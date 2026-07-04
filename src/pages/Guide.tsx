import { useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { cn } from '../lib/cn';
import { RulesTab } from './guide/RulesTab';
import { AppGuideTab } from './guide/AppGuideTab';

type Tab = 'rules' | 'appGuide';

export function Guide() {
  const [tab, setTab] = useState<Tab>('rules');

  return (
    <div>
      <PageHeader
        title="はじめてガイド"
        description="ポーカーのルールと、このアプリでの学び方をまとめました。"
      />

      <div className="mb-5 inline-flex rounded-xl border border-border bg-surface-2/50 p-1">
        {(['rules', 'appGuide'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'rounded-lg px-4 py-1.5 text-sm font-medium transition',
              tab === t ? 'bg-accent text-[#04221a]' : 'text-muted hover:text-text',
            )}
          >
            {t === 'rules' ? 'ポーカーのルール' : 'アプリの使い方・勉強法'}
          </button>
        ))}
      </div>

      {tab === 'rules' ? <RulesTab /> : <AppGuideTab />}
    </div>
  );
}
