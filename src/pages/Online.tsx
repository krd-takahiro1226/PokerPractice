import { useEffect, useState } from 'react';
import { Panel } from '../components/Panel';
import { OnlineLobby } from '../components/online/OnlineLobby';
import { OnlineTable } from '../components/online/OnlineTable';
import { OnlineResults } from '../components/online/OnlineResults';
import { isBackendEnabled, supabase } from '../lib/supabase';
import { useAuth } from '../store/auth';
import { useOnlineRoom } from '../hooks/useOnlineRoom';

const DISPLAY_NAME_KEY = 'poker-online-name';

// Intentionally plain localStorage (not the zustand persist middleware) — this is a single
// string with no version/migration needs, tiny enough not to warrant a store.
function loadStoredName(): string | null {
  try {
    return localStorage.getItem(DISPLAY_NAME_KEY);
  } catch {
    return null;
  }
}

function saveStoredName(name: string): void {
  try {
    localStorage.setItem(DISPLAY_NAME_KEY, name);
  } catch {
    // ignore storage errors (private browsing, quota, etc.)
  }
}

export function Online() {
  // Hooks must run unconditionally (React rules) even though the env-less branch below never
  // uses their values — see docs/ONLINE-VERSUS.md §2 regression guard.
  const auth = useAuth();
  const online = useOnlineRoom();

  const [displayName, setDisplayName] = useState('');
  // Guards the one-time "fill in a sensible default" effect below so it never fights a user who
  // has intentionally cleared the field back to empty.
  const [nameDefaulted, setNameDefaulted] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [guestError, setGuestError] = useState<string | null>(null);
  const [guestBusy, setGuestBusy] = useState(false);

  useEffect(() => {
    if (nameDefaulted || auth.status !== 'signedIn') return;
    const stored = loadStoredName();
    const fallback = auth.email ? auth.email.split('@')[0] : '';
    setDisplayName(stored ?? fallback);
    setNameDefaulted(true);
  }, [auth.status, auth.email, nameDefaulted]);

  const handleDisplayNameChange = (name: string) => {
    setDisplayName(name);
    saveStoredName(name);
  };

  if (!isBackendEnabled) {
    return (
      <Panel title="オンライン対戦">
        <p className="text-sm text-muted">
          オンライン対戦には Supabase の設定が必要です。学習ドリルや vs CPU 対戦はこの設定がなくてもそのまま利用できます。
        </p>
      </Panel>
    );
  }

  if (auth.status === 'loading') {
    return (
      <Panel>
        <p className="text-sm text-muted">読み込み中…</p>
      </Panel>
    );
  }

  if (auth.status !== 'signedIn') {
    const handleGuest = async () => {
      setGuestError(null);
      setGuestBusy(true);
      try {
        if (!supabase) throw new Error('supabase not configured');
        saveStoredName(guestName.trim());
        const { error } = await supabase.auth.signInAnonymously();
        if (error) throw error;
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        if (/anonymous/i.test(detail)) {
          setGuestError(
            'ゲスト参加が無効になっています。部屋の管理者は Supabase Dashboard → Authentication → Sign In / Providers で Anonymous sign-ins を有効化してください。',
          );
        } else {
          setGuestError(`ゲスト参加は現在利用できません（理由: ${detail}）。Google でログインしてください。`);
        }
      } finally {
        setGuestBusy(false);
      }
    };

    return (
      <Panel title="オンライン対戦" subtitle="ログインすると部屋を作成・参加できます">
        <div className="space-y-4">
          <button
            onClick={() => auth.signInWithGoogle()}
            className="w-full rounded-xl bg-gradient-to-b from-accent-bright to-accent px-4 py-2.5 text-sm font-semibold text-[#04221a] shadow-lg shadow-accent/25 transition hover:brightness-110"
          >
            Google でログイン
          </button>

          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-xs text-muted">表示名だけで参加（ゲスト）</p>
            <input
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              placeholder="表示名"
              maxLength={20}
              className="w-full rounded-xl border border-border bg-surface-2/50 px-3 py-2 text-sm outline-none focus:border-accent/50"
            />
            <button
              onClick={handleGuest}
              disabled={guestBusy || !guestName.trim()}
              className="w-full rounded-xl border border-border-bright bg-surface-2 px-4 py-2.5 text-sm font-semibold transition hover:bg-surface-2/80 disabled:cursor-not-allowed disabled:opacity-50"
            >
              ゲストとして参加
            </button>
            {guestError && <p className="text-xs text-danger">{guestError}</p>}
            <p className="text-[11px] text-muted">学習データは端末セッション限りで永続化されません。</p>
          </div>
        </div>
      </Panel>
    );
  }

  // Signed in (Google or anonymous) --------------------------------------------------

  if (!online.roomId) {
    return (
      <OnlineLobby
        mode="pre-room"
        displayName={displayName}
        onDisplayNameChange={handleDisplayNameChange}
        onCreateRoom={online.createRoom}
        onJoinRoom={online.joinRoom}
        storedRoomCode={online.storedRoomCode}
      />
    );
  }

  // A finished tournament always lands here regardless of the exact phase/roomStatus
  // combination — this must never be a dead end.
  if (online.phase === 'finished' || online.roomStatus === 'finished') {
    if (online.tournament) {
      return <OnlineResults tournament={online.tournament} onLeave={online.leaveRoom} />;
    }
    return (
      <Panel>
        <p className="text-sm text-muted">結果を読み込み中…</p>
      </Panel>
    );
  }

  if (online.phase === 'in_hand' || online.phase === 'hand_over') {
    if (online.publicState) {
      return (
        <div className="md:flex md:min-h-[calc(100vh-4rem)] md:flex-col md:justify-center">
          <OnlineTable
            publicState={online.publicState}
            myHole={online.myHole}
            mySeatIndex={online.mySeatIndex}
            isMyTurn={online.isMyTurn}
            legal={online.legal}
            deadlineMs={online.deadlineMs}
            onAction={online.act}
            onSendReaction={online.sendReaction}
            reactions={online.reactions}
            onExpireReaction={online.clearReaction}
            phase={online.phase}
            winnerUids={online.winnerUids}
            onLeave={online.leaveRoom}
            tournament={online.tournament}
            myUid={online.myUid}
            handHistory={online.handHistory}
          />
        </div>
      );
    }
    return (
      <Panel>
        <p className="text-sm text-muted">テーブルを読み込み中…</p>
      </Panel>
    );
  }

  // roomStatus === 'lobby' or phase === 'idle' (including the moment right after entering a room).
  return (
    <OnlineLobby
      mode="in-room"
      roomCode={online.roomCode}
      players={online.players}
      hostUid={online.hostUid}
      isHost={online.isHost}
      roomConfig={online.roomConfig}
      onStartGame={online.startGame}
      onLeave={online.leaveRoom}
    />
  );
}
