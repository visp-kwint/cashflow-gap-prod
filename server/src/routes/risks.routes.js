import { Router } from 'express';
import { getRisks, createRisk, updateRisk, deleteRisk } from '../controllers/risks.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

const router = Router();

router.use(authMiddleware);
router.get('/', getRisks);
router.post('/', createRisk);
router.patch('/:id', updateRisk);
router.delete('/:id', deleteRisk);

export default router;