import type { Card } from '../cards';
import type { Position } from '../ranges/types';
import type { GameMode } from '../ranges/mode';

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

export type PlayerActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';

export type PlayerAction = {
  type: PlayerActionType;
  /** そのストリートでのプレイヤーの total commit 目標額。
   *  engine側で「目標額 - 既拠出 = 追加支払い」に変換する。call/check/fold は amount 不要。 */
  amount?: number;
};

export type PlayerState = {
  id: number;                 // 0..n-1（既定n=6）。ローカル対戦では0 = ヒーロー
  isHero: boolean;
  pos: Position;
  stack: number;              // 残りスタック(bb)
  hole: [Card, Card] | null;
  committedTotal: number;     // ハンド全体での累計拠出(bb)
  committedStreet: number;    // 現ストリートでの拠出(bb)
  status: 'active' | 'folded' | 'allin';
  hasActedThisStreet: boolean;
};

export type GameConfig = {
  difficulty: 'easy' | 'normal' | 'hard';
  mode: GameMode;             // RFI/AI/レビューが参照
  startingStack: number;      // 既定 100
  sb: number;                 // 0.5
  bb: number;                 // 1
  /** BB ante 合計(bb)。0 = アンティなし。アンティありモードは bb と同額(=1)。 */
  ante: number;
  /** 乱数注入（テスト用）。省略時 Math.random */
  rng?: () => number;
};

export type GameState = {
  config: GameConfig;
  handNumber: number;
  buttonSeat: number;         // BTNのplayer.id
  players: PlayerState[];     // 長さ2..6（既定6。online tournament は着席人数に応じて可変）
  board: Card[];              // 0,3,4,5枚
  deck: Card[];               // 未配のデッキ（残り）
  street: Street;
  pot: number;                // 確定済みポット（前ストリートまでの拠出合計）
  currentBet: number;         // 現ストリートで「コールに必要な total commit 目標額」
  minRaise: number;           // 次のレイズの最小増分(bb)
  toAct: number | null;       // 次にアクションするplayer.id。null=ストリート終了
  lastAggressor: number | null;
  log: HandLogEntry[];
  result: HandResult | null;
};

export type HandLogEntry = {
  street: Street;
  playerId: number;
  pos: Position;
  action: PlayerActionType;
  amount?: number;            // total commit 目標額（bet/raise/call時）
  potAfter: number;
};

export type HandResult = {
  winners: { playerId: number; amount: number }[];
  shown: { playerId: number; hole: [Card, Card]; handName: string }[];
  board: Card[];
  endedAtStreet: Street;
};
