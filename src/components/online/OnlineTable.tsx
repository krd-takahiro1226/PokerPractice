import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { SeatView } from '../versus/SeatView';
import { BoardView } from '../versus/BoardView';
import { PotDisplay } from '../versus/PotDisplay';
import { BetControls } from '../versus/BetControls';
import { ActionTimer } from './ActionTimer';
import { ReactionBar } from './ReactionBar';
import { useDisplayPrefs } from '../../store/displayPrefs';
import { formatAmount } from '../../lib/chips';
import type { PublicGameState, PublicPlayer } from '../../core/online/types';
import type { LegalActions } from '../../core/game/engine';
import type { PlayerAction, PlayerState } from '../../core/game/types';
import type { Card } from '../../core/cards';
import type { RoomPhase, ReactionEvent } from '../../store/online';

type OnlineTableProps = {
  publicState: PublicGameState;
  myHole: [Card, Card] | null;
  mySeatIndex: number | null;
  isMyTurn: boolean;
  legal: LegalActions | null;
  deadlineMs: number | null;
  onAction: (move: PlayerAction) => void;
  onSendReaction: (emoji: string) => void;
  reactions: ReactionEvent[];
  onExpireReaction: (id: string) => void;
  phase: RoomPhase | null;
  winnerUids: string[];
};

// Builds the PlayerState SeatView expects from a PublicPlayer, merging in the hero's own hole
// cards (never present in publicState — those arrive separately via room_hole_cards, §7 of
// docs/ONLINE-VERSUS.md) and forcing isHero explicitly rather than trusting the server's
// blanket isHero=false (§3.3) for every seat.
function toSeatPlayer(p: PublicPlayer, isMe: boolean, myHole: [Card, Card] | null): PlayerState {
  return {
    id: p.id,
    isHero: isMe,
    pos: p.pos,
    stack: p.stack,
    hole: isMe ? myHole : p.hole,
    committedTotal: p.committedTotal,
    committedStreet: p.committedStreet,
    status: p.status,
    hasActedThisStreet: p.hasActedThisStreet,
  };
}

export function OnlineTable({
  publicState,
  myHole,
  mySeatIndex,
  isMyTurn,
  legal,
  deadlineMs,
  onAction,
  onSendReaction,
  reactions,
  onExpireReaction,
  phase,
  winnerUids,
}: OnlineTableProps) {
  const { players, board, toAct, buttonSeat, pot, result, handNumber } = publicState;
  const n = players.length;
  const streetCommits = players.reduce((s, p) => s + p.committedStreet, 0);
  const potForSizing = pot + streetCommits;
  const showdownReveal = result != null;
  const chipDisplay = useDisplayPrefs((s) => s.chipDisplay);

  // Retrigger the winner-highlight animation whenever a new hand result lands, so a second
  // consecutive win by the same seat still re-pulses instead of looking like a no-op.
  const [celebrateKey, setCelebrateKey] = useState(0);
  useEffect(() => {
    if (phase === 'hand_over' && result) setCelebrateKey((k) => k + 1);
  }, [phase, result, handNumber]);

  return (
    <div className="space-y-4">
      <div className="relative mx-auto aspect-[4/3] w-full max-w-2xl sm:aspect-[2/1]">
        {/* Felt (visual copy of PokerTable.tsx — that component stays 6-max-only) */}
        <div className="absolute inset-[10%] rounded-[50%] border border-accent/20 bg-gradient-to-b from-emerald-900/40 to-emerald-950/60 shadow-[inset_0_0_60px_rgba(0,0,0,0.6)]" />

        {/* Center: pot + board */}
        <div className="absolute inset-0 flex scale-[0.8] flex-col items-center justify-center gap-2 sm:scale-100">
          <BoardView board={board} />
          <PotDisplay pot={pot} streetCommits={streetCommits} />
        </div>

        {/* Seats: ellipse layout, hero pinned to bottom-center, others clockwise from there */}
        {players.map((p, i) => {
          const relIdx = mySeatIndex != null ? (i - mySeatIndex + n) % n : i;
          const angleDeg = 90 + relIdx * (360 / n);
          const angleRad = (angleDeg * Math.PI) / 180;
          const left = 50 + 42 * Math.cos(angleRad);
          const top = 50 + 38 * Math.sin(angleRad);
          const isMe = i === mySeatIndex;
          const isBtn = i === buttonSeat;
          const isWinner = winnerUids.includes(p.uid);
          const shownEntry = result?.shown.find((s) => s.playerId === i);
          const winEntry = result?.winners.find((w) => w.playerId === i);

          return (
            <div
              key={p.uid}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${left}%`, top: `${top}%` }}
            >
              <motion.div
                className="relative"
                animate={
                  isWinner
                    ? {
                        scale: [1, 1.08, 1],
                        boxShadow: [
                          '0 0 0px rgba(250,204,21,0)',
                          '0 0 24px rgba(250,204,21,0.8)',
                          '0 0 0px rgba(250,204,21,0)',
                        ],
                      }
                    : { scale: 1 }
                }
                transition={isWinner ? { duration: 1.2, repeat: Infinity, repeatDelay: 0.3 } : undefined}
              >
                <SeatView
                  player={toSeatPlayer(p, isMe, myHole)}
                  isToAct={toAct === i}
                  showCards={showdownReveal}
                  displayName={p.displayName}
                  className="min-w-[56px] sm:min-w-[80px]"
                />
                {isBtn && (
                  <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-amber-400 text-[9px] font-black text-black shadow">
                    D
                  </span>
                )}
                {isWinner && shownEntry && (
                  <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-amber-400/90 px-2 py-0.5 text-[9px] font-bold text-black shadow">
                    {shownEntry.handName}
                  </div>
                )}
                <AnimatePresence>
                  {isWinner && winEntry && (
                    <motion.div
                      key={`win-${celebrateKey}`}
                      initial={{ opacity: 0, y: 0 }}
                      animate={{ opacity: 1, y: -24 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 1.2 }}
                      className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs font-bold text-amber-300"
                    >
                      +{formatAmount(winEntry.amount, chipDisplay)}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            </div>
          );
        })}

        <ReactionBar onSend={onSendReaction} reactions={reactions} onExpire={onExpireReaction} />
      </div>

      {/* Bottom control area */}
      <div>
        {isMyTurn && legal ? (
          <div className="flex flex-col gap-2">
            <ActionTimer deadlineMs={deadlineMs} className="mx-auto max-w-xs" />
            <BetControls legal={legal} potForSizing={potForSizing} onAction={onAction} />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-center">
            <p className="text-sm text-muted">
              {toAct != null ? `${players[toAct]?.displayName ?? '相手'}の番です…` : ''}
            </p>
            <ActionTimer deadlineMs={deadlineMs} className="max-w-xs" />
          </div>
        )}
      </div>
    </div>
  );
}
