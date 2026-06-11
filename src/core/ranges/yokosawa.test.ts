import { describe, it, expect } from 'vitest';
import { ALL_HAND_CLASSES } from '../handNotation';
import { TIER1, TIER2, TIER3, TIER4, TIER5, TIER6, TIER7, BB_CALL, TIERS } from './yokosawa';

describe('yokosawa ティアデータ正当性', () => {
  const allTiers = [...TIER1, ...TIER2, ...TIER3, ...TIER4, ...TIER5, ...TIER6, ...TIER7, ...BB_CALL];

  it('全要素が有効な HandClass である', () => {
    const validSet = new Set(ALL_HAND_CLASSES);
    for (const h of allTiers) {
      expect(validSet.has(h), `"${h}" は有効な HandClass でない`).toBe(true);
    }
  });

  it('全ティア・bbCall 間で重複がない', () => {
    const seen = new Set<string>();
    for (const h of allTiers) {
      expect(seen.has(h), `"${h}" が複数のティアに存在する`).toBe(false);
      seen.add(h);
    }
  });

  it('各ティアの件数が ground truth と一致する', () => {
    expect(TIER1).toHaveLength(6);
    expect(TIER2).toHaveLength(7);
    expect(TIER3).toHaveLength(10);
    expect(TIER4).toHaveLength(14);
    expect(TIER5).toHaveLength(10);
    expect(TIER6).toHaveLength(22);
    expect(TIER7).toHaveLength(13);
    expect(BB_CALL).toHaveLength(27);
  });

  it('TIERS 配列の長さは 7', () => {
    expect(TIERS).toHaveLength(7);
  });
});
