import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { ApiError } from '../utils/errors.js';
import { checkCounterpartyRoute } from '../controllers/integrations.controller.js';

const router = Router();
const prisma = new PrismaClient();

router.use(authMiddleware);

// GET /api/counterparty?inn=77******12 (ТЗ-доп. §4.2)
router.get('/', async (req, res, next) => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw new ApiError(401, 'Неавторизован');
    const result = await checkCounterpartyRoute(prisma, userId, req.query);
    if (!result.ok) throw new ApiError(400, result.error);
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
