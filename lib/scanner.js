/**
 * Language-agnostic code scanner
 * Scans a project directory and extracts structural metrics
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative, dirname, extname } from 'path';

const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '.git', '__pycache__', 'venv', '.venv', 'build', 'coverage', '.claude']);
const CODE_EXTS = new Set(['.js', '.ts', '.tsx', '.jsx', '.py', '.go', '.rs', '.java', '.rb']);

/**
 * Recursively find source files in a directory
 * @param {string} dir
 * @param {Set<string>} [exts]
 * @returns {string[]}
 */
export function findSourceFiles(dir, exts = CODE_EXTS) {
  if (!existsSync(dir)) return [];
  const results = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry) || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) results.push(...findSourceFiles(full, exts));
    else if (exts.has(extname(entry))) results.push(full);
  }
  return results;
}

/**
 * Detect project type from file patterns
 * @param {string} projectDir
 * @returns {{ runtime: string, srcDirs: string[], testDirs: string[], configFiles: string[] }}
 */
export function detectProject(projectDir) {
  const has = (f) => existsSync(join(projectDir, f));
  const runtime = has('tsconfig.json') ? 'typescript'
    : has('package.json') ? 'node'
    : has('requirements.txt') || has('pyproject.toml') ? 'python'
    : has('go.mod') ? 'go'
    : has('Cargo.toml') ? 'rust'
    : 'unknown';

  const srcDirs = ['src', 'lib', 'app', 'scripts'].filter(d => has(d));
  const testDirs = ['tests', 'test', '__tests__', 'spec'].filter(d => has(d));
  const configFiles = ['package.json', 'tsconfig.json', 'pyproject.toml', 'go.mod', 'Cargo.toml']
    .filter(f => has(f));

  return { runtime, srcDirs, testDirs, configFiles };
}

/**
 * Extract import/require statements from JS/TS files
 * @param {string} content
 * @returns {string[]}
 */
export function extractImports(content) {
  const imports = [];
  const esm = /import\s+.*?\s+from\s+['"](.+?)['"]/g;
  const cjs = /require\s*\(\s*['"](.+?)['"]\s*\)/g;
  const py = /^(?:from\s+(\S+)\s+import|import\s+(\S+))/gm;
  let m;
  while ((m = esm.exec(content)) !== null) imports.push(m[1]);
  while ((m = cjs.exec(content)) !== null) imports.push(m[1]);
  while ((m = py.exec(content)) !== null) imports.push(m[1] || m[2]);
  return imports;
}

/**
 * Build import graph and detect circular dependencies
 * @param {string} projectDir
 * @param {string[]} files
 * @returns {{ graph: object, cycles: string[][] }}
 */
export function analyzeImportGraph(projectDir, files) {
  const graph = {};
  for (const f of files) {
    const rel = relative(projectDir, f).replace(/\\/g, '/');
    const content = readFileSync(f, 'utf-8');
    graph[rel] = extractImports(content).filter(i => i.startsWith('.'));
  }

  const cycles = [];
  const visited = new Set();
  const stack = new Set();

  function resolve(from, imp) {
    const dir = dirname(from);
    let resolved = join(dir, imp).replace(/\\/g, '/');
    if (!resolved.match(/\.\w+$/)) {
      for (const ext of ['.js', '.ts', '.tsx', '.jsx']) {
        if (graph[resolved + ext]) return resolved + ext;
      }
      if (graph[resolved + '/index.js']) return resolved + '/index.js';
      if (graph[resolved + '/index.ts']) return resolved + '/index.ts';
    }
    return resolved;
  }

  function dfs(node, path) {
    if (stack.has(node)) { cycles.push([...path, node]); return; }
    if (visited.has(node)) return;
    visited.add(node);
    stack.add(node);
    for (const dep of (graph[node] || [])) {
      const resolved = resolve(node, dep);
      if (graph[resolved]) dfs(resolved, [...path, node]);
    }
    stack.delete(node);
  }

  for (const node of Object.keys(graph)) dfs(node, []);
  return { graph, cycles };
}

/**
 * Measure nesting depth per function
 * @param {string[]} files
 * @param {string} projectDir
 * @returns {{ maxDepth: number, violations: Array<{file:string, func:string, depth:number}> }}
 */
export function measureNesting(files, projectDir) {
  const violations = [];
  let maxDepth = 0;
  for (const f of files) {
    const content = readFileSync(f, 'utf-8');
    const lines = content.split('\n');
    const rel = relative(projectDir, f).replace(/\\/g, '/');
    const funcRe = /^[\s]*(export\s+)?(async\s+)?function\s+(\w+)/;
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(funcRe);
      if (!match) continue;
      const funcName = match[3];
      let depth = 0, localMax = 0, braceCount = 0, started = false;
      for (let j = i; j < lines.length; j++) {
        for (const ch of lines[j]) {
          if (ch === '{') { braceCount++; started = true; depth = braceCount; }
          if (ch === '}') braceCount--;
          if (depth > localMax) localMax = depth;
        }
        if (started && braceCount === 0) break;
      }
      const nest = Math.max(0, localMax - 1);
      if (nest > maxDepth) maxDepth = nest;
      if (nest > 3) violations.push({ file: rel, func: funcName, depth: nest });
    }
  }
  return { maxDepth, violations };
}

/**
 * Check for hardcoded URLs/magic numbers in non-config files
 * @param {string[]} files
 * @param {string} projectDir
 * @returns {{ violations: Array<{file:string, line:number, match:string}> }}
 */
export function checkConfigSeparation(files, projectDir) {
  const violations = [];
  const urlRe = /https?:\/\/[^\s'"]+/g;
  const configPatterns = ['config', 'types', '.d.ts', '.json', '.env', 'constants'];
  for (const f of files) {
    const rel = relative(projectDir, f).replace(/\\/g, '/');
    if (configPatterns.some(p => rel.includes(p))) continue;
    const lines = readFileSync(f, 'utf-8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith('//') || line.trim().startsWith('*') || line.trim().startsWith('#')) continue;
      let m;
      while ((m = urlRe.exec(line)) !== null) {
        violations.push({ file: rel, line: i + 1, match: m[0] });
      }
    }
  }
  return { violations };
}

/**
 * Measure async error handling coverage
 * @param {string[]} files
 * @returns {{ total: number, handled: number, ratio: number }}
 */
export function measureAsyncErrors(files) {
  let total = 0, handled = 0;
  for (const f of files) {
    const content = readFileSync(f, 'utf-8');
    const asyncFuncs = content.match(/async\s+(function\s+\w+|\w+\s*=\s*async|\(\s*\w)/g);
    if (!asyncFuncs) continue;
    total += asyncFuncs.length;
    const tryCatches = content.match(/try\s*\{/g);
    const catches = content.match(/\.catch\s*\(/g);
    handled += (tryCatches ? tryCatches.length : 0) + (catches ? catches.length : 0);
  }
  handled = Math.min(handled, total);
  return { total: total || 1, handled, ratio: +(handled / (total || 1)).toFixed(2) };
}

/**
 * Measure let vs const ratio
 * @param {string[]} files
 * @returns {{ letCount: number, constCount: number, ratio: number }}
 */
export function measureMutability(files) {
  let letCount = 0, constCount = 0;
  for (const f of files) {
    const lines = readFileSync(f, 'utf-8').split('\n');
    for (const line of lines) {
      if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
      const lets = line.match(/\blet\s+/g);
      const consts = line.match(/\bconst\s+/g);
      if (lets) letCount += lets.length;
      if (consts) constCount += consts.length;
    }
  }
  const total = letCount + constCount || 1;
  return { letCount, constCount, ratio: +(letCount / total).toFixed(3) };
}

/**
 * Full project scan
 * @param {string} projectDir
 * @returns {object}
 */
export function scanProject(projectDir) {
  const project = detectProject(projectDir);
  const allDirs = [...project.srcDirs, 'scripts'].map(d => join(projectDir, d));
  const files = allDirs.flatMap(d => findSourceFiles(d));

  return {
    timestamp: new Date().toISOString(),
    projectDir,
    projectName: projectDir.split(/[/\\]/).pop(),
    project,
    fileCount: files.length,
    imports: analyzeImportGraph(projectDir, files),
    nesting: measureNesting(files, projectDir),
    configSeparation: checkConfigSeparation(files, projectDir),
    asyncErrors: measureAsyncErrors(files),
    mutability: measureMutability(files),
  };
}
