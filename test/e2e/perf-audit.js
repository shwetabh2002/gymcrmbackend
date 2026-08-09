/**
 * Scale audit.
 *
 * Seeds a gym with enough rows that an unbounded list would hurt, then checks
 * that list endpoints page, search server-side, stay within the safety cap, and
 * that response times hold. Run against a live server:
 *
 *   npm run audit:perf
 */
const API = process.env.AUDIT_API_URL || 'http://localhost:5000';
const MONGO =
  process.env.AUDIT_MONGO_URI || 'mongodb://127.0.0.1:27017/backendgymmast';

/** How many members/payments to seed. Enough to be meaningful, quick to write. */
const SEED_MEMBERS = Number(process.env.AUDIT_SEED || 1200);

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
  const started = Date.now();
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
  return { status: res.status, body: json, ms: Date.now() - started, bytes: text.length };
}

const stamp = String(process.hrtime.bigint()).slice(-7);

async function main() {
  const { MongoClient, ObjectId } = require('mongodb');
  const mongo = new MongoClient(MONGO);
  await mongo.connect();
  const db = mongo.db();

  console.log(`\n=== SETUP: gym + ${SEED_MEMBERS} members with payments ===`);
  const signup = await api('POST', '/companies/signup', {
    gymName: `Scale Gym ${stamp}`,
    adminName: 'Owner',
    adminEmail: `scale${stamp}@s.local`,
    adminPassword: 'Owner@12345',
    memberIdPrefix: 'SCL',
  });
  if (signup.status === 429) {
    console.log('  Signup throttled — wait a minute and re-run.');
    process.exit(0);
  }
  check('signup', signup.status, 201);
  token = signup.body.tokens.accessToken;
  const companyId = new ObjectId(signup.body.user.companyId);
  const locationId = new ObjectId(signup.body.location.id);

  const plan = (
    await api('POST', '/subscription-plans', {
      name: 'Monthly',
      price: 1000,
      duration: 1,
      durationType: 'MONTHS',
    })
  ).body;
  const planId = new ObjectId(plan._id);

  // Seeded straight into Mongo: this is about read performance, and going
  // through the API would take minutes without testing anything extra.
  const members = [];
  const subs = [];
  const payments = [];
  const now = new Date();
  for (let i = 0; i < SEED_MEMBERS; i += 1) {
    const memberId = new ObjectId();
    const subId = new ObjectId();
    members.push({
      _id: memberId,
      name: `Scale Member ${i}`,
      // Unique per run and per row; a company+phone unique index guards this.
      phone: `9${String(stamp).slice(-4)}${String(i).padStart(5, '0')}`,
      email: `scale${stamp}-${i}@s.local`,
      password: 'N/A',
      userType: 'MEMBER',
      role: 'USER',
      memberStatus: 'ACTIVE',
      idNo: `SCL-${String(i).padStart(5, '0')}`,
      companyId,
      locationId,
      currentSubscriptionId: subId,
      createdAt: new Date(now.getTime() - i * 1000),
      updatedAt: now,
    });
    subs.push({
      _id: subId,
      companyId,
      locationId,
      memberId,
      planId,
      startDate: now,
      expiryDate: new Date(now.getTime() + 30 * 86400000),
      subscriptionStatus: 'ACTIVE',
      planPrice: 1000,
      totalPaid: 1000,
      lifetimePaid: 1000,
      pendingAmount: 0,
      paymentStatus: 'FULLY_PAID',
      billingMode: 'MANUAL',
      createdAt: new Date(now.getTime() - i * 1000),
      updatedAt: now,
    });
    payments.push({
      companyId,
      locationId,
      memberId,
      subscriptionId: subId,
      amount: 1000,
      paymentMode: 'CASH',
      paymentDate: now,
      receivedBy: memberId,
      createdAt: new Date(now.getTime() - i * 1000),
      updatedAt: now,
    });
  }
  await db.collection('users').insertMany(members);
  await db.collection('membersubscriptions').insertMany(subs);
  await db.collection('payments').insertMany(payments);
  console.log(`  seeded ${SEED_MEMBERS} members, subscriptions and payments`);

  // ── Paged reads ──
  console.log('\n=== 1. PAGED list ===');
  const page1 = await api('GET', '/members?page=1&limit=25');
  check('paged status', page1.status, 200);
  check('page size honoured', page1.body.items?.length, 25);
  check('total counted', page1.body.total, SEED_MEMBERS);
  check('pages computed', page1.body.pages, Math.ceil(SEED_MEMBERS / 25));
  checkTrue('page 1 is fast', page1.ms < 1500, `${page1.ms}ms, ${(page1.bytes / 1024).toFixed(0)}KB`);

  const lastPage = await api(
    'GET',
    `/members?page=${Math.ceil(SEED_MEMBERS / 25)}&limit=25`,
  );
  checkTrue(
    'last page as fast as the first',
    lastPage.ms < 1500,
    `${lastPage.ms}ms`,
  );
  const ids1 = new Set((page1.body.items || []).map((m) => m.id || m._id));
  const idsLast = new Set((lastPage.body.items || []).map((m) => m.id || m._id));
  checkTrue(
    'pages do not overlap',
    [...ids1].every((id) => !idsLast.has(id)),
  );

  // ── Server-side search ──
  console.log('\n=== 2. SEARCH happens in the database ===');
  const search = await api('GET', '/members?limit=25&search=Scale Member 42');
  check('search status', search.status, 200);
  checkTrue(
    'search narrows the result',
    search.body.total > 0 && search.body.total < SEED_MEMBERS,
    `total=${search.body.total}`,
  );
  checkTrue(
    'matches actually match',
    (search.body.items || []).every((m) => m.name?.includes('42')),
  );
  checkTrue('search is fast', search.ms < 1500, `${search.ms}ms`);

  const byId = await api('GET', '/members?limit=5&search=SCL-00007');
  checkTrue(
    'search covers member id',
    (byId.body.items || []).some((m) => m.idNo === 'SCL-00007'),
    `found=${byId.body.total}`,
  );

  // ── Unpaged safety ──
  console.log('\n=== 3. UNPAGED request stays bounded ===');
  const unpaged = await api('GET', '/members');
  checkTrue('unpaged still returns an array', Array.isArray(unpaged.body));
  checkTrue(
    'unpaged capped at the safety limit',
    unpaged.body.length <= 1000,
    `${unpaged.body.length} rows, ${(unpaged.bytes / 1024).toFixed(0)}KB, ${unpaged.ms}ms`,
  );

  const paymentsPaged = await api('GET', '/payments?page=1&limit=25');
  check('payments paged', paymentsPaged.body.items?.length, 25);
  check('payments total', paymentsPaged.body.total, SEED_MEMBERS);
  checkTrue('payments page is fast', paymentsPaged.ms < 1500, `${paymentsPaged.ms}ms`);

  const paymentsUnpaged = await api('GET', '/payments');
  checkTrue(
    'payments unpaged capped',
    Array.isArray(paymentsUnpaged.body) && paymentsUnpaged.body.length <= 1000,
    `${paymentsUnpaged.body.length} rows, ${(paymentsUnpaged.bytes / 1024).toFixed(0)}KB, ${paymentsUnpaged.ms}ms`,
  );

  const subsUnpaged = await api('GET', '/member-subscriptions');
  checkTrue(
    'subscriptions unpaged capped',
    Array.isArray(subsUnpaged.body) && subsUnpaged.body.length <= 1000,
    `${subsUnpaged.body.length} rows, ${subsUnpaged.ms}ms`,
  );

  // ── Dashboard under load ──
  console.log('\n=== 4. DASHBOARD with a full gym ===');
  const dash = await api('GET', '/analytics/dashboard');
  check('dashboard status', dash.status, 200);
  check('members counted', dash.body.counts.totalMembers, SEED_MEMBERS);
  check('revenue counted', dash.body.counts.totalRevenue, SEED_MEMBERS * 1000);
  checkTrue('dashboard is fast', dash.ms < 3000, `${dash.ms}ms`);

  // ── Autopay sweep cost ──
  console.log('\n=== 5. AUTOPAY sweep over a full gym ===');
  const sweep = await api('POST', '/autopay/run', {});
  check('sweep ok', sweep.status, 200);
  checkTrue('sweep is fast with nothing due', sweep.ms < 3000, `${sweep.ms}ms`);

  await mongo.close();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`PASSED: ${pass}   FAILED: ${failures.length}`);
  failures.forEach((f) => console.log(`  • ${f}`));
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error('PERF AUDIT CRASHED:', e);
  process.exit(2);
});
