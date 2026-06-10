import { useState } from 'react';
import { Dices, Eraser, Play } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Panel } from '../components/Panel';
import { Button } from '../components/Button';
import { PlayingCard } from '../components/PlayingCard';
import { CardPicker } from '../components/CardPicker';
import { useEquity } from '../hooks/useEquity';
import { makeDeck, type Card } from '../core/cards';
import { shuffle } from '../lib/random';
import { cn } from '../lib/cn';

type Slot = Card | null;
type Target = { group: 'hero' | 'villain' | 'board'; index: number };

const ITER_OPTIONS = [50_000, 100_000, 250_000];

export function EquityCalc() {
  const [hero, setHero] = useState<Slot[]>([null, null]);
  const [villain, setVillain] = useState<Slot[]>([null, null]);
  const [board, setBoard] = useState<Slot[]>([null, null, null, null, null]);
  const [picker, setPicker] = useState<Target | null>(null);
  const [iterations, setIterations] = useState(100_000);
  const { run, running, progress, result, error } = useEquity();

  const used = [...hero, ...villain, ...board].filter(Boolean) as Card[];
  const heroReady = hero.every(Boolean);
  const villainReady = villain.every(Boolean);
  const canRun = heroReady && villainReady && !running;

  function setSlot(target: Target, card: Card | null) {
    const setter = target.group === 'hero' ? setHero : target.group === 'villain' ? setVillain : setBoard;
    setter((prev) => prev.map((c, i) => (i === target.index ? card : c)));
  }

  function onSlotClick(target: Target, current: Slot) {
    if (current) setSlot(target, null);
    else setPicker(target);
  }

  function randomize() {
    const d = shuffle(makeDeck());
    setHero([d[0], d[1]]);
    setVillain([d[2], d[3]]);
    setBoard([null, null, null, null, null]);
  }

  function clearAll() {
    setHero([null, null]);
    setVillain([null, null]);
    setBoard([null, null, null, null, null]);
  }

  function compute() {
    if (!canRun) return;
    const boardCards = board.filter(Boolean) as Card[];
    run([hero as Card[], villain as Card[]], boardCards, iterations);
  }

  const players = [
    { name: 'Hero', cards: hero, accent: 'text-accent-bright', bar: 'var(--color-accent)' },
    { name: 'Villain', cards: villain, accent: 'text-danger', bar: 'var(--color-danger)' },
  ];

  return (
    <div>
      <PageHeader
        title="エクイティ計算機"
        description="2ハンドの勝率をモンテカルロ法で計算。ボードを入れると状況別の勝率も出せます。"
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={randomize}>
              <Dices size={15} /> ランダム
            </Button>
            <Button variant="ghost" size="sm" onClick={clearAll}>
              <Eraser size={15} /> クリア
            </Button>
          </>
        }
      />

      <div className="space-y-5">
        <div className="grid gap-5 sm:grid-cols-2">
          {players.map((p, gi) => (
            <Panel key={p.name}>
              <div className="mb-3 flex items-center justify-between">
                <span className={cn('font-semibold', p.accent)}>{p.name}</span>
                {result && (
                  <span className="font-mono text-2xl font-bold tabular-nums">
                    {(result.players[gi].equity * 100).toFixed(1)}%
                  </span>
                )}
              </div>
              <div className="flex gap-3">
                {p.cards.map((c, i) => (
                  <PlayingCard
                    key={i}
                    card={c}
                    size="lg"
                    onClick={() => onSlotClick({ group: gi === 0 ? 'hero' : 'villain', index: i }, c)}
                  />
                ))}
              </div>
              {result && (
                <div className="mt-3 text-xs text-muted">
                  勝ち {(result.players[gi].win * 100).toFixed(1)}% / 引き分け{' '}
                  {(result.players[gi].tie * 100).toFixed(1)}%
                </div>
              )}
            </Panel>
          ))}
        </div>

        <Panel title="ボード (任意)" subtitle="フロップ3枚・ターン4枚・リバー5枚。空欄ならプリフロップ全体の勝率。">
          <div className="flex flex-wrap gap-3">
            {board.map((c, i) => (
              <PlayingCard
                key={i}
                card={c}
                size="lg"
                onClick={() => onSlotClick({ group: 'board', index: i }, c)}
              />
            ))}
          </div>
        </Panel>

        <Panel>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted">試行回数</span>
              <div className="inline-flex rounded-xl border border-border bg-surface-2/50 p-1">
                {ITER_OPTIONS.map((n) => (
                  <button
                    key={n}
                    onClick={() => setIterations(n)}
                    className={cn(
                      'rounded-lg px-3 py-1.5 font-mono text-sm transition',
                      iterations === n ? 'bg-accent text-[#04221a]' : 'text-muted hover:text-text',
                    )}
                  >
                    {(n / 1000).toFixed(0)}k
                  </button>
                ))}
              </div>
            </div>
            <Button onClick={compute} disabled={!canRun} size="lg" className="sm:w-48">
              <Play size={16} /> {running ? '計算中…' : '勝率を計算'}
            </Button>
          </div>

          {running && (
            <div className="mt-4">
              <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-accent-2 to-accent transition-[width] duration-150"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
              <div className="mt-1 text-right font-mono text-xs text-muted">{(progress * 100).toFixed(0)}%</div>
            </div>
          )}

          {error && <div className="mt-4 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</div>}

          {result && !running && (
            <div className="mt-5">
              <div className="flex h-8 overflow-hidden rounded-lg">
                {players.map((p, gi) => (
                  <div
                    key={p.name}
                    className="flex items-center justify-center text-xs font-semibold text-white/90 transition-[width] duration-300"
                    style={{ width: `${result.players[gi].equity * 100}%`, background: p.bar }}
                  >
                    {result.players[gi].equity > 0.08 && `${(result.players[gi].equity * 100).toFixed(0)}%`}
                  </div>
                ))}
              </div>
              <div className="mt-2 text-center text-xs text-muted">{result.iterations.toLocaleString()} 回試行</div>
            </div>
          )}

          {!heroReady || !villainReady ? (
            <p className="mt-4 text-center text-sm text-muted">Hero と Villain のカードを2枚ずつ選んでください</p>
          ) : null}
        </Panel>
      </div>

      {picker && (
        <CardPicker
          used={used}
          title={`${picker.group === 'board' ? 'ボード' : picker.group === 'hero' ? 'Hero' : 'Villain'} のカードを選択`}
          onPick={(card) => {
            setSlot(picker, card);
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}
