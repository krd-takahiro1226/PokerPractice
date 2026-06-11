import { useState, useEffect } from 'react';
import { PageHeader } from '../components/PageHeader';
import { Panel } from '../components/Panel';
import { Button } from '../components/Button';
import { LineChart } from '../components/charts/LineChart';
import { useSessions } from '../store/sessions';
import { useAuth } from '../store/auth';
import { cn } from '../lib/cn';
import type { SessionRecord } from '../store/sessions';

const FORMAT_LABEL: Record<string, string> = {
  tournament: 'トーナメント',
  cash: 'キャッシュ',
};

const MODE_LABEL: Record<string, string> = {
  tournament: 'トーナメント',
  'cash-ante': 'アンティあり',
  'cash-noante': 'アンティなし',
};

const DIFFICULTY_LABEL: Record<string, string> = {
  easy: 'やさしい',
  normal: 'ふつう',
  hard: 'つよい',
};

const RESULT_LABEL: Record<string, { label: string; color: string }> = {
  bust: { label: 'バスト', color: 'text-rose-400' },
  win: { label: '優勝', color: 'text-amber-400' },
  quit: { label: '途中終了', color: 'text-muted' },
};

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}

export function Sessions() {
  const { sessions, loadFromCloud } = useSessions();
  const { status } = useAuth();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // ログイン時は DB からセッション一覧を取得
  useEffect(() => {
    if (status === 'signedIn') {
      loadFromCloud().catch(() => {});
    }
  }, [status, loadFromCloud]);

  const selected = selectedId ? sessions.find((s) => s.id === selectedId) : null;

  if (selected) {
    return (
      <SessionDetail
        record={selected}
        onBack={() => setSelectedId(null)}
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="対戦成績"
        description="セッション履歴とチップ推移を確認できます。"
      />

      {sessions.length === 0 ? (
        <Panel className="p-8 text-center text-muted">
          まだセッション記録がありません。対戦ページでセッションをプレイしてください。
        </Panel>
      ) : (
        <div className="flex flex-col gap-2">
          {sessions.map((s) => (
            <SessionRow
              key={s.id}
              record={s}
              onClick={() => setSelectedId(s.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SessionRow({ record, onClick }: { record: SessionRecord; onClick: () => void }) {
  const resultInfo = record.result ? RESULT_LABEL[record.result] : null;
  const finalStack = record.stackCurve.length > 0
    ? record.stackCurve[record.stackCurve.length - 1]
    : record.startingStack;
  const stackDiff = finalStack - record.startingStack;

  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface-2/40 px-4 py-3 text-left transition hover:bg-surface-2"
    >
      {/* Format badge */}
      <div className="shrink-0">
        <span className={cn(
          'rounded-lg px-2 py-1 text-xs font-semibold',
          record.format === 'tournament'
            ? 'bg-amber-500/20 text-amber-400'
            : 'bg-blue-500/20 text-blue-400',
        )}>
          {FORMAT_LABEL[record.format] ?? record.format}
        </span>
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold">{MODE_LABEL[record.mode] ?? record.mode}</span>
          <span className="text-muted">·</span>
          <span className="text-xs text-muted">{formatDate(record.startedAt)}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <span className="rounded border border-border px-1 text-[10px] text-muted">
            {DIFFICULTY_LABEL[record.difficulty] ?? record.difficulty}
          </span>
          <span className="text-[10px] text-muted">
            {record.handsPlayed} ハンド
          </span>
          {resultInfo && (
            <span className={cn('text-[10px] font-semibold', resultInfo.color)}>
              {resultInfo.label}
            </span>
          )}
          {record.result === null && (
            <span className="text-[10px] text-accent-bright">進行中</span>
          )}
        </div>
      </div>

      {/* Final stack diff */}
      <div className={cn(
        'font-mono text-sm font-bold tabular-nums',
        stackDiff > 0 ? 'text-emerald-400' : stackDiff < 0 ? 'text-rose-400' : 'text-muted',
      )}>
        {stackDiff > 0 ? '+' : ''}{stackDiff.toFixed(0)}
      </div>
    </button>
  );
}

function SessionDetail({ record, onBack }: { record: SessionRecord; onBack: () => void }) {
  const resultInfo = record.result ? RESULT_LABEL[record.result] : null;
  const finalStack = record.stackCurve.length > 0
    ? record.stackCurve[record.stackCurve.length - 1]
    : record.startingStack;
  const stackDiff = finalStack - record.startingStack;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="セッション詳細" />

      <button
        onClick={onBack}
        className="flex w-fit items-center gap-1.5 text-sm text-muted hover:text-text"
      >
        ← 一覧に戻る
      </button>

      {/* Summary */}
      <Panel className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-base font-semibold">
              <span>{FORMAT_LABEL[record.format] ?? record.format}</span>
              <span className="text-muted text-sm">·</span>
              <span className="text-sm text-muted">{MODE_LABEL[record.mode] ?? record.mode}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
              <span>{formatDate(record.startedAt)}</span>
              {record.endedAt && <span>〜 {formatDate(record.endedAt)}</span>}
              <span>|</span>
              <span>{DIFFICULTY_LABEL[record.difficulty] ?? record.difficulty}</span>
              <span>|</span>
              <span>{record.handsPlayed} ハンド</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-widest text-muted">最終スタック</div>
            <div className={cn(
              'font-mono text-2xl font-bold tabular-nums',
              stackDiff > 0 ? 'text-emerald-400' : stackDiff < 0 ? 'text-rose-400' : 'text-muted',
            )}>
              {finalStack.toFixed(0)}
              <span className="ml-1 text-sm">
                ({stackDiff > 0 ? '+' : ''}{stackDiff.toFixed(0)})
              </span>
            </div>
            {resultInfo && (
              <div className={cn('mt-1 text-sm font-semibold', resultInfo.color)}>
                {resultInfo.label}
              </div>
            )}
          </div>
        </div>
      </Panel>

      {/* Chart */}
      {record.stackCurve.length > 1 && (
        <Panel className="p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted">
            チップ推移
          </div>
          <LineChart
            data={record.stackCurve}
            baseline={record.startingStack}
            width={480}
            height={160}
          />
          <div className="mt-1 flex justify-between text-[10px] text-muted">
            <span>開始</span>
            <span>baseline: {record.startingStack}</span>
            <span>{record.stackCurve.length - 1} ハンド後</span>
          </div>
        </Panel>
      )}

      {record.stackCurve.length <= 1 && (
        <Panel className="p-6 text-center text-sm text-muted">
          グラフを表示するにはハンドをプレイしてください。
        </Panel>
      )}
    </div>
  );
}
