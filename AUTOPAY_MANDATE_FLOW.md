# UPI Autopay — per-gym Razorpay + member mandates

How recurring money actually moves, and what each gym must do once.

---

## 1. Each gym connects its own Razorpay

`Settings → Payments — Razorpay`. Money settles into the gym's own bank account;
the platform never holds it. Credentials are encrypted at rest
(`PAYMENT_TOKEN_ENCRYPTION_KEY`) and scoped to that `companyId`.

| Mode | When | Real mandates? | Gym sets up a webhook? |
|---|---|---|---|
| Partner OAuth | production, preferred | yes | **no — platform handles it** |
| Gym's own API keys | until OAuth is approved | yes | yes, in their own dashboard |
| Mock | development only | no — simulated links | no |

### Partner OAuth — one-time platform setup

1. Apply to Razorpay as a Technology Partner and create an app.
2. Register the redirect URI **exactly** as
   `{BACKEND_PUBLIC_URL}/payment-provider/razorpay/callback`.
3. Register **one** app-level webhook at `{BACKEND_PUBLIC_URL}/webhooks/razorpay`
   with the events listed below, and put its signing secret in
   `RAZORPAY_WEBHOOK_SECRET`.
4. Put the app's credentials in `RAZORPAY_PARTNER_CLIENT_ID` /
   `RAZORPAY_PARTNER_CLIENT_SECRET`.

The "Connect with Razorpay" button then appears in Settings on its own. A gym
clicks it, authorises, and is done — no dashboard, no webhook, no secret.

Events for connected accounts arrive on that single endpoint carrying
`account_id`, which is matched to the gym via the `razorpayAccountId` saved at
connect time (our own `notes.companyId` is tried first).

Token handling: access tokens are refreshed automatically shortly before expiry,
refresh tokens rotate, and a failed refresh flips the account to
`NEEDS_REAUTH` so Settings prompts a reconnect instead of silently failing every
charge. `account.app.authorization_revoked` marks the account `REVOKED`.

OAuth token exchange sends `mode=live` in production and `mode=test` outside it,
so a local connect binds the gym's **test** account.

`NODE_ENV=production` blocks the Mock option outright (`mockAvailable: false`,
and `POST /payment-provider/razorpay/mock` returns 400).

### Webhook — required, not optional

A mandate approval and every recurring debit are confirmed by webhook. Without
it a charge stays `pending` forever. The Settings screen shows the exact URL to
paste into the gym's Razorpay dashboard:

```
POST  {BACKEND_PUBLIC_URL}/webhooks/razorpay
```

Events to enable:

```
payment_link.paid   payment.captured   payment.authorized   payment.failed
order.paid          invoice.paid       token.confirmed      token.rejected
token.paused        token.cancelled
```

The gym pastes its signing secret into the same screen
(`POST /payment-provider/razorpay/webhook-secret`). Verification order:

1. that gym's own secret, else
2. `RAZORPAY_WEBHOOK_SECRET` (platform-wide), else
3. **reject** — in production there is no implicit fallback.

Outside production, `RAZORPAY_SKIP_WEBHOOK_VERIFY=true` skips verification for
local testing. In production that flag is ignored.

---

## 2. A member's mandate is created

A plain Razorpay payment link **cannot** create a mandate. With autopay on, the
CRM creates an *authorization link* instead — the member approves the mandate and
pays the first amount in one step.

```
POST /members/checkout   { …, enableAutopay: true }
   │
   ├─ draft member          onboardingStatus=AWAITING_MANDATE, memberStatus=INACTIVE
   ├─ POST /v1/customers    (reused from member.rzpCustomerId when present)
   ├─ POST /v1/subscription_registration/auth_links
   │     subscription_registration: { method, max_amount, expire_at,
   │                                  frequency: 'as_presented' }
   │     amount = what the front desk is collecting now
   │     notes  = { companyId, sessionId, draftMemberId, kind: 'MANDATE' }
   └─ short_url → auto-sent on WhatsApp
                     │
   member approves in UPI app + first debit
                     │
   webhooks: invoice.paid / payment.captured / token.confirmed
                     │
   finalizeFromWebhook()  ← idempotent on providerRef
     member ACTIVE · subscription · mandate(tokenId, customerId, maxAmount,
     expireAt) · ledger payment · invoice
```

`enableAutopay: false` keeps the ordinary one-time payment link.

**If the money arrives but no token does**, the subscription is left on
`billingMode: MANUAL` rather than labelled AUTOPAY with nothing behind it.

### Mandate terms (per gym, `Settings → UPI Autopay`)

| Setting | Default | Meaning |
|---|---|---|
| `autopayMethod` | `upi` | upi / emandate / card / nach |
| `autopayMandateMultiplier` | `2` | per-debit ceiling = plan price × this |
| `autopayMandateValidityMonths` | `60` | how long the mandate stays valid |

The ceiling gives headroom so a plan price rise does not force every member to
re-approve. UPI mandates are capped at ₹1,00,000 per debit.

---

## 3. Recurring charges

The worker sweeps hourly (`AUTOPAY_WORKER_INTERVAL_MS`), or on demand via
`POST /autopay/run` (scoped to the caller's gym).

**What it charges** — dues first, renewal only when the cycle is settled:

- `pendingAmount > 0` → collect the outstanding balance
- else expired → charge `planPrice` and open the next cycle

**Guards before any debit** (`MandatesService.blockers`):

- mandate is ACTIVE, has a token and a Razorpay customer
- mandate not past `expireAt`
- amount within the approved `maxAmount`
- not charged in the last 20 hours
- no charge already awaiting confirmation (6 h window)
- fewer than 3 consecutive failures — after that the mandate is PAUSED

**Outcomes:**

| Razorpay says | What happens |
|---|---|
| `captured` | ledger + invoice immediately |
| `authorized` / `created` | marked pending; the `payment.captured` webhook finishes it |
| `failed` / throws | failure recorded, WhatsApp notice to member, follow-up → PENDING |

A renewal calls `startNewCycle()` **before** applying the payment, so the money
lands against the new cycle's price.

### Billing cycles

`totalPaid` / `pendingAmount` describe the **current cycle only**.
`lifetimePaid` and `renewalCount` carry across cycles, and lifetime revenue
always comes from the payments ledger. Before this, a renewal piled onto the old
totals and a ₹2,000 plan could read `totalPaid: 4000`.

### Renewal length

Extended by the plan's **own** duration (`duration` + `durationType`), and the
price is re-snapshotted from the plan. A quarterly plan moves 3 months, a yearly
plan 12 — previously everything moved exactly 1 month.

---

## 4. Mandate lifecycle

| Webhook | Effect |
|---|---|
| `token.confirmed` | mandate ACTIVE, failure counter cleared |
| `token.paused` | mandate PAUSED — no debits attempted |
| `token.cancelled` / `token.rejected` | mandate dead → subscription back to `MANUAL` |
| `account.app.authorization_revoked` | gym's provider account marked REVOKED |

Staff endpoints:

```
GET  /autopay/mandate/:subscriptionId          mandate health for the CRM badge
POST /autopay/mandate/:subscriptionId/cancel   cancel at Razorpay → MANUAL
```

Cancelling updates local state even if the Razorpay call fails, so the worker
never keeps debiting a mandate someone asked to stop.

---

## 5. Environment discipline

| | development | production |
|---|---|---|
| Mock Razorpay / WhatsApp | allowed | blocked (400) |
| `GET /webhooks/razorpay/mock-pay/:id` | live | 403 |
| Webhook signature | skippable via flag | always verified |
| Missing webhook secret | dev fallback | webhook rejected |
| Dev placeholder secrets | warning only | **server refuses to boot** |

The boot check (`RuntimeService.productionProblems()`) blocks startup on
placeholder `JWT_*` / `SESSION_SECRET` / `PAYMENT_TOKEN_ENCRYPTION_KEY`, a
missing `RAZORPAY_WEBHOOK_SECRET`, or any mock flag left on.

`BACKEND_PUBLIC_URL` must be the real public HTTPS origin in production — it is
both the webhook URL shown to gyms and where Razorpay posts.
