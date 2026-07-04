import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { SeatView } from '../versus/SeatView';
import { BoardView } from '../versus/BoardView';
import { PotDisplay } from '../versus/PotDisplay';
import { BetControls } from '../versus/BetControls';
import { HandRankInfo } from '../versus/HandRankInfo';
import { CollapsibleHandRankings } from '../HandRankings';
import { ActionTimer } from './ActionTimer';
import { ReactionBar } from './ReactionBar';
import { ChipDisplayToggle } from '../ChipDisplayToggle';
import { useDisplayPrefs } from '../../store/displayPrefs';
import { formatAmount } from '../../lib/chips';
import type { ChipDisplay } from '../../lib/chips';
import { seatActionBadges, actionBadgeLabel } from '../../lib/onlineBadges';
import { OnlineClientError } from '../../lib/onlineClient';
import { OnlineTablePanels } from './OnlineTablePanels';
import type { PublicGameState, PublicPlayer } from '../../core/online/types';
import type { LegalActions } from '../../core/game/engine';
import type { HandResult, PlayerAction, PlayerState } from '../../core/game/types';
import type { Card } from '../../core/cards';
import type { RoomPhase, ReactionEvent, HandHistoryEntry } from '../../store/online';
import type { TournamentState } from '../../core/online/tournament';

// アクション送信失敗(stale/illegal_action/not_your_turn等)が無言で握りつぶされないよう、
// 押した本人向けの簡易メッセージにマップする(ON-4)。
function mapActionError(e: unknown): string {
  if (e instanceof OnlineClientError) {
    switch (e.code) {
      case 'not_your_turn':
        return '手番が変わりました';
      case 'illegal_action':
        return '選択できない操作です';
      case 'stale':
        return '状況が更新されました。もう一度お試しください';
      case 'not_in_hand':
        return 'このハンドはすでに終了しています';
      default:
        return '操作に失敗しました。もう一度お試しください';
    }
  }
  return '操作に失敗しました。もう一度お試しください';
}

type OnlineTableProps = {
  publicState: PublicGameState;
  myHole: [Card, Card] | null;
  mySeatIndex: number | null;
  isMyTurn: boolean;
  legal: LegalActions | null;
  deadlineMs: number | null;
  onAction: (move: PlayerAction) => void | Promise<void>;
  onSendReaction: (emoji: string) => void;
  reactions: ReactionEvent[];
  onExpireReaction: (id: string) => void;
  phase: RoomPhase | null;
  winnerUids: string[];
  onLeave: () => Promise<void>;
  tournament: TournamentState | null;
  handHistory: HandHistoryEntry[];
  myUid: string | null;
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

// Seat-anchored reaction float (adapted from ReactionBar's FloatingReaction) — emoji only, no
// displayName needed since it's already anchored to the sender's seat.
const SEAT_REACTION_FLOAT_MS = 1500;

function SeatReactionFloat({ reaction, onExpire }: { reaction: ReactionEvent; onExpire: (id: string) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onExpire(reaction.id), SEAT_REACTION_FLOAT_MS);
    return () => clearTimeout(timer);
  }, [reaction.id, onExpire]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 0, scale: 0.6 }}
      animate={{ opacity: 1, y: -28, scale: 1.2 }}
      exit={{ opacity: 0 }}
      transition={{ duration: SEAT_REACTION_FLOAT_MS / 1000, ease: 'easeOut' }}
      className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 text-xl"
    >
      {reaction.emoji}
    </motion.div>
  );
}

// フォールド勝ち(result.shown が空)/ショーダウン、単独勝者/スプリットの組み合わせを
// 1行のバナー文言に整形する。表示専用の派生ロジックなのでコンポーネント内に留める。
function resultBannerText(result: HandResult, players: PublicPlayer[], chipDisplay: ChipDisplay): string {
  const isFoldWin = result.shown.length === 0;
  const winners = result.winners;

  if (winners.length === 1) {
    const w = winners[0];
    const name = players[w.playerId]?.displayName ?? '?';
    const amountStr = formatAmount(w.amount, chipDisplay);
    if (isFoldWin) return `${name} の勝ち +${amountStr}（全員フォールド）`;
    const handName = result.shown.find((s) => s.playerId === w.playerId)?.handName;
    return `${name} の勝ち +${amountStr}${handName ? `（${handName}）` : ''}`;
  }

  const handNames = winners.map((w) => result.shown.find((s) => s.playerId === w.playerId)?.handName ?? null);
  const commonHandName = !isFoldWin && handNames.every((h) => h === handNames[0]) ? handNames[0] : null;

  const parts = winners.map((w, i) => {
    const name = players[w.playerId]?.displayName ?? '?';
    const amountStr = formatAmount(w.amount, chipDisplay);
    const individualHandName = !commonHandName && handNames[i] ? `（${handNames[i]}）` : '';
    return `${name} +${amountStr}${individualHandName}`;
  });

  const suffix = commonHandName ? `の勝ち（${commonHandName}）` : 'の勝ち';
  return `${parts.join(' / ')} ${suffix}`;
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
  onLeave,
  tournament,
  handHistory,
  myUid,
}: OnlineTableProps) {
  const { players, board, toAct, buttonSeat, pot, result, handNumber } = publicState;
  const n = players.length;
  const actionBadges = seatActionBadges(publicState);
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

  // Reactions from players seated in the current hand are anchored to their seat; reactions from
  // a uid not in `players` (busted/spectating this hand) can't be placed on a seat, so those still
  // go through the floating strip (with a displayName label for attribution).
  const seatUids = new Set(players.map((p) => p.uid));
  const unanchoredReactions = reactions.filter((r) => !seatUids.has(r.uid));

  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [leaveBusy, setLeaveBusy] = useState(false);

  // onAction(act)の失敗が無言で握りつぶされないよう、ここで catch してインライン表示する(ON-4)。
  const [actionError, setActionError] = useState<string | null>(null);
  useEffect(() => {
    if (!actionError) return;
    const timer = setTimeout(() => setActionError(null), 4_000);
    return () => clearTimeout(timer);
  }, [actionError]);
  // 自分の手番でなくなったら(相手が先に操作した等)古いエラーは表示し続けない。
  useEffect(() => {
    if (!isMyTurn) setActionError(null);
  }, [isMyTurn]);

  const handleAction = async (move: PlayerAction) => {
    setActionError(null);
    try {
      await onAction(move);
    } catch (e) {
      setActionError(mapActionError(e));
    }
  };

  const handleConfirmLeave = async () => {
    setLeaveBusy(true);
    try {
      await onLeave();
    } finally {
      setLeaveBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <ChipDisplayToggle />
        </div>
        {confirmingLeave ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-1.5 text-xs">
            <span className="text-danger">
              対戦から退出しますか？退出すると復帰できず、その時点の順位で確定します。
            </span>
            <button
              onClick={handleConfirmLeave}
              disabled={leaveBusy}
              className="rounded-md border border-danger/40 bg-danger/20 px-2 py-1 font-semibold text-danger transition hover:bg-danger/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {leaveBusy ? '退出中…' : '退出する'}
            </button>
            <button
              onClick={() => setConfirmingLeave(false)}
              disabled={leaveBusy}
              className="rounded-md border border-border-bright bg-surface-2 px-2 py-1 font-semibold transition hover:bg-surface-2/80 disabled:cursor-not-allowed disabled:opacity-50"
            >
              キャンセル
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmingLeave(true)}
            className="text-xs text-muted transition hover:text-danger"
          >
            退出
          </button>
        )}
      </div>

      {/* 途中参加直後（今のハンドの publicState に自分が居ない）は観戦扱いになる */}
      {mySeatIndex === null && phase === 'in_hand' && (
        <div className="mx-auto w-fit whitespace-nowrap rounded-full bg-surface-2 px-3 py-1 text-center text-xs text-muted">
          参加しました — 次のハンドから配られます（観戦中）
        </div>
      )}

      <div className="relative mx-auto aspect-[4/3] w-full max-w-2xl sm:aspect-[2/1]">
        {/* Felt (visual copy of PokerTable.tsx — that component stays 6-max-only) */}
        <div className="absolute inset-[10%] rounded-[50%] border border-accent/20 bg-gradient-to-b from-emerald-900/40 to-emerald-950/60 shadow-[inset_0_0_60px_rgba(0,0,0,0.6)]" />

        {/* Center: result banner + pot + board */}
        <div className="absolute inset-0 flex scale-[0.8] flex-col items-center justify-center gap-2 sm:scale-100">
          {phase === 'hand_over' && result && (
            <div className="whitespace-nowrap rounded-full bg-amber-400/90 px-3 py-1 text-center text-xs font-bold text-black shadow">
              {resultBannerText(result, players, chipDisplay)}
            </div>
          )}
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
          const actionBadge = actionBadges[i];
          const seatReactions = reactions.filter((r) => r.uid === p.uid);

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
                {actionBadge && (
                  <div className="absolute -left-2 -top-2 whitespace-nowrap rounded-full border border-border-bright bg-surface/90 px-1.5 py-0.5 text-[8px] font-semibold shadow">
                    {actionBadgeLabel(actionBadge, chipDisplay)}
                  </div>
                )}
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
                <AnimatePresence>
                  {seatReactions.map((r) => (
                    <SeatReactionFloat key={r.id} reaction={r} onExpire={onExpireReaction} />
                  ))}
                </AnimatePresence>
              </motion.div>
            </div>
          );
        })}
      </div>

      <ReactionBar onSend={onSendReaction} reactions={unanchoredReactions} onExpire={onExpireReaction} />

      {mySeatIndex != null && myHole && (
        <HandRankInfo hole={myHole} board={board} className="mx-auto" />
      )}
      <CollapsibleHandRankings className="mx-auto w-fit" />

      {/* Bottom control area */}
      <div>
        {isMyTurn && legal ? (
          <div className="flex flex-col gap-2">
            <ActionTimer deadlineMs={deadlineMs} className="mx-auto max-w-xs" />
            {actionError && (
              <p className="mx-auto max-w-xs text-center text-xs text-danger">{actionError}</p>
            )}
            <BetControls legal={legal} potForSizing={potForSizing} onAction={handleAction} />
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

      {tournament && <OnlineTablePanels tournament={tournament} myUid={myUid} handHistory={handHistory} />}
    </div>
  );
}
