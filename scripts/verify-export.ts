/**
 * Export feature verification — run: npx ts-node -r tsconfig-paths/register scripts/verify-export.ts
 */
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { MembersListQueryDto } from '../src/members/dto/members-list-query.dto';
import { PaymentsListQueryDto } from '../src/members/dto/payments-list-query.dto';

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

type Result = { ok: boolean; detail: string };

async function validate(
  label: string,
  metatype: new () => object,
  query: Record<string, string>,
  expectFail = false,
): Promise<Result> {
  try {
    const out = await pipe.transform(query, {
      type: 'query',
      metatype,
      data: '',
    });
    if (expectFail) {
      return { ok: false, detail: 'FAIL — expected validation error but passed' };
    }
    const o = out as Record<string, unknown>;
    const hasFrom = 'dateFrom' in o;
    const hasTo = 'dateTo' in o;
    return {
      ok: true,
      detail: `PASS — keys: ${Object.keys(o).join(', ')}${hasFrom ? ` dateFrom=${o.dateFrom}` : ''}${hasTo ? ` dateTo=${o.dateTo}` : ''}`,
    };
  } catch (e: unknown) {
    if (expectFail) {
      const err = e as { getResponse?: () => { message?: string[] } };
      const msg = err.getResponse?.()?.message ?? String(e);
      return { ok: true, detail: `PASS (rejected as expected) — ${JSON.stringify(msg)}` };
    }
    const err = e as { getResponse?: () => { message?: string[] } };
    const msg = err.getResponse?.()?.message ?? String(e);
    return { ok: false, detail: `FAIL — ${JSON.stringify(msg)}` };
  }
}

function buildMembersUrl(q: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  Object.entries(q).forEach(([k, v]) => {
    if (v) params.set(k, v);
  });
  return `/members/list?${params.toString()}`;
}

async function main() {
  console.log('=== Backend DTO Validation (same pipe as main.ts) ===\n');

  const APP_TZ = 'Asia/Kolkata';
  const today = new Date().toLocaleDateString('en-CA', { timeZone: APP_TZ });
  const [y, m] = today.split('-').map(Number);
  const dateFrom = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dateTo = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const cases: Array<[string, new () => object, Record<string, string>, boolean?]> = [
    [
      'Members — all time (default UI)',
      MembersListQueryDto,
      { page: '1', limit: '10', status: 'ALL', type: 'ALL', training: 'ALL', pending: 'ALL' },
    ],
    [
      'Members — this month (THE BUG SCENARIO)',
      MembersListQueryDto,
      {
        page: '1',
        limit: '10',
        status: 'ALL',
        type: 'ALL',
        training: 'ALL',
        pending: 'ALL',
        dateFrom,
        dateTo,
      },
    ],
    [
      'Members — this week',
      MembersListQueryDto,
      { page: '1', limit: '10', dateFrom: '2026-06-22', dateTo: '2026-06-28' },
    ],
    [
      'Members — custom range',
      MembersListQueryDto,
      { page: '1', limit: '10', dateFrom: '2026-01-01', dateTo: '2026-03-31' },
    ],
    [
      'Members — export page size 100',
      MembersListQueryDto,
      { page: '1', limit: '100', dateFrom, dateTo },
    ],
    [
      'Members — invalid date (should fail)',
      MembersListQueryDto,
      { page: '1', dateFrom: '06-2026' },
      true,
    ],
    [
      'Members — unknown field (should fail)',
      MembersListQueryDto,
      { page: '1', foo: 'bar' } as Record<string, string>,
      true,
    ],
    [
      'Payments — this month',
      PaymentsListQueryDto,
      { page: '1', limit: '10', dateFrom, dateTo },
    ],
    [
      'Payments — search + dates',
      PaymentsListQueryDto,
      { page: '1', limit: '10', search: 'john', dateFrom, dateTo },
    ],
  ];

  let passed = 0;
  let failed = 0;

  for (const [label, metatype, query, expectFail] of cases) {
    const r = await validate(label, metatype, query, expectFail);
    console.log(`${r.ok ? '✓' : '✗'} ${label}`);
    console.log(`  ${r.detail}\n`);
    if (r.ok) passed++;
    else failed++;
  }

  console.log('=== Frontend URL simulation ===\n');
  console.log('Members all time:', buildMembersUrl({ page: '1', limit: '10', status: 'ALL' }));
  console.log(
    'Members this month:',
    buildMembersUrl({ page: '1', limit: '10', status: 'ALL', dateFrom, dateTo }),
  );

  console.log('\n=== Summary ===');
  console.log(`Passed: ${passed}, Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

main();
