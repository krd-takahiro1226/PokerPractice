import { useLayoutEffect, useRef, useState } from 'react';
import type { GameState } from '../core/game/types';

// 全員オールインで一気にランアウトした際、ボード5枚+結果が同一 state で届く。
// 実際のディーラーがカードを1枚ずつ置く進行を模すため、フック側で段階的に表示する。
const REVEAL_STEP_MS = 900;

export type BoardReveal = {
  displayBoardCount: number;
  resultRevealed: boolean;
  resetReveal: () => void;
};

function isHandOver(state: GameState | null): boolean {
  return state !== null && state.street === 'showdown' && state.result !== null;
}

export function useBoardReveal(state: GameState | null): BoardReveal {
  const [displayBoardCount, setDisplayBoardCount] = useState(state?.board.length ?? 0);
  const [resultRevealed, setResultRevealed] = useState(true);
  const prevBoardCountRef = useRef(state?.board.length ?? 0);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  };

  // レイアウトエフェクトで実行し、結果バナーが1フレームでも先に見えてしまうのを防ぐ
  useLayoutEffect(() => {
    clearTimers();

    if (state === null) {
      prevBoardCountRef.current = 0;
      setDisplayBoardCount(0);
      setResultRevealed(true);
      return clearTimers;
    }

    const prevCount = prevBoardCountRef.current;
    const reachedShowdown = (state.result?.shown.length ?? 0) >= 2;
    const shouldStageReveal =
      isHandOver(state) && reachedShowdown && prevCount < 5 && state.board.length === 5;

    if (shouldStageReveal) {
      setDisplayBoardCount(prevCount);
      setResultRevealed(false);

      let delay = 0;
      for (let target = Math.max(3, prevCount + 1); target <= 5; target++) {
        delay += REVEAL_STEP_MS;
        const count = target;
        timersRef.current.push(setTimeout(() => setDisplayBoardCount(count), delay));
      }
      delay += REVEAL_STEP_MS;
      timersRef.current.push(setTimeout(() => setResultRevealed(true), delay));
    } else {
      setDisplayBoardCount(state.board.length);
      setResultRevealed(true);
    }

    prevBoardCountRef.current = state.board.length;
    return clearTimers;
  }, [state]);

  const resetReveal = () => {
    clearTimers();
    prevBoardCountRef.current = 0;
    setDisplayBoardCount(0);
    setResultRevealed(true);
  };

  return { displayBoardCount, resultRevealed, resetReveal };
}
