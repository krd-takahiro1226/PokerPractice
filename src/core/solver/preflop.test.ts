import { describe, it, expect, vi } from 'vitest';
import type { HandLogEntry } from '../game/types';
import type { Position } from '../ranges/types';
import type { DecisionSnapshot } from '../review/snapshot';
import { analyzePreflop } from './preflop';
import type { AnalyzeContext } from './types';

// preflop.ts の lookup 優先順（solver → manual chart → legacy）と
// ライン分類（RFI/vsOpen/squeeze/vs3bet/vs4bet）を検証する。

// getSolverRange は 'RFI_BTN' のみ固定データを返し、他は undefined（charts.json が空の実挙動と同じ）。
// これにより他のテスト（manual/legacy 系統）は実モジュールと同じ振る舞いのまま影響を受けない。
vi.mock('../ranges/solverSeries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ranges/solverSeries')>();
  return {
    ...actual,
    getSolverRange: vi.fn((key: string) =>
      key === 'RFI_BTN'
        ? {
            range: { AA: { raise: 1 } },
            meta: { source: 'test-fixture', method: 'test', generatedAt: '2026-01-01', stackBB: 100 },
          }
        : undefined,
    ),
  };
});

function entry(
  partial: Partial<HandLogEntry> & Pick<HandLogEntry, 'street' | 'playerId' | 'action' | 'pos'>,
): HandLogEntry {
  return { potAfter: 0, ...partial } as HandLogEntry;
}

const ALL_POS: Position[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];

function snapshotWith(opts: {
  actionHistory: HandLogEntry[];
  actorPlayerId: number;
  actorPos: Position;
  openerPos?: Position;
  villainIds: number[];
  reliability?: 'exact' | 'approx';
  takenAction?: HandLogEntry['action'];
}): DecisionSnapshot {
  return {
    logIndex: opts.actionHistory.length,
    street: 'preflop',
    actor: { playerId: opts.actorPlayerId, pos: opts.actorPos, isHero: true },
    board: [],
    potBefore: 1.5,
    toCall: 2,
    legal: {
      canFold: true,
      canCheck: false,
      canCall: true,
      callAmount: 2,
      canBet: false,
      canRaise: true,
      minBetTo: 6,
      maxBetTo: 100,
    },
    players: [
      { playerId: opts.actorPlayerId, pos: opts.actorPos, stack: 98, committedStreet: 0, committedTotal: 0, status: 'active' },
      ...opts.villainIds.map((id, i) => ({
        playerId: id,
        pos: ALL_POS[i] ?? 'UTG',
        stack: 98,
        committedStreet: 0,
        committedTotal: 0,
        status: 'active' as const,
      })),
    ],
    effectiveStack: 98,
    spr: 20,
    bb: 1,
    actionHistory: opts.actionHistory,
    context: {
      openerPos: opts.openerPos,
      lastAggressorId: undefined,
      heroHasInitiative: false,
      villainIds: opts.villainIds,
      isMultiway: opts.villainIds.length > 1,
    },
    taken: { action: opts.takenAction ?? 'call' },
    reliability: opts.reliability ?? 'exact',
  };
}

const AA_HOLE: AnalyzeContext['heroHole'] = ['As', 'Ah'];

describe('analyzePreflop', () => {
  it('RFI: 先行レイズ無しは manual チャート(range-table)に分類される', () => {
    // ソルバー系列は 'RFI_BTN' のみ有効化しているため、他ポジション(CO)で manual フォールバックを検証する
    const snapshot = snapshotWith({
      actionHistory: [],
      actorPlayerId: 0,
      actorPos: 'CO',
      villainIds: [1, 2, 3, 4, 5],
    });
    const ctx: AnalyzeContext = { heroHole: AA_HOLE, mode: 'tournament' };
    const advice = analyzePreflop(snapshot, ctx);
    expect(advice.source).toBe('range-table');
    expect(advice.rangeOrigin).toBe('manual');
  });

  it('vsOpen: 他者の単一オープンに直面すると manual チャートに分類される', () => {
    const openEntry = entry({ street: 'preflop', playerId: 1, pos: 'UTG', action: 'raise', amount: 2.5, potAfter: 4 });
    const snapshot = snapshotWith({
      actionHistory: [openEntry],
      actorPlayerId: 0,
      actorPos: 'BB',
      openerPos: 'UTG',
      villainIds: [1],
    });
    const ctx: AnalyzeContext = { heroHole: AA_HOLE, mode: 'tournament' };
    const advice = analyzePreflop(snapshot, ctx);
    expect(advice.source).toBe('range-table');
    expect(advice.rangeOrigin).toBe('manual');
  });

  it('vsOpen: オープンシュート(allin)に直面した場合は legacy', () => {
    const openEntry = entry({ street: 'preflop', playerId: 1, pos: 'UTG', action: 'allin', amount: 100, potAfter: 101 });
    const snapshot = snapshotWith({
      actionHistory: [openEntry],
      actorPlayerId: 0,
      actorPos: 'BB',
      openerPos: 'UTG',
      villainIds: [1],
    });
    const ctx: AnalyzeContext = { heroHole: AA_HOLE, mode: 'tournament' };
    const advice = analyzePreflop(snapshot, ctx);
    expect(advice.source).toBe('legacy');
  });

  it('squeeze: オープン後に第三者のコールが挟まると vsOpen 近似(confidence降格)に分類される', () => {
    const openEntry = entry({ street: 'preflop', playerId: 1, pos: 'UTG', action: 'raise', amount: 2.5, potAfter: 4 });
    const callEntry = entry({ street: 'preflop', playerId: 2, pos: 'CO', action: 'call', amount: 2.5, potAfter: 6.5 });
    const snapshot = snapshotWith({
      actionHistory: [openEntry, callEntry],
      actorPlayerId: 0,
      actorPos: 'BB',
      openerPos: 'UTG',
      villainIds: [1, 2],
      reliability: 'exact',
    });
    const ctx: AnalyzeContext = { heroHole: AA_HOLE, mode: 'tournament' };
    const advice = analyzePreflop(snapshot, ctx);
    expect(advice.source).toBe('range-table');
    expect(advice.rangeOrigin).toBe('manual');
    // reliability='exact' なら通常 confidence='high' になるはずが、squeeze近似のため medium に降格
    expect(advice.confidence).toBe('medium');
    for (const c of advice.candidates) {
      expect(c.explanationKeys).toContain('preflop-squeeze-approx');
    }
  });

  it('vs3bet: ヒーローのオープンに3betで返された場合は legacy(データ未整備)', () => {
    const heroOpen = entry({ street: 'preflop', playerId: 0, pos: 'CO', action: 'raise', amount: 2.5, potAfter: 4 });
    const villain3bet = entry({ street: 'preflop', playerId: 1, pos: 'BTN', action: 'raise', amount: 8, potAfter: 12 });
    const snapshot = snapshotWith({
      actionHistory: [heroOpen, villain3bet],
      actorPlayerId: 0,
      actorPos: 'CO',
      openerPos: 'CO',
      villainIds: [1],
    });
    const ctx: AnalyzeContext = { heroHole: AA_HOLE, mode: 'tournament' };
    const advice = analyzePreflop(snapshot, ctx);
    expect(advice.source).toBe('legacy');
    expect(advice.confidence).toBe('low');
  });

  it('vs4bet: ヒーローの3betに4betで返された場合は legacy(データ未整備)', () => {
    const villainOpen = entry({ street: 'preflop', playerId: 1, pos: 'UTG', action: 'raise', amount: 2.5, potAfter: 4 });
    const hero3bet = entry({ street: 'preflop', playerId: 0, pos: 'BTN', action: 'raise', amount: 8, potAfter: 12 });
    const villain4bet = entry({ street: 'preflop', playerId: 1, pos: 'UTG', action: 'raise', amount: 20, potAfter: 28 });
    const snapshot = snapshotWith({
      actionHistory: [villainOpen, hero3bet, villain4bet],
      actorPlayerId: 0,
      actorPos: 'BTN',
      openerPos: 'UTG',
      villainIds: [1],
    });
    const ctx: AnalyzeContext = { heroHole: AA_HOLE, mode: 'tournament' };
    const advice = analyzePreflop(snapshot, ctx);
    expect(advice.source).toBe('legacy');
  });

  it('ソルバー系列にデータがあれば manual チャートより優先される (RFI)', () => {
    const snapshot = snapshotWith({
      actionHistory: [],
      actorPlayerId: 0,
      actorPos: 'BTN',
      villainIds: [1, 2, 3, 4, 5],
    });
    const ctx: AnalyzeContext = { heroHole: AA_HOLE, mode: 'tournament' };
    const advice = analyzePreflop(snapshot, ctx);
    expect(advice.source).toBe('range-table');
    expect(advice.rangeOrigin).toBe('solver');
    expect(advice.candidates.length).toBeGreaterThan(0);
    for (const c of advice.candidates) {
      expect(c.explanationKeys).toContain('preflop-solver-chart');
    }
  });
});
