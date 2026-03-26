#!/usr/bin/env node
/**
 * Run evaluation + evolution on all sibling projects
 *
 * Usage:
 *   node bin/run-all.js                    # evaluate all
 *   node bin/run-all.js --evolve           # evaluate + generate evolution prompts
 *   node bin/run-all.js --evolve --auto    # evaluate + auto-invoke Claude CLI
 */
import { readdirSync, statSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { scanProject } from '../lib/scanner.js';
import { scoreAuto, findImprovementTargets } from '../lib/scorer.js';
import { textReport } from '../lib/reporter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HARNESS_DIR = resolve(__dirname, '..');
const WORKSPACE = resolve(HARNESS_DIR, '..');

const args = process.argv.slice(2);
const doEvolve = args.includes('--evolve');
const autoRun = args.includes('--auto');

function findProjects() {
  const entries = readdirSync(WORKSPACE);
  const projects = [];
  for (const entry of entries) {
    if (entry === 'code-harness') continue;
    const dir = join(WORKSPACE, entry);
    if (!statSync(dir).isDirectory()) continue;
    const hasSrc = existsSync(join(dir, 'src')) || existsSync(join(dir, 'lib')) || existsSync(join(dir, 'scripts'));
    const hasPkg = existsSync(join(dir, 'package.json')) || existsSync(join(dir, 'pyproject.toml'));
    if (hasSrc || hasPkg) projects.push({ name: entry, dir });
  }
  return projects;
}

function runProject(project) {
  process.stdout.write(`\n${'='.repeat(60)}\n`);
  process.stdout.write(`Project: ${project.name}\n`);
  process.stdout.write(`${'='.repeat(60)}\n`);

  try {
    const scan = scanProject(project.dir);
    const result = scoreAuto(scan);
    const report = textReport(project.name, result, scan);
    process.stdout.write(report + '\n');

    const targets = findImprovementTargets(result);
    if (targets.length > 0) {
      process.stdout.write(`\nTop improvements needed:\n`);
      for (const t of targets) {
        process.stdout.write(`  - ${t.ruleId}: ${t.name} (${t.score}/${t.max}, fix: ${t.fix.slice(0, 60)}...)\n`);
      }
    }

    if (doEvolve) {
      const cli = resolve(HARNESS_DIR, 'bin', 'cli.js');
      execSync(`node "${cli}" evolve --target "${project.dir}"`, { stdio: 'inherit' });

      if (autoRun) {
        process.stdout.write(`\nRunning Claude evolution for ${project.name}...\n`);
        try {
          execSync(
            `claude -p "$(cat .harness-evolve-prompt.md)" --dangerously-skip-permissions`,
            { cwd: project.dir, stdio: 'inherit', timeout: 300000 }
          );
          process.stdout.write(`Evolution complete for ${project.name}\n`);
        } catch (e) {
          process.stderr.write(`Evolution failed for ${project.name}: ${e.message}\n`);
        }
      }
    }

    return { name: project.name, autoScore: result.autoTotal, autoMax: result.autoMax };
  } catch (e) {
    process.stderr.write(`  Error scanning ${project.name}: ${e.message}\n`);
    return { name: project.name, error: e.message };
  }
}

// ---- Main ----
const projects = findProjects();
process.stdout.write(`Found ${projects.length} projects in ${WORKSPACE}\n`);

const results = projects.map(runProject);

process.stdout.write(`\n${'='.repeat(60)}\n`);
process.stdout.write('SUMMARY\n');
process.stdout.write(`${'='.repeat(60)}\n`);
for (const r of results) {
  if (r.error) {
    process.stdout.write(`  ${r.name}: ERROR — ${r.error}\n`);
  } else {
    process.stdout.write(`  ${r.name}: ${r.autoScore}/${r.autoMax} (auto)\n`);
  }
}
