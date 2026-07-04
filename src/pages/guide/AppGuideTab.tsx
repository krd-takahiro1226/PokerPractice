import { Link } from 'react-router-dom';
import { BarChart2, BookMarked, BookOpen, Brain, Coins, Eye, Grid3x3, Percent, Swords, Target, Users } from 'lucide-react';
import { Panel } from '../../components/Panel';
import type { LucideIcon } from 'lucide-react';

type RoadmapStep = {
  step: number;
  title: string;
  desc: string;
  links: { to: string; label: string; icon: LucideIcon }[];
};

const ROADMAP: RoadmapStep[] = [
  {
    step: 1,
    title: 'ルールと用語を知る',
    desc: 'このガイドの「ポーカーのルール」タブと用語集で、基本の流れと用語を押さえます。',
    links: [
      { to: '/guide', label: 'このガイド', icon: BookOpen },
      { to: '/glossary', label: '用語集', icon: BookMarked },
    ],
  },
  {
    step: 2,
    title: 'プリフロップのオープンレンジを覚える',
    desc: 'チャートを眺めてからドリルへ。まずは BTN / CO のような易しいポジションから始めるのがおすすめです。',
    links: [{ to: '/range', label: 'レンジ訓練', icon: Grid3x3 }],
  },
  {
    step: 3,
    title: 'クイズで定着させる',
    desc: '覚えたレンジを、状況判断クイズと相手目線レンジの訓練でアウトプットして定着させます。',
    links: [
      { to: '/quiz', label: 'クイズ', icon: Brain },
      { to: '/perceived', label: '相手目線レンジ', icon: Eye },
    ],
  },
  {
    step: 4,
    title: '数字に強くなる',
    desc: 'ポットオッズとエクイティの計算に慣れて、コール/フォールドの判断をすばやくできるようにします。',
    links: [
      { to: '/pot-odds', label: 'ポットオッズ', icon: Coins },
      { to: '/equity', label: 'エクイティ計算', icon: Percent },
    ],
  },
  {
    step: 5,
    title: 'フロップ以降を学ぶ',
    desc: 'プリフロップの次は c-bet（コンティニュエーションベット）の判断を練習します。',
    links: [{ to: '/cbet', label: 'CB 練習', icon: Target }],
  },
  {
    step: 6,
    title: '実戦練習',
    desc: 'CPU 相手にハンドを打ってみます。まずは単発ハンドから、慣れてきたらセッション（連続プレイ）に挑戦しましょう。',
    links: [{ to: '/versus', label: 'vs CPU 対戦', icon: Swords }],
  },
  {
    step: 7,
    title: '人と対戦',
    desc: '友達と部屋コードを共有して、オンラインで対戦できます。',
    links: [{ to: '/online', label: 'オンライン対戦', icon: Users }],
  },
];

export function AppGuideTab() {
  return (
    <div className="space-y-5">
      <Panel title="1. このアプリの楽しみ方">
        <div className="space-y-2 text-sm leading-relaxed text-text">
          <p>
            このアプリは「チャートで覚える → ドリルで定着させる → 実戦で試す」の順で、
            GTO（Game Theory Optimal）風の基礎を無理なく身につけるように作られています。
          </p>
          <ul className="ml-4 list-disc space-y-1 text-muted">
            <li>1 日 10 分でも、毎日コツコツ続けるのが一番効きます。</li>
            <li>正答率や連続正解（ストリーク）が伸びていくのを楽しみにしましょう。</li>
            <li>間違えた問題は復習ページに溜まるので、忘れた頃にもう一度解き直せます。</li>
          </ul>
        </div>
      </Panel>

      <Panel title="2. 学習ロードマップ" subtitle="上から順に進めるのがおすすめですが、気になるところから始めても構いません">
        <div className="space-y-3">
          {ROADMAP.map((r) => (
            <div key={r.step} className="flex gap-3 rounded-xl border border-border/60 bg-surface-2/30 p-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-sm font-bold text-accent-bright ring-1 ring-accent/30">
                {r.step}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold tracking-tight">{r.title}</div>
                <p className="mt-1 text-sm text-muted">{r.desc}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {r.links.map((l) => (
                    <Link
                      key={l.to}
                      to={l.to}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border-bright px-2.5 py-1 text-xs font-medium text-text transition hover:bg-surface-2 hover:text-accent-bright"
                    >
                      <l.icon size={13} />
                      {l.label}
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          ))}

          <div className="flex gap-3 rounded-xl border border-dashed border-border-bright/70 bg-surface/40 p-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted">
              <BarChart2 size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-semibold tracking-tight">補助機能はいつでも</div>
              <p className="mt-1 text-sm text-muted">
                成績の確認や間違えた問題の解き直しは、ロードマップのどの段階でも活用できます。
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Link
                  to="/stats"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border-bright px-2.5 py-1 text-xs font-medium text-text transition hover:bg-surface-2 hover:text-accent-bright"
                >
                  <BarChart2 size={13} />
                  成績
                </Link>
                <Link
                  to="/review"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border-bright px-2.5 py-1 text-xs font-medium text-text transition hover:bg-surface-2 hover:text-accent-bright"
                >
                  <BookOpen size={13} />
                  復習
                </Link>
              </div>
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="3. 勉強のコツ">
        <ul className="ml-4 list-disc space-y-1.5 text-sm text-text">
          <li>
            チャートは丸暗記しようとせず、「色の形（tier の帯構造）」でパターンとして覚えると定着しやすいです。
          </li>
          <li>ドリルは正答率 90% くらいを目安に、次のポジションへ進みましょう。</li>
          <li>対戦中に迷ったハンドは、あとで成績ページや復習ページから振り返るとよい発見があります。</li>
          <li>
            覚えたレンジが自分の好みと違う場合は、レンジ訓練ページの編集モードで自分好みにカスタムできます。
          </li>
        </ul>
      </Panel>
    </div>
  );
}
