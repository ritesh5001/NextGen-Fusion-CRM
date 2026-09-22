import { Router, type NextFunction, type Request, type Response } from 'express';
import * as ctrl from '../controllers/callController.js';
import { authenticate } from '../middleware/auth.js';
import { resolveWorkspace, requireWorkspace } from '../middleware/workspace.js';
import { validate } from '../middleware/validate.js';
import {
  logCallSchema,
  saveCustomContactSchema,
  clickToCallSchema,
  setCallProviderSchema,
} from '../validators/callValidators.js';
import { isEnabled, validateSignature } from '../services/twilioService.js';
import { ApiError } from '../utils/ApiError.js';

const router = Router();

// Rejects webhook requests that aren't genuinely from Twilio. These endpoints are
// public (Twilio can't carry our JWT) so the signature is the only auth.
async function twilioWebhook(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!(await isEnabled())) return next(ApiError.serviceUnavailable('Calling is not configured'));
    if (!(await validateSignature(req))) return next(ApiError.forbidden('Invalid Twilio signature'));
    next();
  } catch (err) {
    next(err);
  }
}

// Public Twilio webhooks (signature-verified, no JWT).
router.post('/voice', twilioWebhook, ctrl.handleVoice);
router.post('/recording', twilioWebhook, ctrl.handleRecording);
router.post('/status', twilioWebhook, ctrl.handleStatus);
router.post('/dial-status', twilioWebhook, ctrl.handleDialStatus);

// Public TeleCMI CDR webhook. TeleCMI doesn't sign its callbacks, so the handler
// authenticates it by matching the configured app id on the payload itself.
router.post('/telecmi/cdr', ctrl.handleTelecmiCdr);

// Everything below requires an authenticated user in an active workspace.
router.use(authenticate, resolveWorkspace, requireWorkspace);

router.get('/config', ctrl.getCallConfig);
router.get('/token', ctrl.getVoiceToken);
// TeleCMI: the caller's own softphone credentials, and the click-to-call trigger.
router.patch('/provider', validate(setCallProviderSchema), ctrl.setCallProvider);
router.get('/telecmi/credentials', ctrl.getTelecmiCredentials);
router.post('/telecmi/click-to-call', validate(clickToCallSchema), ctrl.telecmiClickToCall);
router.get('/dial-status/:callSid', ctrl.getDialStatus);
router.get('/:id/recording', ctrl.streamRecording);
router.get('/', ctrl.listCalls);
router.post('/', validate(logCallSchema), ctrl.logCall);
router.post('/save-contact', validate(saveCustomContactSchema), ctrl.saveCustomContact);

export default router;
