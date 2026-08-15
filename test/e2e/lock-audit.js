/**
 * Concurrency audit.
 *
 * The autopay sweep used an in-process flag, which stops guarding anything the
 * moment a second instance exists. This fires overlapping sweeps and checks that
 * exactly one does the work while the others are told it is already running.
 *
 *   npm run audit:lock
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
async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 160) };
  }
  return { status: res.status, body: json };
}

const stamp = String(process.hrtime.bigint()).slice(-6);
const iso = (d) => d.toISOString().slice(0, 10);
const shift = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return iso(d);
};

async function main() {
  const { MongoClient, ObjectId } = require('mongodb');
  const mongo = new MongoClient(MONGO);
  await mongo.connect();
  const db = mongo.db();

  console.log('\n=== SETUP: gym with a due autopay subscription ===');
  const signup = await api('POST', '/companies/signup', {
    gymName: `Lock Gym ${stamp}`,
    adminName: 'Owner',
    adminEmail: `lock${stamp}@l.local`,
    adminPassword: 'Owner@12345',
    memberIdPrefix: 'LCK',
  });
  if (signup.status === 429) {
    console.log('  Signup throttled — wait a minute and re-run.');
    process.exit(0);
  }
  check('signup', signup.status, 201);
  token = signup.body.tokens.accessToken;
  const locationId = signup.body.location.id;

  await api('PUT', '/gym-settings', { autopayEnabled: true });
  // Autopay is a paid capability; move to the plan that includes it.
  await api('POST', '/subscription/plan', { planCode: 'GROWTH' });
  await api('POST', '/payment-provider/razorpay/mock', {});
  await api('POST', '/whatsapp/mock', {});
  const plan = (
    await api('POST', '/subscription-plans', {
      name: 'Monthly',
      price: 1000,
      duration: 1,
      durationType: 'MONTHS',
    })
  ).body;

  // A member whose cycle is fully paid but expired: exactly one renewal is due.
  const co = (
    await api('POST', '/members/checkout', {
      name: 'Lock Member',
      phone: `97${stamp}1`,
      planId: plan._id,
      locationId,
      startingDate: shift(-40),
      expiryDate: shift(-1),
      amount: 1000,
      received: 1000,
      enableAutopay: true,
    })
  ).body;
  await fetch(co.shareUrl, { redirect: 'manual' });
  const memberId = co.draftMemberId;
  const before = (await api('GET', `/payments/member/${memberId}`)).body;
  check('one payment before the sweep', before.length, 1);

  console.log('\n=== 1. FIVE overlapping sweeps ===');
  const runs = await Promise.all(
    Array.from({ length: 5 }, () => api('POST', '/autopay/run', {})),
  );
  const summaries = runs.map((r) => r.body);
  const worked = summaries.filter((s) => !s.alreadyRunning);
  const blocked = summaries.filter((s) => s.alreadyRunning);

  console.log(`  results: ${JSON.stringify(summaries)}`);
  checkTrue(
    'exactly one sweep did the work',
    worked.length === 1,
    `${worked.length} ran, ${blocked.length} were told it is already running`,
  );
  check(
    'total charged across all five',
    summaries.reduce((s, x) => s + (x.charged || 0), 0),
    1,
  );

  console.log('\n=== 2. the member was charged once, not five times ===');
  const after = (await api('GET', `/payments/member/${memberId}`)).body;
  check('payments after', after.length, 2);
  check(
    'ledger total',
    after.reduce((s, p) => s + p.amount, 0),
    2000,
  );
  const sub = (await api('GET', `/member-subscriptions/member/${memberId}`)).body[0];
  check('renewalCount', sub.renewalCount, 1);
  check('lifetimePaid', sub.lifetimePaid, 2000);

  console.log('\n=== 3. the lease is released, not leaked ===');
  const held = await db.collection('joblocks').countDocuments({});
  check('no lease left behind', held, 0);

  const laterRun = (await api('POST', '/autopay/run', {})).body;
  checkTrue(
    'a later sweep can still acquire the lease',
    laterRun.alreadyRunning !== true,
    JSON.stringify(laterRun),
  );

  await mongo.close();
  console.log(`\n${'='.repeat(58)}`);
  console.log(`PASSED: ${pass}   FAILED: ${failures.length}`);
  failures.forEach((f) => console.log(`  • ${f}`));
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error('LOCK AUDIT CRASHED:', e);
  process.exit(2);
});
