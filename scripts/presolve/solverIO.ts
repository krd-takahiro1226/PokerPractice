import { execFileSync } from 'node:child_process';
import type { HandClass } from '../../src/core/handNotation';
import type { BetSizeSpec, PresolveConfig } from './configs/srp-btn-bb';
import { flopIsoToBoardArg } from './flops';

/** handClass:freq マップを TexasSolver のレンジ文字列に変換する（freq=1 は ':1' を省略）。 */
export function rangeToSolverString(range: Partial<Record<HandClass, number>>): string {
  return Object.entries(range)
    .filter((entry): entry is [HandClass, number] => (entry[1] ?? 0) > 0)
    .map(([hc, freq]) => (Math.abs(freq - 1) < 1e-9 ? hc : `${hc}:${freq}`))
    .join(',');
}

function betSizeLines(street: 'flop' | 'turn' | 'river', side: 'ip' | 'oop', spec: BetSizeSpec): string[] {
  const lines: string[] = [];
  if (spec.bet.length > 0) lines.push(`set_bet_sizes ${side},${street},bet,${spec.bet.join(',')}`);
  if (spec.raise.length > 0) lines.push(`set_bet_sizes ${side},${street},raise,${spec.raise.join(',')}`);
  if (spec.allin) lines.push(`set_bet_sizes ${side},${street},allin`);
  return lines;
}

export type BuildInputOptions = {
  config: PresolveConfig;
  flopIso: string;
  maxIteration: number;
  dumpPath: string;
  threadNum?: number;
};

/** console_solver への入力コマンド列を生成する（docs/SOLVER-REVIEW-DESIGN.md §12.2 実証済みコマンド）。 */
export function buildInputText(opts: BuildInputOptions): string {
  const { config, flopIso, maxIteration, dumpPath, threadNum = 6 } = opts;
  const potScaled = Math.round(config.potBB * config.scale);
  const effStackScaled = Math.round(config.effStackBB * config.scale);

  const lines: string[] = [
    `set_pot ${potScaled}`,
    `set_effective_stack ${effStackScaled}`,
    `set_board ${flopIsoToBoardArg(flopIso)}`,
    `set_range_ip ${rangeToSolverString(config.ranges.ip)}`,
    `set_range_oop ${rangeToSolverString(config.ranges.oop)}`,
    ...betSizeLines('flop', 'oop', config.tree.flop),
    ...betSizeLines('flop', 'ip', config.tree.flop),
    ...betSizeLines('turn', 'oop', config.tree.turn),
    ...betSizeLines('turn', 'ip', config.tree.turn),
    ...betSizeLines('river', 'oop', config.tree.river),
    ...betSizeLines('river', 'ip', config.tree.river),
    `set_allin_threshold ${config.allinThreshold}`,
    'build_tree',
    `set_thread_num ${threadNum}`,
    `set_accuracy ${config.accuracyTargetPctPot}`,
    `set_max_iteration ${maxIteration}`,
    'set_print_interval 20',
    'set_use_isomorphism 1',
    'start_solve',
    'set_dump_rounds 1',
    `dump_result ${dumpPath}`,
  ];
  return lines.join('\n') + '\n';
}

export type RunSolverResult = { stdout: string };

/** console_solver をブロッキング実行する（8GB RAM 制約のため直列前提。並列呼び出し禁止）。
 *  console_solver は作業ディレクトリに tmp_log.txt を書くため cwd をスクラッチに向ける。 */
export function runSolver(
  solverBin: string,
  resourceDir: string,
  inputPath: string,
  cwd: string,
): RunSolverResult {
  const stdout = execFileSync(solverBin, ['-i', inputPath, '-r', resourceDir], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 64,
    cwd,
    env: { ...process.env, OMP_NUM_THREADS: '6' },
  });
  return { stdout };
}
