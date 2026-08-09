# Code conventions

Rules the codebase already follows. Keep new code inside them so the platform
stays readable as it grows.

---

## 1. No hardcoded URLs, anywhere

Every outward-facing URL comes from a resolver, never from a string literal.

| Need | Use |
|---|---|
| This API's public origin | `RuntimeService.backendPublicUrl()` |
| CRM app link | `RuntimeService.crmUrl(CRM_ROUTES.settings)` |
| Marketing site | `RuntimeService.marketingUrl()` |
| Allowed CORS origins | `RuntimeService.corsOrigins()` |
| Razorpay webhook URL | `RuntimeService.razorpayWebhookUrl()` |
| Razorpay API / OAuth hosts | `config/razorpay.config.ts` |
| WhatsApp Graph / wa.me | `config/whatsapp.config.ts` |

CRM paths live in `config/crm-routes.config.ts` — the API never spells out
`/settings` or `/login` inline. Every provider host is env-overridable, so a
sandbox needs no code change.

## 2. `src/config/` is the only home for constants

```
config/
  time.constants.ts     SECOND_MS … DAY_MS, addDays, daysBetween, toUnixSeconds
  razorpay.config.ts    hosts, paths, events, mandate methods, minor-unit maths
  autopay.config.ts     charge windows, retry caps, batch size, mandate defaults
  payment-notes.config.ts  the `notes` vocabulary shared with webhooks
  renewals.config.ts    EXPIRY_SOON_DAYS / EXPIRY_WINDOW_DAYS
  throttle.config.ts    global + per-route rate limits
  whatsapp.config.ts    hosts + message templates
  crm-routes.config.ts  frontend paths the API links to
  countries.config.ts   currency, locale, phone dial code per market
  invoice.config.ts / upload.config.ts
```

Rules:

- **No bare time arithmetic.** `20 * 60 * 60 * 1000` → `20 * HOUR_MS`, and
  date shifting goes through `addDays` / `daysBetween`.
- **No magic strings across a boundary.** Anything written by one component and
  read by another (Razorpay `notes`, webhook event names, charge kinds) has a
  named constant both sides import.
- **Money-safety limits stay in code, not env.** The 20-hour double-charge
  window and the 3-failure cap must not vary per deployment. Per-gym behaviour
  belongs in gym settings; load-related knobs (sweep interval) stay in env.

## 3. Nothing assumes India

`countries.config.ts` holds currency, locale and dial code. `CompanyContextService`
resolves them per tenant (cached 5 min, invalidated when the country changes):

```ts
await this.companyContext.formatMoney(companyId, 2000);   // ₹2,000
await this.companyContext.normalizePhone(companyId, '09876543210'); // 919876543210
```

- No `₹` in source. Format through `formatMoney`, or leave the bare number in
  internal logs.
- No `91` in phone logic. A leading `+` is respected, so a foreign number is
  never given the gym's dial code.
- Opening a new market = uncommenting a row in `countries.config.ts`.

## 4. Environment behaviour is decided in one place

`RuntimeService` answers every "is this allowed here?" question —
`isProduction()`, `mockAllowed()`, `whatsappMockAllowed()`,
`requireWebhookSignature()`. Services never read `NODE_ENV` themselves.

`productionProblems()` runs at boot and refuses to start on placeholder secrets,
mock flags, or localhost public URLs. Add a check there rather than trusting
deployment discipline.

## 5. Multi-tenancy is not optional

- `@CompanyId()` on the controller; every query filtered by `companyId`.
- Reads may span locations (`locationFilter`); writes need one
  (`requireLocationIdForWrite`).
- Background work is scoped too — `POST /autopay/run` sweeps only the caller's
  gym.

## 6. Money is append-only

- Payments are never hard-deleted. Void = soft delete + reverse the subscription
  totals + void the invoice.
- Provider writes are idempotent on `providerRef`; the worker and the webhook can
  both report the same charge and only one ledger row appears.
- `totalPaid` / `pendingAmount` describe the **current cycle**;
  `lifetimePaid` and the payments ledger carry history.

## 7. Shape of a service

- Constructor injection only; no service locators.
- Throw Nest HTTP exceptions (`NotFoundException`, `BadRequestException`) —
  controllers stay thin.
- Non-critical side effects (activity log, email, WhatsApp) are wrapped so they
  cannot fail the main operation.
- Comments explain *why*, not *what* — especially where money or idempotency is
  involved.

## 8. Frontend mirrors this

| Concern | Location |
|---|---|
| API endpoint paths | `config/config.ts` (`API_CONFIG`) |
| Env-derived values | `config/app.config.ts` (`APP_CONFIG`, `HTTP_CONFIG`, `QUERY_CONFIG`, `TOAST_CONFIG`) |
| Animation timing | `config/motion.ts` (`EASE_OUT_EXPO`, `MOTION_DURATION`) |
| Permissions | `lib/rbac.ts` — mirrors `permission.enum.ts` |
| Country/currency | `config/countries.ts` |

No component reads `process.env` directly, and a missing env var warns rather
than throwing so a build never dies on config. The marketing site has the same
arrangement in `lib/config.ts`.
