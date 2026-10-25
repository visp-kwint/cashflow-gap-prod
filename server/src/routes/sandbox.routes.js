import { Router } from 'express';
import { sandboxController } from '../controllers/sandbox.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

const router = Router();

router.use(authMiddleware);
router.post('/simulate', sandboxController.simulate);
router.post('/reset', sandboxController.reset);

export default router;