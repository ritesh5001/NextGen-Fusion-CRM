import type { Lead, User } from '@/types';
import { fmtDateTime } from './format';

function cell(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  // Quote if it contains comma, quote, or newline.
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const COLUMNS: { header: string; value: (l: Lead) => unknown }[] = [
  { header: 'Name', value: (l) => l.name },
  { header: 'Title', value: (l) => l.title },
  { header: 'Company', value: (l) => l.company },
  { header: 'Phone', value: (l) => l.phone },
  { header: 'Alt Phone', value: (l) => l.altPhone },
  { header: 'Alt Phone 2', value: (l) => l.altPhone2 },
  { header: 'Email', value: (l) => l.email },
  { header: 'City', value: (l) => l.city },
  { header: 'State', value: (l) => l.state },
  { header: 'Country', value: (l) => l.country },
  { header: 'Status', value: (l) => l.status },
  { header: 'Call Status', value: (l) => l.callStatus },
  { header: 'Outcome', value: (l) => l.lastOutcome },
  { header: 'Qualified (Lead)', value: (l) => (l.qualified ? 'Yes' : 'No') },
  { header: 'Assigned To', value: (l) => (l.assignedTo as User | undefined)?.name ?? '' },
  { header: 'Remarks', value: (l) => l.remarks?.length ?? 0 },
  { header: 'Last Remark', value: (l) => l.remarks?.[l.remarks.length - 1]?.text ?? '' },
  { header: 'Last Contacted', value: (l) => (l.lastContactedAt ? fmtDateTime(l.lastContactedAt) : '') },
  { header: 'Next Follow-up', value: (l) => (l.nextFollowUpAt ? fmtDateTime(l.nextFollowUpAt) : '') },
];

function triggerDownload(csv: string, fileName: string) {
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadLeadsCsv(leads: Lead[], fileName = 'contacts.csv') {
  const head = COLUMNS.map((c) => c.header).join(',');
  const rows = leads.map((l) => COLUMNS.map((c) => cell(c.value(l))).join(','));
  triggerDownload([head, ...rows].join('\n'), fileName);
}

// Headers the importer recognizes (see server importService). Keep these names in
// sync so a downloaded template re-imports cleanly. Only Name + Phone are required.
const IMPORT_TEMPLATE_HEADERS = [
  'Name',
  'Phone',
  'Alt Phone',
  'Alt Phone 2',
  'Email',
  'Title',
  'Company',
  'City',
  'State',
  'Country',
  'Source',
  'Industry',
  'Notes',
];

const IMPORT_TEMPLATE_SAMPLE = [
  'John Doe',
  '+1 555 010 1234',
  '+1 555 010 5678',
  '+1 555 010 9012',
  'john@example.com',
  'Operations Manager',
  'Acme Shipping',
  'Houston',
  'Texas',
  'United States',
  'import',
  'Maritime',
  'Met at trade show',
];

/** Downloads a blank import template (headers + one sample row) for admins. */
export function downloadImportTemplate(fileName = 'contacts-import-template.csv') {
  const head = IMPORT_TEMPLATE_HEADERS.join(',');
  const sample = IMPORT_TEMPLATE_SAMPLE.map(cell).join(',');
  triggerDownload([head, sample].join('\n'), fileName);
}
