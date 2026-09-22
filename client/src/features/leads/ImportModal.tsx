import { useState } from 'react';
import { UploadCloud, Download } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Label, Select } from '@/components/ui/Field';
import { useImportLeads, previewImportFile, type ImportPreview, type ImportResult, type DuplicateStrategy } from '@/api/leads';
import { useTelecallers } from '@/api/users';
import { apiError } from '@/api/client';
import { downloadImportTemplate } from '@/lib/csv';

interface Props {
  open: boolean;
  onClose: () => void;
}

// CRM target fields the file columns can be mapped to.
const FIELDS: { id: string; label: string; required?: boolean }[] = [
  { id: 'name', label: 'Name / First Name', required: true },
  { id: 'lastName', label: 'Last Name' },
  { id: 'phone', label: 'Phone', required: true },
  { id: 'altPhone', label: 'Alt Phone' },
  { id: 'altPhone2', label: 'Alt Phone 2' },
  { id: 'email', label: 'Email' },
  { id: 'title', label: 'Title' },
  { id: 'company', label: 'Company' },
  { id: 'city', label: 'City' },
  { id: 'state', label: 'State' },
  { id: 'country', label: 'Country' },
  { id: 'source', label: 'Source' },
  { id: 'industry', label: 'Industry (tag)' },
  { id: 'notes', label: 'Notes' },
];

// Header aliases used to pre-guess the mapping (mirrors the server's auto-detection).
const ALIASES: Record<string, string[]> = {
  name: ['name', 'fullname', 'leadname', 'customername', 'contactname', 'firstname', 'fname', 'givenname'],
  lastName: ['lastname', 'lname', 'surname', 'familyname'],
  phone: ['phone', 'phonenumber', 'contact', 'contactnumber', 'phone1', 'mobile', 'mobilephone', 'cell', 'cellphone'],
  altPhone: ['altphone', 'alternatephone', 'alternativephone', 'phone2', 'secondaryphone', 'secondphone', '2ndphone'],
  altPhone2: ['altphone2', 'alternatephone2', 'phone3', 'thirdphone', '3rdphone'],
  email: ['email', 'emailaddress'],
  title: ['title', 'jobtitle', 'designation', 'role'],
  company: ['company', 'companyname', 'organization', 'organisation', 'business'],
  city: ['city', 'location', 'area'],
  state: ['state', 'province', 'region'],
  country: ['country'],
  source: ['source', 'leadsource'],
  industry: ['industry'],
  notes: ['notes', 'remark', 'remarks', 'comment'],
};

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_#-]+/g, '');

function autoMap(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  const used = new Set<string>();
  for (const field of FIELDS) {
    const aliases = ALIASES[field.id] ?? [];
    const match = headers.find((h) => !used.has(h) && aliases.includes(norm(h)));
    if (match) {
      map[field.id] = match;
      used.add(match);
    }
  }
  return map;
}

export function ImportModal({ open, onClose }: Props) {
  const importLeads = useImportLeads();
  const { data: telecallers } = useTelecallers({ isActive: 'true', limit: 100 }, { enabled: open });
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [assignedTo, setAssignedTo] = useState('');
  const [duplicateStrategy, setDuplicateStrategy] = useState<DuplicateStrategy>('skip');
  const [result, setResult] = useState<ImportResult | null>(null);

  async function onFileChange(f: File | null) {
    setFile(f);
    setPreview(null);
    setMapping({});
    setResult(null);
    if (!f) return;
    setPreviewing(true);
    try {
      const p = await previewImportFile(f);
      setPreview(p);
      setMapping(autoMap(p.headers));
    } catch (err) {
      toast.error(apiError(err));
      setFile(null);
    } finally {
      setPreviewing(false);
    }
  }

  async function handleImport() {
    if (!file) return toast.error('Choose a file first');
    if (!mapping.name || !mapping.phone) return toast.error('Map both Name and Phone columns');
    try {
      const res = await importLeads.mutateAsync({ file, assignedTo: assignedTo || undefined, mapping, duplicateStrategy });
      setResult(res);
      toast.success(`Imported ${res.successCount} contacts`);
    } catch (err) {
      toast.error(apiError(err));
    }
  }

  function reset() {
    setFile(null);
    setPreview(null);
    setMapping({});
    setAssignedTo('');
    setDuplicateStrategy('skip');
    setResult(null);
    onClose();
  }

  const canImport = !!preview && !!mapping.name && !!mapping.phone;

  return (
    <Modal
      open={open}
      onClose={reset}
      title="Import contacts"
      size="lg"
      footer={
        <div className="flex gap-2 [&>*]:flex-1 sm:justify-end sm:[&>*]:flex-none">
          <Button variant="secondary" onClick={reset}>
            Close
          </Button>
          {!result && (
            <Button onClick={handleImport} loading={importLeads.isPending} disabled={!canImport}>
              Import {preview ? `${preview.totalRows} rows` : ''}
            </Button>
          )}
        </div>
      }
    >
      {result ? (
        <div className="space-y-2 text-sm dark:text-slate-200">
          <p className="font-medium text-emerald-700 dark:text-emerald-400">Import complete ✅</p>
          <p>Total rows: {result.totalRows}</p>
          <p>New contacts added: {result.successCount}</p>
          {result.updatedCount > 0 && <p>Existing contacts updated: {result.updatedCount}</p>}
          {result.duplicateCount > 0 && (
            <p>
              Duplicates {duplicateStrategy === 'update' ? 'merged' : 'skipped'}: {result.duplicateCount}
            </p>
          )}
          {result.errorCount > 0 && <p className="text-rose-600 dark:text-rose-400">Errors: {result.errorCount}</p>}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              New here? Download the template, fill it in, then upload it.
            </span>
            <Button size="sm" variant="secondary" onClick={() => downloadImportTemplate()}>
              <Download size={14} /> Template
            </Button>
          </div>

          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 p-6 hover:border-brand-400 dark:border-slate-600">
            <UploadCloud className="text-slate-400 dark:text-slate-500" size={26} />
            <span className="text-sm text-slate-500 dark:text-slate-400">
              {previewing ? 'Reading file…' : file ? file.name : 'Click to choose a CSV or Excel file'}
            </span>
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
            />
          </label>

          {/* Column mapping */}
          {preview && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Match columns</p>
                <span className="text-xs text-slate-400 dark:text-slate-500">
                  {preview.headers.length} columns · {preview.totalRows} rows
                </span>
              </div>
              <p className="text-xs text-slate-400 dark:text-slate-500">
                Pick which column in your file maps to each field. <span className="text-rose-500">*</span> required.
              </p>
              <div className="max-h-72 space-y-1.5 overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                {FIELDS.map((f) => {
                  const selected = mapping[f.id] ?? '';
                  const sampleVal = selected ? preview.sample[0]?.[selected] : '';
                  return (
                    <div key={f.id} className="grid grid-cols-2 items-center gap-2">
                      <span className="text-sm text-slate-600 dark:text-slate-300">
                        {f.label}
                        {f.required && <span className="text-rose-500"> *</span>}
                      </span>
                      <div>
                        <Select
                          value={selected}
                          onChange={(e) => setMapping((m) => ({ ...m, [f.id]: e.target.value }))}
                        >
                          <option value="">— Skip —</option>
                          {preview.headers.map((h) => (
                            <option key={h} value={h}>
                              {h}
                            </option>
                          ))}
                        </Select>
                        {sampleVal && (
                          <p className="mt-0.5 truncate text-[11px] text-slate-400 dark:text-slate-500" title={sampleVal}>
                            e.g. {sampleVal}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <Label>Assign all to (optional)</Label>
            <Select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
              <option value="">Leave unassigned</option>
              {telecallers?.data.map((t) => (
                <option key={t._id} value={t._id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Label>If a phone number already exists</Label>
            <Select
              value={duplicateStrategy}
              onChange={(e) => setDuplicateStrategy(e.target.value as DuplicateStrategy)}
            >
              <option value="skip">Skip it — keep the existing contact (recommended)</option>
              <option value="update">Update the existing contact with the new details</option>
              <option value="import">Import anyway — allow a duplicate contact</option>
            </Select>
            <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
              Numbers are matched even when formatted differently (e.g. “+91 70074 36164” and “917007436164”).
            </p>
          </div>
        </div>
      )}
    </Modal>
  );
}
