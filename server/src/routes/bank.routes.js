import { Router } from 'express';
import { bankController } from '../controllers/bank.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

const router = Router();

router.use(authMiddleware);

router.post('/connect', bankController.connect);
router.post('/sync', bankController.sync);
router.get('/accounts', bankController.accounts);
router.get('/transactions', bankController.transactions);
router.post('/loan', bankController.loan);
router.post('/payments', bankController.payments);

export default router;