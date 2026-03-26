/**
 * Scoring engine — scores a project scan against structural rules
 * Auto-measurable rules are scored here; Claude-evaluated rules get placeholders
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RULES_PATH = join(__dirname, '..', 'rules', 'structural.json');

/**
 * Load structural rules
 * @returns {object}
 */
export function loadRules() {
  return JSON.parse(readFileSync(RULES_PATH, 'utf-8'));
}

/**
 * Score auto-measurable rules from a scan result
 * @param {object} scan - Output of scanProject()
 * @returns {{ scores: object, autoTotal: number, autoMax: number, claudeMax: number }}
 */
export function scoreAuto(scan) {
  const rules = loadRules();
  const scores = {};
  let autoTotal = 0, autoMax = 0, claudeMax = 0;

  for (const cat of rules.categories) {
    for (const rule of cat.rules) {
      if (rule.type !== 'auto') {
        claudeMax += rule.maxPoints;
        scores[rule.id] = { score: null, max: rule.maxPoints, type: 'claude', needsEval: true };
        continue;
      }

      let score = 0;
      let measurement = null;

      switch (rule.metric) {
        case 'max_nesting_depth': {
          const viols = scan.nesting.violations.length;
          score = viols === 0 ? rule.maxPoints : Math.max(0, rule.maxPoints - viols);
          measurement = { maxDepth: scan.nesting.maxDepth, violations: viols };
          break;
        }
        case 'circular_imports': {
          score = scan.imports.cycles.length === 0 ? rule.maxPoints : 0;
          measurement = { cycles: scan.imports.cycles.length };
          break;
        }
        case 'config_separation': {
          const viols = scan.configSeparation.violations.length;
          score = Math.max(0, rule.maxPoints - viols);
          measurement = { violations: viols };
          break;
        }
        case 'async_error_coverage': {
          score = Math.round(rule.maxPoints * scan.asyncErrors.ratio);
          measurement = scan.asyncErrors;
          break;
        }
        case 'let_const_ratio': {
          const ratio = scan.mutability.ratio;
          score = ratio <= rule.target ? rule.maxPoints : Math.max(0, rule.maxPoints - Math.ceil((ratio - rule.target) * 20));
          measurement = scan.mutability;
          break;
        }
      }

      scores[rule.id] = { score, max: rule.maxPoints, type: 'auto', measurement };
      autoTotal += score;
      autoMax += rule.maxPoints;
    }
  }

  return { scores, autoTotal, autoMax, claudeMax };
}

/**
 * Merge Claude evaluation scores with auto scores
 * @param {object} autoScores - From scoreAuto()
 * @param {object} claudeScores - { "SC-01": 7, "SC-02": 6, ... }
 * @returns {{ totalScore: number, maxScore: number, percentage: number, categories: object }}
 */
export function mergeScores(autoScores, claudeScores) {
  const rules = loadRules();
  const merged = { ...autoScores.scores };

  for (const [id, score] of Object.entries(claudeScores)) {
    if (merged[id] && merged[id].type === 'claude') {
      merged[id] = { ...merged[id], score, needsEval: false };
    }
  }

  const categories = {};
  let totalScore = 0;

  for (const cat of rules.categories) {
    let catScore = 0, catMax = 0;
    const details = {};
    for (const rule of cat.rules) {
      const s = merged[rule.id];
      const pts = s?.score ?? 0;
      catScore += pts;
      catMax += rule.maxPoints;
      details[rule.id] = s;
    }
    categories[cat.id] = { score: catScore, max: catMax, details };
    totalScore += catScore;
  }

  return {
    totalScore,
    maxScore: rules.maxScore,
    percentage: Math.round((totalScore / rules.maxScore) * 100),
    passing: totalScore >= rules.passingThreshold,
    categories,
  };
}

/**
 * Find the lowest-scoring areas that need improvement
 * @param {object} scoreResult - From mergeScores() or scoreAuto()
 * @param {number} [limit=3]
 * @returns {Array<{ ruleId: string, name: string, score: number, max: number, fix: string }>}
 */
export function findImprovementTargets(scoreResult, limit = 3) {
  const rules = loadRules();
  const targets = [];

  for (const cat of rules.categories) {
    for (const rule of cat.rules) {
      const s = scoreResult.scores?.[rule.id] || scoreResult.categories?.[cat.id]?.details?.[rule.id];
      if (!s) continue;
      const score = s.score ?? 0;
      if (score < rule.maxPoints) {
        targets.push({
          ruleId: rule.id,
          name: rule.name,
          category: cat.name,
          score,
          max: rule.maxPoints,
          gap: rule.maxPoints - score,
          fix: rule.fix,
          type: rule.type,
          measurement: s.measurement,
        });
      }
    }
  }

  return targets.sort((a, b) => b.gap - a.gap).slice(0, limit);
}
