import { prisma } from '../config/db.js';
import { calculateForecast } from './forecast.service.js';
import { getAsOfDate } from '../utils/asOf.js';
import { FORECAST_CONFIG } from '../config/forecast.config.js';
import { bankAdapter } from '../bank-stub/bank-stub.adapter.js';

const PAYMENT_CATEGORY = {
  tax: 'tax',
  salary: 'salary',
  rent: 'expense',
  supplier: 'expense',
  other: 'other',
};

export class BankService {
  async connect(userId, data) {
    return bankAdapter.connect(data);
  }

  /**
   * Синхронизация с банком (заглушка): генерирует новые банковские операции
   * и записывает их в БД (source='bank_stub'), чтобы все банковские движения
   * учитывались в остатке и прогнозе. Повторный синк за один день не дублирует.
   */
  async sync(userId) {
    const operations = await prisma.operation.findMany({ where: { userId }, orderBy: { date: 'asc' } });
    // ТЗ WP-7 §9: бизнес-дата синка — опорная дата asOf (устаревшая выписка — последняя операция),
    // а не настенные часы; new Date() остаётся только как верхняя граница asOf
    const lastOpDate = operations.length ? operations[operations.length - 1].date : null;
    const asOfStr = getAsOfDate(lastOpDate, new Date()) || new Date().toISOString().slice(0, 10);
    const today = new Date(`${asOfStr}T00:00:00Z`);

    const already = await prisma.operation.findMany({ where: { userId, source: 'bank_stub', date: today } });
    if (already.length > 0) {
      return { synced: true, new: 0, operations: already };
    }

    let balance = operations.length > 0 ? operations[operations.length - 1].balanceEndOfDay : 0;

    // Детерминированный «банк»: суммы зависят от даты, а не от Math.random().
    const dayKey = `${userId}_${today.toISOString().slice(0, 10)}`;
    const h = [...dayKey].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 100000, 7);
    const rnd = (min, max, salt) => min + ((h * (salt + 13)) % (max - min));

    const candidates = [
      {
        amount: Math.round(rnd(35000, 95000, 1)),
        direction: 'in',
        category: 'income',
        counterpartyName: 'ООО ТехноПром',
        counterpartyInn: '7712345678',
        purpose: 'Оплата по договору поставки',
      },
      {
        amount: Math.round(rnd(4000, 18000, 2)),
        direction: 'out',
        category: 'expense',
        counterpartyName: 'ООО Офис Снаб',
        counterpartyInn: '7723456789',
        purpose: 'Хозяйственные расходы',
      },
    ];

    const created = [];
    for (const c of candidates) {
      balance += c.direction === 'in' ? c.amount : -c.amount;
      const op = await prisma.operation.create({
        data: {
          userId,
          date: today,
          amount: c.amount,
          direction: c.direction,
          category: c.category,
          counterpartyName: c.counterpartyName,
          counterpartyInn: c.counterpartyInn,
          purpose: c.purpose,
          balanceEndOfDay: Math.round(balance * 100) / 100,
          source: 'bank_stub',
        },
      });
      created.push(op);
    }
    return { synced: true, new: created.length, operations: created };
  }

  async listAccounts(_userId) {
    return bankAdapter.accounts();
  }

  /** Операции пользователя в диапазоне дат (для «Подтянуть операции из банка»). */
  async transactions(userId, from, to) {
    const where = { userId };
    const date = {};
    if (from) date.gte = new Date(from);
    if (to) date.lte = new Date(to);
    if (Object.keys(date).length > 0) where.date = date;
    const operations = await prisma.operation.findMany({ where, orderBy: { date: 'desc' } });
    return { operations };
  }

  /** Условный банковский займ (ТЗ §5.7): кредит поступлением, ставка — константа из конфига. */
  async loan(userId, { amount, termDays }) {
    const sum = Number(amount);
    if (!Number.isFinite(sum) || sum <= 0) {
      throw new BankValidationError('Сумма займа должна быть положительной');
    }

    const operations = await prisma.operation.findMany({ where: { userId }, orderBy: { date: 'asc' } });
    const balance = operations.length > 0 ? operations[operations.length - 1].balanceEndOfDay : 0;
    // ТЗ WP-7 §9: дата операции — опорная дата asOf, а не настенные часы
    const lastOpDate = operations.length ? operations[operations.length - 1].date : null;
    const asOfStr = getAsOfDate(lastOpDate, new Date()) || new Date().toISOString().slice(0, 10);
    const op = await prisma.operation.create({
      data: {
        userId,
        date: new Date(`${asOfStr}T00:00:00Z`),
        amount: sum,
        direction: 'in',
        category: 'income',
        counterpartyName: 'Банк (условный)',
        counterpartyInn: '0000000000',
        purpose: `Условный банковский займ${termDays ? `, срок ${termDays} дн.` : ''}`,
        balanceEndOfDay: balance + sum,
        source: 'bank_loan',
      },
    });
    return {
      status: 'approved',
      ratePct: FORECAST_CONFIG.loanRatePct ?? 0,
      operation: op,
    };
  }

  /** Ожидание платежа: списание + предупреждение, если прогноз показывает новый разрыв. */
  async payment(userId, { type, recipient, amount, date, purpose }) {
    const sum = Number(amount);
    if (!Number.isFinite(sum) || sum <= 0) {
      throw new BankValidationError('Сумма платежа должна быть положительной');
    }

    const [operations, risks, user] = await Promise.all([
      prisma.operation.findMany({ where: { userId }, orderBy: { date: 'asc' } }),
      prisma.risk.findMany({ where: { userId, active: true } }),
      prisma.user.findUnique({ where: { id: userId } }),
    ]);
    const balance = operations.length > 0 ? operations[operations.length - 1].balanceEndOfDay : 0;
    const minThreshold = user?.minBalance ?? 0;
    // ТЗ WP-7 §9: дата платежа по умолчанию — опорная дата asOf (не настенные часы);
    // явная date из запроса приоритетна, некорректная — тоже откат к asOf
    const lastOpDate = operations.length ? operations[operations.length - 1].date : null;
    const asOfDate = new Date(`${getAsOfDate(lastOpDate, new Date()) || new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    const payDate = date ? new Date(date) : asOfDate;
    if (Number.isNaN(payDate.getTime())) payDate.setTime(asOfDate.getTime());

    const op = await prisma.operation.create({
      data: {
        userId,
        date: payDate,
        amount: sum,
        direction: 'out',
        category: PAYMENT_CATEGORY[type] || 'other',
        counterpartyName: String(recipient || 'Получатель').slice(0, 120),
        counterpartyInn: '0000000000',
        purpose: String(purpose || type || 'Платёж').slice(0, 200),
        balanceEndOfDay: balance - sum,
        source: 'payment',
      },
    });

    // Предупреждение: появился ли новый разрыв после платежа.
    let warning = null;
    try {
      const after = calculateForecast(
        [...operations, { ...op, date: payDate }],
        risks,
        op.balanceEndOfDay,
        90,
        minThreshold,
        {
          // ТЗ-доработка WP-7 §9: предупреждение после платежа строится от опорной даты
          today: getAsOfDate(op.date ?? payDate, new Date()),
        },
      );
      if (after.gapDate) {
        warning = {
          gapGrows: true,
          newGapAmount: after.gapAmount,
          message: `После платежа остаток может упасть ниже порога — прогноз разрыва ${after.gapAmount.toLocaleString('ru-RU')} ₽.`,
        };
      }
    } catch {
      // Прогноз не критичен для записи платежа — возвращаем без warning.
    }

    return { status: 'accepted', operation: op, warning };
  }
}

export class BankValidationError extends Error {}

export const bankService = new BankService();
