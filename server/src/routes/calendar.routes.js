import { Router } from 'express';
import { calendarController } from '../controllers/calendar.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

const router = Router();

router.use(authMiddleware);
router.get('/events', calendarController.events);
// Контрактный GET /calendar/month?month=YYYY-MM — та же сущность, тот же контроллер.
router.get('/month', calendarController.events);

export default router;