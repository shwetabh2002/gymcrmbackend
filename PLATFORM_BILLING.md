# Platform billing — what gyms pay us

Distinct from everything a gym charges its members. Same words, different money:
a gym's `SubscriptionPlan` is what its members buy; a `PlatformPlan` is what the
gym buys from us.

---

## The model

**10-day free trial, then a monthly subscription priced per branch.**

Trial length and pricing are rows in the plans table, not constants — pricing
changes far more often than code, and a gym must keep the terms it signed up to
even after the public price moves.

| Plan | Per branch / month | Includes |
|---|---|---|
| Starter | ₹999 | Members, plans, payments, GST invoices, email templates. 1 branch |
| Growth | ₹1,999 | + UPI Autopay, WhatsApp auto-send, staff accounts. 3 branches |
| Chain | ₹1,699 | + unlimited branches and per-branch reporting |

Yearly billing charges 10 months — two free.

**Priced per branch, never per member.** A per-member price punishes the gyms
that grow and makes the bill move every month.

## Collecting the money

The gym approves a **UPI Autopay mandate** for our fees — the same mechanism the
gyms use on their own members, running on the platform's own Razorpay account
(`PLATFORM_RAZORPAY_KEY_ID` / `_KEY_SECRET`), never on a gym's connected one.

Requiring a card up front roughly triples trial conversion, but cards are not how
Indian SMBs pay. A UPI mandate gets the same commitment with far less friction —
and every gym owner then knows first-hand what their own members will experience.

Approving the mandate and paying the first period happen in one step.

## Statuses

| Status | Meaning | Can write? |
|---|---|---|
| `TRIALING` | Inside the free window | yes |
| `ACTIVE` | Paying | yes |
| `PAST_DUE` | A charge failed; retries in progress | yes |
| `READ_ONLY` | Trial expired, or dunning gave up | **no** |
| `CANCELLED` | They left | **no** |

**Read-only is not a lockout.** A lapsed gym can still log in, read everything,
export, and pay. Holding someone's own records hostage to collect a fee is not
something this codebase does — and locking out the people trying to become
customers would be self-defeating.

Enforced by `SubscriptionGuard`, applied per controller after `JwtAuthGuard`.
It cannot be a global guard: Nest runs global guards *before* the controller's
auth guard, so `request.user` would not exist yet and every check would silently
pass.

Exempt by design: `/auth`, `/companies` (signup) and the whole `/subscription`
screen. SUPER_ADMIN is never gated by a tenant's billing.

## Feature gates

`@RequiresFeature('AUTOPAY')` refuses a route unless the gym's plan includes it,
with an error that names the plan and points at the upgrade screen. Autopay is
the differentiator, so it sits on Growth and above.

## Dunning

A failed charge retries after 1, 3 and 5 days. After the last retry there is a
2-day grace window, then the account goes read-only. A gym that lost a card
should not lose its front desk the same morning.

## The sweep

Runs every 6 hours (`PLATFORM_BILLING_INTERVAL_MS`), leased through
`JobLockService` so several instances cannot bill the same gym:

1. Trial reminders at 5, 2 and 1 days left — once each, tracked per subscription
2. Expired trials → charged if a mandate exists, otherwise read-only
3. Due renewals → charged
4. Failed charges → retried on the dunning schedule

`POST /platform/billing/run` triggers it by hand (SUPER_ADMIN only).

## Visibility

**The gym sees** (`Settings → Subscription`): plan, status, days left, what the
next charge will be at today's branch count, the plans it can move to, and its
own billing history. A banner appears in the last 5 days of the trial, when a
payment fails, and once the account is read-only — and stays out of the way
otherwise.

**We see** (`/platform`, SUPER_ADMIN): counts by status, MRR, collected to date,
trials ending in the next 3 days, and every gym with its plan, branch count,
renewal date and dunning state.

## Money on the invoice

Charges carry GST (`PLATFORM_TAX_PERCENTAGE`, default 18) and their own numbering
(`PLT-YYYYMMDD-NNNN`), separate from the invoices a gym raises for its members.
`PlatformCharge` rows are append-only: a failed attempt stays as a failed row, so
both dunning and revenue can be explained after the fact.

## Tests

```bash
npm run audit:billing   # trial → paid → dunning → read-only, and platform views
```

Covers the parts that are easy to get wrong: a lapsed gym can still log in, still
read its data, and still reach the screen where it pays.
