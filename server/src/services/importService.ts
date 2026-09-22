import * as XLSX from 'xlsx';
import { Lead } from '../models/Lead.js';
import { ImportBatch } from '../models/ImportBatch.js';
import { getTwilioSettings } from './twilioService.js';
import { phoneKey } from '../utils/phone.js';
import { compactPhoneFields } from '../utils/phoneSlots.js';

interface RawRow {
  [key: string]: unknown;
}

/** Cleans a cell: strips Excel's text-prefix apostrophes/quotes (e.g. `"+971…`) and trims. */
function clean(v: unknown): string {
  if (v == null) return '';
  return String(v)
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .trim();
}

/** Returns the first non-empty cell whose normalized header matches one of `keys`. */
function pick(row: RawRow, keys: string[]): string {
  for (const key of Object.keys(row)) {
    const norm = key.trim().toLowerCase().replace(/[\s_#-]+/g, '');
    if (keys.includes(norm)) {
      const val = clean(row[key]);
      if (val) return val;
    }
  }
  return '';
}

/** Tries each header group in order and returns the first non-empty match. */
function pickFirst(row: RawRow, groups: string[][]): string {
  for (const group of groups) {
    const val = pick(row, group);
    if (val) return val;
  }
  return '';
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * How to handle a contact whose phone number already exists (in the CRM or
 * earlier in the same file):
 *  - `skip`   — keep the existing contact, don't import the duplicate (default).
 *  - `update` — overwrite the existing contact's fields with the imported values.
 *  - `import` — import it anyway as a separate contact (old behaviour).
 */
export type DuplicateStrategy = 'skip' | 'update' | 'import';

export interface ImportResult {
  batchId: string;
  totalRows: number;
  successCount: number;
  updatedCount: number;
  duplicateCount: number;
  errorCount: number;
  errors: { row: number; message: string }[];
}

/** Maps a CRM field id → the chosen spreadsheet header (admin-defined during import). */
export type FieldMapping = Partial<Record<string, string>>;

export interface ImportPreview {
  headers: string[];
  totalRows: number;
  sample: Record<string, string>[];
}

/** Reads a CSV/Excel buffer and returns its header row, row count, and a small sample. */
export function previewImport(buffer: Buffer): ImportPreview {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
  const headers = (aoa[0] ?? []).map((h) => String(h).trim()).filter(Boolean);
  const sample = aoa.slice(1, 4).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = String((r as unknown[])[i] ?? '').trim();
    });
    return obj;
  });
  return { headers, totalRows: Math.max(0, aoa.length - 1), sample };
}

/**
 * Parses a CSV/Excel buffer and bulk-creates leads. Header matching is
 * case/space/punctuation-insensitive and supports common CRM and Apollo.io
 * export columns, e.g.:
 *   - name        ← name | full name | First Name (+ Last Name)
 *   - phone       ← phone | mobile | Mobile Phone | Work Direct Phone | Corporate Phone | …
 *   - company     ← company | Company Name | organization
 *   - title       ← Title | designation
 *   - city/state/country, email, notes, industry (→ tag).
 */
export async function importLeads(
  buffer: Buffer,
  fileName: string,
  uploadedBy: string,
  workspace: string,
  assignedTo?: string,
  mapping?: FieldMapping,
  duplicateStrategy: DuplicateStrategy = 'skip'
): Promise<ImportResult> {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: '' });

  const useMapping = !!mapping && Object.values(mapping).some(Boolean);
  // Reads a field by its admin-mapped header (exact match).
  const mapped = (row: RawRow, field: string) => {
    const header = mapping?.[field];
    return header ? clean(row[header]) : '';
  };

  const errors: { row: number; message: string }[] = [];
  const parsed: { fields: Record<string, unknown>; phone: string; row: number }[] = [];

  rows.forEach((row, idx) => {
    const rowNum = idx + 2; // account for header row

    let name: string;
    let phone: string;
    let altPhone: string;
    let altPhone2: string;
    let email: string;
    let title: string;
    let company: string;
    let city: string;
    let state: string;
    let country: string;
    let source: string;
    let industry: string;
    let notes: string;

    if (useMapping) {
      // Admin chose exactly which column maps to which field.
      name = mapped(row, 'name');
      const lastName = mapped(row, 'lastName');
      if (lastName) name = [name, lastName].filter(Boolean).join(' ').trim();
      phone = mapped(row, 'phone');
      altPhone = mapped(row, 'altPhone');
      altPhone2 = mapped(row, 'altPhone2');
      email = mapped(row, 'email').toLowerCase();
      title = mapped(row, 'title');
      company = mapped(row, 'company');
      city = mapped(row, 'city');
      state = mapped(row, 'state');
      country = mapped(row, 'country');
      source = mapped(row, 'source');
      industry = mapped(row, 'industry');
      notes = mapped(row, 'notes');
    } else {
      // Auto-detect from common CRM/Apollo header names.
      name = pick(row, ['name', 'fullname', 'leadname', 'customername', 'contactname']);
      if (!name) {
        const first = pick(row, ['firstname', 'fname', 'givenname']);
        const last = pick(row, ['lastname', 'lname', 'surname', 'familyname']);
        name = [first, last].filter(Boolean).join(' ').trim();
      }
      const phones = [
        ['phone', 'phonenumber', 'contact', 'contactnumber', 'phone1'],
        ['mobile', 'mobilephone', 'cell', 'cellphone'],
        ['workdirectphone', 'directphone', 'workphone'],
        ['corporatephone', 'companyphone', 'officephone'],
        ['otherphone', 'homephone'],
        ['altphone', 'alternatephone', 'alternativephone', 'phone2', 'secondaryphone', 'secondphone', '2ndphone'],
        ['altphone2', 'alternatephone2', 'phone3', 'thirdphone', '3rdphone'],
      ]
        .map((group) => pick(row, group))
        .filter(Boolean);
      phone = phones[0] ?? '';
      altPhone = phones.find((p) => p !== phone) ?? '';
      altPhone2 = phones.find((p) => p !== phone && p !== altPhone) ?? '';
      email = pick(row, ['email', 'emailaddress']).toLowerCase();
      title = pick(row, ['title', 'jobtitle', 'designation', 'role']);
      company = pickFirst(row, [['company', 'companyname'], ['organization', 'organisation', 'business']]);
      city = pick(row, ['city', 'location', 'area']);
      state = pick(row, ['state', 'province', 'region']);
      country = pick(row, ['country']);
      source = pick(row, ['source', 'leadsource']);
      industry = pick(row, ['industry']);
      notes = pick(row, ['notes', 'remark', 'remarks', 'comment']);
    }

    // An admin column mapping can leave a hole (phone2 blank, phone3 filled) —
    // compact so imported contacts always fill phone1, then phone2, then phone3.
    // Runs before the missing-phone guard so a row carrying only an alt number is
    // imported (promoted to phone1) instead of being rejected as phone-less.
    ({ phone, altPhone, altPhone2 } = compactPhoneFields({ phone, altPhone, altPhone2 }));

    if (!name && !phone) return; // skip fully empty rows silently
    if (!phone) {
      errors.push({ row: rowNum, message: `Missing phone${name ? ` for "${name}"` : ''}` });
      return;
    }

    parsed.push({
      phone,
      row: rowNum,
      fields: {
        name: name || 'Unknown',
        phone,
        altPhone,
        altPhone2,
        email: EMAIL_RE.test(email) ? email : '',
        title,
        company,
        city,
        state,
        country,
        tags: industry ? [industry] : [],
        source: source || 'import',
        notes,
        status: assignedTo ? 'assigned' : 'new',
        assignedTo: assignedTo || undefined,
        assignedAt: assignedTo ? new Date() : undefined,
        createdBy: uploadedBy,
        workspace,
      },
    });
  });

  // ── Duplicate detection ──
  // Build a canonical E.164 key for each incoming number and match it against
  // existing contacts and against earlier rows in the same file. This is what
  // catches "+91 70074 36164" vs "917007436164" as the same contact.
  const defaultCode = (await getTwilioSettings())?.defaultCountryCode ?? '';
  const keyOf = (raw: string) => phoneKey(raw, defaultCode);

  const existing = await Lead.find({ workspace }, { phone: 1 }).lean();
  const existingByKey = new Map<string, unknown>();
  for (const l of existing) {
    const k = keyOf(String(l.phone ?? ''));
    if (k && !existingByKey.has(k)) existingByKey.set(k, l._id);
  }

  const docs: Record<string, unknown>[] = [];
  const updates: { id: unknown; fields: Record<string, unknown> }[] = [];
  const seenInFile = new Set<string>();
  let duplicateCount = 0;

  for (const p of parsed) {
    const key = keyOf(p.phone);

    if (duplicateStrategy !== 'import' && key) {
      if (seenInFile.has(key)) {
        // Same number appears twice in the uploaded file → keep the first only.
        duplicateCount++;
        continue;
      }
      seenInFile.add(key);

      const existingId = existingByKey.get(key);
      if (existingId) {
        if (duplicateStrategy === 'update') {
          updates.push({ id: existingId, fields: p.fields });
        } else {
          duplicateCount++;
        }
        continue;
      }
    }

    docs.push(p.fields);
  }

  // ── Apply updates (overwrite existing contacts, skipping blank incoming values) ──
  let updatedCount = 0;
  if (updates.length) {
    const ops = updates.map(({ id, fields }) => ({
      updateOne: {
        filter: { _id: id },
        update: { $set: buildUpdateSet(fields) },
      },
    }));
    const res = await Lead.bulkWrite(ops, { ordered: false }).catch(() => null);
    updatedCount = res?.modifiedCount ?? updates.length;
  }

  let inserted: { _id: unknown }[] = [];
  if (docs.length) {
    inserted = (await Lead.insertMany(docs, { ordered: false }).catch((err: unknown) => {
      // With ordered:false, partial inserts succeed; capture write errors.
      const e = err as { insertedDocs?: unknown[]; writeErrors?: { index: number; errmsg: string }[] };
      (e.writeErrors ?? []).forEach((we) => errors.push({ row: we.index + 2, message: we.errmsg }));
      return e.insertedDocs ?? [];
    })) as { _id: unknown }[];
  }

  const successCount = inserted.length;
  const batch = await ImportBatch.create({
    fileName,
    uploadedBy,
    workspace,
    totalRows: rows.length,
    successCount,
    errorCount: errors.length,
    errors: errors.slice(0, 50),
  });

  if (successCount) {
    await Lead.updateMany(
      { _id: { $in: inserted.map((d) => d._id) } },
      { $set: { importBatch: batch._id } }
    );
  }

  return {
    batchId: String(batch._id),
    totalRows: rows.length,
    successCount,
    updatedCount,
    duplicateCount,
    errorCount: errors.length,
    errors: errors.slice(0, 50),
  };
}

/**
 * Builds the `$set` for updating an existing contact from imported values:
 * only non-empty fields overwrite, so a sparse import row never wipes existing
 * data. `assignedTo` is applied (with its side effects) only when provided.
 */
function buildUpdateSet(fields: Record<string, unknown>): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  const copyIfPresent = ['name', 'phone', 'altPhone', 'altPhone2', 'email', 'title', 'company', 'city', 'state', 'country', 'notes', 'source'];
  for (const k of copyIfPresent) {
    const v = fields[k];
    // Don't let the "Unknown" name placeholder overwrite a real existing name.
    if (k === 'name' && v === 'Unknown') continue;
    if (typeof v === 'string' && v.trim()) set[k] = v;
    else if (v != null && typeof v !== 'string') set[k] = v;
  }
  const tags = fields.tags;
  if (Array.isArray(tags) && tags.length) set.tags = tags;
  if (fields.assignedTo) {
    set.assignedTo = fields.assignedTo;
    set.assignedAt = fields.assignedAt ?? new Date();
    set.status = 'assigned';
  }
  return set;
}
