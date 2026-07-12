import { describe, it, expect } from 'vitest';
import { makeDeck } from '../cards';
import type { Card } from '../cards';
import { canonicalFlop, spotQueryKey, sprBucketOf, type SpotQuery } from './types';

describe('canonicalFlop: スート同型除去の凍結', () => {
  it('スート置換に対して不変（同型フロップは同一キー）', () => {
    // レインボー AK7: スートの割当が違っても同型
    expect(canonicalFlop(['As', 'Kh', '7d'])).toBe(canonicalFlop(['Ah', 'Kd', '7c']));
    // モノトーン
    expect(canonicalFlop(['As', 'Ks', '7s'])).toBe(canonicalFlop(['Ah', 'Kh', '7h']));
    // トゥートーン（AK同スート・7別）
    expect(canonicalFlop(['As', 'Ks', '7h'])).toBe(canonicalFlop(['Ad', 'Kd', '7c']));
  });

  it('異なるテクスチャは別キー', () => {
    const rainbow = canonicalFlop(['As', 'Kh', '7d']);
    const twoTone = canonicalFlop(['As', 'Ks', '7h']);
    const mono = canonicalFlop(['As', 'Ks', '7s']);
    expect(new Set([rainbow, twoTone, mono]).size).toBe(3);
  });

  it('カード順に依存しない', () => {
    expect(canonicalFlop(['7d', 'As', 'Kh'])).toBe(canonicalFlop(['As', 'Kh', '7d']));
  });

  it('代表元の文字列を凍結する（DB世代を守る）', () => {
    // ランク降順・全スート置換のうち辞書順最小の形（ASCII で c<d<h<s）
    expect(canonicalFlop(['Ah', 'Kd', '7c'])).toBe('AcKd7h');
    expect(canonicalFlop(['Ah', 'Kh', '7h'])).toBe('AcKc7c');
    expect(canonicalFlop(['2c', '2d', '5h'])).toBe('5c2h2d');
    expect(canonicalFlop(['As', 'Ks', '7h'])).toBe('AcKc7d');
  });

  it('C(52,3) 全フロップが 1,755 個の正規形に収束する', () => {
    const deck = makeDeck();
    const set = new Set<string>();
    for (let i = 0; i < deck.length; i++) {
      for (let j = i + 1; j < deck.length; j++) {
        for (let k = j + 1; k < deck.length; k++) {
          set.add(canonicalFlop([deck[i], deck[j], deck[k]] as [Card, Card, Card]));
        }
      }
    }
    expect(set.size).toBe(1755);
  });
});

describe('spotQueryKey: 直列化形式の凍結', () => {
  it('preflop キー', () => {
    const q: SpotQuery = {
      street: 'preflop',
      players: 3,
      potType: 'srp',
      heroPos: 'BTN',
      ip: false,
      line: '',
      sprBucket: 'gt6',
      handClass: 'AKs',
    };
    expect(spotQueryKey(q)).toBe('preflop|3|srp|BTN|-|oop||gt6|-|AKs');
  });

  it('postflop HU キー', () => {
    const q: SpotQuery = {
      street: 'turn',
      players: 2,
      potType: 'srp',
      heroPos: 'BTN',
      villainPos: 'BB',
      ip: true,
      line: 'x-b66',
      sprBucket: '1to3',
      flopIso: 'AsKh7d',
      handClass: 'QQ',
    };
    expect(spotQueryKey(q)).toBe('turn|2|srp|BTN|BB|ip|x-b66|1to3|AsKh7d|QQ');
  });
});

describe('sprBucketOf', () => {
  it('境界値', () => {
    expect(sprBucketOf(null)).toBe('gt6');
    expect(sprBucketOf(1)).toBe('le1');
    expect(sprBucketOf(1.01)).toBe('1to3');
    expect(sprBucketOf(3)).toBe('1to3');
    expect(sprBucketOf(6)).toBe('3to6');
    expect(sprBucketOf(6.01)).toBe('gt6');
  });
});
