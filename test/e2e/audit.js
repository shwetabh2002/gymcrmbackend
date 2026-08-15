/**
 * End-to-end money audit.
 *
 * Drives a real running server and asserts every number along the way, then
 * injects pre-upgrade documents straight into Mongo to prove a live database
 * keeps working. Run it after any change that touches payments, subscriptions,
 * invoices or autopay.
 *
 *   npm run start:dev          # in one terminal
 *   npm run audit              # in another
 *
 * Env: AUDIT_API_URL, AUDIT_MONGO_URI (defaults match .env.example).
 */
const API = process.env.AUDIT_API_URL || 'http://localhost:5000';
const MONGO =
  process.env.AUDIT_MONGO_URI || 'mongodb://127.0.0.1:27017/backendgymmast';

let pass = 0;
const failures = [];

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${label} = ${JSON.stringify(actual)}`);
  } else {
    failures.push(label);
    console.log(
      `  FAIL  ${label}\n        got      ${JSON.stringify(actual)}\n        expected ${JSON.stringify(expected)}`,
    );
  }
}

function checkTrue(label, cond, detail = '') {
  if (cond) {
    pass += 1;
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures.push(label);
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

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
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, body: json };
}

const stamp = String(process.hrtime.bigint()).slice(-7);
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

  console.log('\n=== SETUP: gym + autopay + mock razorpay + plans ===');
  const signup = await api('POST', '/companies/signup', {
    gymName: `Audit Gym ${stamp}`,
    adminName: `Auditor ${stamp}`,
    adminEmail: `audit${stamp}@a.local`,
    adminPassword: 'Owner@12345',
    city: 'Pune',
    memberIdPrefix: 'AUD',
  });
  if (signup.status === 429) {
    console.log('  Signup throttled — wait a minute and re-run.');
    process.exit(0);
  }
  check('signup', signup.status, 201);
  token = signup.body.tokens.accessToken;
  const companyId = signup.body.user.companyId;
  const locationId = signup.body.location.id;

  await api('PUT', '/gym-settings', {
    autopayEnabled: true,
    invoiceTaxPercentage: 18,
    invoiceTaxMode: 'excluded',
  });
  // Autopay is a paid capability; move to the plan that includes it.
  await api('POST', '/subscription/plan', { planCode: 'GROWTH' });
  await api('POST', '/payment-provider/razorpay/mock', {});
  await api('POST', '/whatsapp/mock', {});

  const monthly = (
    await api('POST', '/subscription-plans', {
      name: 'Monthly',
      price: 1000,
      duration: 1,
      durationType: 'MONTHS',
    })
  ).body;
  const yearly = (
    await api('POST', '/subscription-plans', {
      name: 'Yearly',
      price: 12000,
      duration: 1,
      durationType: 'YEARS',
    })
  ).body;

  // ── A. Cash, paid in full ──
  console.log('\n=== A. CASH, full payment (1000 of 1000) ===');
  const cashMember = (
    await api('POST', '/members', {
      name: 'Cash Full',
      phone: `9100${stamp}`,
      email: `cashfull${stamp}@a.local`,
      planId: monthly._id,
      locationId,
      startingDate: iso(new Date()),
      amount: 1000,
      received: 1000,
      paymentMode: 'CASH',
    })
  ).body;
  const cashId = cashMember.id || cashMember._id;
  let sub = (await api('GET', `/member-subscriptions/member/${cashId}`)).body[0];
  check('A totalPaid', sub.totalPaid, 1000);
  check('A pendingAmount', sub.pendingAmount, 0);
  check('A paymentStatus', sub.paymentStatus, 'FULLY_PAID');
  check('A lifetimePaid', sub.lifetimePaid, 1000);
  check('A billingMode', sub.billingMode, 'MANUAL');

  const cashInvoices = (await api('GET', `/invoices/member/${cashId}`)).body;
  check('A invoice count', cashInvoices.length, 1);
  check('A invoice subtotal', cashInvoices[0].subtotal, 1000);
  check('A invoice tax 18%', cashInvoices[0].taxAmount, 180);
  check('A invoice total', cashInvoices[0].totalAmount, 1180);

  // ── B. Partial, then top-up, then an over-payment attempt ──
  console.log('\n=== B. ONLINE partial 400, top-up 600, over-pay blocked ===');
  const partial = (
    await api('POST', '/members', {
      name: 'Online Partial',
      phone: `9200${stamp}`,
      planId: monthly._id,
      locationId,
      startingDate: iso(new Date()),
      amount: 1000,
      received: 400,
      paymentMode: 'ONLINE',
    })
  ).body;
  const partialId = partial.id || partial._id;
  sub = (await api('GET', `/member-subscriptions/member/${partialId}`)).body[0];
  check('B totalPaid after 400', sub.totalPaid, 400);
  check('B pending after 400', sub.pendingAmount, 600);
  check('B status', sub.paymentStatus, 'PARTIALLY_PAID');

  const topUp = await api('POST', '/payments', {
    memberId: partialId,
    subscriptionId: sub._id,
    amount: 600,
    paymentMode: 'CASH',
    paymentDate: iso(new Date()),
  });
  check('B top-up accepted', topUp.status, 201);
  sub = (await api('GET', `/member-subscriptions/${sub._id}`)).body;
  check('B totalPaid after top-up', sub.totalPaid, 1000);
  check('B pending after top-up', sub.pendingAmount, 0);

  const overPay = await api('POST', '/payments', {
    memberId: partialId,
    subscriptionId: sub._id,
    amount: 500,
    paymentMode: 'CASH',
    paymentDate: iso(new Date()),
  });
  checkTrue('B over-payment blocked', overPay.status === 400, `status ${overPay.status}`);

  // ── C. Void reverses everything ──
  console.log('\n=== C. VOID the 600 top-up ===');
  check('C void accepted', (await api('DELETE', `/payments/${topUp.body._id}`)).status, 200);
  sub = (await api('GET', `/member-subscriptions/${sub._id}`)).body;
  check('C totalPaid after void', sub.totalPaid, 400);
  check('C pending after void', sub.pendingAmount, 600);
  check('C lifetimePaid after void', sub.lifetimePaid, 400);
  check(
    'C voided invoice hidden',
    (await api('GET', `/invoices/member/${partialId}`)).body.length,
    1,
  );

  // ── D. Yearly autopay renewal: duration and cycle ──
  console.log('\n=== D. YEARLY autopay renewal ===');
  const co = (
    await api('POST', '/members/checkout', {
      name: 'Yearly Autopay',
      phone: `9300${stamp}`,
      email: `yearly${stamp}@a.local`,
      planId: yearly._id,
      locationId,
      startingDate: shift(-400),
      expiryDate: shift(-1),
      amount: 12000,
      received: 12000,
      enableAutopay: true,
    })
  ).body;
  await fetch(co.shareUrl, { redirect: 'manual' });
  const yMemberId = co.draftMemberId;
  let ySub = (await api('GET', `/member-subscriptions/member/${yMemberId}`)).body[0];
  const expiryBefore = String(ySub.expiryDate).slice(0, 10);
  check('D paid on mandate', ySub.totalPaid, 12000);
  check('D billingMode', ySub.billingMode, 'AUTOPAY');
  checkTrue('D mandate attached', !!ySub.mandateId);

  check('D autopay charged', (await api('POST', '/autopay/run', {})).body.charged, 1);
  ySub = (await api('GET', `/member-subscriptions/${ySub._id}`)).body;
  check(
    'D expiry moved by 1 year',
    new Date(String(ySub.expiryDate).slice(0, 10)).getFullYear() -
      new Date(expiryBefore).getFullYear(),
    1,
  );
  check('D new cycle totalPaid', ySub.totalPaid, 12000);
  check('D new cycle pending', ySub.pendingAmount, 0);
  check('D renewalCount', ySub.renewalCount, 1);
  check('D lifetimePaid across cycles', ySub.lifetimePaid, 24000);
  check('D followUp', ySub.renewalFollowUpStatus, 'RENEWED');

  const yPayments = (await api('GET', `/payments/member/${yMemberId}`)).body;
  check('D ledger rows', yPayments.length, 2);
  check(
    'D ledger sum equals lifetimePaid',
    yPayments.reduce((s, p) => s + p.amount, 0),
    ySub.lifetimePaid,
  );
  check(
    'D invoice totals with tax',
    (await api('GET', `/invoices/member/${yMemberId}`)).body
      .map((i) => i.totalAmount)
      .sort((a, b) => a - b),
    [14160, 14160],
  );

  // ── E. Analytics must equal the ledger ──
  console.log('\n=== E. ANALYTICS vs ledger ===');
  const dash = (await api('GET', '/analytics/dashboard')).body;
  const allPayments = (await api('GET', '/payments')).body;
  check(
    'E revenue equals ledger sum',
    dash.counts.totalRevenue,
    allPayments.reduce((s, p) => s + p.amount, 0),
  );
  check('E payment count', dash.counts.totalPaymentsCount, allPayments.length);
  check(
    'E pending equals subscription sum',
    dash.counts.totalPendingAmount,
    (await api('GET', '/member-subscriptions')).body.reduce(
      (s, x) => s + (x.pendingAmount || 0),
      0,
    ),
  );

  // ── F. Legacy documents written before this release ──
  console.log('\n=== F. LEGACY documents ===');
  const cid = new ObjectId(companyId);
  const lid = new ObjectId(locationId);

  const legacyMember = await db.collection('users').insertOne({
    name: 'Legacy Member',
    email: `legacy${stamp}@a.local`,
    phone: `9400${stamp}`,
    password: 'N/A',
    userType: 'MEMBER',
    role: 'USER',
    memberStatus: 'ACTIVE',
    idNo: 'AUD-LEGACY',
    // The pre-upgrade checkout stored the Razorpay customer on the member,
    // never on the mandate — that shape must still be chargeable.
    rzpCustomerId: `cust_legacy_${stamp}`,
    companyId: cid,
    locationId: lid,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const legacySub = await db.collection('membersubscriptions').insertOne({
    companyId: cid,
    locationId: lid,
    memberId: legacyMember.insertedId,
    planId: new ObjectId(monthly._id),
    startDate: new Date(shift(-40)),
    expiryDate: new Date(shift(-2)),
    subscriptionStatus: 'ACTIVE',
    planPrice: 1000,
    totalPaid: 600,
    pendingAmount: 400,
    paymentStatus: 'PARTIALLY_PAID',
    billingMode: 'AUTOPAY',
    // no lifetimePaid / renewalCount / cycleStartDate
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db.collection('payments').insertOne({
    companyId: cid,
    locationId: lid,
    memberId: legacyMember.insertedId,
    subscriptionId: legacySub.insertedId,
    amount: 600,
    paymentMode: 'CARD', // retired mode — must still read
    paymentDate: new Date(shift(-40)),
    receivedBy: legacyMember.insertedId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const legacyMandate = await db.collection('paymentmandates').insertOne({
    companyId: cid,
    memberId: legacyMember.insertedId,
    subscriptionId: legacySub.insertedId,
    provider: 'RAZORPAY',
    tokenId: `token_legacy_${stamp}`,
    maxAmount: 1000,
    frequency: 'as_presented',
    status: 'ACTIVE',
    // no customerId / method / expireAt / consecutiveFailures
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db
    .collection('membersubscriptions')
    .updateOne(
      { _id: legacySub.insertedId },
      { $set: { mandateId: legacyMandate.insertedId } },
    );

  const legacyId = String(legacyMember.insertedId);
  check('F legacy member reads', (await api('GET', `/members/${legacyId}`)).status, 200);
  const legacyPays = (await api('GET', `/payments/member/${legacyId}`)).body;
  check('F legacy CARD payment listed', legacyPays.length, 1);
  check('F legacy mode preserved', legacyPays[0].paymentMode, 'CARD');
  check(
    'F legacy sub reads',
    (await api('GET', `/member-subscriptions/${legacySub.insertedId}`)).body.pendingAmount,
    400,
  );

  const dash2 = (await api('GET', '/analytics/dashboard')).body;
  check(
    'F analytics still equals ledger',
    dash2.counts.totalRevenue,
    (await api('GET', '/payments')).body.reduce((s, p) => s + p.amount, 0),
  );
  checkTrue(
    'F legacy CARD in mode breakdown',
    dash2.paymentModeBreakdown.map((m) => m.mode).includes('CARD'),
  );

  const legacyRun = (await api('POST', '/autopay/run', {})).body;
  const legacySubAfter = (
    await api('GET', `/member-subscriptions/${legacySub.insertedId}`)
  ).body;
  checkTrue(
    'F legacy mandate charged its dues',
    legacySubAfter.pendingAmount === 0,
    `pending=${legacySubAfter.pendingAmount} skipped=${JSON.stringify(legacyRun.skippedReasons)}`,
  );
  checkTrue(
    'F legacy mandate customerId backfilled',
    !!(await db.collection('paymentmandates').findOne({ _id: legacyMandate.insertedId }))
      .customerId,
  );

  // A mandate with no customer anywhere must skip cleanly, never crash.
  const orphanMember = await db.collection('users').insertOne({
    name: 'Orphan Mandate',
    phone: `9500${stamp}`,
    password: 'N/A',
    userType: 'MEMBER',
    role: 'USER',
    memberStatus: 'ACTIVE',
    idNo: 'AUD-ORPHAN',
    companyId: cid,
    locationId: lid,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const orphanSub = await db.collection('membersubscriptions').insertOne({
    companyId: cid,
    locationId: lid,
    memberId: orphanMember.insertedId,
    planId: new ObjectId(monthly._id),
    startDate: new Date(shift(-40)),
    expiryDate: new Date(shift(-2)),
    subscriptionStatus: 'ACTIVE',
    planPrice: 1000,
    totalPaid: 0,
    pendingAmount: 1000,
    paymentStatus: 'UNPAID',
    billingMode: 'AUTOPAY',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const orphanMandate = await db.collection('paymentmandates').insertOne({
    companyId: cid,
    memberId: orphanMember.insertedId,
    subscriptionId: orphanSub.insertedId,
    provider: 'RAZORPAY',
    tokenId: `token_orphan_${stamp}`,
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db
    .collection('membersubscriptions')
    .updateOne(
      { _id: orphanSub.insertedId },
      { $set: { mandateId: orphanMandate.insertedId } },
    );
  const orphanRun = (await api('POST', '/autopay/run', {})).body;
  checkTrue(
    'F customer-less mandate skipped with a reason',
    orphanRun.failed === 0 &&
      JSON.stringify(orphanRun.skippedReasons || {}).includes('customer'),
    JSON.stringify(orphanRun),
  );
  check(
    'F customer-less sub untouched',
    (await api('GET', `/member-subscriptions/${orphanSub.insertedId}`)).body.pendingAmount,
    1000,
  );

  const legacySessionId = `legacy-session-${stamp}`;
  await db.collection('checkoutsessions').insertOne({
    companyId: cid,
    locationId: lid,
    sessionId: legacySessionId,
    draftMemberId: legacyMember.insertedId,
    planId: new ObjectId(monthly._id),
    amount: 1000,
    receivedIntent: 1000,
    startDate: new Date(),
    expiryDate: new Date(shift(30)),
    status: 'PENDING',
    enableAutopay: true,
    expiresAt: new Date(shift(1)),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const legacySession = await api('GET', `/members/checkout/${legacySessionId}`);
  check('F legacy checkout session reads', legacySession.status, 200);
  check('F legacy session email defaults', legacySession.body.emailSent, false);

  // ── G. Guards ──
  console.log('\n=== G. Guards ===');
  check('G no double charge on rerun', (await api('POST', '/autopay/run', {})).body.charged, 0);
  check(
    'G retired mode rejected',
    (
      await api('POST', '/payments', {
        memberId: partialId,
        subscriptionId: sub._id,
        amount: 100,
        paymentMode: 'BANK_TRANSFER',
        paymentDate: iso(new Date()),
      })
    ).status,
    400,
  );
  checkTrue(
    'G renewal counts computed',
    typeof (await api('GET', '/renewals/queue/counts')).body.total === 'number',
  );

  await mongo.close();

  console.log(`\n${'='.repeat(60)}`);
  console.log(`PASSED: ${pass}   FAILED: ${failures.length}`);
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log(`  • ${f}`));
  }
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error('AUDIT CRASHED:', e);
  process.exit(2);
});
