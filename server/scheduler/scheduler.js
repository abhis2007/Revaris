// ── scheduler.js ── Weekly digest cron job ───────────────────────────
let cron;
try { cron = require('node-cron'); } catch(_) { cron = null; }

const db                 = require('../db/store');
const { generateDigestForOrg } = require('../digest/insights');
const { sendDigestEmail }      = require('../digest/mailer');

// Runs every Monday at 8:00 AM
const CRON_SCHEDULE = '0 8 * * 1';

async function runDigestForAllOrgs() {
  const orgs = db.getAllSubscribedOrgs();
  console.log(`[Scheduler] Running weekly digest for ${orgs.length} orgs...`);

  for (const org of orgs) {
    try {
      console.log(`[Scheduler] Generating digest for: ${org.businessName} (${org.email})`);
      const digestData  = await generateDigestForOrg(org);
      const emailSent   = await sendDigestEmail(org, digestData);
      db.saveDigest({ orgId: org.id, data: digestData, emailSent });
      db.updateOrg(org.id, { lastDigestAt: new Date().toISOString() });
      console.log(`[Scheduler] ✓ Done: ${org.businessName} — email sent: ${emailSent}`);
    } catch (err) {
      console.error(`[Scheduler] ✗ Failed for ${org.email}:`, err.message);
    }
  }

  console.log('[Scheduler] Weekly digest run complete.');
}

function startScheduler() {
  if (!cron) {
    console.warn('[Scheduler] node-cron not installed — run npm install to enable scheduling');
    return;
  }
  console.log(`[Scheduler] Started — digest will run every Monday at 8:00 AM`);
  cron.schedule(CRON_SCHEDULE, runDigestForAllOrgs);
}

module.exports = { startScheduler, runDigestForAllOrgs };
