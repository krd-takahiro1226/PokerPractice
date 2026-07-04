import { describe, it, expect } from 'vitest';
import { classifyStrength } from './handStrength';
import type { Card } from '../cards';

describe('classifyStrength - detectStraightDraw (CORE-1)', () => {
  it('ボード単独の4連番テクスチャはヒーローのドローとして誤検知しない', () => {
    // ボード 4-5-6-7 は誰でも3か8でストレートになるテクスチャだが、
    // ヒーローの 22 はそのストレート成立に一切寄与しない
    const result = classifyStrength(['2s', '2h'], ['4s', '5d', '6h', '7c']);
    expect(result.draw).toBe('none');
  });

  it('ヒーローのホールカードが実際に寄与するOESDは引き続き検出される', () => {
    // ヒーロー 8,9 + ボード 6,7 → 5 or T で OESD
    const result = classifyStrength(['8h', '9h'], ['6s', '7c', '2d']);
    expect(result.draw).toBe('oesd');
  });

  it('ヒーローのホールカードが実際に寄与するガットショット系ドローも none にはならない', () => {
    // ヒーロー 5,9 + ボード 6,7 → 8 で完成するガットショット（8を含む一直線の一部をヒーローが保持）
    const result: { draw: string } = classifyStrength(['5h', '9h'], ['6s', '7c', '2d']);
    expect(result.draw).not.toBe('none');
  });

  it('フラッシュドローはボード起因誤検知の対象外（従来通り検出される）', () => {
    const result = classifyStrength(['As', 'Ks'], ['2s', '7s', '9d']);
    expect(['flush-draw', 'combo-draw']).toContain(result.draw);
  });
});

describe('classifyStrength - classifyMade trips (UI-3)', () => {
  it('ポケットペアでボードにヒットしたセットは made=set', () => {
    const result = classifyStrength(['7s', '7h'], ['7d', '2c', '9h']);
    expect(result.made).toBe('set');
  });

  it('ボードペア由来のトリップスは made=trips（two-pairに誤分類しない）', () => {
    // ボードが 9-9 のペアを含み、ヒーローの片方のホールカードがそのランクとマッチしてトリップス
    const result = classifyStrength(['9s', '2h'], ['9d', '9c', '3h']);
    expect(result.made).toBe('trips');
  });
});

describe('classifyStrength - 基本ケース', () => {
  const board: Card[] = ['4s', '5d', '6h'];
  it('ハイカードは made=air', () => {
    const result = classifyStrength(['As', 'Kc'], board);
    expect(result.made).toBe('air');
  });
});
