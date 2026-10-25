// server/scripts/scenario-api-smoke.mjs — ТЗ-доработка WP-4 (гейт G31):
// дымовой прогон API негативных сценариев на уровне сервиса (scenarioService) —
// форма ответа POST /scenarios/simulate { base, scenario, isolated[], delta } и
// 400 VALIDATION на выходах за границами + GET /scenarios/clients (топ-5).
// Рантаем от корня server/ через node (без хардкода локальных путей).
import { PrismaClient } from '@prisma/client';
import { scenarioService } from '../src/services/scenario.service.js';
import { ApiError } from '../src/utils/errors.js';

const prisma = new PrismaClient();
const round = String(Date.now());
const email = `scen-smoke-${round}@test.local`;

function assert(cond, msg) {
  if (!cond) {
    console.error(`SMOKE-FAIL: ${msg}`);
    process.exit(1);
  }
}

async function main() {
  const user = await prisma.user.create({
    data: { email, passwordHash: 'smoke', companyName: 'Smoke Co', inn: '1111111111', minBalance: 0 },
  });

  // 6 месяцев истории: регулярный клиент 1111, спорадическая выручка 2222, rent/suppliers
  const today = Math.floor(Date.now() / 86_400_000);
  const iso = (d) => new Date(d * 86_400_000).toISOString();
  const ops = [];
  let bal = 0;
  for (let d = today - 182; d < today; d++) {
    if (d % 7 === 0) {
      bal += 5000;
      ops.push({ userId: user.id, date: iso(d), amount: 5000, direction: 'in', category: 'income', subcategory: 'revenue_clients', counterpartyName: 'ООО Ромашка', counterpartyInn: '1111', purpose: 'Оплата счёта', balanceEndOfDay: bal, source: 'import' });
    }
    if (d % 5 === 2) {
      bal += 3000;
      ops.push({ userId: user.id, date: iso(d), amount: 3000, direction: 'in', category: 'income', subcategory: 'revenue_clients', counterpartyName: 'ИП Иванов', counterpartyInn: '2222', purpose: 'Выручка', balanceEndOfDay: bal, source: 'import' });
    }
    if (d % 14 === 3) {
      bal -= 20000;
      ops.push({ userId: user.id, date: iso(d), amount: 20000, direction: 'out', category: 'expense', subcategory: 'rent', counterpartyName: 'Аренда', counterpartyInn: '3333', purpose: 'Аренда офиса', balanceEndOfDay: bal, source: 'import' });
    }
    if (d % 14 === 10) {
      bal -= 15000;
      ops.push({ userId: user.id, date: iso(d), amount: 15000, direction: 'out', category: 'expense', subcategory: 'suppliers', counterpartyName: 'Поставщик', counterpartyInn: '4444', purpose: 'Закупка', balanceEndOfDay: bal, source: 'import' });
    }
  }
  await prisma.operation.createMany({ data: ops });

  // 1) simulate: один сценарий — форма ответа
  const res = await scenarioService.simulate(user.id, {
    scenarios: [{ type: 'revenue_drop', params: { percent: 20 } }],
  });
  assert(res.base && res.scenario && Array.isArray(res.isolated) && res.isolated.length === 1, 'форма { base, scenario, isolated[1] }');
  assert(res.delta && ['gapDateShiftDays', 'gapAmount', 'gapProbabilityPct', 'minBalance'].every((k) => k in res.delta), 'delta: 4 ключа');
  for (const part of [res.base, res.scenario, ...res.isolated]) {
    assert(Array.isArray(part.series) && part.series.length > 0, 'series не пустой');
    const p0 = part.series[0];
    assert('date' in p0 && 'balance' in p0 && 'p10' in p0 && 'p90' in p0, 'point серии: date, balance, p10, p90');
    assert('gapDate' in part && 'gapAmount' in part && 'gapProbabilityPct' in part, 'part: gapDate/gapAmount/gapProbabilityPct');
  }
  // сценарий хуже базы по мин. балансу (revenue_drop 20%)
  assert(res.scenario.minBalance <= res.base.minBalance + 0.01, 'revenue_drop: minBalance сценария не выше базы');

  // 2) 4 разных типа одновременно
  const all = await scenarioService.simulate(user.id, {
    scenarios: [
      { type: 'client_delay', params: { inn: '1111', days: 21 } },
      { type: 'revenue_drop', params: { percent: 20 } },
      { type: 'unplanned_expense', params: { amount: 50000, date: new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10) } },
      { type: 'fixed_costs_growth', params: { percent: 15 } },
    ],
  });
  assert(all.isolated.length === 4, '4 изолированных сценария');

  // 3) валидация 400 VALIDATION: 5 сценариев / дубликат / за границей
  const badBodies = [
    { scenarios: Array.from({ length: 5 }, (_, i) => ({ type: ['client_delay', 'revenue_drop', 'unplanned_expense', 'fixed_costs_growth', 'client_delay'][i], params: {} })) },
    { scenarios: [{ type: 'revenue_drop', params: { percent: 31 } }] },
    { scenarios: [{ type: 'unknown_type', params: {} }] },
  ];
  for (const body of badBodies) {
    let threw = false;
    try {
      await scenarioService.simulate(user.id, body);
    } catch (e) {
      threw = e instanceof ApiError && e.statusCode === 400 && e.code === 'VALIDATION';
    }
    assert(threw, `400 VALIDATION на: ${JSON.stringify(body).slice(0, 80)}`);
  }

  // 4) GET /scenarios/clients — топ-5
  const clients = await scenarioService.clients(user.id);
  assert(Array.isArray(clients.clients) && clients.clients.length <= 5, 'clients ≤ 5');
  assert(clients.clients.every((c) => c.inn && c.name != null && c.sharePct >= 0), 'поля клиента: inn, name, sharePct');

  // 5) карточки в БД: kind + params
  const cards = await prisma.sandboxScenario.findMany({ where: { userId: user.id } });
  assert(cards.length === 5, 'сохранено 5 карточек (1 + 4)');
  assert(cards.every((c) => c.kind && c.kind !== 'custom_event' && c.params), 'kind != custom_event и params непустые');

  await prisma.user.delete({ where: { id: user.id } });
  console.log('SCENARIO-API-OK');
  process.exit(0);
}

main().catch(async (e) => {
  console.error('SMOKE-FAIL:', e.message);
  await prisma.user.delete({ where: { id: email } }).catch(() => {});
  process.exit(1);
});
