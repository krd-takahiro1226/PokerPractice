import { useAuth } from './auth';
import { useAttempts } from './attempts';
import { useBookmarks } from './bookmarks';
import { useCustomRanges } from './customRanges';
import { useSessions } from './sessions';

let previousUserId: string | null | undefined;

/**
 * userId の変化（ゲスト↔ログイン、別アカウントへの切替）を検知し、
 * アカウントを跨いでメモリ上に残り続ける各ストアをリセット+再読込する。
 * main.tsx で useAuth().init() の直後に一度だけ呼ぶ。
 */
export function initAuthSync(): void {
  previousUserId = undefined;
  useAuth.subscribe((state) => {
    if (state.status === 'loading') return; // 初回セッション確認中
    if (state.userId === previousUserId) return;
    const prev = previousUserId;
    previousUserId = state.userId;

    // attempts/bookmarks/customRanges は zustand persist を使わず localStorage を
    // 自分のアクション内でしか触らないため、どちら向きの遷移でも即リセット+再読込して安全。
    useAttempts.setState({ attempts: [], loaded: false });
    useBookmarks.setState({ items: [], loaded: false });
    useCustomRanges.setState({ ranges: {}, loaded: false });
    useAttempts.getState().load();
    useBookmarks.getState().load();
    useCustomRanges.getState().load();

    // sessions は zustand persist で setState のたびに localStorage へ自動保存されるため、
    // 「ゲスト→ログイン」直後にここでクリアすると、直後に走る migrateLocalToCloud
    // （生の localStorage を読んで移行する）より先に guest データを消してしまう。
    // そのため起動直後に観測した最初の遷移（prev === undefined、ページ再読み込み時に
    // 既にログイン済みだったケースも含む）はここでは何もしない。
    if (prev === undefined) return;
    if (state.userId === null) {
      // サインアウト: 前アカウントのセッション履歴を残さない
      useSessions.setState({ sessions: [], activeSession: null, loaded: false });
    } else if (prev !== null && prev !== state.userId) {
      // サインアウトを挟まずに別アカウントへ切り替わった場合
      useSessions.setState({ sessions: [], activeSession: null, loaded: false });
      useSessions.getState().loadFromCloud();
    }
  });
}
