/** Throwaway: inspect recent US call attempts and what Twilio said about them. */
import { connectDB, disconnectDB } from '../config/db.js';
import { CallLog } from '../models/CallLog.js';
import { CallRecording } from '../models/CallRecording.js';
import { Integration } from '../models/Integration.js';
import { User } from '../models/User.js';

async function main() {
  await connectDB();

  const s = (await Integration.findOne({ key: 'twilio' }).lean()) as Record<string, any> | null;
  console.log('=== Twilio integration ===');
  console.log('  enabled:', s?.enabled, '| recordCalls:', s?.recordCalls);
  console.log('  callerId (default):', JSON.stringify(s?.callerId));
  console.log('  defaultCountryCode:', JSON.stringify(s?.defaultCountryCode));
  console.log('  publicServerUrl:', JSON.stringify(s?.publicServerUrl));

  const users = await User.find({ twilioNumber: { $nin: [null, ''] } }).select('name role twilioNumber').lean();
  console.log('\n=== Assigned caller IDs ===');
  users.forEach((u: any) => console.log(`  ${u.name} (${u.role}): ${u.twilioNumber}`));

  const us = await CallLog.find({ phoneNumber: /^\+1/ }).sort({ createdAt: -1 }).limit(25).lean();
  console.log(`\n=== Recent US (+1) call logs: ${us.length} ===`);
  for (const c of us as any[]) {
    const rec: any = c.twilioCallSid ? await CallRecording.findOne({ callSid: c.twilioCallSid }).lean() : null;
    console.log(
      `  ${new Date(c.createdAt).toISOString().slice(0, 16)} ${c.phoneNumber} ` +
        `status=${c.callStatus ?? '-'} disp=${c.disposition ?? '-'} dur=${c.durationSec}s ` +
        `sid=${c.twilioCallSid ? 'yes' : 'NO'} dial=${rec?.dialStatus ?? '-'} err=${rec?.errorCode ?? '-'} ${rec?.dialReason ?? ''}`
    );
  }

  const nonUs = await CallLog.find({ phoneNumber: { $not: /^\+1/ }, durationSec: { $gt: 0 } })
    .sort({ createdAt: -1 }).limit(5).lean();
  console.log(`\n=== Recent NON-US connected calls (for comparison): ${nonUs.length} ===`);
  for (const c of nonUs as any[]) {
    console.log(`  ${c.phoneNumber} status=${c.callStatus} dur=${c.durationSec}s`);
  }

  console.log('\n=== Dial failures by status/error (all calls) ===');
  const agg = await CallRecording.aggregate([
    { $group: { _id: { d: '$dialStatus', e: '$errorCode' }, n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]);
  agg.forEach((a: any) => console.log(`  dial=${a._id.d ?? '-'} err=${a._id.e ?? '-'} → ${a.n}`));

  await disconnectDB();
}
main().catch((e) => { console.error(e); process.exit(1); });
