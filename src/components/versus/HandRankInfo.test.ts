import { describe, it, expect } from 'vitest';
import { handRankSummary } from './HandRankInfo';
import type { Card } from '../../core/cards';

describe('handRankSummary', () => {
  it('プリフロップ・ポケットペアはワンペア扱い', () => {
    const summary = handRankSummary(['Ks', 'Kd'] as [Card, Card], []);
    expect(summary.categoryName).toBe('ワンペア');
    expect(summary.detailLabel).toBeNull();
  });

  it('プリフロップ・非ペアはハイカード扱い', () => {
    const summary = handRankSummary(['As', 'Kd'] as [Card, Card], []);
    expect(summary.categoryName).toBe('ハイカード');
    expect(summary.detailLabel).toBeNull();
  });

  it('フロップでトップペアを検出する', () => {
    const summary = handRankSummary(
      ['As', '7d'] as [Card, Card],
      ['Ah', '4c', '2s'] as Card[],
    );
    expect(summary.categoryName).toBe('ワンペア');
    expect(summary.detailLabel).toBe('トップペア');
  });

  it('A ハイのストレートフラッシュはロイヤルストレートフラッシュと表示する', () => {
    const summary = handRankSummary(
      ['As', 'Ks'] as [Card, Card],
      ['Qs', 'Js', 'Ts'] as Card[],
    );
    expect(summary.categoryName).toBe('ロイヤルストレートフラッシュ');
  });

  it('A ハイでないストレートフラッシュはロイヤル扱いしない', () => {
    const summary = handRankSummary(
      ['9s', '8s'] as [Card, Card],
      ['7s', '6s', '5s'] as Card[],
    );
    expect(summary.categoryName).toBe('ストレートフラッシュ');
  });

  it('フラッシュ完成時は役名とmadeの重複を省略する', () => {
    const summary = handRankSummary(
      ['As', 'Ks'] as [Card, Card],
      ['Js', '9s', '2s', '3h', '4d'] as Card[],
    );
    expect(summary.categoryName).toBe('フラッシュ');
    expect(summary.detailLabel).toBeNull();
    expect(summary.filledBars).toBeGreaterThanOrEqual(4);
  });

  it('ボードペア由来のトリップスは「スリーカード」と表示され「ツーペア」と矛盾しない (UI-3)', () => {
    // ボードの 9-9 ペア + ヒーローの片方の9でトリップス（セットではない）
    const summary = handRankSummary(
      ['9s', '2h'] as [Card, Card],
      ['9d', '9c', '3h'] as Card[],
    );
    expect(summary.categoryName).toBe('スリーカード');
    expect(summary.detailLabel).not.toBe('ツーペア');
  });

  it('ポケットペアがボードにヒットしたセットは「セット」の詳細ラベルが付く', () => {
    const summary = handRankSummary(
      ['7s', '7h'] as [Card, Card],
      ['7d', '2c', '9h'] as Card[],
    );
    expect(summary.categoryName).toBe('スリーカード');
    expect(summary.detailLabel).toBe('セット');
  });
});
