import { describe, it, expect, vi } from 'vitest';
import type { Card } from '../cards';
import { cardsToHandClass } from '../handNotation';
import type { DecisionSnapshot } from '../review/snapshot';
import type { HandLogEntry } from '../game/types';
import { buildSubgameRanges } from './ranges';
import type { AnalyzeContext } from './types';

// ranges.ts はライン絞り込みの「規則」が仕様。規則の適用有無と開示を検証する
// （頻度の数値スナップショットは書かない: §8.2）。
//
// getSolverRange は 'RFI_BTN' のみデータ有り、他は undefined を返すようモックする。
// 実charts.jsonは常に空のため、既存テスト群（下記の villain=CO オープン固定シナリオ）は
// 'RFI_BTN' を問い合わせないので実モジュールと挙動が一致し、無変更のままグリーンを保つ。
vi.mock('../ranges/solverSeries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ranges/solverSeries')>();
  return {
    ...actual,
    getSolverRange: vi.fn((key: string) =>
      key === 'RFI_BTN'
        ? {
            range: { AA: { raise: 1 } },
            meta: { source: 'test-solver-source', method: 'cfr', generatedAt: '2026-01-01', stackBB: 100 },
          }
        : undefined,
    ),
  };
});

function entry(partial: Partial<HandLogEntry> & Pick<HandLogEntry, 'street' | 'playerId' | 'action'>): HandLogEntry {
  return { pos: partial.playerId === 0 ? 'BTN' : 'CO', potAfter: 0, ...partial } as HandLogEntry;
}

function snapshotWith(actionHistory: HandLogEntry[], board: Card[]): DecisionSnapshot {
  return {
    logIndex: actionHistory.length,
    street: 'river',
    actor: { playerId: 0, pos: 'BTN', isHero: true },
    board,
    potBefore: 10,
    toCall: 5,
    legal: { canFold: true, canCheck: false, canCall: true, callAmount: 5, canBet: false, canRaise: true, minBetTo: 15, maxBetTo: 100 },
    players: [
      { playerId: 0, pos: 'BTN', stack: 95, committedStreet: 0, committedTotal: 5, status: 'active' },
      { playerId: 5, pos: 'CO', stack: 90, committedStreet: 5, committedTotal: 10, status: 'active' },
    ],
    effectiveStack: 90,
    spr: 9,
    bb: 1,
    actionHistory,
    context: {
      openerPos: 'CO',
      lastAggressorId: 5,
      heroHasInitiative: false,
      villainIds: [5],
      isMultiway: false,
    },
    taken: { action: 'call', additional: 5 },
    reliability: 'exact',
  };
}

const ctx: AnalyzeContext = { heroHole: ['As', 'Kd'], mode: 'tournament' };

const preflop: HandLogEntry[] = [
  entry({ street: 'preflop', playerId: 5, action: 'raise', amount: 2.5, potAfter: 4 }),
  entry({ street: 'preflop', playerId: 0, action: 'call', amount: 2.5, potAfter: 6.5 }),
];

const board: Card[] = ['Qh', '7d', '2c', '5s', '9h'];

describe('buildSubgameRanges', () => {
  it('アグレッションが無ければ chart 起点のみ（絞り込みなし）', () => {
    const snapshot = snapshotWith(
      [
        ...preflop,
        entry({ street: 'flop', playerId: 5, action: 'check' }),
        entry({ street: 'flop', playerId: 0, action: 'check' }),
        entry({ street: 'turn', playerId: 5, action: 'check' }),
        entry({ street: 'turn', playerId: 0, action: 'check' }),
        entry({ street: 'river', playerId: 5, action: 'bet', amount: 5, potAfter: 11.5 }),
      ],
      board,
    );
    const ranges = buildSubgameRanges(snapshot, ctx)!;
    expect(ranges).not.toBeNull();
    expect(ranges.hero.assumption.origin).toBe('chart');
    expect(ranges.villain.assumption.origin).toBe('chart');
    expect(ranges.rare).toBe(false);
    expect(ranges.hero.combos.length).toBeGreaterThan(50);
  });

  it('flop で bet した側は air が減衰し、規則が RangeAssumption に開示される', () => {
    const snapshot = snapshotWith(
      [
        ...preflop,
        entry({ street: 'flop', playerId: 5, action: 'bet', amount: 3, potAfter: 9.5 }),
        entry({ street: 'flop', playerId: 0, action: 'call', amount: 3, potAfter: 12.5 }),
        entry({ street: 'turn', playerId: 5, action: 'check' }),
        entry({ street: 'turn', playerId: 0, action: 'check' }),
        entry({ street: 'river', playerId: 5, action: 'bet', amount: 5, potAfter: 17.5 }),
      ],
      board,
    );
    const ranges = buildSubgameRanges(snapshot, ctx)!;
    expect(ranges.villain.assumption.origin).toBe('chart+line-rule');
    expect(ranges.villain.assumption.note).toContain('flop');
    // コール側（hero）には絞り込みが掛からない
    expect(ranges.hero.assumption.origin).toBe('chart');

    // flop board(Qh7d2c) と絡まない air（例 66 系）は Q ヒットより軽くなっている
    const weightOf = (hc: string): number => {
      const found = ranges.villain.combos.filter((c) => cardsToHandClass(c.cards[0], c.cards[1]) === hc);
      return found.length > 0 ? Math.max(...found.map((c) => c.weight)) : 0;
    };
    const airWeight = weightOf('A5s') || weightOf('JTs');
    const hitWeight = weightOf('AQs') || weightOf('KQs');
    if (airWeight > 0 && hitWeight > 0) {
      expect(airWeight).toBeLessThan(hitWeight);
    }
  });

  it('リンプポットは rare=true（confidence 降格へ伝播）', () => {
    const snapshot = snapshotWith(
      [
        entry({ street: 'preflop', playerId: 5, action: 'call', amount: 1, potAfter: 2.5 }),
        entry({ street: 'preflop', playerId: 0, action: 'check', potAfter: 2.5 }),
        entry({ street: 'river', playerId: 5, action: 'bet', amount: 5, potAfter: 7.5 }),
      ],
      board,
    );
    const ranges = buildSubgameRanges(snapshot, ctx)!;
    expect(ranges.rare).toBe(true);
  });

  it('マルチウェイは対象外（null）', () => {
    const snapshot = snapshotWith([...preflop], board);
    snapshot.context.villainIds = [4, 5];
    expect(buildSubgameRanges(snapshot, ctx)).toBeNull();
  });
});

describe('buildSubgameRanges: ソルバー系列の優先（Phase B）', () => {
  const heroOpenPreflop: HandLogEntry[] = [
    entry({ street: 'preflop', playerId: 0, action: 'raise', amount: 2.5, potAfter: 4 }),
    entry({ street: 'preflop', playerId: 5, action: 'call', amount: 2.5, potAfter: 6.5 }),
  ];

  it('ヒーローがRFIオープン本人でソルバー系列に該当データがあれば assumption に反映される', () => {
    const snapshot = snapshotWith(
      [
        ...heroOpenPreflop,
        entry({ street: 'flop', playerId: 5, action: 'check' }),
        entry({ street: 'flop', playerId: 0, action: 'check' }),
        entry({ street: 'turn', playerId: 5, action: 'check' }),
        entry({ street: 'turn', playerId: 0, action: 'check' }),
        entry({ street: 'river', playerId: 5, action: 'bet', amount: 5, potAfter: 11.5 }),
      ],
      board,
    );
    const ranges = buildSubgameRanges(snapshot, ctx)!;
    expect(ranges).not.toBeNull();
    expect(ranges.hero.assumption.label).toContain('ソルバー由来チャート起点');
    expect(ranges.hero.assumption.note).toContain('test-solver-source');
  });
});
