import { Panel } from '../Panel';
import { OnlineTablePanels } from './OnlineTablePanels';
import type { LeftSummary } from '../../store/online';

type OnlineLeftSummaryProps = {
  summary: LeftSummary;
  onClose: () => void;
};

// 途中退出した対戦の結果を、ロビーに戻る前に確認できる画面(reset() で消える前に
// useOnlineRoom.leaveRoom が退避した LeftSummary を表示するだけ)。OnlineTablePanels を
// そのまま再利用してチップ推移/順位/履歴タブを見せる。
export function OnlineLeftSummary({ summary, onClose }: OnlineLeftSummaryProps) {
  return (
    <div className="space-y-4">
      <Panel title="対戦から退出しました" subtitle="退出時点のチップ推移・順位・履歴を確認できます">
        <button
          onClick={onClose}
          className="w-full rounded-xl bg-gradient-to-b from-accent-bright to-accent px-4 py-2.5 text-sm font-semibold text-[#04221a] shadow-lg shadow-accent/25 transition hover:brightness-110"
        >
          ロビーへ戻る
        </button>
      </Panel>
      <OnlineTablePanels tournament={summary.tournament} myUid={summary.myUid} handHistory={summary.handHistory} />
    </div>
  );
}
