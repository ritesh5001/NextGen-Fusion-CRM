import { Router } from 'express';
import * as ctrl from '../controllers/followUpController.js';
import { authenticate } from '../middleware/auth.js';
import { resolveWorkspace, requireWorkspace } from '../middleware/workspace.js';

const router = Router();
router.use(authenticate, resolveWorkspace, requireWorkspace);

router.get('/', ctrl.listFollowUps);
router.patch('/:id/done', ctrl.markFollowUpDone);

export default router;
