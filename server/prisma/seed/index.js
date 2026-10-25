// server/prisma/seed/index.js
// ТЗ-доработка WP-7 §13: демо-данные — выписки из test-data/demo/, а не генератор
// (demo-data.js удалён). Контракт (docs/api-contract.md): demo@cashflow.ru / demo1234,
// разрыв гарантированно находится моделью на горизонте 30–60 дней.
// Демо — 3 выписки организаторов (датасет, test-data/statements/, all_operations-кросс-чек):
//   C096 — ИП, «Продажи на маркетплейсах» (01.10.2024–30.09.2026, 594 оп.),
//   C097 — ООО, «Производство мебели на заказ» (22.09.2025–30.09.2026, 429 оп.),
//   C098 — ИП, «IT-услуги и разработка» (01.10.2024–17.10.2025, 373 оп. — архивная).
// Активная (самая свежая) выписка C096/C097 (asOf = 2026-09-30, см. FORECAST_AS_OF в server/.env.example):
//   дефолтный порог разрыва T (User.minBalance) = P25-квантиль остатков C096 ≈ 1,74 млн ₽
//   (остаток на 09-30 ≈ 1,27 млн ₽ — ниже P25; крупный плановый capex 25.10.2026 удерживает
//   медианный путь ниже порога → на главной виден БУДУЩИЙ разрыв, docs/backtest-results.json).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { parseBankStatement } from '../../src/utils/parser.js';

const DEMO_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../test-data/demo');
const prisma = new PrismaClient();

// Тот же percentile (линейная интерполяция), что в server/src/utils/backtestMetrics.js
function percentile(values, p) {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * (p / 100);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

async function main() {
  console.log('🌱 Starting seed...');

  const files = fs.existsSync(DEMO_DIR)
    ? fs.readdirSync(DEMO_DIR).filter((f) => f.endsWith('.csv')).sort()
    : [];
  if (files.length === 0) {
    console.error('❌ Демо-выписки не найдены: test-data/demo/ пустая.');
    console.error('   Положите файлы: node server/scripts/pick-demo.mjs (критерии ТЗ §13, описано в test-data/demo/README.md).');
    process.exit(1);
  }

  // Сначала разбираем все выписки (данные + P25-порог), потом пишем в БД
  const parsedFiles = [];
  for (const file of files) {
    const parsed = await parseBankStatement(fs.readFileSync(path.join(DEMO_DIR, file)), file);
    if (parsed.operations.length === 0) {
      throw new Error('Демо-выписка пустая: ' + file);
    }
    parsedFiles.push({ file, operations: parsed.operations, lastDate: parsed.operations[parsed.operations.length - 1].date });
  }
  // Активная выписка — максимум по дате последней операции (НЕ алфавитный порядок):
  // свежие C096/C097 (30.09.2026), C098 — архив (17.10.2025). При равенстве дат — первая в списке (C096).
  const active = parsedFiles.reduce((best, f) => (f.lastDate > best.lastDate ? f : best), parsedFiles[0]);

  // Порог разрыва T демо-юзера — P25-квантиль остатков АКТИВНОЙ выписки (по дням, как в бэктесте).
  const balByDay = new Map();
  for (const op of active.operations) {
    balByDay.set(new Date(op.date).toISOString().slice(0, 10), op.balanceEndOfDay); // строки хронологические
  }
  const p25 = Math.round(percentile([...balByDay.values()], 25));
  const asOf = String(active.lastDate).slice(0, 10);

  // Контракт: демо@cashflow.ru / demo1234
  const hashedPassword = await bcrypt.hash('demo1234', 10);
  const demoUser = await prisma.user.upsert({
    where: { email: 'demo@cashflow.ru' },
    update: { minBalance: p25 },
    create: {
      email: 'demo@cashflow.ru',
      passwordHash: hashedPassword,
      companyName: 'Демо-компания (выписки организаторов)',
      inn: '0000000001',
      minBalance: p25, // дефолтный порог разрыва T = P25 остатков (см. выше)
    },
  });
  console.log(`✅ Демо-пользователь: ${demoUser.email} (T = ${p25.toLocaleString('ru-RU')} ₽)`);

  // Удаляем старые операции и плановые события, если они были
  await prisma.operation.deleteMany({ where: { userId: demoUser.id } });
  await prisma.plannedEvent.deleteMany({ where: { userId: demoUser.id } });

  // Записываем пачками по 500 штук (createMany батчи — защита от SQLite-лимита, WP-7 §1)
  const batchSize = 500;
  let total = 0;
  for (const { file, operations } of parsedFiles) {
    // Категоризация уже выполнена в парсере (WP-3); служебные поля — не в схеме Prisma.
    const rows = operations.map((op) => {
      const { companyId, categorizeRule, ...rest } = op;
      return { ...rest, userId: demoUser.id, source: 'demo' };
    });
    for (let i = 0; i < rows.length; i += batchSize) {
      await prisma.operation.createMany({ data: rows.slice(i, i + batchSize) });
    }
    total += rows.length;
    console.log(`📦 ${file}: ${rows.length} операций`);
  }

  // Плановые события демо (аудит §2.2/§2.4: план-факт не должен быть нулевым).
  // Значения выняты из реальных регулярностей демо-выписок C096/C097 (asOf = 2026-09-30):
  const fact = (where) => prisma.operation.findFirst({ where: { userId: demoUser.id, ...where } });
  const paidTax = await fact({ externalId: 'C096-000591' }); // ЕНП 25 934 ₽ от 28.09.2026 в C096
  const events = [
    // 1) Договор (исходящий, будущий): аренда — АО «Арендодатель-880» платит 02–03-го числа месяца (24 операции)
    {
      type: 'contract', direction: 'out', amount: 22000, expectedDate: new Date('2026-10-02T00:00:00Z'),
      issueDate: new Date('2026-09-01T00:00:00Z'), status: 'pending', source: '1c',
      counterpartyName: 'АО «Арендодатель-880»', counterpartyInn: '0076144034',
      title: 'Оплата аренды по договору № 97, октябрь 2026',
    },
    // 2) Счёт (входящий, будущий): Маркетплейс-568 — 105 поступлений, медиана 97 512,87 ₽
    {
      type: 'invoice', direction: 'in', amount: 97512.87, expectedDate: new Date('2026-10-15T00:00:00Z'),
      issueDate: new Date('2026-09-25T00:00:00Z'), status: 'pending', source: 'edo',
      counterpartyName: 'ООО «Маркетплейс-568»', counterpartyInn: '0035185049',
      title: 'Оплата по счетам за октябрь 2026',
    },
    // 3) Налог (будущий): ЕНП октябрь, по образцу сентября (25 934 ₽, 28-е число)
    {
      type: 'tax', direction: 'out', amount: 25934, expectedDate: new Date('2026-10-28T00:00:00Z'),
      issueDate: new Date('2026-09-28T00:00:00Z'), status: 'pending', source: 'tax-calendar',
      counterpartyName: 'Казначейство России (ФНС России)', counterpartyInn: '7727406020',
      title: 'Единый налоговый платеж (октябрь 2026)',
    },
    // 4) Просроченный платёж (исходящий, C097): Фурнитура-434, последний платёж 03.08.2026 (282 729,74 ₽);
    //    ожидаемый по циклу 03.09.2026 — не отправлен (после 03.08 платежей этому ИНН нет).
    //    Факт 03.08 не свернётся: окно reconcile ±3 дня (planGraceDays), а дата — на 31 день позже.
    {
      type: 'contract', direction: 'out', amount: 282729.74, expectedDate: new Date('2026-09-03T00:00:00Z'),
      issueDate: new Date('2026-08-01T00:00:00Z'), status: 'overdue', source: '1c',
      counterpartyName: 'ООО «Фурнитура-434»', counterpartyInn: '0035378298',
      title: 'Оплата по договору за фурнитуру (не отправлен)',
    },
    // 5) Крупный одноразовый плановый платёж (capex): уводит медианный путь остатка ниже T (P25 ≈ 1,74 млн ₽)
    //    → на главной виден будущий разрыв на горизонте 30–60 дней от asOf=2026-09-30.
    {
      type: 'contract', direction: 'out', amount: 1200000, expectedDate: new Date('2026-10-25T00:00:00Z'),
      issueDate: new Date('2026-09-10T00:00:00Z'), status: 'pending', source: 'manual',
      title: 'Капитальные расходы: покупка оборудования для склада (октябрь 2026)',
    },
  ];
  // 6) Налог с фактом (paid) — только если факт-операция нашлась в выписке (иначе дубль №3 уже покрывает тип tax)
  if (paidTax) {
    events.push({
      type: 'tax', direction: 'out', amount: 25934, expectedDate: new Date('2026-09-28T00:00:00Z'),
      issueDate: new Date('2026-08-28T00:00:00Z'), status: 'paid', paidAmount: 25934,
      factOperationId: paidTax.id, source: 'tax-calendar',
      counterpartyName: 'Казначейство России (ФНС России)', counterpartyInn: '7727406020',
      title: 'Единый налоговый платеж (сентябрь 2026)',
    });
  }
  await prisma.plannedEvent.createMany({
    data: events.map((e) => ({ ...e, userId: demoUser.id, active: true })),
  });
  console.log(`📅 Плановые события: ${events.length} (T = P25 = ${p25.toLocaleString('ru-RU')} ₽)`);

  // ТЗ-доработка WP-7 §9/§13: опорная дата демо — последняя дата АКТИВНОЙ выписки;
  // для демо-пользователя задаётся FORECAST_AS_OF (см. server/.env.example).
  console.log(`✨ Seed завершён: ${total} операций. FORECAST_AS_OF для демо: ${asOf}`);
}

main()
  .catch((e) => {
    console.error('❌ Ошибка при сидировании:', e.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });