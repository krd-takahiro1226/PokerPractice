import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { BarChart2, BookMarked, BookOpen, Brain, Coins, Eye, Grid3x3, Home, Percent, Swords, Target, Trophy, Users, type LucideIcon } from 'lucide-react';
import { accuracy, useProgress } from '../store/progress';
import { cn } from '../lib/cn';
import { AuthButton } from './AuthButton';

type NavItem = { to: string; label: string; icon: LucideIcon };

type NavSection = { section: string; items: NavItem[] };

const NAV_SECTIONS: NavSection[] = [
  {
    section: '学習（ドリル）',
    items: [
      { to: '/', label: 'ホーム', icon: Home },
      { to: '/range', label: 'レンジ訓練', icon: Grid3x3 },
      { to: '/equity', label: 'エクイティ', icon: Percent },
      { to: '/pot-odds', label: 'オッズ & MDF', icon: Coins },
      { to: '/cbet', label: 'CB', icon: Target },
      { to: '/quiz', label: 'クイズ', icon: Brain },
      { to: '/perceived', label: '相手目線レンジ', icon: Eye },
      { to: '/stats', label: '統計', icon: BarChart2 },
      { to: '/review', label: '復習', icon: BookOpen },
      { to: '/glossary', label: '用語集', icon: BookMarked },
    ],
  },
  {
    section: 'プレイ',
    items: [
      { to: '/versus', label: '対戦', icon: Swords },
      { to: '/online', label: 'オンライン対戦', icon: Users },
      { to: '/sessions', label: '成績', icon: Trophy },
    ],
  },
];

// Flat list for mobile tab bar (top 5)
const MOBILE_NAV: NavItem[] = [
  { to: '/', label: 'ホーム', icon: Home },
  { to: '/range', label: 'レンジ', icon: Grid3x3 },
  { to: '/pot-odds', label: 'オッズ', icon: Coins },
  { to: '/quiz', label: 'クイズ', icon: Brain },
  { to: '/versus', label: '対戦', icon: Swords },
];

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <img src="/icons/icon-192.png" alt="PokerDrill" className="h-8 w-8 rounded-md" />
      <div className="leading-tight">
        <div className="text-sm font-bold tracking-tight">PokerDrill</div>
        <div className="text-[10px] uppercase tracking-widest text-muted">NLH 6-max</div>
      </div>
    </div>
  );
}

function OverallStat() {
  const { range, potOdds, quiz, reqEquity, mdf, cbet, perceived } = useProgress();
  const attempts = range.attempts + potOdds.attempts + quiz.attempts + reqEquity.attempts + mdf.attempts + cbet.attempts + perceived.attempts;
  const correct = range.correct + potOdds.correct + quiz.correct + reqEquity.correct + mdf.correct + cbet.correct + perceived.correct;
  const acc = attempts === 0 ? 0 : correct / attempts;
  return (
    <div className="rounded-xl border border-border bg-surface-2/50 p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted">総合正答率</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="font-mono text-xl font-bold text-accent-bright tabular-nums">
          {(acc * 100).toFixed(0)}%
        </span>
        <span className="text-xs text-muted">{attempts} 問</span>
      </div>
    </div>
  );
}

export function AppShell() {
  const location = useLocation();
  return (
    <div className="flex min-h-full">
      {/* Sidebar (desktop) */}
      <aside className="hidden w-60 flex-col border-r border-border bg-surface/40 p-4 md:flex">
        <div className="px-2 py-3">
          <Logo />
        </div>
        <nav className="mt-4 flex flex-1 flex-col gap-1">
          {NAV_SECTIONS.map((section) => (
            <div key={section.section} className="mb-2">
              <div className="mb-1 px-3 text-[10px] uppercase tracking-widest text-muted/60">
                {section.section}
              </div>
              {section.items.map((item) => (
                <NavItemLink key={item.to} item={item} />
              ))}
            </div>
          ))}
        </nav>
        <OverallStat />
        <div className="mt-2">
          <AuthButton />
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile header */}
        <header className="flex items-center justify-between border-b border-border bg-surface/60 px-4 py-3 backdrop-blur md:hidden">
          <Logo />
          <div className="w-40">
            <AuthButton />
          </div>
        </header>

        <main className="flex-1 px-4 pb-24 pt-5 sm:px-6 md:pb-8 md:pt-8">
          <div className="mx-auto w-full max-w-5xl">
            <AnimatePresence mode="wait">
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
              >
                <Outlet />
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>

      {/* Bottom tab bar (mobile) */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-surface/90 backdrop-blur md:hidden">
        {MOBILE_NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              cn(
                'flex flex-col items-center gap-0.5 py-2.5 text-[10px] transition',
                isActive ? 'text-accent-bright' : 'text-muted',
              )
            }
          >
            <item.icon size={20} />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function NavItemLink({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
          isActive
            ? 'bg-accent/15 text-accent-bright ring-1 ring-accent/30'
            : 'text-muted hover:bg-surface-2 hover:text-text',
        )
      }
    >
      <item.icon size={18} />
      {item.label}
    </NavLink>
  );
}
