/**
 * Invoice: what the document now carries, and what an edit may and may not do.
 */
const API = 'http://localhost:5000';

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
const today = new Date().toISOString().slice(0, 10);

async function main() {
  console.log('\n=== SETUP ===');
  const signup = await api('POST', '/companies/signup', {
    gymName: `Invoice Gym ${stamp}`,
    adminName: 'Owner',
    adminEmail: `inv${stamp}@i.local`,
    adminPassword: 'Owner@12345',
    city: 'Mumbai',
    memberIdPrefix: 'INV',
  });
  if (!signup.body?.tokens) {
    console.log('  signup blocked:', JSON.stringify(signup.body).slice(0, 120));
    process.exit(0);
  }
  token = signup.body.tokens.accessToken;
  const locationId = signup.body.location.id;

  const settings = await api('PUT', '/gym-settings', {
    invoiceTaxPercentage: 18,
    invoiceTaxMode: 'excluded',
    invoiceGstin: '27AAAAA0000A1Z5',
    invoiceSacCode: '999723',
    invoicePlaceOfSupply: 'Maharashtra',
    invoiceTaxBreakup: 'split',
    invoiceShowAmountInWords: true,
    invoiceTerms: 'Fees once paid are non-refundable.',
  });
  check(
    'settings saved',
    {
      sac: settings.body.invoiceSacCode,
      pos: settings.body.invoicePlaceOfSupply,
      breakup: settings.body.invoiceTaxBreakup,
      words: settings.body.invoiceShowAmountInWords,
      terms: !!settings.body.invoiceTerms,
    },
    {
      sac: '999723',
      pos: 'Maharashtra',
      breakup: 'split',
      words: true,
      terms: true,
    },
  );

  const plan = (
    await api('POST', '/subscription-plans', {
      name: 'Quarterly Gold',
      price: 6000,
      duration: 3,
      durationType: 'MONTHS',
    })
  ).body;

  console.log('\n=== 1. member add → invoice bane ===');
  const member = (
    await api('POST', '/members', {
      name: 'Ramesh Kumar',
      phone: `95${stamp}1`,
      email: `ramesh${stamp}@m.local`,
      planId: plan._id,
      locationId,
      startingDate: today,
      amount: 6000,
      received: 4000,
      paymentMode: 'CASH',
    })
  ).body;
  const memberId = member.id || member._id;

  const invoices = (await api('GET', `/invoices/member/${memberId}`)).body;
  check('invoice bana', invoices.length, 1);
  const inv = invoices[0];
  check('subtotal', inv.subtotal, 4000);
  check('tax 18%', inv.taxAmount, 720);
  check('total', inv.totalAmount, 4720);

  console.log('\n=== 2. document ke liye data mil raha hai? ===');
  checkTrue('member ka idNo', !!inv.memberId?.idNo, inv.memberId?.idNo);
  checkTrue(
    'plan ka naam (nested populate)',
    inv.subscriptionId?.planId?.name === 'Quarterly Gold',
    inv.subscriptionId?.planId?.name,
  );
  checkTrue(
    'plan ki validity',
    !!inv.subscriptionId?.startDate && !!inv.subscriptionId?.expiryDate,
    `${String(inv.subscriptionId?.startDate).slice(0, 10)} → ${String(inv.subscriptionId?.expiryDate).slice(0, 10)}`,
  );
  checkTrue(
    'payment ka mode + amount',
    inv.paymentId?.paymentMode === 'CASH' && inv.paymentId?.amount === 4000,
    `${inv.paymentId?.paymentMode} ${inv.paymentId?.amount}`,
  );

  console.log('\n=== 3. EDIT: notes / dates theek hone chahiye ===');
  const okEdit = await api('PUT', `/invoices/${inv._id}`, {
    notes: 'Corrected: paid at front desk',
    dueDate: today,
  });
  check('notes edit accepted', okEdit.status, 200);
  check('notes saved', okEdit.body.notes, 'Corrected: paid at front desk');
  check('amount chhua nahi gaya', okEdit.body.totalAmount, 4720);

  console.log('\n=== 4. EDIT: item ka description badla ja sakta hai ===');
  const descEdit = await api('PUT', `/invoices/${inv._id}`, {
    items: [{ description: 'Quarterly Gold — Jan to Mar' }],
  });
  check('description edit accepted', descEdit.status, 200);
  check('naya description', descEdit.body.items[0].description, 'Quarterly Gold — Jan to Mar');
  check('amount waisa hi', descEdit.body.items[0].amount, 4000);
  check('total waisa hi', descEdit.body.totalAmount, 4720);

  console.log('\n=== 5. EDIT: amount badalna BLOCK hona chahiye ===');
  const amountEdit = await api('PUT', `/invoices/${inv._id}`, {
    items: [{ description: 'Quarterly Gold', amount: 99999 }],
  });
  check('amount edit rejected', amountEdit.status, 400);
  checkTrue(
    'reason samajh aata hai',
    JSON.stringify(amountEdit.body.message).includes('Void the payment'),
    amountEdit.body.message,
  );

  const taxEdit = await api('PUT', `/invoices/${inv._id}`, {
    taxPercentage: 5,
  });
  check('tax edit rejected', taxEdit.status, 400);

  const stillSame = (await api('GET', `/invoices/${inv._id}`)).body;
  check('invoice chhua nahi gaya', stillSame.totalAmount, 4720);

  console.log('\n=== 6. audit trail bana? ===');
  // Activity logs surface through the dashboard feed, not a standalone route.
  const dash = (await api('GET', '/analytics/dashboard')).body;
  const rows = dash?.activityFeed || [];
  checkTrue(
    'INVOICE_UPDATE log hai',
    rows.some((l) => l.action === 'INVOICE_UPDATE'),
    rows.find((l) => l.action === 'INVOICE_UPDATE')?.summary || 'nahi mila',
  );

  console.log('\n=== 7. asli sudhaar ka raasta: payment void → invoice void ===');
  const paymentId = inv.paymentId?._id;
  const voided = await api('DELETE', `/payments/${paymentId}`);
  check('payment void', voided.status, 200);
  const afterVoid = (await api('GET', `/invoices/member/${memberId}`)).body;
  check('invoice bhi hat gaya', afterVoid.length, 0);
  const subAfter = (await api('GET', `/member-subscriptions/member/${memberId}`)).body[0];
  check('subscription totals reverse', subAfter.totalPaid, 0);
  check('pending wapas', subAfter.pendingAmount, 6000);

  console.log('\n=== 8. sahi amount dobara → naya invoice ===');
  const redo = await api('POST', '/payments', {
    memberId,
    subscriptionId: subAfter._id,
    amount: 6000,
    paymentMode: 'CASH',
    paymentDate: today,
  });
  check('naya payment', redo.status, 201);
  const newInvoices = (await api('GET', `/invoices/member/${memberId}`)).body;
  check('naya invoice', newInvoices.length, 1);
  check('naya total (6000 + 18%)', newInvoices[0].totalAmount, 7080);

  console.log(`\n${'='.repeat(58)}`);
  console.log(`PASSED: ${pass}   FAILED: ${failures.length}`);
  failures.forEach((f) => console.log(`  • ${f}`));
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error('CRASHED:', e);
  process.exit(2);
});
