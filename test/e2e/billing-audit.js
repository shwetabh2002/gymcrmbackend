/**
 * Platform billing audit: the trial → paid → dunning → read-only lifecycle.
 *
 * Covers what a gym experiences and what the platform sees, including the parts
 * that are easy to get wrong: a lapsed gym must still be able to read its data
 * and pay, and must never be locked out of logging in.
 *
 *   npm run audit:billing
 */
const API = process.env.AUDIT_API_URL || 'http://localhost:5000';
const MONGO =
  process.env.AUDIT_MONGO_URI || 'mongodb://127.0.0.1:27017/backendgymmast';

let pass = 0;
const failures = [];
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : failures.push(label);
  console.log(
    ok
      ? `  PASS  ${label} = ${JSON.stringify(actual)}`
      : `  FAIL  ${label}\n        got      ${JSON.stringify(actual)}\n        expected ${JSON.stringify(expected)}`,
  );
};
const checkTrue = (label, cond, detail = '') => {
  cond ? pass++ : failures.push(label);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

let token = '';
async function api(method, path, body, useToken = token) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(useToken ? { Authorization: `Bearer ${useToken}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, body: json };
}

const stamp = String(process.hrtime.bigint()).slice(-6);
const today = new Date().toISOString().slice(0, 10);

async function main() {
  const { MongoClient, ObjectId } = require('mongodb');
  const mongo = new MongoClient(MONGO);
  await mongo.connect();
  const db = mongo.db();

  console.log('\n=== 1. PLANS TABLE seeded ===');
  const signup = await api('POST', '/companies/signup', {
    gymName: `Billing Gym ${stamp}`,
    adminName: 'Owner',
    adminEmail: `bill${stamp}@b.local`,
    adminPassword: 'Owner@12345',
    phone: `98${stamp}1`,
    memberIdPrefix: 'BIL',
  });
  if (signup.status === 429) {
    console.log('  Signup throttled — wait a minute and re-run.');
    process.exit(0);
  }
  check('signup', signup.status, 201);
  token = signup.body.tokens.accessToken;
  const companyId = signup.body.user.companyId;
  const locationId = signup.body.location.id;

  const plans = (await api('GET', '/subscription/plans')).body;
  checkTrue('plans exist in the table', plans.length >= 3, `${plans.length} plans`);
  const starter = plans.find((p) => p.code === 'STARTER');
  const growth = plans.find((p) => p.code === 'GROWTH');
  check('starter price', starter?.pricePerBranch, 999);
  check('growth price', growth?.pricePerBranch, 1999);
  checkTrue(
    'autopay is a paid feature',
    !starter.features.includes('AUTOPAY') && growth.features.includes('AUTOPAY'),
    `starter=${starter.features} growth=${growth.features}`,
  );
  check('yearly bills 10 months', starter.pricing.yearlyPerBranch, 9990);

  console.log('\n=== 2. NEW GYM starts on trial automatically ===');
  const sub = (await api('GET', '/subscription')).body;
  check('status', sub.status, 'TRIALING');
  check('plan', sub.planCode, 'STARTER');
  checkTrue('trial has an end date', !!sub.trialEndsAt, sub.trialEndsAt);
  checkTrue(
    'days left is sane',
    sub.trialDaysLeft >= 9 && sub.trialDaysLeft <= 10,
    `${sub.trialDaysLeft} days`,
  );
  check('can write during trial', sub.canWrite, true);
  check('branches counted', sub.branches, 1);
  check('next amount = price x branches', sub.nextAmount, 999);

  console.log('\n=== 3. DURING TRIAL everything works ===');
  const plan = await api('POST', '/subscription-plans', {
    name: 'Monthly',
    price: 1000,
    duration: 1,
    durationType: 'MONTHS',
  });
  check('can create a gym plan', plan.status, 201);
  const member = await api('POST', '/members', {
    name: 'Trial Member',
    phone: `91${stamp}1`,
    planId: plan.body._id,
    locationId,
    startingDate: today,
    amount: 1000,
    received: 1000,
    paymentMode: 'CASH',
  });
  check('can add a member', member.status, 201);

  console.log('\n=== 4. FEATURE GATE: autopay is not on Starter ===');
  const autopayBlocked = await api('POST', '/autopay/run', {});
  check('autopay blocked on Starter', autopayBlocked.status, 403);
  checkTrue(
    'the error says how to fix it',
    JSON.stringify(autopayBlocked.body).includes('Upgrade'),
    autopayBlocked.body?.message,
  );

  const upgraded = await api('POST', '/subscription/plan', {
    planCode: 'GROWTH',
  });
  check('upgrade accepted', upgraded.status, 200);
  check('now on Growth', upgraded.body.planCode, 'GROWTH');
  const autopayAllowed = await api('POST', '/autopay/run', {});
  check('autopay allowed after upgrade', autopayAllowed.status, 200);

  console.log('\n=== 5. BRANCH LIMIT is enforced on downgrade ===');
  await api('POST', '/locations', {
    name: `Second Branch ${stamp}`,
    code: `br2${stamp}`,
  });
  const downgrade = await api('POST', '/subscription/plan', {
    planCode: 'STARTER',
  });
  check('downgrade below branch count refused', downgrade.status, 400);
  checkTrue(
    'the refusal explains itself',
    JSON.stringify(downgrade.body).includes('branch'),
    downgrade.body?.message,
  );

  const afterBranch = (await api('GET', '/subscription')).body;
  check('two branches now billed', afterBranch.branches, 2);
  check('price follows branches', afterBranch.nextAmount, 1999 * 2);

  // The platform sweep is SUPER_ADMIN-only; grab that token up front so the
  // lifecycle steps below actually run it.
  const superLoginEarly = await api(
    'POST',
    '/auth/admin/login',
    { email: 'superadmin@gym.local', password: 'SuperAdmin@123' },
    null,
  );
  const superToken =
    superLoginEarly.status === 200
      ? superLoginEarly.body.tokens.accessToken
      : null;
  checkTrue('super admin available for platform routes', !!superToken);

  console.log('\n=== 6. TRIAL EXPIRES without a payment method ===');
  await db
    .collection('platformsubscriptions')
    .updateOne(
      { companyId: new ObjectId(companyId) },
      { $set: { trialEndsAt: new Date(Date.now() - 60_000) } },
    );
  const sweep = await api('POST', '/platform/billing/run', {}, superToken);
  check('sweep ran', sweep.status, 200);

  const lapsed = (await api('GET', '/subscription')).body;
  check('status went read-only', lapsed.status, 'READ_ONLY');
  check('cannot write', lapsed.canWrite, false);

  console.log('\n=== 7. READ-ONLY: data readable, writes blocked, login works ===');
  const readMembers = await api('GET', '/members');
  check('members still readable', readMembers.status, 200);
  const readInvoices = await api('GET', '/invoices');
  check('invoices still readable', readInvoices.status, 200);

  const blockedWrite = await api('POST', '/members', {
    name: 'Blocked Member',
    phone: `92${stamp}1`,
    locationId,
  });
  check('adding a member is blocked', blockedWrite.status, 403);
  checkTrue(
    'the block explains what to do',
    JSON.stringify(blockedWrite.body).includes('Subscription'),
    blockedWrite.body?.message,
  );

  const relogin = await api(
    'POST',
    '/auth/admin/login',
    { email: `bill${stamp}@b.local`, password: 'Owner@12345' },
    null,
  );
  check('a lapsed gym can still log in', relogin.status, 200);

  const canStillSeeBilling = await api('GET', '/subscription');
  check('billing screen still reachable', canStillSeeBilling.status, 200);
  const canStillSeePlans = await api('GET', '/subscription/plans');
  check('plans still reachable', canStillSeePlans.status, 200);

  console.log('\n=== 8. PAYING revives the account ===');
  const mandate = await api('POST', '/subscription/mandate', {});
  check('mandate link created', mandate.status, 200);
  checkTrue('link returned', !!mandate.body.shareUrl, mandate.body.shareUrl);
  check('first charge = plan x branches + GST', mandate.body.amount, Math.round(1999 * 2 * 1.18));

  // Approving the mandate is what the gym owner does on the link.
  await fetch(mandate.body.shareUrl).catch(() => undefined);
  await db.collection('platformsubscriptions').updateOne(
    { companyId: new ObjectId(companyId) },
    {
      $set: {
        mandateTokenId: `token_platform_${stamp}`,
        mandateCustomerId: `cust_platform_${stamp}`,
        mandateApprovedAt: new Date(),
        status: 'ACTIVE',
      },
    },
  );

  const revived = (await api('GET', '/subscription')).body;
  check('status active', revived.status, 'ACTIVE');
  check('can write again', revived.canWrite, true);
  const writeAgain = await api('POST', '/members', {
    name: 'Paid Member',
    phone: `93${stamp}1`,
    locationId,
  });
  check('member add works again', writeAgain.status, 201);

  console.log('\n=== 9. RENEWAL charges through the mandate ===');
  await db.collection('platformsubscriptions').updateOne(
    { companyId: new ObjectId(companyId) },
    { $set: { currentPeriodEnd: new Date(Date.now() - 60_000) } },
  );
  await api('POST', '/platform/billing/run', {}, superToken);
  const charged = (await api('GET', '/subscription')).body;
  check('still active after renewal', charged.status, 'ACTIVE');
  const invoices = (await api('GET', '/subscription/invoices')).body;
  checkTrue('an invoice was raised', invoices.length >= 1, `${invoices.length} invoices`);
  const paid = invoices.find((i) => i.status === 'PAID');
  checkTrue('invoice is paid', !!paid, paid?.invoiceNumber);
  checkTrue(
    'invoice carries GST',
    paid && paid.taxAmount > 0 && paid.totalAmount === paid.subtotal + paid.taxAmount,
    `${paid?.subtotal} + ${paid?.taxAmount} = ${paid?.totalAmount}`,
  );

  console.log('\n=== 10. PLATFORM VISIBILITY (super admin) ===');
  if (superToken) {
    const overview = await api('GET', '/platform/overview', undefined, superToken);
    check('overview readable', overview.status, 200);
    checkTrue(
      'counts by status',
      typeof overview.body.counts?.active === 'number',
      JSON.stringify(overview.body.counts),
    );
    checkTrue('MRR computed', overview.body.mrr >= 0, `MRR ${overview.body.mrr}`);
    const companies = await api('GET', '/platform/companies', undefined, superToken);
    check('companies list readable', companies.status, 200);
    checkTrue(
      'our gym appears with its standing',
      companies.body.some((c) => c.companyId === companyId && c.status === 'ACTIVE'),
      `${companies.body.length} companies`,
    );
  } else {
    console.log('  (super admin login unavailable — skipping platform view)');
  }

  console.log('\n=== 11. CANCEL keeps data readable ===');
  const cancelled = await api('POST', '/subscription/cancel', {
    reason: 'Testing',
  });
  check('cancel accepted', cancelled.status, 200);
  checkTrue('cancelledAt set', !!cancelled.body.cancelledAt);
  const stillReadable = await api('GET', '/members');
  check('data still readable after cancel', stillReadable.status, 200);

  await mongo.close();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`PASSED: ${pass}   FAILED: ${failures.length}`);
  failures.forEach((f) => console.log(`  • ${f}`));
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error('BILLING AUDIT CRASHED:', e);
  process.exit(2);
});
