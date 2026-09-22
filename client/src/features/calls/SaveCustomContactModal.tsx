import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Label, Input, Textarea, FieldError } from '@/components/ui/Field';
import { apiError } from '@/api/client';
import { useSaveCustomContact } from '@/api/calls';
import { formatPhoneDisplay } from '@/lib/phone';

/**
 * Offered after a call to a number that isn't in the CRM. Entirely optional — the
 * call and its outcome are already saved either way; this just attaches a person
 * to it. Only the name is required, so saving stays a two-second job.
 */
export function SaveCustomContactModal({
  callLogId,
  phone,
  onDone,
}: {
  callLogId: string;
  phone: string;
  onDone: () => void;
}) {
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [notes, setNotes] = useState('');
  const [touched, setTouched] = useState(false);
  const save = useSaveCustomContact();

  const nameError = touched && !name.trim() ? 'Name is required' : '';

  function submit() {
    setTouched(true);
    if (!name.trim()) return;
    save.mutate(
      {
        callLog: callLogId,
        name: name.trim(),
        phone,
        company: company.trim() || undefined,
        email: email.trim() || undefined,
        city: city.trim() || undefined,
        notes: notes.trim() || undefined,
      },
      {
        onSuccess: () => {
          toast.success('Contact saved');
          onDone();
        },
        onError: (err) => toast.error(apiError(err)),
      }
    );
  }

  return (
    <Modal
      open
      onClose={onDone}
      title="Save as contact?"
      size="sm"
      footer={
        <div className="flex gap-2 [&>*]:flex-1 sm:justify-end sm:[&>*]:flex-none">
          <Button variant="secondary" onClick={onDone} disabled={save.isPending}>
            Skip
          </Button>
          <Button onClick={submit} loading={save.isPending}>
            <UserPlus size={14} /> Save contact
          </Button>
        </div>
      }
    >
      <div className="space-y-3.5">
        <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/60">
          <p className="font-medium text-slate-800 dark:text-slate-100">{formatPhoneDisplay(phone)}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            This number isn’t in your contacts. The call is already saved — adding details is optional.
          </p>
        </div>

        <div>
          <Label htmlFor="cc-name">Name *</Label>
          <Input
            id="cc-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setTouched(true)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="Who did you speak to?"
          />
          <FieldError>{nameError}</FieldError>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="cc-company">Company</Label>
            <Input id="cc-company" value={company} onChange={(e) => setCompany(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="cc-city">City</Label>
            <Input id="cc-city" value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
        </div>

        <div>
          <Label htmlFor="cc-email">Email</Label>
          <Input id="cc-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>

        <div>
          <Label htmlFor="cc-notes">Notes</Label>
          <Textarea id="cc-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}
