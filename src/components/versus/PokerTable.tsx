import { cn } from '../../lib/cn';
import { SeatView } from './SeatView';
import { BoardView } from './BoardView';
import { PotDisplay } from './PotDisplay';
import type { GameState } from '../../core/game/types';
import type { Position } from '../../core/ranges/types';
import type { Pot } from '../../core/game/pots';

// Seat positions on the table (CSS percentages)
const SEAT_POS: Record<Position, { top: string; left: string }> = {
  UTG: { top: '10%', left: '32%' },
  HJ:  { top: '10%', left: '68%' },
  CO:  { top: '50%', left: '92%' },
  BTN: { top: '85%', left: '75%' },
  SB:  { top: '85%', left: '25%' },
  BB:  { top: '50%', left: '8%' },
};

type PokerTableProps = {
  state: GameState;
  className?: string;
  displayBoardCount?: number;
  pots?: Pot[];
};

export function PokerTable({ state, className, displayBoardCount, pots }: PokerTableProps) {
  const { players, board, toAct, buttonSeat, pot } = state;
  const streetCommits = players.reduce((s, p) => s + p.committedStreet, 0);
  const isShowdown = state.street === 'showdown';
  const shownBoard = board.slice(0, displayBoardCount ?? board.length);
  // showdown 到達後は pot が分配済みで 0 のため、段階リビール中に「Pot 0」と見えないよう
  // 勝者の獲得合計(=分配前ポット)を表示する
  const displayPot = state.result
    ? state.result.winners.reduce((s, w) => s + w.amount, 0)
    : pot;

  return (
    <div className={cn('relative mx-auto aspect-[4/3] w-full max-w-2xl sm:aspect-[2/1]', className)}>
      {/* Felt */}
      <div className="absolute inset-[10%] rounded-[50%] border border-accent/20 bg-gradient-to-b from-emerald-900/40 to-emerald-950/60 shadow-[inset_0_0_60px_rgba(0,0,0,0.6)]" />

      {/* Center: pot + board（モバイルは縮小して左右の座席との衝突を避ける） */}
      <div className="absolute inset-0 flex scale-[0.8] flex-col items-center justify-center gap-2 sm:scale-100">
        <BoardView board={shownBoard} />
        <PotDisplay pot={displayPot} streetCommits={streetCommits} pots={pots} />
      </div>

      {/* Seats */}
      {players.map((player) => {
        const { top, left } = SEAT_POS[player.pos];
        const isToAct = toAct === player.id;
        const isBTN = player.id === buttonSeat;

        return (
          <div
            key={player.id}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ top, left }}
          >
            <div className="relative">
              <SeatView
                player={player}
                isToAct={isToAct}
                showCards={isShowdown}
                className="min-w-[56px] sm:min-w-[80px]"
              />
              {/* Dealer button */}
              {isBTN && (
                <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-amber-400 text-[9px] font-black text-black shadow">
                  D
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
