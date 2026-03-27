import { readFileSync } from 'fs';

const rules = JSON.parse(readFileSync('cron-config/rules.json', 'utf8'));
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const now = new Date().toISOString().slice(0, 10);

console.log('');
console.log('=== Cron Registry Status Report ===');
console.log(`Updated : ${rules.updated}`);
console.log(`As-of   : ${now}`);
console.log('');

for (const [id, job] of Object.entries(rules.jobs)) {
  const r = job.rules || {};
  let status = '✅ ACTIVE  ';
  if (job.enabled === false) status = '🔴 DISABLED';
  else if (job.paused)       status = '⏸️  PAUSED  ';

  const rulesSummary = [];
  if (r.skipOnWeekend) rulesSummary.push('no-weekend');
  if (r.skipDates?.length) rulesSummary.push(`skip:${r.skipDates.join(',')}`);
  if (r.onlyOnDays?.length) rulesSummary.push(`only:${r.onlyOnDays.map(d => DAY_NAMES[d]).join(',')}`);
  if (r.activeFrom) rulesSummary.push(`from:${r.activeFrom}`);
  if (r.activeUntil) rulesSummary.push(`until:${r.activeUntil}`);
  if (job.paused && job.pauseReason) rulesSummary.push(`reason:${job.pauseReason}`);

  console.log(`${status}  [${id}]`);
  console.log(`           schedule : ${job.schedule}`);
  console.log(`           desc     : ${job.description}`);
  if (rulesSummary.length) console.log(`           rules    : ${rulesSummary.join(' | ')}`);
  console.log('');
}
