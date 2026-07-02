import { describe, it, expect } from 'vitest';
import { startHand, applyAction, advanceStreet } from '../game/engine';
import type { GameConfig, GameState } from '../game/types';
import { toPublicState } from './publicState';

function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0x100000000;
  };
}

const DEFAULT_CONFIG: GameConfig = {
  difficulty: 'normal',
  mode: 'tournament',
  startingStack: 100,
  sb: 0.5,
  bb: 1,
  ante: 0,
  rng: makeRng(42),
};

function freshConfig(seed = 42): GameConfig {
  return { ...DEFAULT_CONFIG, rng: makeRng(seed) };
}

describe('toPublicState', () => {
  it('mid-hand: all holes are hidden in the projection even though raw state has holes', () => {
    const state = startHand(null, freshConfig(), [100, 100, 100, 100, 100, 100]);
    expect(state.players.every((p) => p.hole !== null)).toBe(true);

    const seatUids = ['u0', 'u1', 'u2', 'u3', 'u4', 'u5'];
    const names: Record<string, string> = {};
    const publicState = toPublicState(state, seatUids, names);

    expect(publicState.players.every((p) => p.hole === null)).toBe(true);
  });

  it('after HU all-in showdown: only players in result.shown have revealed holes matching shown entries', () => {
    // HU: after seat 0 shoves, only seat 1 remains 'active' so the engine already
    // marks the betting round complete (toAct=null) — a second applyAction call
    // for seat 1 would throw "not your turn", so one shove is enough to drive
    // this straight to showdown via advanceStreet.
    let state: GameState = startHand(null, freshConfig(), [100, 100]);
    state = applyAction(state, 0, { type: 'allin' });

    let iterations = 0;
    while (state.street !== 'showdown' && iterations < 10) {
      state = advanceStreet(state);
      iterations += 1;
    }

    expect(state.street).toBe('showdown');
    expect(state.result).not.toBeNull();

    const seatUids = ['u0', 'u1'];
    const names: Record<string, string> = { u0: 'Alice', u1: 'Bob' };
    const publicState = toPublicState(state, seatUids, names);

    const shownIds = new Set(state.result!.shown.map((s) => s.playerId));
    expect(shownIds.size).toBe(2);

    for (const player of publicState.players) {
      if (shownIds.has(player.id)) {
        const shownEntry = state.result!.shown.find((s) => s.playerId === player.id)!;
        expect(player.hole).toEqual(shownEntry.hole);
      } else {
        expect(player.hole).toBeNull();
      }
    }
  });

  it('does not have a deck property at all', () => {
    const state = startHand(null, freshConfig());
    const publicState = toPublicState(state, ['u0', 'u1', 'u2', 'u3', 'u4', 'u5'], {});

    expect(Object.prototype.hasOwnProperty.call(publicState, 'deck')).toBe(false);
  });

  it('forces isHero to false for every player, including the underlying hero seat', () => {
    const state = startHand(null, freshConfig());
    expect(state.players[0].isHero).toBe(true);

    const publicState = toPublicState(state, ['u0', 'u1', 'u2', 'u3', 'u4', 'u5'], {});
    expect(publicState.players[0].isHero).toBe(false);
    expect(publicState.players.every((p) => p.isHero === false)).toBe(true);
  });

  it('attaches uid/displayName per seat from seatUids/names inputs', () => {
    const state = startHand(null, freshConfig());
    const seatUids = ['uid-a', 'uid-b', 'uid-c', 'uid-d', 'uid-e', 'uid-f'];
    const names: Record<string, string> = {
      'uid-a': 'Alice',
      'uid-b': 'Bob',
      'uid-c': 'Carol',
      'uid-d': 'Dave',
      'uid-e': 'Eve',
      'uid-f': 'Frank',
    };

    const publicState = toPublicState(state, seatUids, names);

    for (let i = 0; i < seatUids.length; i += 1) {
      expect(publicState.players[i].uid).toBe(seatUids[i]);
      expect(publicState.players[i].displayName).toBe(names[seatUids[i]]);
    }
  });
});
