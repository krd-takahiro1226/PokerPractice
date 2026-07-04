import { useState } from 'react';
import { standings } from '../../core/online/tournament';
import type { TournamentState } from '../../core/online/tournament';
import { useDisplayPrefs } from '../../store/displayPrefs';
import { formatAmount } from '../../lib/chips';
import type { ChipDisplay } from '../../lib/chips';
import { actionBadgeLabel } from '../../lib/onlineBadges';
import { PlayingCard } from '../PlayingCard';
import { MultiLineChart } from '../charts/MultiLineChart';
import { ErrorBoundary } from '../ErrorBoundary';
import { cn } from '../../lib/cn';
import type { HandHistoryEntry } from '../../store/online';
import type { Street } from '../../core/game/types';

type OnlineTablePanelsProps = {
  tournament: TournamentState;
  myUid: string | null;
  handHistory: HandHistoryEntry[];
};

type TabKey = 'structure' | 'standings' | 'chart' | 'history';

const TAB_LABEL: Record<TabKey, string> = {
  structure: 'ストラクチャー',
  standings: '順位',
  chart: 'チップ推移',
  history: '履歴',
};

const STREET_ORDER: Street[] = ['preflop', 'flop', 'turn', 'river'];
const STREET_LABEL: Record<Street, string> = {
  preflop: 'Preflop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
  showdown: 'Showdown',
};

export function OnlineTablePanels({ tournament, myUid, handHistory }: OnlineTablePanelsProps) {
  const [activeTab, setActiveTab] = useState<TabKey | null>(null);
  const chipDisplay = useDisplayPrefs((s) => s.chipDisplay);

  const toggleTab = (tab: TabKey) => {
    setActiveTab((cur) => (cur === tab ? null : tab));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(TAB_LABEL) as TabKey[]).map((tab) => (
          <button
            key={tab}
            onClick={() => toggleTab(tab)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition',
              activeTab === tab
                ? 'bg-accent/15 text-accent-bright ring-1 ring-accent/30'
                : 'border border-border text-muted hover:text-text',
            )}
          >
            {TAB_LABEL[tab]}
          </button>
        ))}
      </div>

      {activeTab && (
        <div className="rounded-xl border border-border bg-surface-2/30 p-3">
          <ErrorBoundary key={activeTab}>
            {activeTab === 'structure' && <StructureTab tournament={tournament} />}
            {activeTab === 'standings' && (
              <StandingsTab tournament={tournament} myUid={myUid} chipDisplay={chipDisplay} />
            )}
            {activeTab === 'chart' && <MultiLineChart players={tournament.players} />}
            {activeTab === 'history' && <HistoryTab handHistory={handHistory} chipDisplay={chipDisplay} />}
          </ErrorBoundary>
        </div>
      )}
    </div>
  );
}

function StructureTab({ tournament }: { tournament: TournamentState }) {
  const { config, currentLevel, handNumber } = tournament;
  const isFinalLevel = currentLevel >= config.blindLevels.length - 1;
  const statusText = !Number.isFinite(config.handsPerLevel)
    ? 'ブラインド固定'
    : isFinalLevel
      ? '最終レベル'
      : `あと ${config.handsPerLevel - (handNumber % config.handsPerLevel)} ハンドでブラインドアップ`;

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">{statusText}</p>
      <div className="space-y-1">
        {config.blindLevels.map((lv, i) => (
          <div
            key={i}
            className={cn(
              'rounded-lg px-2 py-1 text-xs',
              i === currentLevel ? 'bg-accent/10 text-accent-bright' : 'text-muted',
            )}
          >
            Lv{i + 1} SB {lv.sb} / BB {lv.bb} / Ante {lv.ante}
          </div>
        ))}
      </div>
    </div>
  );
}

function StandingsTab({
  tournament,
  myUid,
  chipDisplay,
}: {
  tournament: TournamentState;
  myUid: string | null;
  chipDisplay: ChipDisplay;
}) {
  const ranked = standings(tournament);
  const playing = tournament.players.filter((p) => p.status === 'playing');
  const avg = playing.length > 0 ? playing.reduce((s, p) => s + p.stack, 0) / playing.length : null;

  return (
    <div className="space-y-2">
      {avg !== null && <p className="text-xs text-muted">アベレージ: {formatAmount(avg, chipDisplay)}</p>}
      <div className="space-y-1">
        {ranked.map((p, i) => {
          const rank = p.finishRank ?? i + 1;
          const isMe = p.uid === myUid;
          return (
            <div
              key={p.uid}
              className={cn(
                'flex items-center justify-between rounded-lg border border-border bg-surface-2/30 px-2 py-1.5 text-xs',
                isMe && 'border-accent/40 bg-accent/10',
              )}
            >
              <div className="flex items-center gap-2">
                <span className="w-4 text-center text-muted">{rank}</span>
                <span>{p.displayName}</span>
                {p.status === 'busted' && <span className="text-[10px] text-danger">バスト</span>}
                {p.status === 'left' && <span className="text-[10px] text-muted">退出</span>}
              </div>
              <span className="font-mono tabular-nums text-muted">{formatAmount(p.stack, chipDisplay)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HistoryTab({ handHistory, chipDisplay }: { handHistory: HandHistoryEntry[]; chipDisplay: ChipDisplay }) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const toggleHand = (handNumber: number) => {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(handNumber)) next.delete(handNumber);
      else next.add(handNumber);
      return next;
    });
  };

  if (handHistory.length === 0) {
    return <p className="text-xs text-muted">まだ完了したハンドがありません</p>;
  }

  const sorted = [...handHistory].sort((a, b) => b.handNumber - a.handNumber);

  return (
    <div className="space-y-1.5">
      {sorted.map((entry) => {
        const isOpen = expanded.has(entry.handNumber);
        const winnersText = entry.winners
          .map((w) => `${w.displayName} +${formatAmount(w.amount, chipDisplay)}`)
          .join(' / ');
        const groupedLog = STREET_ORDER.map((street) => ({
          street,
          entries: entry.log.filter((l) => l.street === street),
        })).filter((g) => g.entries.length > 0);

        return (
          <div key={entry.handNumber} className="rounded-lg border border-border bg-surface-2/30">
            <button
              onClick={() => toggleHand(entry.handNumber)}
              className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-xs"
            >
              <span className="text-muted">#{entry.handNumber}</span>
              <span className="truncate">{winnersText}</span>
            </button>
            {isOpen && (
              <div className="space-y-2 border-t border-border px-2 py-2 text-xs">
                {entry.board.length > 0 && (
                  <div className="flex gap-1">
                    {entry.board.map((c, i) => (
                      <PlayingCard key={i} card={c} size="sm" />
                    ))}
                  </div>
                )}
                {entry.shown.length > 0 && (
                  <div className="space-y-1">
                    {entry.shown.map((s, i) => (
                      <div key={i} className="flex flex-wrap items-center gap-1.5 text-muted">
                        <span>{s.displayName}:</span>
                        <div className="flex gap-0.5">
                          {s.hole.map((c, j) => (
                            <PlayingCard key={j} card={c} size="sm" />
                          ))}
                        </div>
                        <span>{s.handName}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="space-y-1.5">
                  {groupedLog.map((g) => (
                    <div key={g.street}>
                      <div className="text-[10px] uppercase tracking-wide text-muted">{STREET_LABEL[g.street]}</div>
                      {g.entries.map((l, i) => {
                        const name = entry.players.find((p) => p.playerId === l.playerId)?.displayName ?? '?';
                        return (
                          <div key={i} className="pl-2 text-muted">
                            {l.pos} {name} — {actionBadgeLabel({ action: l.action, amount: l.amount }, chipDisplay)}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
