import { Router } from 'express';
import { getSelfLoans, selfLoan, cancelSelfLoan } from '../controllers/gap.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

const router = Router();

router.use(authMiddleware);

router.get('/self-loans', getSelfLoans);
router.post('/self-loan', selfLoan);
router.delete('/self-loan/:operationId', cancelSelfLoan);

export default router;