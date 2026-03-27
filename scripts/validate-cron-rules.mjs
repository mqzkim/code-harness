import { readFileSync } from 'fs';

const rules = JSON.parse(readFileSync('cron-config/rules.json', 'utf8'));
const errors = [];

if (!rules.version) errors.push('missing: version');
if (!rules.defaults) errors.push('missing: defaults');
if (!rules.jobs || typeof rules.jobs !== 'object') errors.push('missing: jobs');

const VALID_DAYS = [0, 1, 2, 3, 4, 5, 6];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

for (const [id, job] of Object.entries(rules.jobs || {})) {
  if (typeof job.enabled !== 'boolean') errors.push(`${id}: enabled must be boolean`);
  if (typeof job.paused !== 'boolean') errors.push(`${id}: paused must be boolean`);
  if (!job.schedule) errors.push(`${id}: missing schedule`);
  if (!job.repo) errors.push(`${id}: missing repo`);

  const r = job.rules || {};
  if (!Array.isArray(r.skipDates)) errors.push(`${id}: rules.skipDates must be array`);
  for (const d of r.skipDates || []) {
    if (!DATE_RE.test(d)) errors.push(`${id}: invalid skipDate format: ${d}`);
  }
  if (r.onlyOnDays !== null && r.onlyOnDays !== undefined) {
    if (!Array.isArray(r.onlyOnDays)) errors.push(`${id}: rules.onlyOnDays must be array or null`);
    for (const d of r.onlyOnDays || []) {
      if (!VALID_DAYS.includes(d)) errors.push(`${id}: invalid day in onlyOnDays: ${d}`);
    }
  }
  if (r.activeFrom && !DATE_RE.test(r.activeFrom)) errors.push(`${id}: invalid activeFrom format`);
  if (r.activeUntil && !DATE_RE.test(r.activeUntil)) errors.push(`${id}: invalid activeUntil format`);
}

if (errors.length > 0) {
  console.error('Validation FAILED:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`Validation PASSED — ${Object.keys(rules.jobs).length} jobs registered`);
