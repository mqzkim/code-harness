#!/usr/bin/env node
/**
 * code-harness CLI
 *
 * Usage:
 *   node bin/cli.js evaluate --target /path/to/project
 *   node bin/cli.js evolve --target /path/to/project
 *   node bin/cli.js report --target /path/to/project
 */
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { scanProject } from '../lib/scanner.js';
import { scoreAuto, findImprovementTargets } from '../lib/scorer.js';
import { textReport, improvementPrompt } from '../lib/reporter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HARNESS_DIR = resolve(__dirname, '..');

function parseArgs(argv) {
  const args = { command: argv[2], target: null };
  for (let i = 3; i < argv.length; i++) {
    if (argv[i] === '--target' && argv[i + 1]) {
      args.target = resolve(argv[++i]);
    }
  }
  return args;
}

function ensureDataDir(projectDir) {
  const dir = resolve(projectDir, 'data');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function saveScores(projectDir, result, scan) {
  const dataDir = ensureDataDir(projectDir);
  const scoresFile = resolve(dataDir, 'structural-scores.json');
  let existing;
  try {
    existing = JSON.parse(readFileSync(scoresFile, 'utf-8'));
  } catch {
    existing = { rubricVersion: '1.0.0', maxScore: 100, evaluations: [] };
  }

  const entry = {
    date: scan.timestamp.split('T')[0],
    autoScore: result.autoTotal,
    autoMax: result.autoMax,
    claudeMax: result.claudeMax,
    scores: result.scores,
    scan: {
      fileCount: scan.fileCount,
      runtime: scan.project.runtime,
      cycles: scan.imports.cycles.length,
      maxNesting: scan.nesting.maxDepth,
      mutabilityRatio: scan.mutability.ratio,
    },
  };

  const todayIdx = existing.evaluations.findIndex(e => e.date === entry.date);
  if (todayIdx >= 0) existing.evaluations[todayIdx] = entry;
  else existing.evaluations.push(entry);

  writeFileSync(scoresFile, JSON.stringify(existing, null, 2) + '\n');
  return scoresFile;
}

function cmdEvaluate(projectDir) {
  const scan = scanProject(projectDir);
  const result = scoreAuto(scan);
  const report = textReport(scan.projectName, result, scan);
  process.stdout.write(report + '\n');

  const saved = saveScores(projectDir, result, scan);
  process.stdout.write(`\nScores saved to: ${saved}\n`);

  return { scan, result };
}

function cmdEvolve(projectDir) {
  const { scan, result } = cmdEvaluate(projectDir);
  const targets = findImprovementTargets(result);

  if (targets.length === 0) {
    process.stdout.write('\nAll auto-measurable rules pass. Claude evaluation needed for remaining points.\n');
    return;
  }

  const prompt = readFileSync(resolve(HARNESS_DIR, 'prompts', 'evolve.md'), 'utf-8');
  const report = textReport(scan.projectName, result, scan);
  const targetText = improvementPrompt(scan.projectName, targets, scan);

  const testCmd = detectTestCmd(projectDir);

  const filled = prompt
    .replace(/\{\{HARNESS_DIR\}\}/g, HARNESS_DIR.replace(/\\/g, '/'))
    .replace(/\{\{PROJECT_DIR\}\}/g, projectDir.replace(/\\/g, '/'))
    .replace('{{REPORT}}', report)
    .replace('{{TARGETS}}', targetText)
    .replace('{{TEST_CMD}}', testCmd);

  const promptFile = resolve(projectDir, '.harness-evolve-prompt.md');
  writeFileSync(promptFile, filled);
  process.stdout.write(`\nEvolution prompt saved to: ${promptFile}\n`);
  process.stdout.write(`\nTo run evolution:\n`);
  process.stdout.write(`  cd ${projectDir}\n`);
  process.stdout.write(`  claude -p "$(cat .harness-evolve-prompt.md)"\n`);
}

function detectTestCmd(projectDir) {
  const pkg = resolve(projectDir, 'package.json');
  if (existsSync(pkg)) {
    const p = JSON.parse(readFileSync(pkg, 'utf-8'));
    if (p.scripts?.test) return 'npm test';
  }
  if (existsSync(resolve(projectDir, 'pyproject.toml'))) return 'pytest';
  if (existsSync(resolve(projectDir, 'go.mod'))) return 'go test ./...';
  return 'echo "no test runner detected"';
}

function cmdReport(projectDir) {
  const scan = scanProject(projectDir);
  process.stdout.write(JSON.stringify(scan, null, 2) + '\n');
}

// ---- Main ----
const args = parseArgs(process.argv);

if (!args.command || !['evaluate', 'evolve', 'report'].includes(args.command)) {
  process.stderr.write('Usage:\n');
  process.stderr.write('  code-harness evaluate --target /path/to/project\n');
  process.stderr.write('  code-harness evolve   --target /path/to/project\n');
  process.stderr.write('  code-harness report   --target /path/to/project\n');
  process.exit(1);
}

if (!args.target) {
  process.stderr.write('Error: --target is required\n');
  process.exit(1);
}

if (!existsSync(args.target)) {
  process.stderr.write(`Error: target directory not found: ${args.target}\n`);
  process.exit(1);
}

switch (args.command) {
  case 'evaluate': cmdEvaluate(args.target); break;
  case 'evolve': cmdEvolve(args.target); break;
  case 'report': cmdReport(args.target); break;
}
