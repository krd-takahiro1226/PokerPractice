import { useState } from 'react';
import { Panel } from '../Panel';
import { cn } from '../../lib/cn';
import { OnlineClientError } from '../../lib/onlineClient';
import type { TournamentConfigInput } from '../../core/online/tournament';
import type { RoomPlayerRow } from '../../store/online';

const STACK_OPTIONS = [50, 100, 200] as const;

type PreRoomProps = {
  mode: 'pre-room';
  displayName: string;
  onDisplayNameChange: (name: string) => void;
  onCreateRoom: (config: TournamentConfigInput, displayName: string) => Promise<unknown>;
  onJoinRoom: (code: string, displayName: string) => Promise<unknown>;
};

type InRoomProps = {
  mode: 'in-room';
  roomCode: string | null;
  players: RoomPlayerRow[];
  hostUid: string | null;
  isHost: boolean;
  onStartGame: () => Promise<void>;
  onLeave: () => Promise<void>;
};

type OnlineLobbyProps = PreRoomProps | InRoomProps;

function mapError(e: unknown): string {
  if (e instanceof OnlineClientError) {
    switch (e.code) {
      case 'room_not_found':
        return '部屋が見つかりません';
      case 'room_full':
        return '満席です';
      case 'already_started':
        return 'すでに開始しています';
      default:
        return 'エラーが発生しました';
    }
  }
  return 'エラーが発生しました';
}

export function OnlineLobby(props: OnlineLobbyProps) {
  if (props.mode === 'pre-room') return <PreRoomLobby {...props} />;
  return <InRoomLobby {...props} />;
}

function PreRoomLobby({ displayName, onDisplayNameChange, onCreateRoom, onJoinRoom }: PreRoomProps) {
  const [stack, setStack] = useState<number>(100);
  const [code, setCode] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleCreate = async () => {
    setCreateError(null);
    setBusy(true);
    try {
      await onCreateRoom({ startingStack: stack }, displayName.trim());
    } catch (e) {
      setCreateError(mapError(e));
    } finally {
      setBusy(false);
    }
  };

  const handleJoin = async () => {
    setJoinError(null);
    setBusy(true);
    try {
      await onJoinRoom(code.trim().toUpperCase(), displayName.trim());
    } catch (e) {
      setJoinError(mapError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Panel title="表示名">
        <input
          value={displayName}
          onChange={(e) => onDisplayNameChange(e.target.value)}
          placeholder="表示名を入力"
          maxLength={20}
          className="w-full rounded-xl border border-border bg-surface-2/50 px-3 py-2 text-sm outline-none focus:border-accent/50"
        />
      </Panel>

      <Panel title="部屋を作る">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted">初期スタック</span>
            <select
              value={stack}
              onChange={(e) => setStack(Number(e.target.value))}
              className="rounded-lg border border-border bg-surface-2/50 px-2 py-1.5 text-sm outline-none"
            >
              {STACK_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v}bb
                </option>
              ))}
            </select>
          </div>
          {createError && <p className="text-sm text-danger">{createError}</p>}
          <button
            onClick={handleCreate}
            disabled={busy || !displayName.trim()}
            className="w-full rounded-xl bg-gradient-to-b from-accent-bright to-accent px-4 py-2.5 text-sm font-semibold text-[#04221a] shadow-lg shadow-accent/25 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            作成
          </button>
        </div>
      </Panel>

      <Panel title="部屋に参加する">
        <div className="space-y-3">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="6文字の部屋コード"
            maxLength={6}
            className="w-full rounded-xl border border-border bg-surface-2/50 px-3 py-2 text-center font-mono text-lg uppercase tracking-widest outline-none focus:border-accent/50"
          />
          {joinError && <p className="text-sm text-danger">{joinError}</p>}
          <button
            onClick={handleJoin}
            disabled={busy || !displayName.trim() || code.trim().length !== 6}
            className="w-full rounded-xl border border-border-bright bg-surface-2 px-4 py-2.5 text-sm font-semibold text-text transition hover:bg-surface-2/80 disabled:cursor-not-allowed disabled:opacity-50"
          >
            参加
          </button>
        </div>
      </Panel>
    </div>
  );
}

function InRoomLobby({ roomCode, players, hostUid, isHost, onStartGame, onLeave }: InRoomProps) {
  const [copied, setCopied] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleCopy = async () => {
    if (!roomCode) return;
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable (e.g. insecure context) — code is already visible on screen.
    }
  };

  const handleStart = async () => {
    setStartError(null);
    setBusy(true);
    try {
      await onStartGame();
    } catch (e) {
      setStartError(mapError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="ロビー" subtitle="参加者が揃ったらホストが開始します">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-2/40 p-4">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted">部屋コード</div>
            <div className="font-mono text-2xl font-bold tracking-[0.3em] text-accent-bright">{roomCode}</div>
          </div>
          <button
            onClick={handleCopy}
            className="rounded-lg border border-border-bright bg-surface-2 px-3 py-1.5 text-xs font-semibold transition hover:bg-surface-2/80"
          >
            {copied ? 'コピーしました' : 'コピー'}
          </button>
        </div>

        <div className="space-y-1.5">
          {players.map((p) => (
            <div
              key={p.uid}
              className="flex items-center justify-between rounded-lg border border-border bg-surface-2/30 px-3 py-2 text-sm"
            >
              <div className="flex items-center gap-2">
                <span className={cn('h-2 w-2 rounded-full', p.connected ? 'bg-call' : 'bg-muted/50')} />
                <span>{p.display_name}</span>
                {p.uid === hostUid && (
                  <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent-bright">
                    ホスト
                  </span>
                )}
              </div>
              <span className="text-xs text-muted">Seat {p.seat + 1}</span>
            </div>
          ))}
        </div>

        {startError && <p className="text-sm text-danger">{startError}</p>}

        <div className="flex gap-2">
          {isHost && (
            <button
              onClick={handleStart}
              disabled={busy || players.length < 2}
              className="flex-1 rounded-xl bg-gradient-to-b from-accent-bright to-accent px-4 py-2.5 text-sm font-semibold text-[#04221a] shadow-lg shadow-accent/25 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              開始
            </button>
          )}
          <button
            onClick={onLeave}
            className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-2.5 text-sm font-semibold text-danger transition hover:bg-danger/20"
          >
            退出
          </button>
        </div>
      </div>
    </Panel>
  );
}
