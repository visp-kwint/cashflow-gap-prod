// Скрипт: пересоздать демо-данные пользователя demo@cashflow.ru «чистыми»
// (удалить тестовые операции/риски/тикеты и сгенерировать реалистичную историю).
import { prisma } from '../src/config/db.js';
import { generateDemoTransactions } from '../prisma/seed/demo-data.js';

const EMAIL = 'demo@cashflow.ru';

const user = await prisma.user.findUnique({ where: { email: EMAIL } });
if (!user) {
  console.log('Пользователь не найден:', EMAIL);
  process.exit(1);
}

const [deletedOps, deletedRisks, deletedTickets, deletedScenarios] = await Promise.all([
  prisma.operation.deleteMany({ where: { userId: user.id } }),
  prisma.risk.deleteMany({ where: { userId: user.id } }),
  prisma.supportTicket.deleteMany({ where: { userId: user.id } }),
  prisma.sandboxScenario.deleteMany({ where: { userId: user.id } }),
]);

const { transactions } = generateDemoTransactions();
await prisma.operation.createMany({
  data: transactions.map((t) => ({ ...t, userId: user.id })),
});

// Реалистичный порог T для малого бизнеса (чтобы красные зоны в календаре/графике были возможны)
await prisma.user.update({ where: { id: user.id }, data: { minBalance: 0 } });

console.log(
  JSON.stringify(
    {
      deleted: { ops: deletedOps.count, risks: deletedRisks.count, tickets: deletedTickets.count, scenarios: deletedScenarios.count },
      created: transactions.length,
      lastBalance: transactions[transactions.length - 1]?.balanceEndOfDay,
    },
    null,
    2,
  ),
);
