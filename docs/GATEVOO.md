# Gatevoo checkout: what VooSquare needs from Gatevoo's API

VooSquare can take Premium and paid-room payments through **Gatevoo** (Zedapex's own non-custodial crypto checkout, USDT TRC20 and Bitcoin, at gatevoo.com). Gatevoo is still being built, so this file is the contract: if Gatevoo's API does what is written here, the "Gatevoo" payment method in VooSquare works with no code changes.

In VooSquare: **Admin → Payments → Gatevoo** (seeded switched off). Fill in:

| Field | What it is |
|---|---|
| Gatevoo address (`api_base`) | `https://gatevoo.com` unless Gatevoo gives another base URL |
| API key (`api_key`) | Secret merchant key. Sent as `Authorization: Bearer <api_key>` |
| Webhook signing secret (`webhook_secret`) | Shared secret for signing webhooks |
| Coins | USDT (TRC20) and/or Bitcoin |

Then paste the **Webhook URL** shown on the method (`https://<your VooSquare>/api/billing/webhook/<method id>`) into Gatevoo, and press **Test connection**.

Prices are always in USD. The member chooses USDT or BTC on Gatevoo's page.

---

## 1. Create an invoice

`POST {api_base}/api/v1/invoices`
Headers: `Authorization: Bearer {api_key}`, `Content-Type: application/json`

```json
{
  "amount_usd": 20,
  "order_id": "VS-AB12CD34",
  "description": "VooSquare Premium",
  "customer_email": "buyer@example.com",
  "success_url": "https://voosquare.com/app#billing-return:VS-AB12CD34",
  "cancel_url": "https://voosquare.com/app#premium",
  "webhook_url": "https://voosquare.com/api/billing/webhook/7",
  "assets": ["USDT_TRC20", "BTC"]
}
```

Response `200`:

```json
{ "id": "inv_123", "checkout_url": "https://gatevoo.com/pay/inv_123", "status": "pending" }
```

- `checkout_url` must be `https://`. VooSquare redirects the member there.
- `order_id` is VooSquare's order reference. Store it on the invoice and return it in every read and webhook.
- After payment (or cancel), send the member to `success_url` (or `cancel_url`).

## 2. Read an invoice

`GET {api_base}/api/v1/invoices/{id}` with the same `Authorization` header.

```json
{ "id": "inv_123", "order_id": "VS-AB12CD34", "status": "paid", "paid_amount": 20, "asset": "USDT_TRC20", "tx_hash": "b1f0..." }
```

- `status`: `pending` | `paid` | `expired` | `underpaid`
- `paid_amount`: the **USD value** received.

VooSquare grants access only when `status` is `paid`, `paid_amount` ≥ the order's USD price, `id` matches and `order_id` matches. It calls this endpoint when a webhook arrives and when the member's return page polls the order, so a lost webhook never loses a payment.

## 3. Webhook to VooSquare

When an invoice is paid, `POST` to the invoice's `webhook_url`:

Headers: `Content-Type: application/json`, `X-Gatevoo-Signature: <hex HMAC-SHA256 of the raw request body, keyed with webhook_secret>`

```json
{ "type": "invoice.paid", "invoice": { "id": "inv_123", "order_id": "VS-AB12CD34", "status": "paid", "paid_amount": 20, "asset": "USDT_TRC20", "tx_hash": "b1f0..." } }
```

VooSquare:
1. Refuses the call (401) if no secret is saved or the signature is wrong (timing-safe compare).
2. Never trusts the body: it fetches the invoice again with **Read an invoice** and checks it.
3. Is idempotent: repeats of the same webhook do nothing. Retry on any non-2xx response.

Other event types are accepted and ignored.

## 4. Who am I (for "Test connection")

`GET {api_base}/api/v1/me` with the `Authorization` header → `200 { "merchant": { "name": "Zedapex" } }`, or `401` for a bad key. Must have no side effects.

---

## Prompt to paste into Gatevoo's AI builder

> Add a merchant REST API to Gatevoo so other apps (first: VooSquare) can take payments.
> Auth: each merchant has an API key, sent as `Authorization: Bearer <key>`; keys are shown once and can be rotated. Each merchant also sets a webhook signing secret.
> 1. `POST /api/v1/invoices` with JSON `{amount_usd, order_id, description, customer_email, success_url, cancel_url, webhook_url, assets}` where `assets` is a subset of `["USDT_TRC20","BTC"]`. Create an invoice priced in USD, store all fields, return `{id, checkout_url, status:"pending"}`. `checkout_url` is our hosted pay page (https) where the buyer picks USDT TRC20 or BTC, sees the address and exact amount, and pays straight to the merchant's own wallet (non-custodial). After payment redirect to `success_url`; on cancel to `cancel_url`.
> 2. `GET /api/v1/invoices/{id}` returns `{id, order_id, status, paid_amount, asset, tx_hash}`; `status` is `pending|paid|expired|underpaid`; `paid_amount` is the USD value received. Only the owning merchant's key can read it.
> 3. When an invoice becomes paid, POST `{"type":"invoice.paid","invoice":{id, order_id, status, paid_amount, asset, tx_hash}}` to its `webhook_url`, with header `X-Gatevoo-Signature` = lowercase hex HMAC-SHA256 of the exact raw body using the merchant's webhook secret. Retry with backoff for 24 hours until a 2xx response. Deliver at least once.
> 4. `GET /api/v1/me` returns `{merchant:{name}}` for a valid key, 401 otherwise.
> Return JSON errors `{error:"message"}` with proper status codes. Rate-limit per key. Never log keys or secrets.
