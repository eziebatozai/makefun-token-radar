// Token radar entrypoint. Exit codes: 0 success (including --dry-run), 1 rejected board or
// unreadable/unwritable inputs or output, 2 snapshot missing. Errors are concise; no stack traces.

import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const TEXT_MAX_BYTES = 65_536;
const DOSSIER_CAPS = {
  text_max_bytes: TEXT_MAX_BYTES,
  screenshots: { max: 4, max_bytes: 524_288 },
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
};
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const byName = (a: { name: string }, b: { name: string }): number => a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

function options(): { input: string; output: string; dryRun: boolean } {
  let input = '/input';
  let output = process.env.MAKEFUN_OUTPUT_DIR || '/output';
  let dryRun = false;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const value = args[i]!;
    if (value === '--dry-run') dryRun = true;
    else if (value === '--input' || value === '--output') {
      const next = args[++i];
      if (!next || next.startsWith('--')) throw new Error(`${value} needs a file or directory`);
      if (value === '--input') input = next;
      else output = next;
    } else if (value.startsWith('--input=')) input = value.slice(8);
    else if (value.startsWith('--output=')) output = value.slice(9);
    else throw new Error(`unknown option ${value}`);
  }
  if (!input || !output) throw new Error('--input and --output cannot be empty');
  return { input, output, dryRun };
}

function listFiles(source: string): string[] {
  const root = lstatSync(source);
  if (!root.isDirectory()) throw new Error(`${source} must be a directory`);
  const files: string[] = [];
  const walk = (from: string, prefix: string): void => {
    for (const entry of readdirSync(from, { withFileTypes: true }).sort(byName)) {
      if (entry.name.startsWith('.')) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(from, entry.name), relative);
      else if (entry.isFile()) files.push(relative);
    }
  };
  walk(source, '');
  return files;
}

function copyTree(source: string, destination: string): void {
  const root = lstatSync(source);
  if (!root.isDirectory()) throw new Error(`${source} must be a directory`);
  mkdirSync(destination, { recursive: true });
  const walk = (from: string, to: string): void => {
    for (const entry of readdirSync(from, { withFileTypes: true }).sort(byName)) {
      if (entry.name.startsWith('.')) continue;
      const src = join(from, entry.name);
      const dst = join(to, entry.name);
      if (entry.isDirectory()) {
        mkdirSync(dst, { recursive: true });
        walk(src, dst);
      } else if (entry.isFile()) copyFileSync(src, dst);
    }
  };
  walk(source, destination);
}

function validateBoard(board: ReturnType<typeof buildRadar>['board'], watchlist: string[]): void {
  if (board.length < 100 || board.length > 4000) throw new Error(`board has ${board.length} rows; expected 100..4000`);
  const seen = new Set<string>();
  let previous = Number.POSITIVE_INFINITY;
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (row.rank !== i + 1) throw new Error(`row ${i + 1} has rank ${row.rank}; expected exactly ${i + 1}`);
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0) {
      throw new Error(`${row.slug} has an implied value that is not a positive whole number`);
    }
    if (row.implied_value_usd > previous) throw new Error(`${row.slug} rises in implied value at rank ${row.rank}`);
    previous = row.implied_value_usd;
    if (seen.has(row.slug)) throw new Error(`board repeats protocol slug ${row.slug}`);
    seen.add(row.slug);
    if (!Array.isArray(row.farm_steps) || row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      throw new Error(`${row.slug} must have 3..12 farm steps`);
    }
    for (let j = 0; j < row.farm_steps.length; j++) {
      const step: unknown = row.farm_steps[j];
      if (typeof step !== 'string' || step.trim().length < 20 || step.trim().length > 600) {
        throw new Error(`${row.slug} farm step ${j + 1} must be 20..600 trimmed characters`);
      }
    }
  }
  for (const slug of watchlist) if (!seen.has(slug)) throw new Error(`board misses watchlist slug ${slug}`);
}

function run(): number {
  try {
    const { input, output, dryRun } = options();
    const inputFile = input.endsWith('.json') ? input : join(input, 'snapshot.json');
    if (!existsSync(inputFile)) {
      process.stderr.write(`token radar: no snapshot at ${inputFile}; pass --input <snapshot.json|directory> or provide /input/snapshot.json\n`);
      return 2;
    }

    const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
    const { board, radar } = buildRadar(snapshot);
    const issue = boardIssue(board, snapshot);
    if (issue !== null) throw new Error(`board refused by gate: ${issue}`);
    validateBoard(board, snapshot.watchlist);

    const dashboardSource = join(here, 'dashboard');
    // Keep already-produced reference screenshots stable when rerunning beside an existing local output.
    const bundledShots = join(here, 'screenshots');
    const referenceShots = join(here, 'out', 'screenshots');
    const screenshotsSource = existsSync(referenceShots) ? referenceShots : bundledShots;
    const shotFiles = listFiles(screenshotsSource);
    const rootShots = shotFiles.filter((path) => !path.includes('/'));
    if (rootShots.length < 3) throw new Error(`screenshots/ has ${rootShots.length} regular image files at its root; at least 3 are required`);
    if (rootShots.length > DOSSIER_CAPS.screenshots.max) throw new Error(`screenshots/ has ${rootShots.length} root files; the dossier allows at most ${DOSSIER_CAPS.screenshots.max}`);
    for (const path of rootShots) {
      const name = path.slice(path.lastIndexOf('/') + 1);
      if (!IMAGE_NAME.test(name)) throw new Error(`screenshots/${path}: use a 1..128 character name of letters, digits, . _ -`);
      const size = lstatSync(join(screenshotsSource, ...path.split('/'))).size;
      if (size > DOSSIER_CAPS.screenshots.max_bytes) throw new Error(`screenshots/${path} is ${size} bytes; the dossier allows ${DOSSIER_CAPS.screenshots.max_bytes}`);
    }
    buildDossier(here, DOSSIER_CAPS);

    const out = output;
    const boardPath = join(out, 'board.json');
    const dataPath = join(out, 'data.js');
    const dashboardPath = join(out, 'dashboard');
    const screenshotsPath = join(out, 'screenshots');
    const dossierPath = join(out, 'dossier.json');
    const total = board.reduce((sum, row) => sum + BigInt(row.implied_value_usd), 0n);
    const money = (n: bigint | number): string => `$${new Intl.NumberFormat('en-US').format(n)}`;
    const top = [...board].sort((a, b) => b.implied_value_usd - a.implied_value_usd).slice(0, 3)
      .map((row) => `#${row.rank} ${row.slug} ${money(row.implied_value_usd)}`).join('; ');
    process.stdout.write(
      `token radar: ${snapshot.protocols.length} protocols; ${snapshot.watchlist.length} watchlist; ${board.length} rows; ${radar.live_size} trading set aside\n` +
      `token radar: combined implied value ${money(total)}; top three: ${top}\n` +
      `token radar: outputs ${boardPath}, ${dataPath}, ${dashboardPath}, ${screenshotsPath}, ${dossierPath}\n`,
    );

    if (dryRun) {
      process.stdout.write('token radar: dry run; wrote nothing\n');
      return 0;
    }

    mkdirSync(out, { recursive: true });
    if (resolve(dashboardPath) !== resolve(dashboardSource)) {
      rmSync(dashboardPath, { recursive: true, force: true });
      copyTree(dashboardSource, dashboardPath);
    }
    if (resolve(screenshotsPath) !== resolve(screenshotsSource)) {
      rmSync(screenshotsPath, { recursive: true, force: true });
      copyTree(screenshotsSource, screenshotsPath);
    }
    writeFileSync(boardPath, `${JSON.stringify({ rows: board })}\n`);
    writeFileSync(dataPath, dataScript(radar));
    writeFileSync(dossierPath, buildDossier(out, DOSSIER_CAPS));
    process.stdout.write(`token radar: wrote ${boardPath}, ${dataPath}, dashboard, screenshots and ${dossierPath}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`token radar: ${message}\n`);
    return 1;
  }
}

process.exitCode = run();
