import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Info } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { Panel } from '../components/Panel';
import { PlayingCard } from '../components/PlayingCard';
import { PokerTable } from '../components/versus/PokerTable';
import { BetControls } from '../components/versus/BetControls';
import { useVersusGame } from '../hooks/useVersusGame';
import { useHistory } from '../store/history';
import { reviewHand } from '../core/review/reviewHand';
import type { SavedHand } from '../store/history';
import type { DecisionReview } from '../core/review/reviewHand';
import { cn } from '../lib/cn';

type Tab = 'game' | 'history';

// Verdict styling
const VERDICT_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  good:    { bg: 'border-emerald-500/40 bg-emerald-500/10', text: 'text-emerald-400', label: 'Good' },
  ok:      { bg: 'border-cyan-500/40 bg-cyan-500/10',       text: 'text-cyan-400',    label: 'OK' },
  mistake: { bg: 'border-rose-500/40 bg-rose-500/10',       text: 'text-rose-400',    label: 'Mistake' },
  info:    { bg: 'border-border/40 bg-surface-2/50',        text: 'text-muted',       label: 'Info' },
};

// ─── Main Page ─────────────────────────────────────────────────────────────────

export function Versus() {
  const [tab, setTab] = useState<Tab>('game');
  const params = useParams();
  const navigate = useNavigate();

  // If we have a history id in the URL, show review
  const reviewId = params.id;
  if (reviewId) {
    return <HandReviewPage id={reviewId} onBack={() => navigate('/versus/history')} />;
  }

  return (
    <div>
      <PageHeader
        title="対戦 (vs CPU)"
        description="6-max 100bb。CPU5人と対戦してハンドを体で覚える。"
      />

      {/* Tabs */}
      <div className="mb-5 inline-flex rounded-xl border border-border bg-surface-2/50 p-1">
        {(['game', 'history'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'rounded-lg px-4 py-1.5 text-sm font-medium transition',
              tab === t ? 'bg-accent text-[#04221a]' : 'text-muted hover:text-text',
            )}
          >
            {t === 'game' ? '対戦' : '履歴'}
          </button>
        ))}
      </div>

      {tab === 'game' ? <GameTab /> : <HistoryTab />}
    </div>
  );
}

// ─── Game Tab ──────────────────────────────────────────────────────────────────

function GameTab() {
  const { state, legal, isHeroTurn, heroAct, newHand, difficulty, setDifficulty } =
    useVersusGame();

  const hero = state.players[0];
  const isHandOver = state.street === 'showdown' && state.result !== null;

  const totalPot =
    state.pot + state.players.reduce((s, p) => s + p.committedStreet, 0);

  const streetLabel: Record<string, string> = {
    preflop: 'プリフロップ',
    flop: 'フロップ',
    turn: 'ターン',
    river: 'リバー',
    showdown: 'ショーダウン',
  };

  const DIFFICULTY_LABEL = {
    easy: 'やさしい',
    normal: 'ふつう',
    hard: 'つよい',
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Difficulty selector */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted">難易度:</span>
        {(['easy', 'normal', 'hard'] as const).map((d) => (
          <button
            key={d}
            onClick={() => setDifficulty(d)}
            className={cn(
              'rounded-lg px-3 py-1 text-xs font-medium transition',
              difficulty === d
                ? 'bg-accent text-[#04221a]'
                : 'border border-border text-muted hover:text-text',
            )}
          >
            {DIFFICULTY_LABEL[d]}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-muted">
          ハンド #{state.handNumber}　{streetLabel[state.street]}
        </span>
      </div>

      {/* Poker table */}
      <Panel className="overflow-visible p-4">
        <PokerTable state={state} />
      </Panel>

      {/* Hand result */}
      {isHandOver && state.result && (
        <Panel className="border-accent/30 bg-accent/5 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-accent-bright">ハンド終了</div>
              <div className="mt-1 text-xs text-muted">
                {state.result.endedAtStreet !== 'showdown'
                  ? 'フォールド勝ち'
                  : 'ショーダウン'}
              </div>
              {state.result.winners.map((w) => {
                const p = state.players[w.playerId];
                return (
                  <div key={w.playerId} className="mt-1 text-sm">
                    <span className={p.isHero ? 'font-bold text-accent-bright' : 'text-text'}>
                      {p.isHero ? 'あなた' : p.pos}
                    </span>
                    <span className="text-muted"> が {w.amount.toFixed(1)}bb 獲得</span>
                  </div>
                );
              })}
              {state.result.shown.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {state.result.shown.map((s) => {
                    const p = state.players[s.playerId];
                    return (
                      <div key={s.playerId} className="flex items-center gap-1.5">
                        <span className="text-xs text-muted">{p.isHero ? 'YOU' : p.pos}:</span>
                        <PlayingCard card={s.hole[0]} size="sm" />
                        <PlayingCard card={s.hole[1]} size="sm" />
                        <span className="text-xs text-muted">{s.handName}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <Button size="sm" onClick={newHand}>
              <RefreshCw size={14} />
              次のハンド
            </Button>
          </div>
        </Panel>
      )}

      {/* Hero action controls */}
      {isHeroTurn && legal && (
        <Panel className="p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted">
            あなたの番
          </div>
          <BetControls
            legal={legal}
            potForSizing={totalPot}
            onAction={heroAct}
          />
        </Panel>
      )}

      {/* CPU thinking indicator */}
      {!isHeroTurn && !isHandOver && (
        <div className="text-center text-sm text-muted animate-pulse">
          CPU が考え中…
        </div>
      )}
    </div>
  );
}

// ─── History Tab ───────────────────────────────────────────────────────────────

function HistoryTab() {
  const { hands, clear } = useHistory();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (selectedId) {
    const hand = hands.find((h) => h.id === selectedId);
    if (hand) {
      return <HandReviewPanel hand={hand} onBack={() => setSelectedId(null)} />;
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted">{hands.length} ハンド記録済み</div>
        {hands.length > 0 && (
          <Button variant="ghost" size="sm" onClick={clear}>
            履歴をクリア
          </Button>
        )}
      </div>

      {hands.length === 0 ? (
        <Panel className="p-8 text-center text-muted">
          まだ履歴がありません。対戦タブでハンドをプレイしてください。
        </Panel>
      ) : (
        <div className="flex flex-col gap-2">
          {hands.map((hand) => (
            <HistoryRow key={hand.id} hand={hand} onClick={() => setSelectedId(hand.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function HistoryRow({ hand, onClick }: { hand: SavedHand; onClick: () => void }) {
  const netPositive = hand.heroNet > 0;
  const netNeutral = hand.heroNet === 0;
  const date = new Date(hand.ts);
  const DIFF_LABEL = { easy: 'やさしい', normal: 'ふつう', hard: 'つよい' };

  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface-2/40 px-4 py-3 text-left transition hover:bg-surface-2"
    >
      {/* Cards */}
      <div className="flex gap-0.5 shrink-0">
        <PlayingCard card={hand.heroHole[0]} size="sm" />
        <PlayingCard card={hand.heroHole[1]} size="sm" />
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold">{hand.heroPos}</span>
          <span className="text-muted">·</span>
          <span className="text-muted text-xs">
            {date.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })}{' '}
            {date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <span className="rounded border border-border px-1 text-[10px] text-muted">
            {DIFF_LABEL[hand.difficulty]}
          </span>
          {hand.board.length > 0 && (
            <span className="text-[10px] text-muted">
              {hand.board.slice(0, 3).join(' ')}
              {hand.board.length > 3 && ` +${hand.board.length - 3}`}
            </span>
          )}
        </div>
      </div>

      {/* Net */}
      <div
        className={cn(
          'font-mono text-sm font-bold tabular-nums',
          netPositive
            ? 'text-emerald-400'
            : netNeutral
              ? 'text-muted'
              : 'text-rose-400',
        )}
      >
        {netPositive ? '+' : ''}{hand.heroNet.toFixed(1)}bb
      </div>
    </button>
  );
}

// ─── Hand Review ────────────────────────────────────────────────────────────────

function HandReviewPage({ id, onBack }: { id: string; onBack: () => void }) {
  const { hands } = useHistory();
  const hand = hands.find((h) => h.id === id);
  if (!hand) {
    return (
      <div className="py-8 text-center text-muted">
        ハンドが見つかりません。
        <button onClick={onBack} className="ml-2 text-accent-bright hover:underline">
          戻る
        </button>
      </div>
    );
  }
  return <HandReviewPanel hand={hand} onBack={onBack} />;
}

function HandReviewPanel({ hand, onBack }: { hand: SavedHand; onBack: () => void }) {
  const reviews = reviewHand(hand);

  const streetOrder = ['preflop', 'flop', 'turn', 'river', 'showdown'] as const;
  const logsByStreet = streetOrder.reduce(
    (acc, s) => {
      acc[s] = hand.log.filter((l) => l.street === s);
      return acc;
    },
    {} as Record<string, typeof hand.log>,
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="ハンドレビュー" />

      {/* Back button */}
      <button
        onClick={onBack}
        className="flex w-fit items-center gap-1.5 text-sm text-muted hover:text-text"
      >
        <ArrowLeft size={14} />
        履歴一覧に戻る
      </button>

      {/* Approximation banner */}
      <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
        <Info size={16} className="mt-0.5 shrink-0 text-amber-400" />
        <p className="text-xs text-amber-300">
          これはソルバーではなく一般傾向に基づく近似の目安です。エクイティ計算はモンテカルロ法（2000反復）による近似値であり、最適な戦略を保証するものではありません。
        </p>
      </div>

      {/* Hero cards + board */}
      <Panel className="p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-widest text-muted">あなたのハンド</div>
            <div className="flex gap-1">
              <PlayingCard card={hand.heroHole[0]} size="sm" />
              <PlayingCard card={hand.heroHole[1]} size="sm" />
            </div>
          </div>
          {hand.board.length > 0 && (
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-widest text-muted">ボード</div>
              <div className="flex gap-1">
                {hand.board.map((c, i) => (
                  <PlayingCard key={i} card={c} size="sm" />
                ))}
              </div>
            </div>
          )}
          <div className="ml-auto text-right">
            <div className="text-[10px] uppercase tracking-widest text-muted">収支</div>
            <div
              className={cn(
                'font-mono text-lg font-bold tabular-nums',
                hand.heroNet > 0 ? 'text-emerald-400' : hand.heroNet < 0 ? 'text-rose-400' : 'text-muted',
              )}
            >
              {hand.heroNet > 0 ? '+' : ''}{hand.heroNet.toFixed(1)}bb
            </div>
          </div>
        </div>
      </Panel>

      {/* Street replay */}
      <div className="flex flex-col gap-3">
        {streetOrder.map((street) => {
          const logs = logsByStreet[street] ?? [];
          if (logs.length === 0) return null;
          const STREET_LABEL: Record<string, string> = {
            preflop: 'プリフロップ',
            flop: 'フロップ',
            turn: 'ターン',
            river: 'リバー',
            showdown: 'ショーダウン',
          };
          return (
            <Panel key={street} className="p-4">
              <div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">
                {STREET_LABEL[street]}
                {street === 'flop' && hand.board.length >= 3 && (
                  <span className="ml-2 font-normal text-text">
                    {hand.board.slice(0, 3).join(' ')}
                  </span>
                )}
                {street === 'turn' && hand.board.length >= 4 && (
                  <span className="ml-2 font-normal text-text">{hand.board[3]}</span>
                )}
                {street === 'river' && hand.board.length >= 5 && (
                  <span className="ml-2 font-normal text-text">{hand.board[4]}</span>
                )}
              </div>
              <div className="flex flex-col gap-2">
                {logs.map((log, i) => {
                  const isHero = log.playerId === 0;
                  const logIdx = hand.log.indexOf(log);
                  const review = reviews.find((r) => r.logIndex === logIdx);
                  const ACTION_LABEL: Record<string, string> = {
                    fold: 'Fold',
                    check: 'Check',
                    call: 'Call',
                    bet: 'Bet',
                    raise: 'Raise',
                    allin: 'All-in',
                  };

                  return (
                    <div
                      key={i}
                      className={cn(
                        'rounded-lg px-3 py-2 text-sm',
                        isHero ? 'bg-accent/5 border border-accent/20' : 'bg-surface-2/40',
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className={cn('font-semibold', isHero ? 'text-accent-bright' : 'text-text')}>
                          {isHero ? 'YOU' : log.pos}
                        </span>
                        <span className="text-muted">
                          {ACTION_LABEL[log.action]}
                          {log.amount && ` ${log.amount.toFixed(1)}bb`}
                        </span>
                        {review && (
                          <span
                            className={cn(
                              'ml-auto rounded px-1.5 py-0.5 text-[10px] font-bold uppercase',
                              VERDICT_STYLE[review.verdict]?.bg,
                              VERDICT_STYLE[review.verdict]?.text,
                            )}
                          >
                            {VERDICT_STYLE[review.verdict]?.label}
                          </span>
                        )}
                      </div>

                      {/* Review detail */}
                      {review && (
                        <div
                          className={cn(
                            'mt-1.5 rounded border px-2 py-1.5',
                            VERDICT_STYLE[review.verdict]?.bg,
                          )}
                        >
                          <div className={cn('text-xs font-semibold', VERDICT_STYLE[review.verdict]?.text)}>
                            {review.headline}
                          </div>
                          <div className="mt-0.5 text-xs text-muted">{review.detail}</div>
                          {review.metrics && (
                            <div className="mt-1 flex flex-wrap gap-3 text-[10px] text-muted">
                              {review.metrics.heroEquity !== undefined && (
                                <span>
                                  Equity: <strong className="text-text">{(review.metrics.heroEquity * 100).toFixed(0)}%</strong>
                                </span>
                              )}
                              {review.metrics.potOdds !== undefined && (
                                <span>
                                  必要勝率: <strong className="text-text">{(review.metrics.potOdds * 100).toFixed(0)}%</strong>
                                </span>
                              )}
                              {review.metrics.mdf !== undefined && (
                                <span>
                                  MDF: <strong className="text-text">{(review.metrics.mdf * 100).toFixed(0)}%</strong>
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
