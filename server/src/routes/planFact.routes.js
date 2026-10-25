// server/src/routes/planFact.routes.js
// ТЗ-доработка WP-5: график «План-факт» GET /api/plan-fact?days=30|60|90&granularity=day|week
import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { planFactService } from '../services/planFact.service.js';
import { ApiError } from '../utils/errors.js';

const router = Router();
router.use(authMiddleware);

/**
 * GET /plan-fact?days=30|60|90&granularity=day|week
 * Периоды { from, to, planIn, planOut, factIn, factOut, planNet, factNet, deviationNet, significant }.
 * План — прогноз, построенный на cut = начало периода − 1 день (данные, известные на cut),
 * факт — операции периода без own_funds_in/own_funds_out/loan_in.
 * Меньше 90 дней истории до cut → 400 (HTTPError из сервиса).
 */
router.get('/', async (req, res, next) => {
  try {
    const days = parseInt(req.query.days ?? '30', 10);
    const granularity = String(req.query.granularity ?? 'day');
    if (![30, 60, 90].includes(days)) throw ApiError.badRequest('days — 30, 60 или 90');
    if (!['day', 'week'].includes(granularity)) throw ApiError.badRequest('granularity — day или week');
    res.json(await planFactService.planFact(req.user.userId, days, granularity));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /plan-fact/gap-breakdown?days=30|60|90 — разбивка «из чего складывается нехватка»
 * (отчёт §8.4, минимум §8.7): обязательные платежи (PlannedEvents) / внеплановые резервы /
 * ожидаемые поступления. Показывается в Dashboard рядом с найденным разрывом.
 */
router.get('/gap-breakdown', async (req, res, next) => {
  try {
    const days = parseInt(req.query.days ?? '30', 10);
    res.json(await planFactService.gapBreakdown(req.user.userId, days));
  } catch (err) {
    next(err);
  }
});

export default router;
