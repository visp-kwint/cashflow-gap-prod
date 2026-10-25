import { bankService, BankValidationError } from '../services/bank.service.js';
import { planFactService } from '../services/planFact.service.js';
import { ApiError } from '../utils/errors.js';

function run(handler) {
  return async (req, res, next) => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw ApiError.unauthorized();
      await handler(userId, req, res);
    } catch (err) {
      if (err instanceof BankValidationError) return next(ApiError.badRequest(err.message));
      next(err);
    }
  };
}

export class BankController {
  connect = run(async (userId, req, res) => {
    res.json(await bankService.connect(userId, req.body || {}));
  });

  sync = run(async (userId, _req, res) => {
    res.json(await bankService.sync(userId));
  });

  accounts = run(async (userId, _req, res) => {
    res.json(await bankService.listAccounts(userId));
  });

  /** POST /bank/loan { amount, termDays? } — условный займ (заглушка банка). */
  loan = run(async (userId, req, res) => {
    const { amount, termDays } = req.body || {};
    res.json(await bankService.loan(userId, { amount, termDays }));
  });

  /** POST /bank/payments { type, recipient, amount, date, purpose } — ожидаемый платёж. */
  payments = run(async (userId, req, res) => {
    const { type, recipient, amount, date, purpose } = req.body || {};
    res.status(201).json(await bankService.payment(userId, { type, recipient, amount, date, purpose }));
  });

  /** GET /bank/transactions?from=YYYY-MM-DD&to=YYYY-MM-DD — выписка по счёту. */
  transactions = run(async (userId, req, res) => {
    const { from, to } = req.query;
    const data = await bankService.transactions(userId, from, to);
    // ТЗ-доработка WP-5: после чтения выписки банка — сверка план-факт
    // (операции могут появиться — статусы плановых событий обновляются к следующему GET /dashboard)
    await planFactService.reconcileForUser(userId);
    res.json(data);
  });
}

export const bankController = new BankController();
