'use strict';
/*
 * Affiliate payouts (separate from member referral payouts in src/referrals.js).
 *
 *  - Request: the full available balance (commissions `available` and not yet in a payout, clawbacks included), at least
 *    the method minimum ($50 USDT TRC20, $100 BTC), one open request at a time, KYC per settings, a valid saved wallet
 *    (TRC20 Base58Check and BTC bech32/bech32m/Base58Check checksums). The request snapshots the wallet and its line items.
 *  - Four eyes: nobody acts on their own payout. Above the limit ($2,000 by default) one finance user approves and a
 *    different one sends. A staff member who approved a clawback in a payout cannot mark that payout paid.
 *  - Sending: manual by default (send from the Zedapex wallet, then "Mark paid" with the transaction hash) or through a
 *    generic HTTP provider configured in Program settings (called through src/netguard.js; provider webhook or status check).
 *  - Receipts: every paid payout gets a receipt number and a PDF (src/pdf.js) with the VooSquare mark, line items by product
 *    and type, network, wallet and transaction hash. Monthly statements as JSON and PDF.
 *  Statuses: requested → (approved) → processing → paid, or rejected (Not sent), cancelled (by the affiliate), held (review).
 */
const crypto = require('node:crypto');
const config = require('../config');
const D = require('../db');
const C = require('./core');
const N = require('./notify');
const PDF = require('../pdf');
const NG = require('../netguard');
const REF = require('../referrals');
const { now, hmac, safeEq } = require('../util');

const OPEN = ['requested', 'approved', 'processing', 'held'];
const METHOD_LABEL = { usdt_trc20: 'USDT (TRC20)', btc: 'BTC' };
const EXPLORER = { usdt_trc20: (h) => `https://tronscan.org/#/transaction/${h}`, btc: (h) => `https://mempool.space/tx/${h}` };

/* ------------------------------------------------------------------ wallets */
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58check(a, versions) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{25,35}$/.test(a)) return false;
  let n = 0n; for (const ch of a) n = n * 58n + BigInt(B58.indexOf(ch));
  let hex = n.toString(16); if (hex.length % 2) hex = '0' + hex;
  let b = Buffer.from(hex, 'hex');
  const lead = a.match(/^1*/)[0].length; b = Buffer.concat([Buffer.alloc(lead), b]);
  if (b.length !== 25 || !versions.includes(b[0])) return false;
  const sha = (x) => crypto.createHash('sha256').update(x).digest();
  return sha(sha(b.subarray(0, 21))).subarray(0, 4).equals(b.subarray(21));
}
const BECH = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
function polymod(v) { const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]; let c = 1; for (const x of v) { const b = c >>> 25; c = ((c & 0x1ffffff) << 5) ^ x; for (let i = 0; i < 5; i++) if ((b >>> i) & 1) c ^= G[i]; } return c >>> 0; }
function bech32Ok(addr) {
  if (addr !== addr.toLowerCase() && addr !== addr.toUpperCase()) return false;
  const a = addr.toLowerCase();
  const pos = a.lastIndexOf('1');
  if (pos < 1 || pos + 7 > a.length || a.length > 90) return false;
  const hrp = a.slice(0, pos); if (hrp !== 'bc') return false;
  const data = [...a.slice(pos + 1)].map((c) => BECH.indexOf(c));
  if (data.some((x) => x < 0)) return false;
  const exp = [...[...hrp].map((c) => c.charCodeAt(0) >> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31)];
  const chk = polymod([...exp, ...data]);
  const ver = data[0];
  if (ver === 0 && chk !== 1) return false;
  if (ver > 0 && chk !== 0x2bc830a3) return false;
  if (ver > 16) return false;
  // Witness program length: 5-bit groups to bytes.
  const prog = data.slice(1, -6); let acc = 0; let bits = 0; const out = [];
  for (const v of prog) { acc = (acc << 5) | v; bits += 5; while (bits >= 8) { bits -= 8; out.push((acc >> bits) & 255); } }
  if (bits >= 5 || ((acc << (8 - bits)) & 255)) return false;
  if (out.length < 2 || out.length > 40) return false;
  if (ver === 0 && out.length !== 20 && out.length !== 32) return false;
  return true;
}
function btcOk(a) { a = String(a || '').trim(); if (/^(bc1|BC1)/.test(a)) return bech32Ok(a); if (/^[13]/.test(a)) return b58check(a, [0x00, 0x05]); return false; }
/** Check a wallet for a method. Returns the cleaned address or throws a 400 with plain language. */
function cleanWallet(method, addr) {
  addr = String(addr || '').trim();
  if (method === 'usdt_trc20') {
    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(addr)) C.fail(400, 'That is not a USDT (TRC20) address. It starts with T and has 34 letters and numbers.');
    if (!REF.tronOk(addr)) C.fail(400, 'That USDT (TRC20) address is not valid. Check each character.');
    return addr;
  }
  if (method === 'btc') { if (!btcOk(addr)) C.fail(400, 'That BTC address is not valid. Check each character.'); return addr; }
  C.fail(400, 'Choose USDT (TRC20) or BTC.');
}

/* ------------------------------------------------------------------ views */
const openPayout = (affId) => D.get(`SELECT * FROM aff_payouts WHERE affiliate_id=? AND status IN ('requested','approved','processing','held') ORDER BY id DESC LIMIT 1`, affId);
function lineItems(payoutId) {
  // A manual adjustment keeps its own line with the reason the affiliate was told (QA-33), so the receipt explains it.
  return D.all(`SELECT type, product_key, COALESCE(special_bp,0) sp, CASE WHEN type='adjustment' OR COALESCE(uniq_key,'') LIKE 'adj:%' THEN COALESCE(reason,'') ELSE '' END rsn,
      COUNT(*) n, SUM(amount_cents) s FROM aff_commissions WHERE payout_id=? GROUP BY type, product_key, sp, rsn ORDER BY s DESC`, payoutId)
    .map((r) => ({ type: r.type, product_key: r.product_key, product: r.product_key ? (C.product(r.product_key) || { name: r.product_key }).name : '', count: r.n, amount_cents: r.s, special_bp: r.sp, special: r.sp > 0, reason: r.rsn || '' }));
}
const TYPE_LABEL = { revshare: 'RevShare', cpa: 'CPA', hybrid_cpa: 'Hybrid CPA', sub_override: 'Sub-affiliate earnings', adjustment: 'Adjustment', clawback: 'Reversal', contest_prize: 'Contest prize' };
const STATUS_LABEL = { requested: 'Requested', approved: 'Approved', processing: 'Sending', paid: 'Paid', rejected: 'Not sent', cancelled: 'Cancelled', held: 'Under review' };
function view(p, { reveal = true } = {}) {
  return {
    id: p.id, amount_cents: p.amount_cents, fee_cents: p.fee_cents, net_cents: p.amount_cents - p.fee_cents, method: p.method, method_label: METHOD_LABEL[p.method] || p.method,
    wallet: reveal ? p.wallet : C.maskWallet(p.wallet), wallet_masked: C.maskWallet(p.wallet), status: p.status, status_label: STATUS_LABEL[p.status] || p.status,
    requested_at: p.requested_at, sla_due_at: p.sla_due_at, approved_at: p.approved_at, processing_at: p.processing_at, paid_at: p.paid_at,
    tx_hash: p.tx_hash, explorer_url: p.tx_hash && EXPLORER[p.method] ? EXPLORER[p.method](p.tx_hash) : '', provider: p.provider, provider_ref: p.provider_ref,
    reason: p.reason, hold_reason: p.status === 'held' ? 'Under review' : '', note: p.note, receipt_no: p.receipt_no || null,
    receipt_url: p.receipt_no ? `/api/aff/payouts/${p.id}/receipt.pdf` : null, period_from: p.period_from, period_to: p.period_to, four_eyes: p.amount_cents > C.settings().payouts.four_eyes_cents,
  };
}

/* ------------------------------------------------------------------ KYC rule */
function kycRequired(a, amountCents) {
  const k = C.settings().kyc;
  if (a.kyc_status === 'verified') return false;
  if (k.required === 'off') return false;
  if (k.required === 'always') return true;
  if (k.required === 'threshold') return amountCents > (k.threshold_cents || 0);
  const paidBefore = D.get("SELECT 1 FROM aff_payouts WHERE affiliate_id=? AND status='paid' LIMIT 1", a.id);
  return !paidBefore && amountCents > (k.threshold_cents || 0);
}

/* ------------------------------------------------------------------ affiliate actions */
function request(a, { method } = {}, at = now()) {
  if (a.status === 'suspended') C.fail(403, 'Your affiliate account is paused while we review activity. Earnings are held, not lost. Your manager will contact you within 2 business days.');
  if (a.status !== 'approved') C.fail(403, 'Payouts open after approval.');
  // Updated terms (v1.1, 2026-10-05): payout requests wait until the affiliate accepts them. Earning never stops.
  const ts = C.termsState(a);
  if (ts.needs_accept) C.fail(409, `We've updated the affiliate terms (${ts.current}). Accept them to request a payout. Your earnings keep growing in the meantime, nothing is lost.`, { terms_required: true, terms_version: ts.current });
  const cfg = C.settings().payouts;
  method = method || a.payout_method || 'usdt_trc20';
  const m = cfg.methods[method];
  if (!m || !m.enabled) C.fail(400, 'Choose USDT (TRC20) or BTC.');
  const wallet = method === 'btc' ? a.wallet_btc : a.wallet_usdt;
  if (!wallet) C.fail(400, `Add your ${METHOD_LABEL[method]} address in Settings first.`);
  cleanWallet(method, wallet);
  return D.tx(() => {
    if (openPayout(a.id)) C.fail(409, 'You already have a payout request open. Cancel it or wait until it is paid.');
    const rows = D.all("SELECT id, amount_cents, created_at FROM aff_commissions WHERE affiliate_id=? AND status='available' AND payout_id IS NULL", a.id);
    const total = rows.reduce((s, r) => s + r.amount_cents, 0);
    if (total < m.min_cents) C.fail(400, `Your available balance is ${C.fmtUsd(Math.max(0, total))}. The minimum is ${C.fmtUsd(m.min_cents)}.`, { available_cents: Math.max(0, total), min_cents: m.min_cents });
    if (kycRequired(a, total)) C.fail(403, 'Before this payout we need to confirm who you are. Start verification on the Payouts page.', { kyc_required: true });
    const tier = C.tiers()[C.effectiveTier(a, at)];
    const fee = m.fee === 'deducted' ? Math.min(total, m.fee_cents || 0) : 0;
    let id;
    try {
      id = D.insert('aff_payouts', { affiliate_id: a.id, amount_cents: total, fee_cents: fee, method, wallet, status: 'requested', requested_at: at, sla_due_at: C.addBusinessDays(at, tier.sla_days || 3),
        provider: cfg.provider && cfg.provider.kind === 'http' ? 'http' : 'manual', period_from: Math.min(...rows.map((r) => r.created_at)), period_to: Math.max(...rows.map((r) => r.created_at)), tier: tier.idx }).id;
    } catch (e) { if (/UNIQUE/i.test(String(e.message))) C.fail(409, 'You already have a payout request open.'); throw e; }
    D.run(`UPDATE aff_commissions SET payout_id=? WHERE id IN (${rows.map(() => '?').join(',')})`, id, ...rows.map((r) => r.id));
    const p = D.get('SELECT * FROM aff_payouts WHERE id=?', id);
    C.audit(a.user_id, 'payout.request', { affiliate_id: a.id, target: `#${id} ${C.fmtUsd(total)}` });
    const days = tier.sla_days || 3;
    N.emit(a, 'payout_requested', { text: `Payout request received: ${C.fmtUsd(total)} in ${METHOD_LABEL[method]}. We send it within ${days} business ${days === 1 ? 'day' : 'days'}.`, email: { amount: C.fmtUsd(total), method: `${METHOD_LABEL[method]} · ${C.maskWallet(wallet)}`, days: String(days), payout_id: String(id) } });
    return p;
  });
}
function cancel(a, id) {
  const p = D.get('SELECT * FROM aff_payouts WHERE id=? AND affiliate_id=?', Number(id), a.id);
  if (!p) C.fail(404, 'Payout not found.');
  if (p.status !== 'requested') C.fail(409, p.status === 'processing' ? 'We are already sending this payout, so it cannot be cancelled.' : `This payout is already ${STATUS_LABEL[p.status] || p.status}.`);
  D.tx(() => {
    if (!D.run("UPDATE aff_payouts SET status='cancelled', reason='Cancelled by you' WHERE id=? AND status='requested'", p.id).changes) C.fail(409, 'This payout just changed. Refresh to see it.');
    D.run('UPDATE aff_commissions SET payout_id=NULL WHERE payout_id=?', p.id);
  });
  C.audit(a.user_id, 'payout.cancel', { affiliate_id: a.id, target: `#${p.id}` });
  return D.get('SELECT * FROM aff_payouts WHERE id=?', p.id);
}

/* ------------------------------------------------------------------ finance actions */
function load(id, me) {
  const p = D.get('SELECT * FROM aff_payouts WHERE id=?', Number(id));
  if (!p) C.fail(404, 'Payout not found.');
  const a = C.byId(p.affiliate_id);
  if (a && me && a.user_id === me.id) C.fail(403, 'This is your own payout. Another finance team member has to handle it.');
  return { p, a };
}
const big = (p) => p.amount_cents > C.settings().payouts.four_eyes_cents;
function move(p, from, sets) {
  const keys = Object.keys(sets);
  const r = D.run(`UPDATE aff_payouts SET ${keys.map((k) => k + '=?').join(',')} WHERE id=? AND status IN (${from.map(() => '?').join(',')})`, ...keys.map((k) => sets[k]), p.id, ...from);
  if (!r.changes) C.fail(409, `This payout is ${STATUS_LABEL[D.get('SELECT status FROM aff_payouts WHERE id=?', p.id).status]} now. Refresh to see it.`);
  return D.get('SELECT * FROM aff_payouts WHERE id=?', p.id);
}
function approve(me, id, at = now()) {
  const { p } = load(id, me);
  if (!big(p)) C.fail(400, 'Only payouts above the four-eyes limit need a separate approval. Mark it sending or paid.');
  const out = move(p, ['requested'], { status: 'approved', approved_by: me.id, approved_at: at });
  C.audit(me, 'payout.approve', { affiliate_id: p.affiliate_id, target: `#${p.id} ${C.fmtUsd(p.amount_cents)}` });
  return out;
}
function hold(me, id, reason, at = now()) {
  const { p } = load(id, me);
  reason = C.clean(reason, 300);
  if (reason.length < 3) C.fail(400, 'Add a reason for the hold.');
  const out = move(p, ['requested', 'approved'], { status: 'held', hold_reason: reason, note: `Held ${C.dayKey(at)}` });
  C.audit(me, 'payout.hold', { affiliate_id: p.affiliate_id, target: `#${p.id}`, after: { reason } });
  return out;
}
function release(me, id) {
  const { p } = load(id, me);
  const out = move(p, ['held'], { status: p.approved_by ? 'approved' : 'requested', hold_reason: '' });
  C.audit(me, 'payout.release', { affiliate_id: p.affiliate_id, target: `#${p.id}` });
  return out;
}
function checkSender(me, p) {
  if (big(p)) {
    if (p.status !== 'approved' && p.status !== 'processing') C.fail(409, 'Payouts above the four-eyes limit need approval by one finance user first.');
    if (p.approved_by === me.id) C.fail(403, 'You approved this payout. Another finance user has to send it.');
  }
  const cb = D.get("SELECT 1 FROM aff_commissions WHERE payout_id=? AND type='clawback' AND approved_by=? LIMIT 1", p.id, me.id);
  if (cb) C.fail(403, 'You approved a clawback in this payout. Another finance user has to mark it.');
}
async function processing(me, id, at = now()) {
  const { p, a } = load(id, me);
  checkSender(me, p);
  const from = big(p) ? ['approved'] : ['requested', 'approved'];
  const prov = C.settings().payouts.provider;
  if (!(prov && prov.kind === 'http' && prov.api_base)) {
    const out = move(p, from, { status: 'processing', processing_by: me.id, processing_at: at });
    C.audit(me, 'payout.processing', { affiliate_id: p.affiliate_id, target: `#${p.id} ${C.fmtUsd(p.amount_cents)}` });
    return out;
  }
  // Claim, then call (CA-2). The conditional UPDATE lets exactly one request move the payout to "sending"; every other
  // click, finance user or retry gets a 409 and never reaches the provider. The provider also gets an Idempotency-Key
  // (the same for every attempt at this payout), and a failed call puts the payout back where it was.
  const claimed = move(p, from.includes(p.status) ? [p.status] : from, { status: 'processing', processing_by: me.id, processing_at: at, provider: 'http', provider_status: 'sending' });
  let r;
  try { r = await providerCreate(prov, p, a); } catch (e) {
    D.run("UPDATE aff_payouts SET status=?, processing_by=?, processing_at=?, provider=?, provider_status=? WHERE id=? AND status='processing' AND provider_status='sending'",
      p.status, p.processing_by ?? null, p.processing_at ?? null, p.provider || 'manual', p.provider_status || '', p.id);
    C.audit(me, 'payout.send_failed', { affiliate_id: p.affiliate_id, target: `#${p.id} ${C.fmtUsd(p.amount_cents)}`, after: { error: String(e.message || e).slice(0, 200) } });
    throw e;
  }
  // The provider took it: record its reference even if someone changed the payout meanwhile (never lose a sent payout).
  D.run("UPDATE aff_payouts SET provider_ref=?, provider_status=?, tx_hash=CASE WHEN ?<>'' THEN ? ELSE tx_hash END WHERE id=?", r.ref, r.status || 'pending', r.tx_hash || '', r.tx_hash || '', claimed.id);
  C.audit(me, 'payout.processing', { affiliate_id: p.affiliate_id, target: `#${p.id} ${C.fmtUsd(p.amount_cents)} via provider ${r.ref}` });
  return D.get('SELECT * FROM aff_payouts WHERE id=?', p.id);
}
function paid(me, id, { tx_hash, note } = {}, at = now(), { system = false } = {}) {
  const { p, a } = load(id, system ? null : me);
  tx_hash = C.clean(tx_hash, 200);
  if (tx_hash.length < 8) C.fail(400, 'Paste the transaction hash before marking it paid.');
  if (!system) checkSender(me, p);
  else if (big(p) && !p.approved_by) C.fail(409, 'This payout needs a finance approval first.');
  const receiptNo = `VSA-${C.dayKey(at).slice(0, 4)}-${String(p.id).padStart(6, '0')}`;
  const out = D.tx(() => {
    const r = move(p, big(p) ? ['approved', 'processing'] : ['requested', 'approved', 'processing'], { status: 'paid', paid_by: me ? me.id : null, paid_at: at, tx_hash, note: C.clean(note, 500) || p.note, receipt_no: receiptNo });
    D.run("UPDATE aff_commissions SET status='paid', updated_at=? WHERE payout_id=?", at, p.id);
    D.insert('aff_receipts', { payout_id: p.id, receipt_no: receiptNo, affiliate_id: p.affiliate_id, issued_at: at, data: JSON.stringify(receiptData(r, a)) });
    return r;
  });
  C.audit(me, 'payout.paid', { affiliate_id: p.affiliate_id, target: `#${p.id} ${C.fmtUsd(p.amount_cents)} tx ${tx_hash}` });
  N.emit(a, 'payout_paid', {
    text: `Payout sent: ${C.fmtUsd(p.amount_cents - p.fee_cents)} ${p.method === 'btc' ? 'BTC' : 'USDT'} · tx ${tx_hash.slice(0, 4)}…${tx_hash.slice(-4)} · ${EXPLORER[p.method] ? EXPLORER[p.method](tx_hash) : ''}`,
    email: { amount: C.fmtUsd(p.amount_cents - p.fee_cents), method: `${METHOD_LABEL[p.method]} · ${C.maskWallet(p.wallet)}`, reference: tx_hash, receipt_no: receiptNo, receipt_url: `${config.baseUrl}/api/aff/payouts/${p.id}/receipt.pdf`, payout_id: String(p.id), date: C.dateShort(at) },
  });
  return out;
}
function reject(me, id, reason, at = now()) {
  const { p, a } = load(id, me);
  reason = C.clean(reason, 500);
  if (reason.length < 3) C.fail(400, 'Add a short reason. The affiliate sees it.');
  const out = D.tx(() => {
    const r = move(p, ['requested', 'approved', 'processing', 'held'], { status: 'rejected', reason, paid_by: me.id, paid_at: null });
    D.run('UPDATE aff_commissions SET payout_id=NULL WHERE payout_id=?', p.id);
    return r;
  });
  C.audit(me, 'payout.reject', { affiliate_id: p.affiliate_id, target: `#${p.id}`, after: { reason } });
  N.emit(a, 'payout_rejected', { text: `Your payout of ${C.fmtUsd(p.amount_cents)} was not sent: ${reason}. The amount is back in your available balance.`, email: { amount: C.fmtUsd(p.amount_cents), reason } });
  return out;
}

/* ------------------------------------------------------------------ provider adapter (generic HTTP) */
function provHeaders(prov, idempotencyKey) { return { Authorization: `Bearer ${prov.api_key || ''}`, 'Content-Type': 'application/json', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) }; }
async function providerCreate(prov, p, a) {
  const body = { reference: `vsa-payout-${p.id}`, amount_usd: ((p.amount_cents - p.fee_cents) / 100).toFixed(2), currency: p.method === 'btc' ? 'BTC' : 'USDT', network: p.method === 'btc' ? 'BTC' : 'TRC20', address: p.wallet, callback_url: `${config.baseUrl}/api/aff/hooks/payouts`, affiliate: `AF-${a.id}` };
  let r;
  try { r = await NG.guardedJson(prov.api_base.replace(/\/+$/, '') + '/payouts', { method: 'POST', headers: provHeaders(prov, `vsa-payout-${p.id}`), body: JSON.stringify(body), timeoutMs: 12_000 }); }
  catch (e) { C.fail(502, `The payout provider could not be reached: ${e.message}`); }
  if (!r.ok || !r.data || !(r.data.id || r.data.reference)) C.fail(502, `The payout provider refused the payout (HTTP ${r.status}).`);
  return { ref: String(r.data.id || r.data.reference).slice(0, 120), status: C.clean(r.data.status, 30), tx_hash: C.clean(r.data.tx_hash, 200) };
}
/** Ask the provider for the status of a payout sent through it; marks it paid when the provider says so. */
async function providerCheck(me, id) {
  const p = D.get('SELECT * FROM aff_payouts WHERE id=?', Number(id));
  if (!p) C.fail(404, 'Payout not found.');
  const prov = C.settings().payouts.provider;
  if (!prov || prov.kind !== 'http' || !p.provider_ref) C.fail(400, 'This payout was not sent through a provider.');
  let r;
  try { r = await NG.guardedJson(`${prov.api_base.replace(/\/+$/, '')}/payouts/${encodeURIComponent(p.provider_ref)}`, { headers: provHeaders(prov), timeoutMs: 10_000 }); }
  catch (e) { C.fail(502, `The payout provider could not be reached: ${e.message}`); }
  const st = String((r.data && r.data.status) || '').toLowerCase();
  D.run('UPDATE aff_payouts SET provider_status=? WHERE id=?', st.slice(0, 30), p.id);
  if (['paid', 'completed', 'success', 'sent'].includes(st) && r.data.tx_hash && p.status !== 'paid') return paid(null, p.id, { tx_hash: r.data.tx_hash }, now(), { system: true });
  return D.get('SELECT * FROM aff_payouts WHERE id=?', p.id);
}
/** Provider webhook: X-Payout-Signature = hex HMAC-SHA256 of the raw body with the provider's webhook secret. */
function providerWebhook(headers, raw) {
  const prov = C.settings().payouts.provider;
  if (!prov || !prov.webhook_secret) C.fail(404, 'Not configured.');
  const sig = String(headers['x-payout-signature'] || headers['x-signature'] || '').replace(/^sha256=/, '');
  if (!safeEq(sig, hmac(prov.webhook_secret, raw))) C.fail(401, 'Bad signature');
  const b = C.json(raw.toString('utf8'), {});
  const ref = String(b.reference || '').replace(/^vsa-payout-/, '');
  const p = D.get('SELECT * FROM aff_payouts WHERE id=? OR (provider_ref<>\'\' AND provider_ref=?)', Number(ref) || -1, String(b.id || b.provider_ref || ''));
  if (!p) C.fail(404, 'Unknown payout');
  const st = String(b.status || '').toLowerCase();
  D.run('UPDATE aff_payouts SET provider_status=? WHERE id=?', st.slice(0, 30), p.id);
  if (['paid', 'completed', 'success', 'sent'].includes(st) && b.tx_hash && p.status !== 'paid') paid(null, p.id, { tx_hash: b.tx_hash }, now(), { system: true });
  if (['failed', 'rejected', 'cancelled'].includes(st) && p.status === 'processing') D.run("UPDATE aff_payouts SET status=?, provider_status=? WHERE id=?", p.approved_by ? 'approved' : 'requested', st, p.id);
  return { ok: true };
}

/* ------------------------------------------------------------------ receipts and statements */
function receiptData(p, a) {
  const user = D.get('SELECT name, email FROM users WHERE id=?', a.user_id);
  return {
    receipt_no: p.receipt_no, paid_at: p.paid_at, requested_at: p.requested_at, affiliate: { id: `AF-${a.id}`, name: a.display_name || (user && user.name) || '', company: a.company || '', country: a.country || '', email: user ? user.email : '' },
    period_from: p.period_from, period_to: p.period_to, method: METHOD_LABEL[p.method], wallet: p.wallet, tx_hash: p.tx_hash, amount_cents: p.amount_cents, fee_cents: p.fee_cents,
    net_cents: p.amount_cents - p.fee_cents, lines: lineItems(p.id).map((l) => ({ ...l, label: `${l.product ? l.product + ' · ' : ''}${l.reason ? (l.amount_cents < 0 ? 'Deduction' : 'Adjustment') : TYPE_LABEL[l.type] || l.type}${l.special_bp ? ` · Special deal ${l.special_bp / 100}%` : ''}${l.reason ? `: ${l.reason}` : ''}`.slice(0, 70) })),
  };
}
const fmtDate = (t) => (t ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: C.tz() }) : '');
function pdfDoc(title, d, lines, totals) {
  const W = 595.28; const H = 841.89; const pg = new PDF.Page(W, H);
  const ink = '#0A1A13'; const muted = '#6A7A73'; const line = '#E3EBE7';
  pg.fill('#FFFFFF').rect(0, 0, W, H);
  pg.fill('#0A1611').rect(0, H - 96, W, 96);
  PDF.mark(pg, 40, H - 70, 40);
  pg.text('VooSquare', 92, H - 50, { font: 'Helvetica-Bold', size: 20, color: '#FFFFFF' });
  pg.text('Affiliates', 92, H - 66, { size: 10, color: '#B9C9C1' });
  pg.text(title, W - 40, H - 48, { font: 'Helvetica-Bold', size: 14, color: '#C9F65B', align: 'right' });
  pg.text(d.number || '', W - 40, H - 66, { size: 10, color: '#B9C9C1', align: 'right' });
  let y = H - 136;
  const kv = (k, v, x, yy) => { pg.text(k, x, yy, { size: 8.5, color: muted }); pg.text(String(v || '-'), x, yy - 14, { font: 'Helvetica-Bold', size: 10.5, color: ink }); };
  kv('Paid to', d.to.name, 40, y); kv('Affiliate ID', d.to.id, 230, y); kv('Country', d.to.country || '-', 380, y); kv('Date', d.date, 470, y);
  y -= 40;
  for (const [k, v] of d.rows) { kv(k, v, 40, y); y -= 34; }
  y -= 6;
  pg.stroke(line, 1).line(40, y, W - 40, y); y -= 20;
  pg.text('Line items', 40, y, { font: 'Helvetica-Bold', size: 11, color: ink }); pg.text('Items', 400, y, { size: 9, color: muted, align: 'right' }); pg.text('Amount (USD)', W - 40, y, { size: 9, color: muted, align: 'right' });
  y -= 18;
  for (const l of lines.slice(0, 28)) {
    pg.text(l.label, 40, y, { size: 10, color: ink }); pg.text(String(l.count ?? ''), 400, y, { size: 10, color: muted, align: 'right' });
    pg.text(C.fmtUsd(l.amount_cents), W - 40, y, { size: 10, color: l.amount_cents < 0 ? '#B42318' : ink, align: 'right' });
    y -= 6; pg.stroke(line, 0.5).line(40, y, W - 40, y); y -= 14;
  }
  if (!lines.length) { pg.text('No items.', 40, y, { size: 10, color: muted }); y -= 20; }
  y -= 6;
  for (const [k, v, bold] of totals) { pg.text(k, 380, y, { size: bold ? 11 : 10, font: bold ? 'Helvetica-Bold' : 'Helvetica', color: bold ? ink : muted }); pg.text(v, W - 40, y, { size: bold ? 12 : 10, font: bold ? 'Helvetica-Bold' : 'Helvetica', color: ink, align: 'right' }); y -= 18; }
  pg.para('Commissions are paid centrally by Zedapex Limited, Lagos, under the VooSquare Affiliate Program terms. Crypto payments sent to the address you saved are final. You are responsible for taxes on your earnings.', 40, 70, W - 80, { size: 8.5, color: muted });
  pg.text('Zedapex Limited, Lagos · voosquare.com', 40, 40, { size: 8.5, color: muted });
  return PDF.build([pg], { title: `${title} ${d.number || ''}`, author: 'VooSquare' });
}
function receiptPdf(payoutId) {
  const r = D.get('SELECT * FROM aff_receipts WHERE payout_id=?', Number(payoutId));
  if (!r) C.fail(404, 'This payout has no receipt yet. Receipts are issued when it is paid.');
  const d = C.json(r.data, {});
  return pdfDoc('Payout receipt', {
    number: d.receipt_no, date: fmtDate(d.paid_at), to: d.affiliate,
    rows: [['Period', `${fmtDate(d.period_from)} to ${fmtDate(d.period_to)}`], ['Network', d.method], ['Wallet', d.wallet], ['Transaction hash', d.tx_hash]],
  }, d.lines || [], [['Earnings', C.fmtUsd(d.amount_cents)], ['Network fee', d.fee_cents ? '-' + C.fmtUsd(d.fee_cents) : 'Covered by Zedapex'], ['Amount sent', C.fmtUsd(d.net_cents), true]]);
}
/*
 * A month's statement (money audit MN-5, MN-6). Earnings belong to the month of their date (earned_at: the payment date
 * for RevShare, the approval date for CPA, the reversal date for clawbacks; Africa/Lagos months), like revenue and
 * qualified customers in the reports. "Earned" is what was earned: available, paid, on hold and waiting for activation.
 * CPA still in review is not earned yet and is shown apart (in_review_cents); declined CPA never counts.
 * Stable: a line that was earned when the month closed stays in that month even if it is cancelled later while held (the
 * cancellation shows as a reversal in the month it happened, like a clawback). A payment reported after the month closed
 * still belongs to its payment month; late_cents says how much of "earned" arrived after the month ended.
 */
const MODEL_SWAP = ['cpa_model', 'hybrid_rerate']; // provisional RevShare replaced at qualification: never earned
function statement(a, key) {
  if (!/^\d{4}-\d{2}$/.test(String(key || ''))) C.fail(400, 'Choose a month as YYYY-MM.');
  const [from, to] = C.monthRange(key);
  const rows = D.all(`SELECT type, product_key, COALESCE(special_bp,0) sp, amount_cents, status, reason, COALESCE(earned_at, created_at) e, created_at, updated_at FROM aff_commissions
    WHERE affiliate_id=? AND ((COALESCE(earned_at, created_at)>=? AND COALESCE(earned_at, created_at)<?) OR (status='reversed' AND updated_at>=? AND updated_at<?))`, a.id, from, to, from, to);
  const by = new Map(); let inReview = 0; let late = 0;
  const add = (type, r, cents) => {
    const k = `${type}|${r.product_key}|${r.sp}`;
    const l = by.get(k) || { type, product_key: r.product_key, sp: r.sp, n: 0, s: 0 };
    l.n++; l.s += cents; by.set(k, l);
  };
  for (const r of rows) {
    const inMonth = r.e >= from && r.e < to;
    const swapped = MODEL_SWAP.includes(r.reason);
    if (inMonth) {
      if (r.status === 'in_review') { inReview += r.amount_cents; continue; }
      const earned = ['available', 'paid', 'hold', 'pending_activation'].includes(r.status) || (r.status === 'reversed' && !swapped && r.updated_at >= to);
      if (earned) { add(r.type, r, r.amount_cents); if (r.created_at >= to) late += r.amount_cents; }
    } else if (r.status === 'reversed' && !swapped && r.e < from && r.amount_cents > 0) {
      add('clawback', r, -r.amount_cents); // earned in an earlier month, cancelled (while held) in this one
    }
  }
  const name = (k) => (k ? (C.product(k) || { name: k }).name : '');
  const lines = [...by.values()].sort((x, y) => y.s - x.s).map((r) => ({ type: r.type, product_key: r.product_key, product: name(r.product_key), count: r.n, amount_cents: r.s, special_bp: r.sp,
    label: `${r.product_key ? name(r.product_key) + ' · ' : ''}${TYPE_LABEL[r.type] || r.type}${r.sp ? ` · Special deal ${r.sp / 100}%` : ''}` }));
  const earned = lines.reduce((s2, l) => s2 + l.amount_cents, 0);
  const paidRows = D.all("SELECT * FROM aff_payouts WHERE affiliate_id=? AND status='paid' AND paid_at>=? AND paid_at<? ORDER BY paid_at", a.id, from, to).map((p) => view(p));
  return { month: key, from, to, lines, earned_cents: earned, in_review_cents: inReview, late_cents: late, paid_cents: paidRows.reduce((s2, p) => s2 + p.amount_cents, 0), payouts: paidRows };
}
function statementPdf(a, key) {
  const s = statement(a, key);
  const user = D.get('SELECT name FROM users WHERE id=?', a.user_id);
  const totals = [['Earned this month', C.fmtUsd(s.earned_cents), true], ['Paid out this month', C.fmtUsd(s.paid_cents)]];
  if (s.late_cents) totals.push(['Reported late (incl.)', C.fmtUsd(s.late_cents)]);
  if (s.in_review_cents) totals.push(['In review (not earned)', C.fmtUsd(s.in_review_cents)]);
  return pdfDoc('Monthly statement', {
    number: `Statement ${key}`, date: fmtDate(now()), to: { name: a.display_name || (user && user.name) || '', id: `AF-${a.id}`, country: a.country },
    rows: [['Month', key], ['Payouts paid this month', `${s.payouts.length} · ${C.fmtUsd(s.paid_cents)}`]],
  }, s.lines, totals);
}

module.exports = {
  OPEN, METHOD_LABEL, STATUS_LABEL, TYPE_LABEL, cleanWallet, btcOk, bech32Ok, b58check, view, lineItems, openPayout, kycRequired,
  request, cancel, approve, hold, release, processing, paid, reject, providerCheck, providerWebhook, receiptPdf, statement, statementPdf, receiptData,
};
