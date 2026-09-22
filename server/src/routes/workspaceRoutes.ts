import { Router } from 'express';
import * as ctrl from '../controllers/workspaceController.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { validate } from '../middleware/validate.js';
import { createWorkspaceSchema, updateWorkspaceSchema } from '../validators/workspaceValidators.js';

const router = Router();
router.use(authenticate);

// Both roles can list (telecaller sees only their own — for the header badge).
router.get('/', ctrl.listWorkspaces);

// Managing workspaces is superadmin-only.
router.post('/', requireRole('superadmin'), validate(createWorkspaceSchema), ctrl.createWorkspace);
router.put('/:id', requireRole('superadmin'), validate(updateWorkspaceSchema), ctrl.updateWorkspace);
router.delete('/:id', requireRole('superadmin'), ctrl.deleteWorkspace);

export default router;
