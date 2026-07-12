# solverRanges/charts.json

ソルバー由来のプリフロップレンジチャートを格納するデータファイル。

## インポート方法

このファイルを直接手編集しない。データの取り込みは `scripts/solver-ranges/import.mjs` を使う:

```bash
node scripts/solver-ranges/import.mjs <input.json>
```

入力JSONは `meta`（`source` 必須）と `tables` を持つ、このファイルと同じ形式である必要がある。
スクリプトが形式検証を行い、valid な場合のみ `src/data/solverRanges/charts.json` を上書きする。

## 現在の状態（tables が空）

まだデータを取り込んでいないため `tables` は空。この間は以下のフォールバックが適用される:

- vs3bet / vs4bet のプリフロップスポット: `legacy` 表示にフォールバック
- squeeze: vsOpen チャートによる近似にフォールバック

## JSON形状

```jsonc
{
  "meta": {
    "source": "string（必須）",
    "method": "string",
    "generatedAt": "string",
    "stackBB": 100,
    "license": "string（任意）",
    "note": "string（任意）"
  },
  "tables": {
    // キーは SolverRangeKey（例: "RFI_BTN", "VSOPEN_UTG_BTN", "VS3BET_BTN_SB", ...）
    // 値は Range = Record<HandClass, { raise?: number; call?: number; fold?: number }>
  }
}
```

詳細な型定義は `src/core/ranges/solverSeries.ts` を参照。
