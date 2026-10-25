import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { ApiError } from '../utils/errors.js';
import {
  listPlannedEvents,
  createPlannedEvents,
  updatePlannedEvent,
} from '../controllers/plannedEvents.controller.js';

const router = Router();
const prisma = new PrismaClient();

router.use(authMiddleware);

router.get('/', async (req, res, next) => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw new ApiError(401, 'Неавторизован');
    const { type, source } = req.query;
    res.json(await listPlannedEvents(prisma, userId, { type, source }));
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw new ApiError(401, 'Неавторизован');
    const created = await createPlannedEvents(prisma, userId, req.body ?? {});
    res.status(201).json({ events: created });
  } catch (err) { next(err); }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw new ApiError(401, 'Неавторизован');
    const updated = await updatePlannedEvent(prisma, userId, req.params.id, req.body ?? {});
    if (!updated) throw new ApiError(404, 'Событие не найдено');
    res.json({ event: updated });
  } catch (err) { next(err); }
});

export default router;
