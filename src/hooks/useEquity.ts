import { useCallback, useEffect, useRef, useState } from 'react';
import type { EquityResult } from '../core/equity';
import type { EquityRequest, EquityResponse } from '../workers/equity.worker';

export function useEquity() {
  const workerRef = useRef<Worker | null>(null);
  const idRef = useRef(0);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<EquityResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const worker = new Worker(new URL('../workers/equity.worker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;
    worker.onmessage = (e: MessageEvent<EquityResponse>) => {
      const msg = e.data;
      if (msg.id !== String(idRef.current)) return;
      if (msg.type === 'progress') {
        setProgress(msg.total === 0 ? 1 : msg.done / msg.total);
      } else if (msg.type === 'done') {
        setResult(msg.result);
        setProgress(1);
        setRunning(false);
      } else if (msg.type === 'error') {
        setError(msg.message);
        setRunning(false);
      }
    };
    return () => worker.terminate();
  }, []);

  const run = useCallback((hands: string[][], board: string[], iterations: number) => {
    if (!workerRef.current) return;
    const id = String(++idRef.current);
    setRunning(true);
    setProgress(0);
    setResult(null);
    setError(null);
    workerRef.current.postMessage({ id, hands, board, iterations } satisfies EquityRequest);
  }, []);

  return { run, running, progress, result, error };
}
