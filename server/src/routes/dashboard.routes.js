import { Router } from 'express';
import { getDashboard } from '../controllers/dashboard.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { planFactService } from '../services/planFact.service.js';

const router = Router();

router.get('/', authMiddleware, getDashboard);

// Вкладка «План-факт» (ТЗ-доработка WP-5): ?month=ГГГГ-ММ (по умолчанию текущий месяц)
router.get('/plan-fact', authMiddleware, async (req, res, next) => {
  try {
    const month = /^\d{4}-\d{2}$/.test(String(req.query.month ?? '')) ? String(req.query.month) : undefined;
    res.json(await planFactService.forMonth(req.user.userId, month));
  } catch (err) {
    next(err);
  }
});

export default router;