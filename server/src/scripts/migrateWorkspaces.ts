/**
 * One-time migration to move all pre-workspace data into a single workspace.
 *
 * Creates the "NextGen Fusion" workspace (if no workspace exists yet) and backfills
 * `workspace` on every telecaller and every CRM document that predates the
 * multi-workspace change. Idempotent — safe to run more than once; already-scoped
 * documents are left untouched.
 *
 *   npm run migrate:workspaces   (from the server package, or via root workspace)
 */
import { connectDB, disconnectDB } from '../config/db.js';
import { Workspace } from '../models/Workspace.js';
import { User } from '../models/User.js';
import { Lead } from '../models/Lead.js';
import { Task } from '../models/Task.js';
import { CallLog } from '../models/CallLog.js';
import { FollowUp } from '../models/FollowUp.js';
import { Notification } from '../models/Notification.js';
import { ImportBatch } from '../models/ImportBatch.js';

const DEFAULT_NAME = 'NextGen Fusion';

async function migrate() {
  await connectDB();

  // Target = the earliest existing workspace, or a freshly created "NextGen Fusion".
  let workspace = await Workspace.findOne().sort({ createdAt: 1 });
  if (!workspace) {
    const admin = await User.findOne({ role: 'superadmin' }).sort({ createdAt: 1 });
    workspace = await Workspace.create({ name: DEFAULT_NAME, createdBy: admin?._id });
    console.log(`✅ Created workspace "${workspace.name}" (${workspace._id})`);
  } else {
    console.log(`ℹ️  Using existing workspace "${workspace.name}" (${workspace._id})`);
  }

  const wsId = workspace._id;
  // `{ workspace: null }` matches both missing and explicitly-null fields.
  const orphan = { workspace: null } as const;

  // Telecallers only — the superadmin stays global (workspace-less).
  const users = await User.updateMany(
    { role: 'telecaller', ...orphan },
    { $set: { workspace: wsId } }
  );

  const [leads, tasks, calls, followUps, notifications, imports] = await Promise.all([
    Lead.updateMany(orphan, { $set: { workspace: wsId } }),
    Task.updateMany(orphan, { $set: { workspace: wsId } }),
    CallLog.updateMany(orphan, { $set: { workspace: wsId } }),
    FollowUp.updateMany(orphan, { $set: { workspace: wsId } }),
    Notification.updateMany(orphan, { $set: { workspace: wsId } }),
    ImportBatch.updateMany(orphan, { $set: { workspace: wsId } }),
  ]);

  console.log('\n📦 Backfilled into workspace:');
  console.log(`   telecallers   : ${users.modifiedCount}`);
  console.log(`   contacts/leads: ${leads.modifiedCount}`);
  console.log(`   tasks         : ${tasks.modifiedCount}`);
  console.log(`   call logs     : ${calls.modifiedCount}`);
  console.log(`   follow-ups    : ${followUps.modifiedCount}`);
  console.log(`   notifications : ${notifications.modifiedCount}`);
  console.log(`   import batches: ${imports.modifiedCount}`);

  await disconnectDB();
  console.log('\n🌱 Workspace migration complete.');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
