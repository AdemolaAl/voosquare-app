'use strict';
/*
 * KYC adapter, provider-agnostic (Smile ID, Sumsub, Veriff or any service with a REST API and a webhook).
 *  Program settings → kyc.provider: { kind: 'manual' | 'http', name, api_base, api_key, webhook_secret }.
 *  - http: POST {api_base}/verifications { reference: "aff-<id>", callback_url, redirect_url } with Bearer api_key
 *    → { id, url } (the hosted verification page). The provider then calls POST /api/aff/hooks/kyc with
 *    X-KYC-Signature: hex HMAC-SHA256(raw body, webhook_secret) and { reference | id, status }.
 *  - manual (default): the affiliate uploads ID images (uploads purpose `kyc`, private) and a finance or admin user decides.
 *  Statuses: none, pending, verified, rejected.
 */
const config = require('../config');
const D = require('../db');
const C = require('./core');
const N = require('./notify');
const NG = require('../netguard');
const { now, hmac, safeEq } = require('../util');

const MAP = { approved: 'verified', verified: 'verified', completed: 'verified', passed: 'verified', success: 'verified', rejected: 'rejected', declined: 'rejected', failed: 'rejected', pending: 'pending', review: 'pending', in_progress: 'pending', submitted: 'pending' };
const provider = () => C.settings().kyc.provider || { kind: 'manual' };

function state(a) {
  const docs = D.all('SELECT id, upload_id, doc_type, created_at FROM aff_kyc_docs WHERE affiliate_id=? ORDER BY id DESC LIMIT 10', a.id);
  const p = provider();
  return { status: a.kyc_status || 'none', reason: a.kyc_reason || '', updated_at: a.kyc_updated_at || null, mode: p.kind === 'http' && p.api_base ? 'provider' : 'manual', provider: p.kind === 'http' ? p.name || 'Verification provider' : '', documents: docs.length };
}
function setStatus(a, status, { reason = '', ref, actor = null } = {}) {
  D.run('UPDATE aff_affiliates SET kyc_status=?, kyc_reason=?, kyc_provider_ref=COALESCE(?, kyc_provider_ref), kyc_updated_at=?, updated_at=? WHERE id=?', status, C.clean(reason, 300), ref || null, now(), now(), a.id);
  C.audit(actor, 'kyc.' + status, { affiliate_id: a.id, after: { reason } });
  if (status === 'verified') N.emit(a, 'approved', { text: 'Your identity is verified. Payouts are open.', noApp: false });
  if (status === 'rejected') N.emit(a, 'approved', { text: `We could not verify your identity${reason ? ': ' + reason : ''}. Try again from the Payouts page or message your manager.` });
}
async function start(a) {
  if (a.kyc_status === 'verified') C.fail(409, 'You are already verified.');
  const p = provider();
  if (p.kind === 'http' && p.api_base) {
    let r;
    try {
      r = await NG.guardedJson(p.api_base.replace(/\/+$/, '') + '/verifications', { method: 'POST', headers: { Authorization: `Bearer ${p.api_key || ''}`, 'Content-Type': 'application/json', 'Idempotency-Key': `vsa-kyc-${a.id}-${a.kyc_updated_at || 0}` }, // same key for double clicks; a new attempt after a result gets a new one
        body: JSON.stringify({ reference: `aff-${a.id}`, callback_url: `${config.baseUrl}/api/aff/hooks/kyc`, redirect_url: `${config.baseUrl}/affiliates#/aff/payouts` }), timeoutMs: 12_000 });
    } catch (e) { C.fail(502, `The verification service could not be reached: ${e.message}`); }
    if (!r.ok || !r.data || !r.data.url) C.fail(502, `The verification service did not return a link (HTTP ${r.status}).`);
    const url = String(r.data.url);
    if (!/^https?:\/\//.test(url)) C.fail(502, 'The verification service returned an invalid link.');
    setStatus(a, 'pending', { ref: String(r.data.id || `aff-${a.id}`).slice(0, 120) });
    return { mode: 'provider', url };
  }
  return { mode: 'manual', upload_purpose: 'kyc', doc_types: ['id_front', 'id_back', 'selfie', 'proof_of_address', 'company'] };
}
function submitDocs(a, list) {
  if (a.kyc_status === 'verified') C.fail(409, 'You are already verified.');
  const items = (Array.isArray(list) ? list : []).slice(0, 6);
  if (!items.length) C.fail(400, 'Add at least one document.');
  for (const it of items) {
    const id = String(it.upload_id || '');
    const u = D.get("SELECT * FROM uploads WHERE id=? AND deleted=0 AND purpose='kyc'", id);
    if (!u || u.user_id !== a.user_id) C.fail(400, 'That document is no longer available. Add it again.');
    D.run('UPDATE uploads SET attached_to=? WHERE id=?', `kyc:${a.id}`, id);
    D.insert('aff_kyc_docs', { affiliate_id: a.id, upload_id: id, doc_type: C.clean(it.doc_type, 30) || 'id', created_at: now() });
  }
  setStatus(a, 'pending', { actor: a.user_id });
  return state(C.byId(a.id));
}
function decide(me, a, status, reason) {
  if (!['verified', 'rejected'].includes(status)) C.fail(400, 'Choose verified or rejected.');
  if (a.user_id === me.id) C.fail(403, 'You cannot verify yourself.');
  if (status === 'rejected' && C.clean(reason, 300).length < 3) C.fail(400, 'Add a short reason. The affiliate sees it.');
  setStatus(a, status, { reason, actor: me });
  return C.byId(a.id);
}
/** Provider webhook. Raw body HMAC-SHA256 with the provider's webhook secret, hex, in X-KYC-Signature (optionally "sha256=..."). */
function webhook(headers, raw) {
  const p = provider();
  if (!p.webhook_secret) C.fail(404, 'Not configured.');
  const sig = String(headers['x-kyc-signature'] || headers['x-signature'] || '').replace(/^sha256=/, '');
  if (!safeEq(sig, hmac(p.webhook_secret, raw))) C.fail(401, 'Bad signature');
  const b = C.json(raw.toString('utf8'), {});
  const ref = String(b.reference || b.external_id || '');
  let a = /^aff-(\d+)$/.test(ref) ? C.byId(Number(ref.slice(4))) : null;
  if (!a && (b.id || b.provider_ref)) a = C.hydrate(D.get("SELECT * FROM aff_affiliates WHERE kyc_provider_ref<>'' AND kyc_provider_ref=?", String(b.id || b.provider_ref)));
  if (!a) C.fail(404, 'Unknown reference');
  const st = MAP[String(b.status || '').toLowerCase()];
  if (!st) C.fail(400, 'Unknown status');
  setStatus(a, st, { reason: C.clean(b.reason, 300) });
  return { ok: true, status: st };
}

module.exports = { state, start, submitDocs, decide, webhook, setStatus, MAP };
