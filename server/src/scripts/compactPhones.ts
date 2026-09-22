/**
 * One-time migration: close gaps in the phone1/phone2/phone3 slots of every contact.
 *
 * A contact whose phone2 is empty but phone3 is filled leaves a hole in the
 * contacts table. This shifts the later numbers up so the filled slots are always
 * contiguous (phone1, then phone2, then phone3) — and carries everything attached
 * to each number along with it:
 *
 *   - the number itself   (phone / altPhone / altPhone2)
 *   - its per-phone state (phone1Outcome / phone2Outcome / phone3Outcome)
 *   - its remarks         (Lead.remarks[].phone tags)
 *   - its call history    (CallLog.phone for every log on that contact)
 *
 * Idempotent — contacts already contiguous are skipped, so it is safe to re-run.
 *
 *   npm run migrate:phones              # apply
 *   npm run migrate:phones -- --dry-run # report only, no writes
 */
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../config/db.js';
import { Lead } from '../models/Lead.js';
import { CallLog } from '../models/CallLog.js';

const DRY_RUN = process.argv.includes('--dry-run');

type Slot = 'phone1' | 'phone2' | 'phone3';
const SLOTS: Slot[] = ['phone1', 'phone2', 'phone3'];
const NUMBER_FIELD: Record<Slot, string> = {
  phone1: 'phone',
  phone2: 'altPhone',
  phone3: 'altPhone2',
};
const OUTCOME_FIELD: Record<Slot, string> = {
  phone1: 'phone1Outcome',
  phone2: 'phone2Outcome',
  phone3: 'phone3Outcome',
};

const EMPTY_OUTCOME = { callStatus: 'pending', leadOutcome: 'none' } as const;

/** A phone slot is "filled" when it holds something other than blank/whitespace. */
const filled = (v: unknown) => typeof v === 'string' && v.trim() !== '';

async function migrate() {
  await connectDB();
  if (DRY_RUN) console.log('🔍 Dry run — no documents will be modified.\n');

  // Only contacts that actually have a gap: a later slot filled while an earlier one is blank.
  const blank = { $in: [null, ''] };
  const candidates = await Lead.find({
    $or: [
      { phone: blank, $or: [{ altPhone: { $nin: [null, ''] } }, { altPhone2: { $nin: [null, ''] } }] },
      { altPhone: blank, altPhone2: { $nin: [null, ''] } },
    ],
  });

  let shifted = 0;
  let remarksMoved = 0;
  let callLogsMoved = 0;

  for (const lead of candidates) {
    // Read the current slots, then drop the blanks — the surviving order *is* the new layout.
    const current = SLOTS.map((slot) => ({
      slot,
      number: ((lead.get(NUMBER_FIELD[slot]) as string) ?? '').trim(),
      outcome: lead.get(OUTCOME_FIELD[slot]),
    }));
    const kept = current.filter((s) => filled(s.number));

    // old slot -> new slot, for the numbers that moved.
    const remap = new Map<Slot, Slot>();
    kept.forEach((entry, i) => {
      const target = SLOTS[i];
      if (entry.slot !== target) remap.set(entry.slot, target);
    });
    if (remap.size === 0) continue; // already contiguous (guard: shouldn't happen given the query)

    // Write the compacted numbers + their outcomes into slot order, blanking the tail.
    SLOTS.forEach((slot, i) => {
      const entry = kept[i];
      lead.set(NUMBER_FIELD[slot], entry ? entry.number : '');
      lead.set(OUTCOME_FIELD[slot], entry ? entry.outcome : { ...EMPTY_OUTCOME });
    });

    // Re-tag the remarks belonging to the numbers that moved.
    let leadRemarks = 0;
    for (const remark of lead.remarks as unknown as { phone?: Slot | null }[]) {
      const target = remark.phone ? remap.get(remark.phone) : undefined;
      if (target) {
        remark.phone = target;
        leadRemarks += 1;
      }
    }

    if (!DRY_RUN) {
      lead.markModified('remarks');
      await lead.save();
    }
    remarksMoved += leadRemarks;

    // Re-tag this contact's call history. Done per old-slot so logs are never
    // double-shifted (e.g. phone3->phone2 followed by phone2->phone1).
    let leadCalls = 0;
    for (const [from, to] of remap) {
      const filter = { lead: lead._id, phone: from };
      const count = DRY_RUN
        ? await CallLog.countDocuments(filter)
        : (await CallLog.updateMany(filter, { $set: { phone: to } })).modifiedCount;
      leadCalls += count;
    }
    callLogsMoved += leadCalls;
    shifted += 1;

    const moves = [...remap].map(([from, to]) => `${from}→${to}`).join(', ');
    console.log(
      `   ${DRY_RUN ? '[dry] ' : ''}${lead.name} (${lead._id}): ${moves}` +
        `${leadRemarks ? `, ${leadRemarks} remark(s)` : ''}${leadCalls ? `, ${leadCalls} call log(s)` : ''}`
    );
  }

  console.log('\n📞 Phone slot compaction:');
  console.log(`   contacts scanned : ${candidates.length}`);
  console.log(`   contacts shifted : ${shifted}`);
  console.log(`   remarks re-tagged: ${remarksMoved}`);
  console.log(`   call logs re-tag : ${callLogsMoved}`);

  await disconnectDB();
  console.log(DRY_RUN ? '\n🔍 Dry run complete — nothing written.' : '\n✅ Phone compaction complete.');
}

migrate().catch(async (err) => {
  console.error('Migration failed:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
