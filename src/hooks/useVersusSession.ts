import { useCallback, useEffect, useRef, useState } from 'react';
import {
  startHand,
  legalActions,
  applyAction,
  advanceStreet,
  isBettingRoundComplete,
  resolveShowdown,
  type LegalActions,
} from '../core/game/engine';
import { decideCpu } from '../core/ai';
import type { GameState, PlayerAction } from '../core/game/types';
import {
  startSession,
  configForHand,
  commitHandResult,
  canContinue,
  pruneBustedSeats,
  type SessionConfig,
  type SessionState,
} from '../core/game/session';
import { useHistory } from '../store/history';
import { useSessions } from '../store/sessions';
import type { SavedHand } from '../store/history';
import type { ActiveSession } from '../store/sessions';

export type VersusSessionController = {
  session: SessionState;
  game: GameState;
  legal: LegalActions | null;
  isHeroTurn: boolean;
  heroAct: (action: PlayerAction) => void;
  nextHand: () => void;
  quit: () => void;
  pause: () => void;
  start: (config: SessionConfig) => void;
  resume: (saved: ActiveSession) => void;
  sessionId: string | null;
};

function isHandOver(game: GameState): boolean {
  return game.street === 'showdown' && game.result !== null;
}

function needsAdvance(game: GameState): boolean {
  if (isHandOver(game)) return false;
  if (game.toAct !== null) return false;
  return true;
}

export function useVersusSession(): VersusSessionController {
  const addHistory = useHistory((s) => s.add);
  const { createSession, finishSession, saveActiveSession, clearActiveSession } = useSessions();

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<SessionState>(() => {
    const defaultConfig: SessionConfig = {
      format: 'tournament',
      mode: 'tournament',
      difficulty: 'normal',
      startingStack: 100,
      blindLevels: [],
      handsPerLevel: 10,
    };
    return startSession(defaultConfig);
  });

  const [game, setGame] = useState<GameState | null>(null);

  // ゲームループ制御
  const processingRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedRef = useRef<string | null>(null);
  const sessionRef = useRef<SessionState>(session);
  const sessionIdRef = useRef<string | null>(null);

  // session の最新を ref に同期
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const isHeroTurn = game !== null && game.toAct === 0 && game.street !== 'showdown';
  const legal = isHeroTurn && game !== null ? legalActions(game, 0) : null;

  const scheduleNext = useCallback((currentGame: GameState) => {
    if (processingRef.current) return;
    if (isHandOver(currentGame)) return;

    if (needsAdvance(currentGame)) {
      processingRef.current = true;
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        processingRef.current = false;
        setGame((prev) => {
          if (prev === null || !needsAdvance(prev)) return prev;
          return advanceStreet(prev);
        });
      }, 200);
      return;
    }

    if (currentGame.toAct !== null && currentGame.toAct !== 0) {
      const cpuId = currentGame.toAct;
      processingRef.current = true;
      const delay = 300 + Math.floor(Math.random() * 300);
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        processingRef.current = false;
        setGame((prev) => {
          if (prev === null || prev.toAct !== cpuId) return prev;
          try {
            const action = decideCpu(prev, cpuId);
            return applyAction(prev, cpuId, action);
          } catch {
            return prev;
          }
        });
      }, delay);
    }
  }, []);

  // ハンド保存
  useEffect(() => {
    if (game === null || !isHandOver(game)) return;
    const handId = `sess-${game.handNumber}`;
    if (savedRef.current === handId) return;
    savedRef.current = handId;

    const hero = game.players[0];
    if (!hero.hole || !game.result) return;

    const heroWin = game.result.winners
      .filter((w) => w.playerId === 0)
      .reduce((s, w) => s + w.amount, 0);
    const heroNet = heroWin - hero.committedTotal;

    const savedHand: SavedHand = {
      id: `${Date.now()}-sess-${game.handNumber}`,
      ts: Date.now(),
      mode: game.config.mode,
      difficulty: game.config.difficulty,
      heroPos: hero.pos,
      heroHole: hero.hole,
      board: game.board,
      log: game.log,
      result: game.result,
      heroNet,
    };

    try {
      addHistory(savedHand);
    } catch {
      // ignore storage errors
    }

    // セッション状態を更新
    const currentSession = sessionRef.current;
    const nextSession = commitHandResult(currentSession, game);
    setSession(nextSession);

    // セッション終了チェック
    const sid = sessionIdRef.current;
    if (!canContinue(nextSession)) {
      // DB/localStorage に終了記録を保存
      if (sid) {
        finishSession(sid, {
          result: nextSession.status as 'bust' | 'win' | 'quit',
          handsPlayed: nextSession.handNumber,
          stackCurve: nextSession.stackCurve,
        }).catch(() => {});
      }
      clearActiveSession();
    } else if (sid) {
      saveActiveSession(sid, nextSession);
    }
  }, [game, addHistory, finishSession, saveActiveSession, clearActiveSession]);

  // ゲームループドライバー
  useEffect(() => {
    if (game === null) return;
    scheduleNext(game);
  }, [game, scheduleNext]);

  // アンマウント時クリーンアップ
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      processingRef.current = false;
    };
  }, []);

  const start = useCallback((config: SessionConfig) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    processingRef.current = false;
    savedRef.current = null;

    const newSession = startSession(config);
    setSession(newSession);
    sessionRef.current = newSession;

    const handConfig = configForHand(newSession);
    const newGame = startHand(null, handConfig, newSession.seatStacks);
    setGame(newGame);

    // localStorage/DB にセッション開始を記録
    createSession({
      format: config.format,
      mode: config.mode,
      difficulty: config.difficulty,
      startingStack: config.startingStack,
    }).then((id) => {
      setSessionId(id);
      sessionIdRef.current = id;
      saveActiveSession(id, newSession);
    }).catch(() => {});
  }, [createSession, saveActiveSession]);

  const nextHand = useCallback(() => {
    const currentSession = sessionRef.current;
    if (!canContinue(currentSession)) return;

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    processingRef.current = false;
    savedRef.current = null;

    setGame((prev) => {
      const handConfig = configForHand(currentSession);
      return startHand(prev, handConfig, currentSession.seatStacks);
    });
  }, []);

  const quit = useCallback(() => {
    const currentSession = sessionRef.current;
    const nextSession: SessionState = { ...currentSession, status: 'quit' };
    setSession(nextSession);
    sessionRef.current = nextSession;

    const sid = sessionIdRef.current;
    if (sid) {
      finishSession(sid, {
        result: 'quit',
        handsPlayed: nextSession.handNumber,
        stackCurve: nextSession.stackCurve,
      }).catch(() => {});
    }
    clearActiveSession();
  }, [finishSession, clearActiveSession]);

  const pause = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    processingRef.current = false;
    setGame(null);
  }, []);

  const heroAct = useCallback((action: PlayerAction) => {
    setGame((prev) => {
      if (prev === null || prev.toAct !== 0) return prev;
      try {
        return applyAction(prev, 0, action);
      } catch {
        return prev;
      }
    });
  }, []);

  const resume = useCallback((saved: ActiveSession) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    processingRef.current = false;
    savedRef.current = null;

    // ゾンビ席除外の導入前に保存されたセッションは stack 0 の席を含みうる。
    // そのまま startHand に渡すと SB/BB の stack<=0 検出で throw するため復元時に除外する。
    const state = { ...saved.state, seatStacks: pruneBustedSeats(saved.state.seatStacks) };
    setSession(state);
    sessionRef.current = state;
    setSessionId(saved.recordId);
    sessionIdRef.current = saved.recordId;

    const handConfig = configForHand(state);
    const newGame = startHand(null, handConfig, state.seatStacks);
    setGame(newGame);
  }, []);

  return {
    session,
    game: game ?? ((() => {
      // 未開始状態のダミーゲームを返す（start() が呼ばれるまで）
      // 実際には start() を呼ぶ前に game を参照しない設計だが、型を満たすために用意
      return startHand(null, {
        difficulty: 'normal',
        mode: 'tournament',
        startingStack: 100,
        sb: 0.5,
        bb: 1,
        ante: 0,
      });
    })()),
    legal,
    isHeroTurn,
    heroAct,
    nextHand,
    quit,
    pause,
    start,
    resume,
    sessionId,
  };
}
