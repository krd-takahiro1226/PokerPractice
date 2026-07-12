import { ALL_HAND_CLASSES } from '../handNotation';
import type { Position, Range } from './types';
import chartsRaw from '../../data/solverRanges/charts.json';

export type SolverRangeKey =
  | `RFI_${Position}`
  | `VSOPEN_${Position}_${Position}` // VSOPEN_<opener>_<hero>
  | `VS3BET_${Position}_${Position}` // VS3BET_<hero>_<threebettor>
  | `SQUEEZE_${Position}_${Position}` // SQUEEZE_<opener>_<hero>
  | `VS4BET_${Position}_${Position}`; // VS4BET_<hero>_<fourbettor>

export function solverRfiKey(pos: Position): SolverRangeKey {
  return `RFI_${pos}`;
}
export function solverVsOpenKey(opener: Position, hero: Position): SolverRangeKey {
  return `VSOPEN_${opener}_${hero}`;
}
export function vs3betKey(hero: Position, threebettor: Position): SolverRangeKey {
  return `VS3BET_${hero}_${threebettor}`;
}
export function squeezeKey(opener: Position, hero: Position): SolverRangeKey {
  return `SQUEEZE_${opener}_${hero}`;
}
export function vs4betKey(hero: Position, fourbettor: Position): SolverRangeKey {
  return `VS4BET_${hero}_${fourbettor}`;
}

export type SolverChartMeta = {
  source: string;
  method: string;
  generatedAt: string;
  stackBB: number;
  license?: string;
  note?: string;
};

export type SolverChartData = {
  meta: SolverChartMeta;
  tables: Partial<Record<SolverRangeKey, Range>>;
};

// 生JSONは import script が編集後に書き換えるため union キー付きの型と
// 構造的に一致しない場合がある。ランタイム検証は validateSolverChartData 側で行う。
const chartsData = chartsRaw as unknown as SolverChartData;

export function getSolverRange(
  key: SolverRangeKey,
): { range: Range; meta: SolverChartMeta } | undefined {
  const range = chartsData.tables[key];
  if (!range || Object.keys(range).length === 0) return undefined;
  return { range, meta: chartsData.meta };
}

const POSITIONS_RE = 'UTG|HJ|CO|BTN|SB|BB';
const KEY_PATTERNS = [
  new RegExp(`^RFI_(${POSITIONS_RE})$`),
  new RegExp(`^VSOPEN_(${POSITIONS_RE})_(${POSITIONS_RE})$`),
  new RegExp(`^VS3BET_(${POSITIONS_RE})_(${POSITIONS_RE})$`),
  new RegExp(`^SQUEEZE_(${POSITIONS_RE})_(${POSITIONS_RE})$`),
  new RegExp(`^VS4BET_(${POSITIONS_RE})_(${POSITIONS_RE})$`),
];

function isValidKey(key: string): boolean {
  return KEY_PATTERNS.some((re) => re.test(key));
}

/** src/data/solverRanges/charts.json の形式を検証する。返り値が空配列なら valid。 */
export function validateSolverChartData(data: unknown): string[] {
  const errors: string[] = [];
  if (typeof data !== 'object' || data === null) {
    errors.push('data はオブジェクトである必要があります');
    return errors;
  }
  const d = data as Record<string, unknown>;
  const meta = d.meta as Record<string, unknown> | undefined;
  if (
    typeof meta !== 'object' ||
    meta === null ||
    typeof meta.source !== 'string' ||
    meta.source.trim() === ''
  ) {
    errors.push('meta.source が欠落しています');
  }
  const tables = d.tables;
  if (typeof tables !== 'object' || tables === null || Array.isArray(tables)) {
    errors.push('tables はオブジェクトである必要があります');
    return errors;
  }
  for (const [key, range] of Object.entries(tables as Record<string, unknown>)) {
    if (!isValidKey(key)) errors.push(`不正なキー形式: ${key}`);
    if (typeof range !== 'object' || range === null || Array.isArray(range)) {
      errors.push(`${key} のテーブルはオブジェクトである必要があります`);
      continue;
    }
    for (const [handClass, action] of Object.entries(range as Record<string, unknown>)) {
      if (!ALL_HAND_CLASSES.includes(handClass)) {
        errors.push(`${key}: 未知の handClass '${handClass}'`);
        continue;
      }
      if (typeof action !== 'object' || action === null) {
        errors.push(`${key}/${handClass}: action はオブジェクトである必要があります`);
        continue;
      }
      const a = action as Record<string, unknown>;
      let sum = 0;
      for (const freqKey of ['raise', 'call', 'fold'] as const) {
        const v = a[freqKey];
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
