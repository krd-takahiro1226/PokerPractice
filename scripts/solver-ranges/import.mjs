// Validates and imports a solver-derived preflop range chart JSON file into
// src/data/solverRanges/charts.json. See src/core/ranges/solverSeries.ts for
// the canonical (TS) validation logic this script mirrors — kept in plain JS
// here since a .mjs CLI script cannot import a .ts module without a build step.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const OUTPUT_PATH = path.join(repoRoot, 'src', 'data', 'solverRanges', 'charts.json');

const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];

function allHandClasses() {
  const classes = new Set();
  for (let i = 0; i < RANKS.length; i++) {
    for (let j = 0; j < RANKS.length; j++) {
      if (i === j) classes.add(RANKS[i] + RANKS[i]);
      else if (i < j) classes.add(RANKS[i] + RANKS[j] + 's');
      else classes.add(RANKS[j] + RANKS[i] + 'o');
    }
  }
  return classes; // size 169
}

const ALL_HAND_CLASSES = allHandClasses();

const POSITIONS_RE = 'UTG|HJ|CO|BTN|SB|BB';
const KEY_PATTERNS = [
  new RegExp(`^RFI_(${POSITIONS_RE})$`),
  new RegExp(`^VSOPEN_(${POSITIONS_RE})_(${POSITIONS_RE})$`),
  new RegExp(`^VS3BET_(${POSITIONS_RE})_(${POSITIONS_RE})$`),
  new RegExp(`^SQUEEZE_(${POSITIONS_RE})_(${POSITIONS_RE})$`),
  new RegExp(`^VS4BET_(${POSITIONS_RE})_(${POSITIONS_RE})$`),
];

function isValidKey(key) {
  return KEY_PATTERNS.some((re) => re.test(key));
}

function validateSolverChartData(data) {
  const errors = [];
  if (typeof data !== 'object' || data === null) {
    errors.push('data はオブジェクトである必要があります');
    return errors;
  }
  const meta = data.meta;
  if (
    typeof meta !== 'object' ||
    meta === null ||
    typeof meta.source !== 'string' ||
    meta.source.trim() === ''
  ) {
    errors.push('meta.source が欠落しています');
  }
  const tables = data.tables;
  if (typeof tables !== 'object' || tables === null || Array.isArray(tables)) {
    errors.push('tables はオブジェクトである必要があります');
    return errors;
  }
  for (const [key, range] of Object.entries(tables)) {
    if (!isValidKey(key)) errors.push(`不正なキー形式: ${key}`);
    if (typeof range !== 'object' || range === null || Array.isArray(range)) {
      errors.push(`${key} のテーブルはオブジェクトである必要があります`);
      continue;
    }
    for (const [handClass, action] of Object.entries(range)) {
      if (!ALL_HAND_CLASSES.has(handClass)) {
        errors.push(`${key}: 未知の handClass '${handClass}'`);
        continue;
      }
      if (typeof action !== 'object' || action === null) {
        errors.push(`${key}/${handClass}: action はオブジェクトである必要があります`);
        continue;
      }
      let sum = 0;
      for (const freqKey of ['raise', 'call', 'fold']) {
        const v = action[freqKey];
        if (v === undefined) continue;
        if (typeof v !== 'number' || v < 0) {
          errors.push(`${key}/${handClass}/${freqKey}: 頻度は非負の数値である必要があります`);
          continue;
        }
        sum += v;
      }
      if (sum > 1 + 1e-6) {
        errors.push(`${key}/${handClass}: 頻度の合計が1を超えています (${sum})`);
      }
    }
  }
  return errors;
}

function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('使い方: node scripts/solver-ranges/import.mjs <input.json>');
    process.exit(1);
  }

  const absInputPath = path.resolve(process.cwd(), inputPath);
  let raw;
  try {
    raw = fs.readFileSync(absInputPath, 'utf8');
  } catch (err) {
    console.error(`ファイルを読み込めません: ${absInputPath}\n${err.message}`);
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    console.error(`JSON のパースに失敗しました: ${err.message}`);
    process.exit(1);
  }

  const errors = validateSolverChartData(data);
  if (errors.length > 0) {
    for (const e of errors) console.error(e);
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');

  const tableCount = Object.keys(data.tables).length;
  console.log(`インポート完了: ${tableCount} 件のテーブルキーを ${OUTPUT_PATH} に書き込みました`);
}

main();
