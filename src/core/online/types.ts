import type { GameState, PlayerState } from '../game/types';

/** 公開席: hole は自分/公開分以外 null。uid/displayName を付与、deck は持たない。 */
export type PublicPlayer = Omit<PlayerState, 'hole'> & {
  uid: string;
  displayName: string;
  hole: PlayerState['hole'];   // null unless revealed at showdown
};

export type PublicGameState = Omit<GameState, 'players' | 'deck'> & {
  players: PublicPlayer[];     // seatIndex 順（= engine の players 順）
  // deck は意図的に除外
};
