/**
 * Report generator — produces human-readable and JSON reports
 */
import { loadRules } from './scorer.js';

/**
 * Generate a text report from score results
 * @param {string} projectName
 * @param {object} autoResult - From scoreAuto()
 * @param {object} scan - From scanProject()
 * @returns {string}
 */
export function textReport(projectName, autoResult, scan) {
  const rules = loadRules();
  const lines = [];

  lines.push(`\n=== Structural Evaluation: ${projectName} ===`);
  lines.push(`Date: ${scan.timestamp.split('T')[0]}`);
  lines.push(`Files scanned: ${scan.fileCount}`);
  lines.push(`Runtime: ${scan.project.runtime}`);
  lines.push(`Auto score: ${autoResult.autoTotal}/${autoResult.autoMax}`);
  lines.push(`Claude evaluation needed: ${autoResult.claudeMax} points`);
  lines.push('');

  for (const cat of rules.categories) {
    const autoRules = cat.rules.filter(r => r.type === 'auto');
    const claudeRules = cat.rules.filter(r => r.type === 'claude');

    if (autoRules.length > 0) {
      lines.push(`  ${cat.name}:`);
      for (const rule of autoRules) {
        const s = autoResult.scores[rule.id];
        const icon = s.score === s.max ? '+' : '-';
        const detail = s.measurement ? ` (${JSON.stringify(s.measurement)})` : '';
        lines.push(`    [${icon}] ${rule.id}: ${s.score}/${s.max} — ${rule.name}${detail}`);
      }
      for (const rule of claudeRules) {
        lines.push(`    [?] ${rule.id}: ?/${rule.maxPoints} — ${rule.name} (needs Claude)`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Generate the improvement prompt for Claude
 * @param {string} projectName
 * @param {Array} targets - From findImprovementTargets()
 * @param {object} scan - From scanProject()
 * @returns {string}
 */
export function improvementPrompt(projectName, targets, scan) {
  if (targets.length === 0) return 'All auto-measurable rules pass. Focus on Claude-evaluated rules.';

  const lines = [
    `Project "${projectName}" needs structural improvements.`,
    '',
    'Improvement targets (highest gap first):',
    '',
  ];

  for (const t of targets) {
    lines.push(`## ${t.ruleId}: ${t.name}`);
    lines.push(`   Category: ${t.category}`);
    lines.push(`   Score: ${t.score}/${t.max} (gap: ${t.gap})`);
    if (t.measurement) lines.push(`   Measurement: ${JSON.stringify(t.measurement)}`);
    lines.push(`   Fix: ${t.fix}`);
    lines.push('');
  }

  return lines.join('\n');
}
