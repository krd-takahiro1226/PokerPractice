import { useMemo, useState } from 'react';
import { ArrowLeft, Info, RefreshCw } from 'lucide-react';
import { PageHeader } from '../../PageHeader';
import { Panel } from '../../Panel';
import { PlayingCard } from '../../PlayingCard';
import { Button } from '../../Button';
import { useHistory } from '../../../store/history';
import { useCustomRanges } from '../../../store/customRanges';
import { useDisplayPrefs } from '../../../store/displayPrefs';
import { formatAmount } from '../../../lib/chips';
import { cn } from '../../../lib/cn';
import { reviewHand, type DecisionVerdict } from '../../../core/review/reviewHand';
import { useHandAnalysis } from '../../../hooks/useHandAnalysis';
import { verdictOfAdvice, sourceChipLabel, summarizeAnalysis } from './logic';
import { DecisionAdviceDetail } from './DecisionAdviceDetail';
import { AnalysisSummaryCard } from './AnalysisSummaryCard';
import type { AnalyzedDecision, StrategyAdvice } from '../../../core/solver';
import type { SavedHand } from '../../../store/history';

const VERDICT_STYLE: Record<DecisionVerdict, { bg: string; text: string; label: string }> = {
  good: { bg: 'border-emerald-500/40 bg-emerald-500/10', text: 'text-emerald-400', label: 'Good' },
  ok: { bg: 'border-cyan-500/40 bg-cyan-500/10', text: 'text-cyan-400', label: 'OK' },
  mistake: { bg: 'border-rose-500/40 bg-rose-500/10', text: 'text-rose-400', label: 'Mistake' },
  info: { bg: 'border-border/40 bg-surface-2/50', text: 'text-muted', label: 'Info' },
};

const ACTION_LABEL: Record<string, string> = {
  fold: 'Fold',
  check: 'Check',
  call: 'Call',
  bet: 'Bet',
  raise: 'Raise',
  allin: 'All-in',
};

const STREET_LABEL: Record<string, string> = {
  preflop: 'プリフロップ',
  flop: 'フロップ',
  turn: 'ターン',
  river: 'リバー',
  showdown: 'ショーダウン',
};

const STREET_ORDER = ['preflop', 'flop', 'turn', 'river', 'showdown'] as const;

export function HandReviewPage({ id, onBack }: { id: string; onBack: () => void }) {
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

export function HandReviewPanel({ hand, onBack }: { hand: SavedHand; onBack: () => void }) {
  const custom = useCustomRanges((s) => s.ranges);
  const reviews = useMemo(() => reviewHand(hand, custom), [hand, custom]);
  const chipDisplay = useDisplayPrefs((s) => s.chipDisplay);
  const [withTurn, setWithTurn] = useState(false);
  const analysis = useHandAnalysis(hand, custom, { solveTurn: withTurn });
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  // legacy 表示中の turn 判断（GTO解析へオプトインする余地がある）が1つでもあるか
  const hasUnsolvedTurn = useMemo(
    () =>
      !!analysis.decisions &&
      analysis.decisions.some(
        ({ snapshot, advice }) =>
          snapshot.street === 'turn' && !snapshot.context.isMultiway && advice.source === 'legacy',
      ),
    [analysis.decisions],
  );

  // worker 完了(done/cached)時のみ decisions が入る。それまでは同期パス(review)のみで表示する
  const decisionByLogIndex = useMemo(() => {
    const map = new Map<number, AnalyzedDecision>();
    if (analysis.decisions) {
      for (const d of analysis.decisions) map.set(d.snapshot.logIndex, d);
    }
    return map;
  }, [analysis.decisions]);

  const summary = useMemo(
    () => (analysis.decisions ? summarizeAnalysis(analysis.decisions) : null),
    [analysis.decisions],
  );

  const toggle = (logIndex: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(logIndex)) next.delete(logIndex);
      else next.add(logIndex);
      return next;
    });
  };

  const logsByStreet = STREET_ORDER.reduce(
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

      {/* 解析種別の説明バナー */}
      <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
        <Info size={16} className="mt-0.5 shrink-0 text-amber-400" />
        <p className="text-xs text-amber-300">
          判断ごとのバッジが解析の種別を示します。「GTO解」= レンジ仮定付きのソルバー厳密解、「GTOレンジ」=
          ソルバー出力由来チャート、「レンジ表」= 手動チャート、「参考」= GTO解析非対応スポットの近似です。
          エクイティ表示はモンテカルロ法による近似値です。
        </p>
      </div>

      {/* 非同期解析の状態表示 */}
      {analysis.status === 'loading' && (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-2/40 px-4 py-2 text-xs text-muted">
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
          GTO解析中… {Math.round(analysis.progress * 100)}%
        </div>
      )}
      {analysis.status === 'failed' && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs text-rose-300">
          <span>解析に失敗しました{analysis.error ? `（${analysis.error}）` : ''}</span>
          <Button size="sm" variant="ghost" onClick={analysis.retry}>
            <RefreshCw size={12} />
            再試行
          </Button>
        </div>
      )}
      {summary && (analysis.status === 'done' || analysis.status === 'cached') && (
        <AnalysisSummaryCard summary={summary} />
      )}
      {(analysis.status === 'done' || analysis.status === 'cached') &&
        !analysis.turnSolved &&
        hasUnsolvedTurn && (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-surface-2/40 px-4 py-2 text-xs text-muted">
            <span>turn の判断は現在「参考」表示です。</span>
            <Button size="sm" variant="ghost" onClick={() => setWithTurn(true)}>
              turn 判断も GTO 解析する（重い処理・端末により数十秒）
            </Button>
          </div>
        )}

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
              {hand.heroNet > 0 ? '+' : ''}
              {formatAmount(hand.heroNet, chipDisplay)}
            </div>
          </div>
        </div>
      </Panel>

      {/* Street replay */}
      <div className="flex flex-col gap-3">
        {STREET_ORDER.map((street) => {
          const logs = logsByStreet[street] ?? [];
          if (logs.length === 0) return null;
          return (
            <Panel key={street} className="p-4">
              <div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">
                {STREET_LABEL[street]}
                {street === 'flop' && hand.board.length >= 3 && (
                  <span className="ml-2 font-normal text-text">{hand.board.slice(0, 3).join(' ')}</span>
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
                  const analyzed = decisionByLogIndex.get(logIdx);
                  // worker 結果があればそれを優先。無ければ同期 reviewHand が添付した advice を使う
                  const advice: StrategyAdvice | undefined = analyzed?.advice ?? review?.advice;
                  const verdict = advice ? verdictOfAdvice(advice) : undefined;
                  const canExpand = !!advice && advice.source !== 'legacy' && advice.candidates.length > 0;
                  const isExpanded = expanded.has(logIdx);

                  const rowClassName = cn(
                    'rounded-lg px-3 py-2 text-sm',
                    isHero ? 'bg-accent/5 border border-accent/20' : 'bg-surface-2/40',
                  );

                  const header = (
                    <div className="flex items-center gap-2">
                      <span className={cn('font-semibold', isHero ? 'text-accent-bright' : 'text-text')}>
                        {isHero ? 'YOU' : log.pos}
                      </span>
                      <span className="text-muted">
                        {ACTION_LABEL[log.action]}
                        {log.amount && ` ${log.amount.toFixed(1)}bb`}
                      </span>
                      {isHero && advice && (
                        <span className="rounded border border-border/40 bg-surface-2/60 px-1 text-[9px] uppercase text-muted">
                          {sourceChipLabel(advice)}
                        </span>
                      )}
                      {isHero && verdict && (
                        <span
                          className={cn(
                            'ml-auto rounded px-1.5 py-0.5 text-[10px] font-bold uppercase',
                            VERDICT_STYLE[verdict].bg,
                            VERDICT_STYLE[verdict].text,
                          )}
                        >
                          {VERDICT_STYLE[verdict].label}
                        </span>
                      )}
                    </div>
                  );

                  return (
                    <div key={i} id={isHero ? `review-decision-${logIdx}` : undefined} className={rowClassName}>
                      {/* 詳細内の <details> 等へのクリックが行の開閉に化けないよう、トグルはヘッダー行のみ */}
                      {isHero && canExpand ? (
                        <button onClick={() => toggle(logIdx)} className="block w-full text-left">
                          {header}
                        </button>
                      ) : (
                        header
                      )}

                      {/* GTO 解析詳細（展開時） */}
                      {isHero && canExpand && isExpanded && advice && <DecisionAdviceDetail advice={advice} />}

                      {/* legacy スポット、または GTO 展開時の補足として既存レビュー文言を表示 */}
                      {isHero && review && (!canExpand || isExpanded) && (
                        <div className={cn('mt-1.5 rounded border px-2 py-1.5', VERDICT_STYLE[review.verdict]?.bg)}>
                          {!canExpand && (
                            <div className={cn('text-xs font-semibold', VERDICT_STYLE[review.verdict]?.text)}>
                              {review.headline}
                            </div>
                          )}
                          <div className={cn('text-muted', canExpand ? 'mt-1 text-[10px]' : 'mt-0.5 text-xs')}>
                            {review.detail}
                          </div>
                          {review.metrics && (
                            <div className="mt-1 flex flex-wrap gap-3 text-[10px] text-muted">
                              {review.metrics.heroEquity !== undefined && (
                                <span>
                                  Equity:{' '}
                                  <strong className="text-text">{(review.metrics.heroEquity * 100).toFixed(0)}%</strong>
                                </span>
                              )}
                              {review.metrics.potOdds !== undefined && (
                                <span>
                                  必要勝率:{' '}
                                  <strong className="text-text">{(review.metrics.potOdds * 100).toFixed(0)}%</strong>
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
