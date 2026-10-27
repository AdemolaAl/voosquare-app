# API versioning rules (`/api/v1` and "Continue with VooSquare")

Every Zedapex tool (Joinvoo, Replyvoo, Castvoo, Spyvoo, Gatevoo...) talks to VooSquare through these addresses. The tools are
deployed separately and on their own schedule, so **a change here must never break a tool that was built against the old
behaviour**. This page is the rule book. The how-to for developers is in [CHANGING-SAFELY.md](CHANGING-SAFELY.md).

## What is frozen

| Address | Used for |
|---|---|
| `POST /api/v1/events` | activity, spend, refunds, plans (feeds dashboards, referrals and affiliate commissions) |
| `GET /api/v1/users/:voo_id` | look up a member |
| `POST /api/v1/support/messages` | send a support message into the one inbox |
| `GET /api/v1/support/tickets/:id/messages` | read a support thread |
| `GET /oauth/authorize`, `POST /oauth/token`, `GET /oauth/userinfo`, `GET /oauth/logout` | "Continue with VooSquare" login |
| `/api/widget/*`, `/widget.js` | the support widget on other websites |

The affiliate program's own API (`docs/AFFILIATE_API.md`) follows the same rules.

## The rules

1. **Only add.** You may add a new optional request field, a new response field, a new endpoint or a new event type.
2. **Never remove, rename or change the type of a response field.** `premium` stays a boolean forever; `ticket_id` stays a number.
   If you need something different, add a new field next to the old one (for example `premium_until` next to `premium`) and keep
   filling the old one.
3. **Never make an optional request field required**, and never start rejecting input that used to be accepted. Add validation
   only for new fields.
4. **Unknown fields are ignored.** VooSquare reads only the fields it knows, so a tool that sends extra fields (or a newer tool
   talking to an older VooSquare after a rollback) keeps working. Tools must do the same with our responses: ignore keys they
   do not know.
5. **Status codes and error shape stay.** Errors are always `{ "error": "<message>" }` (plus optional extra keys) with the same
   status codes (`401` bad key, `400` bad input, `404` not found, `429` slow down).
6. **Same meaning.** A field may never quietly change what it means (for example `value_usd` changing from dollars to cents).
7. **A real breaking change means `/api/v2`.** Build `/api/v2/...` next to v1, move the tools one by one, and keep v1 running
   until the last tool has moved and the request log shows no v1 calls for 30 days. Announce the date to the tool owners.

## How it is enforced

- `test/fixtures/api-v1-shapes.json` lists every response key of the main endpoints with its type. `test/safety.js` calls the
  real endpoints (with extra unknown fields in the requests) and fails if a key is missing or its type changed.
- When you **add** a response field, you may add it to that file too (then it is frozen as well). **Never delete or change a
  line in that file.** If the test fails after your change, your change breaks tools: undo it, do not edit the fixture.
- `npm test` must pass before every deploy.

## Checklist for any change under `/api/v1` or `/oauth`

- [ ] I only added things (rule 1).
- [ ] Old tools that do not send my new field still get the same answer.
- [ ] I updated `docs/INTEGRATION.md` (what tools developers read) with the new field, marked "new, optional".
- [ ] `npm test` is green, including "v1 ... keeps its shape".
