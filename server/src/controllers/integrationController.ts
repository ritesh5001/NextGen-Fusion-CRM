import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { env } from '../config/env.js';
import { Integration, type IntegrationDoc } from '../models/Integration.js';
import { TWILIO_KEY, listNumbers } from '../services/twilioService.js';
import { TELECMI_KEY, DEFAULT_SBC_URI, SBC_REGIONS, DEFAULT_API_REGION, API_REGIONS, detectApiRegion } from '../services/telecmiService.js';
import type { UpdateTwilioInput, UpdateTelecmiInput } from '../validators/integrationValidators.js';

// Fields the admin form sends that are kept secret: blanks mean "leave unchanged",
// and we never echo their values back to the client.
const SECRET_FIELDS = ['authToken', 'apiKeySecret'] as const;

/** Client-safe view of the Twilio settings — secrets reduced to a "set" flag. */
function sanitizeTwilio(doc: IntegrationDoc | null) {
  const base = (doc?.publicServerUrl || env.publicUrl || '').replace(/\/$/, '');
  const hasAllCreds = Boolean(
    doc?.accountSid && doc?.apiKeySid && doc?.apiKeySecret && doc?.twimlAppSid && doc?.callerId
  );
  return {
    enabled: doc?.enabled ?? false,
    configured: hasAllCreds,
    accountSid: doc?.accountSid ?? '',
    apiKeySid: doc?.apiKeySid ?? '',
    twimlAppSid: doc?.twimlAppSid ?? '',
    callerId: doc?.callerId ?? '',
    recordCalls: doc?.recordCalls ?? true,
    defaultCountryCode: doc?.defaultCountryCode ?? '',
    publicServerUrl: doc?.publicServerUrl ?? '',
    authTokenSet: Boolean(doc?.authToken),
    apiKeySecretSet: Boolean(doc?.apiKeySecret),
    // Handy for the admin: the URL to paste into the Twilio TwiML App's Voice config.
    voiceWebhookUrl: base ? `${base}/api/v1/calls/voice` : '',
  };
}

// GET /integrations/twilio (superadmin) — current Twilio settings, secrets masked.
export const getTwilioIntegration = asyncHandler(async (_req: Request, res: Response) => {
  const doc = await Integration.findOne({ key: TWILIO_KEY });
  res.json({ success: true, data: sanitizeTwilio(doc) });
});

// PUT /integrations/twilio (superadmin) — upsert Twilio settings. Non-secret fields
// always overwrite; secret fields only overwrite when a non-empty value is sent.
export const updateTwilioIntegration = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as UpdateTwilioInput;
  const doc = (await Integration.findOne({ key: TWILIO_KEY })) ?? new Integration({ key: TWILIO_KEY });

  const plainFields = [
    'enabled',
    'accountSid',
    'apiKeySid',
    'twimlAppSid',
    'callerId',
    'recordCalls',
    'defaultCountryCode',
    'publicServerUrl',
  ] as const;
  for (const field of plainFields) {
    if (body[field] !== undefined) doc.set(field, body[field]);
  }
  // Only replace a secret when a fresh value is supplied (blank = keep current).
  for (const field of SECRET_FIELDS) {
    if (body[field]) doc.set(field, body[field]);
  }

  doc.updatedBy = req.user!.id as unknown as IntegrationDoc['updatedBy'];
  await doc.save();

  res.json({ success: true, data: sanitizeTwilio(doc) });
});

// GET /integrations/twilio/numbers (superadmin) — voice-capable numbers owned by
// the Twilio account, for assigning to telecallers.
export const listTwilioNumbers = asyncHandler(async (_req: Request, res: Response) => {
  const numbers = await listNumbers();
  res.json({ success: true, data: numbers });
});

/** Client-safe view of the TeleCMI settings — the API token reduced to a "set" flag. */
function sanitizeTelecmi(doc: IntegrationDoc | null) {
  const base = (doc?.publicServerUrl || env.publicUrl || '').replace(/\/$/, '');
  return {
    enabled: doc?.enabled ?? false,
    configured: Boolean(doc?.appId && doc?.apiSecret),
    appId: doc?.appId ?? '',
    sbcUri: doc?.sbcUri || DEFAULT_SBC_URI,
    apiRegion: doc?.apiRegion || DEFAULT_API_REGION,
    recordCalls: doc?.recordCalls ?? true,
    defaultCountryCode: doc?.defaultCountryCode ?? '',
    publicServerUrl: doc?.publicServerUrl ?? '',
    apiSecretSet: Boolean(doc?.apiSecret),
    sbcRegions: SBC_REGIONS,
    apiRegions: API_REGIONS,
    // Paste this into the PIOPIY dashboard's "CDR URL" so call records reach us.
    cdrWebhookUrl: base ? `${base}/api/v1/calls/telecmi/cdr` : '',
  };
}

// GET /integrations/telecmi (superadmin) — current TeleCMI settings, secret masked.
export const getTelecmiIntegration = asyncHandler(async (_req: Request, res: Response) => {
  const doc = await Integration.findOne({ key: TELECMI_KEY });
  res.json({ success: true, data: sanitizeTelecmi(doc) });
});

// PUT /integrations/telecmi (superadmin) — upsert TeleCMI settings. Non-secret
// fields always overwrite; a blank `apiSecret` keeps the stored one.
export const updateTelecmiIntegration = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as UpdateTelecmiInput;
  const doc = (await Integration.findOne({ key: TELECMI_KEY })) ?? new Integration({ key: TELECMI_KEY });

  const plainFields = [
    'enabled',
    'appId',
    'sbcUri',
    'apiRegion',
    'recordCalls',
    'defaultCountryCode',
    'publicServerUrl',
  ] as const;
  for (const field of plainFields) {
    if (body[field] !== undefined) doc.set(field, body[field]);
  }
  if (body.apiSecret) doc.set('apiSecret', body.apiSecret);

  doc.updatedBy = req.user!.id as unknown as IntegrationDoc['updatedBy'];
  await doc.save();

  res.json({ success: true, data: sanitizeTelecmi(doc) });
});

// POST /integrations/telecmi/detect (superadmin) — works out which CHUB platform
// the account is on by trying the credentials against both. Uses the values the
// admin has typed, falling back to the stored secret (which is never sent back to
// the browser, so the form field is blank once saved).
export const detectTelecmiRegion = asyncHandler(async (req: Request, res: Response) => {
  const doc = await Integration.findOne({ key: TELECMI_KEY });
  const appId = String(req.body.appId || doc?.appId || '').trim();
  const apiSecret = String(req.body.apiSecret || doc?.apiSecret || '').trim();

  if (!appId || !apiSecret) {
    throw ApiError.badRequest('Enter the App ID and API secret first, then test.');
  }

  const { region, tried } = await detectApiRegion(appId, apiSecret);
  res.json({ success: true, region, tried });
});
