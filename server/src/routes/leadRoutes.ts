import { Router } from 'express';
import * as ctrl from '../controllers/leadController.js';
import { authenticate } from '../middleware/auth.js';
import { resolveWorkspace, requireWorkspace } from '../middleware/workspace.js';
import { requireRole } from '../middleware/requireRole.js';
import { validate } from '../middleware/validate.js';
import { uploadSpreadsheet } from '../middleware/upload.js';
import {
  addRemarkSchema,
  assignLeadSchema,
  bulkAssignSchema,
  bulkDeleteSchema,
  createLeadSchema,
  followUpSchema,
  phoneOutcomeSchema,
  updateLeadSchema,
} from '../validators/leadValidators.js';

const router = Router();
router.use(authenticate, resolveWorkspace, requireWorkspace);

// Reads — both roles (telecaller results are scoped to their own leads in the controller).
router.get('/', ctrl.listLeads);
router.get('/stats', ctrl.getLeadStats);
router.get('/export', ctrl.exportLeads);

// Superadmin-only writes / assignment / import.
router.post('/', requireRole('superadmin'), validate(createLeadSchema), ctrl.createLead);
router.post('/import/preview', requireRole('superadmin'), uploadSpreadsheet, ctrl.previewImportHandler);
router.post('/import', requireRole('superadmin'), uploadSpreadsheet, ctrl.importLeadsHandler);
router.patch('/bulk-assign', requireRole('superadmin'), validate(bulkAssignSchema), ctrl.bulkAssignLeads);
router.post('/bulk-delete', requireRole('superadmin'), validate(bulkDeleteSchema), ctrl.bulkDeleteLeads);
router.patch('/:id/assign', requireRole('superadmin'), validate(assignLeadSchema), ctrl.assignLead);
router.delete('/:id', requireRole('superadmin'), ctrl.deleteLead);

// Read one + update — both roles (telecaller scoped in controller).
router.get('/:id', ctrl.getLead);
router.put('/:id', validate(updateLeadSchema), ctrl.updateLead);

// Remarks — both roles (telecaller scoped to assigned contacts in controller).
router.post('/:id/remarks', validate(addRemarkSchema), ctrl.addRemark);

// Schedule a follow-up inline — both roles (telecaller scoped in controller).
router.post('/:id/followup', validate(followUpSchema), ctrl.scheduleFollowUp);

// Per-phone call outcome — both roles (telecaller scoped in controller).
router.patch('/:id/phone-outcome', validate(phoneOutcomeSchema), ctrl.updatePhoneOutcome);

export default router;
