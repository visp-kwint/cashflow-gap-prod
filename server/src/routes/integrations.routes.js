import { Router } from 'express';
import { prisma } from '../config/db.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { ApiError } from '../utils/errors.js';
import { syncProvider, unsyncProvider, checkCounterpartyRoute } from '../controllers/integrations.controller.js';
import { syncTaxCalendar } from '../controllers/plannedEvents.controller.js';

const router = Router();

router.use(authMiddleware);

// POST /api/integrations/:provider/sync
router.post('/:provider/sync', async (req, res, next) => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw new ApiError(401, 'Неавторизован');
    if (req.params.provider === 'tax-calendar') {
      const events = await syncTaxCalendar(prisma, userId);
      return res.status(201).json({ ok: true, provider: 'tax-calendar', label: 'Налоговый календарь ФНС', created: events.length, events });
    }
    const result = await syncProvider(prisma, userId, req.params.provider);
    if (!result.ok) throw new ApiError(400, result.error);
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// DELETE /api/integrations/:provider/sync — убрать синхронизацию источника
router.delete('/:provider/sync', async (req, res, next) => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw new ApiError(401, 'Неавторизован');
    const result = await unsyncProvider(prisma, userId, req.params.provider);
    if (!result.ok) throw new ApiError(400, result.error);
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/counterparty?inn=77******12
router.get('/counterparty', async (req, res, next) => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw new ApiError(401, 'Неавторизован');
    const result = await checkCounterpartyRoute(prisma, userId, req.query);
    if (!result.ok) throw new ApiError(400, result.error);
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
