/**
 * ТЗ-доработка WP-3 §7 п.7: пересчёт подкатегорий уже сохранённых операций.
 * Операции с categorySource = 'manual' не трогаются.
 * Запуск (из server/): node scripts/recategorize.mjs
 */
import { PrismaClient } from '@prisma/client';
import { categorize, buildInnHints } from '../src/services/categorizer.service.js';
import { legacyForSub } from '../src/config/categories.config.js';

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({ select: { id: true, inn: true } });
  let considered = 0, changed = 0;
  for (const user of users) {
    const ops = await prisma.operation.findMany({ where: { userId: user.id }, orderBy: { date: 'asc' } });
    // 1-й проход: правила (текст / ИНН владельца / 24-ч окно возвратов)
    const withCat = ops.map((o) => ({ id: o.id, __cat: categorize(o, { userInn: user.inn, operations: ops }) }));
    const byId = new Map(withCat.map((x) => [x.id, x.__cat]));
    // 2-й проход: ИНН-правило (§4 п.5) для нераспознанных
    const hints = buildInnHints(withCat);
    let userChanged = 0;
    for (const o of ops) {
      if (o.categorySource === 'manual') continue; // ручная разметка не перезаписывается
      considered += 1;
      let cat = byId.get(o.id);
      if (cat.rule === 'unlabeled' && o.counterpartyInn) {
        const hint = hints.get(String(o.counterpartyInn));
        if (hint) cat = categorize(o, { userInn: user.inn, operations: ops, innHint: hint });
      }
      const next = {
        subcategory: cat.subcategory,
        category: legacyForSub(cat.subcategory, o.direction),
        categoryConfidence: cat.confidence,
        categorySource: 'rule',
      };
      if (
        o.subcategory === next.subcategory &&
        o.category === next.category &&
        o.categoryConfidence === next.categoryConfidence &&
        o.categorySource === next.categorySource
      ) {
        continue;
      }
      await prisma.operation.update({ where: { id: o.id }, data: next });
      userChanged += 1;
    }
    changed += userChanged;
    console.log(`Пользователь ${user.id}: операций ${ops.length}, изменено ${userChanged}`);
  }
  console.log(`Готово: рассмотрено ${considered}, изменено ${changed}.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('Ошибка recategorize:', e.message);
  process.exit(1);
});
