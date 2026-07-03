import { describe, it, expect, beforeEach } from 'vitest';
import { useOnlineStore } from './online';
import type { HandHistoryEntry } from './online';

function makeEntry(handNumber: number): HandHistoryEntry {
  return {
    handNumber,
    board: [],
    winners: [{ displayName: 'Alice', amount: 5 }],
    shown: [],
    log: [],
    players: [{ playerId: 0, displayName: 'Alice', pos: 'BTN', stackAfter: 100 }],
  };
}

describe('useOnlineStore.pushHandHistory', () => {
  beforeEach(() => {
    useOnlineStore.getState().reset();
  });

  it('同一handNumberのエントリは重複して積まれない', () => {
    const store = useOnlineStore.getState();
    store.pushHandHistory(makeEntry(1));
    store.pushHandHistory(makeEntry(1));
    expect(useOnlineStore.getState().handHistory).toHaveLength(1);
  });

  it('50件を超えたら最古のものから落ちる', () => {
    const store = useOnlineStore.getState();
    for (let i = 1; i <= 55; i++) {
      store.pushHandHistory(makeEntry(i));
    }
    const history = useOnlineStore.getState().handHistory;
    expect(history).toHaveLength(50);
    expect(history[0].handNumber).toBe(6);
    expect(history[history.length - 1].handNumber).toBe(55);
  });

  it('resetでhandHistoryが空になる', () => {
    const store = useOnlineStore.getState();
    store.pushHandHistory(makeEntry(1));
    store.reset();
    expect(useOnlineStore.getState().handHistory).toEqual([]);
  });
});
