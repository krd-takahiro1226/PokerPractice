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
import type { GameState, GameConfig, PlayerAction } from '../core/game/types';
import type { GameMode } from '../core/ranges/mode';
import { useHistory } from '../store/history';
import type { SavedHand } from '../store/history';
import { useBoardReveal } from './useBoardReveal';

export type VersusController = {
  state: GameState;
  legal: LegalActions | null;
  isHeroTurn: boolean;
  heroAct: (action: PlayerAction) => void;
  newHand: () => void;
  difficulty: GameConfig['difficulty'];
  setDifficulty: (d: GameConfig['difficulty']) => void;
  mode: GameMode;
  setMode: (m: GameMode) => void;
  heroRebought: boolean;
  displayBoardCount: number;
  resultRevealed: boolean;
};

const DEFAULT_CONFIG_BASE = {
  startingStack: 100,
  sb: 0.5,
  bb: 1,
};

function anteForMode(mode: GameMode, bb: number): number {
  return mode === 'cash-noante' ? 0 : bb;
}

function makeConfig(difficulty: GameConfig['difficulty'], mode: GameMode): GameConfig {
  return {
    ...DEFAULT_CONFIG_BASE,
    difficulty,
    mode,
    ante: anteForMode(mode, DEFAULT_CONFIG_BASE.bb),
  };
}

function isHandOver(state: GameState): boolean {
  return state.street === 'showdown' && state.result !== null;
}

function needsAdvance(state: GameState): boolean {
  if (isHandOver(state)) return false;
  if (state.toAct !== null) return false;
  return true;
}

export function useVersusGame(): VersusController {
  const [difficulty, setDifficultyState] = useState<GameConfig['difficulty']>('normal');
  const [mode, setModeState] = useState<GameMode>('tournament');
  const [state, setState] = useState<GameState>(() =>
    startHand(null, makeConfig('normal', 'tournament')),
  );
  const addHistory = useHistory((s) => s.add);

  // Pending changes (apply on next hand)
  const pendingDifficulty = useRef<GameConfig['difficulty']>('normal');
  const pendingMode = useRef<GameMode>('tournament');

  const isHeroTurn = state.toAct === 0 && state.street !== 'showdown';
  const legal = isHeroTurn ? legalActions(state, 0) : null;
  const { displayBoardCount, resultRevealed, resetReveal } = useBoardReveal(state);

  // CPU turn processing
  const processingRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleNext = useCallback((currentState: GameState) => {
    if (processingRef.current) return;
    if (isHandOver(currentState)) return;

    // Advance street if betting round is complete
    if (needsAdvance(currentState)) {
      processingRef.current = true;
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        processingRef.current = false;
        setState((prev) => {
          if (needsAdvance(prev)) {
            return advanceStreet(prev);
          }
          return prev;
        });
      }, 200);
      return;
    }

    // CPU's turn
    if (currentState.toAct !== null && currentState.toAct !== 0) {
      const cpuId = currentState.toAct;
      processingRef.current = true;
      const delay = 300 + Math.floor(Math.random() * 300);
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        processingRef.current = false;
        setState((prev) => {
          if (prev.toAct !== cpuId) return prev;
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

  // Save hand when it ends
  const savedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isHandOver(state)) return;
    const handId = `${state.handNumber}`;
    if (savedRef.current === handId) return;
    savedRef.current = handId;

    const hero = state.players[0];
    if (!hero.hole || !state.result) return;

    const heroWin = state.result.winners
      .filter((w) => w.playerId === 0)
      .reduce((s, w) => s + w.amount, 0);
    const heroNet = heroWin - hero.committedTotal;

    const savedHand: SavedHand = {
      id: `${Date.now()}-${state.handNumber}`,
      ts: Date.now(),
      mode: state.config.mode,
      difficulty: state.config.difficulty,
      heroPos: hero.pos,
      heroHole: hero.hole,
      board: state.board,
      log: state.log,
      result: state.result,
      heroNet,
    };

    try {
      addHistory(savedHand);
    } catch {
      // ignore storage errors
    }
  }, [state, addHistory]);

  // Drive the game loop: run after every state change
  useEffect(() => {
    scheduleNext(state);
  }, [state, scheduleNext]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      processingRef.current = false;
    };
  }, []);

  const heroAct = useCallback((action: PlayerAction) => {
    if (state.toAct !== 0) return;
    setState((prev) => {
      if (prev.toAct !== 0) return prev;
      try {
        return applyAction(prev, 0, action);
      } catch {
        return prev;
      }
    });
  }, [state.toAct]);

  const [heroRebought, setHeroRebought] = useState(false);

  const newHand = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    processingRef.current = false;
    savedRef.current = null;
    resetReveal();
    const d = pendingDifficulty.current;
    const m = pendingMode.current;
    const config = makeConfig(d, m);
    const seatStacks = state.players.map((p) => (p.stack <= 0 ? config.startingStack : p.stack));
    setHeroRebought(state.players[0].stack <= 0);
    setState((prev) => startHand(prev, config, seatStacks));
  }, [state, resetReveal]);

  const setDifficulty = useCallback((d: GameConfig['difficulty']) => {
    pendingDifficulty.current = d;
    setDifficultyState(d);
  }, []);

  const setMode = useCallback((m: GameMode) => {
    pendingMode.current = m;
    setModeState(m);
  }, []);

  return {
    state,
    legal,
    isHeroTurn,
    heroAct,
    newHand,
    difficulty,
    setDifficulty,
    mode,
    setMode,
    heroRebought,
    displayBoardCount,
    resultRevealed,
  };
}
