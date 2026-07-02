import { PageHeader } from '../components/PageHeader';
import { SessionHistory } from '../components/SessionHistory';

export function Sessions() {
  return (
    <div>
      <PageHeader
        title="対戦成績"
        description="セッション履歴とチップ推移を確認できます。"
      />
      <SessionHistory />
    </div>
  );
}
