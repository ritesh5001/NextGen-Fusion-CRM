import { useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Field';
import { useCreateTelecaller, useUpdateTelecaller } from '@/api/users';
import { apiError } from '@/api/client';
import type { User } from '@/types';

interface Props {
  open: boolean;
  onClose: () => void;
  editing?: User | null;
}

export function TelecallerFormModal({ open, onClose, editing }: Props) {
  const create = useCreateTelecaller();
  const update = useUpdateTelecaller();
  const isEdit = !!editing;

  const [name, setName] = useState(editing?.name ?? '');
  const [email, setEmail] = useState(editing?.email ?? '');
  const [phone, setPhone] = useState(editing?.phone ?? '');
  const [password, setPassword] = useState('');
  const [dailyTarget, setDailyTarget] = useState(editing?.dailyTarget ?? 50);

  async function handleSubmit() {
    try {
      if (isEdit) {
        await update.mutateAsync({ id: editing!._id, name, phone, dailyTarget });
        toast.success('User updated');
      } else {
        await create.mutateAsync({ name, email, phone, password, dailyTarget });
        toast.success('User created');
      }
      onClose();
    } catch (err) {
      toast.error(apiError(err));
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit user' : 'Add user'}
      footer={
        <div className="flex gap-2 [&>*]:flex-1 sm:justify-end sm:[&>*]:flex-none">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} loading={create.isPending || update.isPending}>
            {isEdit ? 'Save changes' : 'Create'}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div>
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="User name" />
        </div>
        <div>
          <Label>Email</Label>
          <Input
            type="email"
            value={email}
            disabled={isEdit}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@nextgenfusion.in"
          />
        </div>
        <div>
          <Label>Phone</Label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
        </div>
        {!isEdit && (
          <div>
            <Label>Password</Label>
            <Input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Set an initial password"
            />
          </div>
        )}
        <div>
          <Label>Daily call target</Label>
          <Input
            type="number"
            value={dailyTarget}
            onChange={(e) => setDailyTarget(Number(e.target.value))}
          />
        </div>
      </div>
    </Modal>
  );
}
