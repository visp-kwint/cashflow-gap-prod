import { Router } from 'express';
import { prisma } from '../config/db.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { ApiError } from '../utils/errors.js';

const router = Router();

router.use(authMiddleware);

/**
 * PATCH /user — обновление профиля (ТЗ §14): companyName, inn, minBalance (порог T).
 * Отвечает контрактом User { id, email, companyName, inn, minBalance }.
 */
router.patch('/', async (req, res, next) => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw ApiError.unauthorized();

    const { companyName, inn, minBalance } = req.body || {};
    const data = {};
    if (companyName !== undefined) data.companyName = String(companyName).slice(0, 120);
    if (inn !== undefined) {
      const innStr = String(inn);
      if (!/^(\d{10}|\d{12})$/.test(innStr)) throw ApiError.badRequest('ИНН должен состоять из 10 или 12 цифр');
      data.inn = innStr;
    }
    if (minBalance !== undefined) {
      const n = Number(minBalance);
      if (!Number.isFinite(n) || n < 0) throw ApiError.badRequest('Порог разрыва должен быть числом, не меньше 0');
      data.minBalance = n;
    }
    if (Object.keys(data).length === 0) throw ApiError.badRequest('Нет полей для обновления');

    const user = await prisma.user.update({
      where: { id: userId },
      data,
      select: { id: true, email: true, companyName: true, inn: true, minBalance: true },
    });
    res.json(user);
  } catch (err) {
    next(err);
  }
});

export default router;
