/**
 * Keeps a contact's three phone slots gap-free.
 *
 * The contacts table shows phone1/phone2/phone3 side by side, so a contact whose
 * phone2 is blank while phone3 is filled reads as a hole. Whenever the numbers
 * change we slide the filled ones up to be contiguous, carrying each number's
 * per-phone outcome with it so the CALL STATUS / LEAD STATUS columns stay attached
 * to the number they describe.
 *
 * Remarks and call logs are tagged by slot too, but only a saved document can have
 * those re-tagged — see `compactLeadPhones` in the lead controller for that path,
 * and `scripts/compactPhones.ts` for the one-time backfill of existing data.
 */
export const PHONE_SLOTS = ['phone1', 'phone2', 'phone3'] as const;
export type PhoneSlot = (typeof PHONE_SLOTS)[number];

/** Slot → the Lead field holding that slot's number. */
export const SLOT_NUMBER_FIELD: Record<PhoneSlot, 'phone' | 'altPhone' | 'altPhone2'> = {
  phone1: 'phone',
  phone2: 'altPhone',
  phone3: 'altPhone2',
};

/** Slot → the Lead field holding that slot's per-phone outcome. */
export const SLOT_OUTCOME_FIELD: Record<PhoneSlot, 'phone1Outcome' | 'phone2Outcome' | 'phone3Outcome'> = {
  phone1: 'phone1Outcome',
  phone2: 'phone2Outcome',
  phone3: 'phone3Outcome',
};

export const EMPTY_PHONE_OUTCOME = { callStatus: 'pending', leadOutcome: 'none' } as const;

const filled = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

export type SlotRemap = Map<PhoneSlot, PhoneSlot>;

/**
 * Compacts the phone slots of a lead-shaped object **in place**.
 *
 * Returns the old-slot → new-slot mapping for the numbers that actually moved
 * (empty when the slots were already contiguous), so callers can re-tag anything
 * else keyed by slot.
 */
export function compactPhoneSlots(lead: {
  get(path: string): unknown;
  set(path: string, value: unknown): unknown;
}): SlotRemap {
  const kept = PHONE_SLOTS.map((slot) => ({
    slot,
    number: ((lead.get(SLOT_NUMBER_FIELD[slot]) as string) ?? '').trim(),
    outcome: lead.get(SLOT_OUTCOME_FIELD[slot]),
  })).filter((entry) => filled(entry.number));

  const remap: SlotRemap = new Map();
  kept.forEach((entry, i) => {
    const target = PHONE_SLOTS[i];
    if (entry.slot !== target) remap.set(entry.slot, target);
  });
  if (remap.size === 0) return remap;

  PHONE_SLOTS.forEach((slot, i) => {
    const entry = kept[i];
    lead.set(SLOT_NUMBER_FIELD[slot], entry ? entry.number : '');
    lead.set(SLOT_OUTCOME_FIELD[slot], entry ? entry.outcome : { ...EMPTY_PHONE_OUTCOME });
  });
  return remap;
}

/**
 * Compacts a plain object of lead fields (the import path, where there is no
 * Mongoose document yet and no outcomes/remarks to carry).
 */
export function compactPhoneFields<
  T extends { phone?: unknown; altPhone?: unknown; altPhone2?: unknown },
>(fields: T): T & { phone: string; altPhone: string; altPhone2: string } {
  const out = fields as T & { phone: string; altPhone: string; altPhone2: string };
  const numbers = [fields.phone, fields.altPhone, fields.altPhone2]
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(filled);
  out.phone = numbers[0] ?? '';
  out.altPhone = numbers[1] ?? '';
  out.altPhone2 = numbers[2] ?? '';
  return out;
}
