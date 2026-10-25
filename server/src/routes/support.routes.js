import { Router } from 'express';
import { supportController } from '../controllers/support.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

const router = Router();

router.use(authMiddleware);
router.post('/tickets', supportController.createTicket);
router.get('/tickets', supportController.listTickets);

export default router;