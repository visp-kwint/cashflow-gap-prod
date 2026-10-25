// CLI: импорт банковской выписки (test-data/*.csv) в БД пользователя.
// Использование:
//   node scripts/import-statement.mjs <file.csv> [--email user@example.com] [--replace]
//   --replace — сначала удалить операции пользователя со source='import' (полный повторный импорт)
import { readFileSync } from 'node:fs';
process.env.PRISMA_LOG_LEVEL = 'quiet';
const { prisma } = await import('../src/config/db.js');
const { parseBankStatement } = await import('../src/utils/parser.js');

function parseArgs(argv) {
  const args = { file: null, email: 'demo@cashflow.ru', replace: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--email') args.email = argv[++i];
    else if (a === '--replace') args.replace = true;
    else if (!a.startsWith('--') && !args.file) args.file = a;
    else { console.error(`Непонятный аргумент: ${a}`); process.exit(1); }
  }
  if (!args.file) {
    console.error('Использование: node scripts/import-statement.mjs <file.csv> [--email x@y.z] [--replace]');
    process.exit(1);
  }
  return args;
}

const { file, email, replace } = parseArgs(process.argv);
const buffer = readFileSync(file);

const user = await prisma.user.findUnique({ where: { email } });
if (!user) {
  console.error(`Пользователь не найден: ${email}`);
  process.exit(1);
}

// 1. Парсинг
const { operations, meta, warnings } = await parseBankStatement(buffer, file);
console.log(`Формат: ${meta.format} | компания: ${meta.companyId} | строк: ${meta.rowsTotal} | распарсено: ${operations.length} | пропущено: ${meta.rowsSkipped}`);
if (warnings.length) {
  console.log(`Внимание (${warnings.length}):`);
  for (const w of warnings.slice(0, 10)) console.log(' -', w);
}
if (operations.length === 0) {
  console.log('Нечего импортировать.');
  process.exit(0);
}

// 2. Замена (опционально): удалить импортированные операции пользователя
if (replace) {
  const res = await prisma.operation.deleteMany({ where: { userId: user.id, source: 'import' } });
  console.log(`Заменено: удалено ${res.count} операций source=import`);
}

// 3. Дедупликация по externalId: не импортируем то, что уже в БД у этого пользователя
const existing = await prisma.operation.findMany({
  where: { userId: user.id, externalId: { not: null } },
  select: { externalId: true },
});
const existingIds = new Set(existing.map(o => o.externalId));
const toCreate = operations
  .filter(op => !op.externalId || !existingIds.has(op.externalId))
  .map(({ companyId, ...rest }) => ({ ...rest, userId: user.id, source: 'import' }));
const skipped = operations.length - toCreate.length;

if (toCreate.length) {
  await prisma.operation.createMany({ data: toCreate });
}

console.log(`Импортировано: ${toCreate.length} | пропущено (уже в БД): ${skipped}`);
console.log('Готово.');
