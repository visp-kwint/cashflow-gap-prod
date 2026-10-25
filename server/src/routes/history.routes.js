import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { PrismaClient } from '@prisma/client';
import { ApiError } from '../utils/errors.js';
import { categoryWhere, RECURRING_PLANNEDNESS } from '../controllers/operations.controller.js';

const router = Router();
const prisma = new PrismaClient();

router.use(authMiddleware);

router.get('/summary', async (req, res, next) => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw new ApiError(401, 'Неавторизован');

    const { month, category, recurring } = req.query;
    const where = { userId };
    if (category) Object.assign(where, categoryWhere(category));
    // Фильтр «Повторяющиеся платежи» (отчёт §8.2): диаграмма учитывает тот же класс, что и список
    if (String(recurring) === 'true') where.plannedness = { in: RECURRING_PLANNEDNESS };
    if (month && /^\d{4}-\d{2}$/.test(String(month))) {
      const [year, m] = String(month).split('-').map(Number);
      where.date = {
        gte: new Date(year, m - 1, 1),
        lte: new Date(year, m, 0, 23, 59, 59),
      };
    }
    const operations = await prisma.operation.findMany({
      where,
      orderBy: { date: 'desc' },
    });
    res.json({ items: operations });
  } catch (err) {
    next(err);
  }
});

export default router;