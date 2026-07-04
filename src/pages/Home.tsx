import { Link } from 'react-router-dom';
import { ArrowRight, Brain, Coins, Eye, GraduationCap, Grid3x3, Percent, TrendingDown, Trophy, Users } from 'lucide-react';
import { Panel } from '../components/Panel';
import { ProgressRing } from '../components/ProgressRing';
import { StatBadge } from '../components/StatBadge';
import { accuracy, useProgress } from '../store/progress';
import { getScenario } from '../core/ranges';

const FEATURES = [
  {
    to: '/guide',
    icon: GraduationCap,
    title: 'はじめてガイド',
    desc: 'ポーカーのルールと、このアプリでの学び方をチュートリアル形式で解説。初めての方はここから。',
    accent: 'text-emerald-400',
  },
  {
    to: '/range',
    icon: Grid3x3,
    title: 'プリフロップ・レンジ訓練',
    desc: 'ポジション別のオープンレンジをチャートで学び、ドリルで反復。最も伸びる領域。',
    accent: 'text-accent-bright',
  },
  {
    to: '/equity',
    icon: Percent,
    title: 'エクイティ計算機',
    desc: 'ハンド同士の勝率をモンテカルロで計算。ボードを入れて状況別の勝率も。',
    accent: 'text-call',
  },
  {
    to: '/pot-odds',
    icon: Coins,
    title: 'ポットオッズ訓練',
    desc: 'ドローのコール判断を、必要勝率とアウツから瞬時に計算する練習。',
    accent: 'text-gold',
  },
  {
    to: '/quiz',
    icon: Brain,
    title: 'ハンドクイズ',
    desc: '状況を提示し最適アクションを選択。正誤と解説で理解を定着。',
    accent: 'text-accent-2',
  },
  {
    to: '/perceived',
    icon: Eye,
    title: '相手目線レンジ',
    desc: '自分のアクションが相手にどんなレンジを見せているかを意識する訓練。',
    accent: 'text-danger',
  },
  {
    to: '/sessions',
    icon: Trophy,
    title: '対戦成績',
    desc: 'セッション履歴とチップ推移',
    accent: 'text-amber-400',
  },
  {
    to: '/online',
    icon: Users,
    title: 'オンライン対戦',
    desc: '部屋コードで知り合いと 2〜6 人トーナメント対戦。',
    accent: 'text-sky-400',
  },
] as const;

export function Home() {
  const progress = useProgress();
  const { range, potOdds, quiz, byScenario } = progress;
  const attempts = range.attempts + potOdds.attempts + quiz.attempts;
  const correct = range.correct + potOdds.correct + quiz.correct;
  const overall = attempts === 0 ? 0 : correct / attempts;

  const weakSpots = Object.entries(byScenario)
    .filter(([, s]) => s.attempts >= 3)
    .map(([id, s]) => ({ id, acc: s.correct / s.attempts, attempts: s.attempts }))
    .sort((a, b) => a.acc - b.acc)
    .slice(0, 3);

  return (
    <div className="space-y-6">
      {/* Hero */}
      <Panel className="glow-accent overflow-hidden">
        <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
          <div>
            <div className="text-xs uppercase tracking-widest text-accent-bright">NLH 6-max トレーナー</div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
              今日もポーカーを上達させよう
            </h1>
            <p className="mt-2 max-w-md text-sm text-muted">
              プリフロップの判断は勝率の土台。まずはレンジ訓練のドリルから始めるのがおすすめです。
            </p>
            <Link
              to="/range"
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-gradient-to-b from-accent-bright to-accent px-5 py-2.5 text-sm font-semibold text-[#04221a] shadow-lg shadow-accent/25 transition hover:brightness-110"
            >
              レンジ訓練を始める <ArrowRight size={16} />
            </Link>
          </div>
          <div className="flex shrink-0 flex-col items-center">
            <ProgressRing value={overall} size={120} stroke={10} label={`${(overall * 100).toFixed(0)}%`} sublabel="総合正答率" />
            <span className="mt-2 text-xs text-muted">{attempts} 問 練習済み</span>
          </div>
        </div>
      </Panel>

      {/* Quick stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatBadge label="レンジ" value={`${(accuracy(range) * 100).toFixed(0)}%`} hint={`${range.attempts} 問`} accent="accent" />
        <StatBadge label="ポットオッズ" value={`${(accuracy(potOdds) * 100).toFixed(0)}%`} hint={`${potOdds.attempts} 問`} accent="gold" />
        <StatBadge label="クイズ" value={`${(accuracy(quiz) * 100).toFixed(0)}%`} hint={`${quiz.attempts} 問`} accent="call" />
        <StatBadge label="最高連続正解" value={Math.max(range.bestStreak, potOdds.bestStreak, quiz.bestStreak)} hint="ストリーク" accent="muted" />
      </div>

      {/* Feature cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <Link
            key={f.to}
            to={f.to}
            className="panel group flex items-start gap-4 p-5 transition hover:border-accent/40 hover:bg-surface/90"
          >
            <div className={`rounded-xl bg-surface-2 p-3 ${f.accent}`}>
              <f.icon size={22} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 font-semibold tracking-tight">
                {f.title}
                <ArrowRight size={15} className="text-muted transition group-hover:translate-x-0.5 group-hover:text-accent-bright" />
              </div>
              <p className="mt-1 text-sm text-muted">{f.desc}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* Weak spots */}
      {weakSpots.length > 0 && (
        <Panel title="弱点シナリオ" subtitle="正答率が低いシナリオから優先的に復習しましょう">
          <div className="space-y-2">
            {weakSpots.map((w) => {
              const sc = getScenario(w.id);
              return (
                <Link
                  key={w.id}
                  to="/range"
                  className="flex items-center justify-between rounded-xl border border-border bg-surface-2/40 px-4 py-3 transition hover:border-danger/40"
                >
                  <span className="flex items-center gap-2 text-sm">
                    <TrendingDown size={16} className="text-danger" />
                    {sc?.label ?? w.id}
                  </span>
                  <span className="font-mono text-sm text-danger tabular-nums">
                    {(w.acc * 100).toFixed(0)}%
                    <span className="ml-2 text-muted">{w.attempts}問</span>
                  </span>
                </Link>
              );
            })}
          </div>
        </Panel>
      )}
    </div>
  );
}
