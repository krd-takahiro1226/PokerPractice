#!/usr/bin/env npx tsx
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { PRESOLVE_CONFIGS, type PresolveConfig } from './configs/srp-btn-bb';
import { allCanonicalFlops, STARTER_FLOPS } from './flops';
import { parseFinalExploitability, parseFlopTree, type SolverNode } from './parse';
import { buildInputText, runSolver } from './solverIO';

// バッチ実行 CLI（docs/SOLVER-REVIEW-DESIGN.md §12.2.2）。
// 使い方: npm run presolve:batch -- --config srp-btn-bb [--all | --starter] [--limit N]
//         [--solver <path>] [--resources <path>]

type Args = {
  config: string;
  scope: 'all' | 'starter';
  /** 今回の実行で新規に解く flop 数の上限（スモーク・分割実行用） */
  limit: number;
  solverBin: string;
  resourceDir: string;
};

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const config = get('--config') ?? 'srp-btn-bb';
  const scope: 'all' | 'starter' = argv.includes('--all') ? 'all' : 'starter';
  const limit = Number(get('--limit') ?? Infinity);
  const solverBin = get('--solver') ?? join(homedir(), 'tools/TexasSolver/build/console_solver');
  const resourceDir = get('--resources') ?? join(homedir(), 'tools/TexasSolver/resources');
  return { config, scope, limit, solverBin, resourceDir };
}

function toolCommit(solverBin: string): string {
  try {
    // solverBin は <repo>/build/console_solver 想定
    const repoRoot = join(solverBin, '..', '..');
    return execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

type MetaFile = {
  config: string;
  potType: string;
  positions: { ip: string; oop: string };
  mode: string;
  potBB: number;
  effStackBB: number;
  sprBucket: string;
  scale: number;
  tree: PresolveConfig['tree'];
  allinThreshold: number;
  ranges: PresolveConfig['ranges'];
  tool: { name: string; mode: string; commit: string };
  accuracyTarget: { maxIteration: number; retryMaxIteration: number; failThresholdPctPot: number };
  notes: string[];
  flops: Record<string, { exploitabilityPctPot: number; solvedAt: string; iterations: number }>;
};

const META_NOTES = [
  '意図的な品質妥協: turn/river は bet 75% + allin のみ（raise なし）。allin_threshold 0.3 で raise 連鎖・大型 bet を早期に allin へ併合',
  '逸脱(2026-07-10): 当初計画（turn/river raise 60・threshold 0.67・accuracy 0.5・maxIter 120）は SPR 17.7 の木で収束不能（実測 40反復 3,083秒 / exploitability 10.8%）だったため上記へ縮小。exploitability ゲート 1.0% pot は維持（超過 flop は出力しない）',
  '同梱スターターは代表テクスチャ6枚。残りテクスチャとフル 1,755 枚は resume 可能バッチで夜間実行する運用（scripts/presolve/README.md）',
];

function loadOrInitMeta(metaPath: string, config: PresolveConfig, solverBin: string): MetaFile {
  if (existsSync(metaPath)) {
    return JSON.parse(readFileSync(metaPath, 'utf8')) as MetaFile;
  }
  return {
    config: config.name,
    potType: config.potType,
    positions: { ip: config.ip.pos, oop: config.oop.pos },
    mode: config.mode,
    potBB: config.potBB,
    effStackBB: config.effStackBB,
    sprBucket: config.sprBucket,
    scale: config.scale,
    tree: config.tree,
    allinThreshold: config.allinThreshold,
    ranges: config.ranges,
    tool: { name: 'TexasSolver (bupticybee/TexasSolver, console)', mode: 'console', commit: toolCommit(solverBin) },
    accuracyTarget: {
      maxIteration: config.maxIteration,
      retryMaxIteration: config.retryMaxIteration,
      failThresholdPctPot: config.failThresholdPctPot,
    },
    notes: META_NOTES,
    flops: {},
  };
}

function solveOneFlop(
  config: PresolveConfig,
  flopIso: string,
  args: Args,
  scratchDir: string,
): { exploitabilityPctPot: number; iterations: number; dump: SolverNode } | null {
  for (const maxIteration of [config.maxIteration, config.retryMaxIteration]) {
    const inputPath = join(scratchDir, `${flopIso}.txt`);
    const dumpPath = join(scratchDir, `${flopIso}.dump.json`);
    const inputText = buildInputText({ config, flopIso, maxIteration, dumpPath });
    writeFileSync(inputPath, inputText);

    const { stdout } = runSolver(args.solverBin, args.resourceDir, inputPath, scratchDir);
    const exploitabilityPctPot = parseFinalExploitability(stdout);
    if (exploitabilityPctPot === null) {
      console.error(`[${flopIso}] exploitability could not be parsed from solver output; skipping`);
      return null;
    }
    if (exploitabilityPctPot <= config.failThresholdPctPot) {
      const dump = JSON.parse(readFileSync(dumpPath, 'utf8')) as SolverNode;
      rmSync(inputPath, { force: true });
      rmSync(dumpPath, { force: true });
      return { exploitabilityPctPot, iterations: maxIteration, dump };
    }
    console.warn(
      `[${flopIso}] exploitability ${exploitabilityPctPot.toFixed(3)}% > ${config.failThresholdPctPot}% at maxIteration=${maxIteration}`,
    );
    rmSync(inputPath, { force: true });
    rmSync(dumpPath, { force: true });
  }
  return null;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const configFactory = PRESOLVE_CONFIGS[args.config];
  if (!configFactory) {
    console.error(`unknown config "${args.config}". known: ${Object.keys(PRESOLVE_CONFIGS).join(', ')}`);
    process.exit(1);
  }
  const config = configFactory();

  if (!existsSync(args.solverBin)) {
    console.error(`solver binary not found: ${args.solverBin} (see scripts/presolve/README.md)`);
    process.exit(1);
  }

  const outDir = join(process.cwd(), 'public/presolve', config.name);
  mkdirSync(outDir, { recursive: true });
  const metaPath = join(outDir, 'meta.json');
  const meta = loadOrInitMeta(metaPath, config, args.solverBin);

  const flops = args.scope === 'all' ? allCanonicalFlops() : STARTER_FLOPS;
  const scratchDir = join(tmpdir(), 'presolve-scratch');
  mkdirSync(scratchDir, { recursive: true });

  let done = 0;
  let skipped = 0;
  for (const flopIso of flops) {
    if (done >= args.limit) {
      console.log(`limit ${args.limit} reached; stopping (resume で続きから再開可能)`);
      break;
    }
    const outPath = join(outDir, `${flopIso}.json`);
    if (existsSync(outPath)) {
      skipped++;
      continue;
    }
    const startedAt = Date.now();
    console.log(`[${flopIso}] solving (${done + skipped + 1}/${flops.length})...`);
    const result = solveOneFlop(config, flopIso, args, scratchDir);
    const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
    if (!result) {
      console.error(`[${flopIso}] FAILED after ${elapsedSec}s — not written`);
      continue;
    }
    const nodes = parseFlopTree(result.dump, {
      potBB: config.potBB * config.scale,
      effStackBB: config.effStackBB * config.scale,
    });
    // flop フィールドは SpotQuery.flopIso と同一表記（スペースなし canonical）で自己記述させる
    const outData = { v: 1, flop: flopIso, nodes };
    writeFileSync(outPath, JSON.stringify(outData));

    meta.flops[flopIso] = {
      exploitabilityPctPot: result.exploitabilityPctPot,
      solvedAt: new Date().toISOString(),
      iterations: result.iterations,
    };
    writeFileSync(metaPath, JSON.stringify(meta, null, 2));

    done++;
    console.log(
      `[${flopIso}] OK exploitability=${result.exploitabilityPctPot.toFixed(3)}% iterations=${result.iterations} elapsed=${elapsedSec}s`,
    );
  }

  console.log(`done. solved=${done} skipped(resume)=${skipped} total=${flops.length}`);
}

main();
