import { Router } from 'express';
import * as ctrl from '../controllers/notificationController.js';
import { authenticate } from '../middleware/auth.js';
import { resolveWorkspace, requireWorkspace } from '../middleware/workspace.js';

const router = Router();
router.use(authenticate, resolveWorkspace, requireWorkspace);

router.get('/', ctrl.listNotifications);
router.patch('/read-all', ctrl.markAllRead);
router.patch('/:id/read', ctrl.markRead);

export default router;
