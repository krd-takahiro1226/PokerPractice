# flop プリソルブ生成パイプライン

`public/presolve/<config>/<flopIso>.json` を生成するオフラインバッチ
（docs/SOLVER-REVIEW-DESIGN.md §12.2）。ソルバーは
[TexasSolver](https://github.com/bupticybee/TexasSolver)（console ブランチ, **AGPL-3.0**）を
ローカルビルドして使う。

## ライセンス注記

- TexasSolver 本体（AGPL-3.0）は**リポジトリに同梱しない**。クローン・ビルド成果物は
  リポジトリ外（例 `~/tools/TexasSolver`）に置くこと。
- 同梱するのはソルバーが出力した**生成データ（JSON）のみ**。生成物はツールの
  ライセンス対象外であり、AGPL はアプリ本体に伝播しない。

## TexasSolver のビルド（macOS）

```bash
cd ~/tools
git clone -b console https://github.com/bupticybee/TexasSolver.git
cd TexasSolver
```

1. **pybind11 の無効化**: console ビルドに Python バインディングは不要。
   `CMakeLists.txt` の pybind11 関連（`add_subdirectory(ext/pybind11)` と
   `pybind11_add_module` のターゲット）をコメントアウトする。
2. **OpenMP（AppleClang + libomp）**: macOS 標準の AppleClang は `-fopenmp` を
   自前解決できないため、Homebrew の libomp を入れて cmake にヒントを渡す:

```bash
brew install libomp
cd ~/tools/TexasSolver
mkdir -p build && cd build
cmake .. \
  -DCMAKE_BUILD_TYPE=Release \
  -DOpenMP_CXX_FLAGS="-Xpreprocessor -fopenmp -I$(brew --prefix libomp)/include" \
  -DOpenMP_CXX_LIB_NAMES="omp" \
  -DOpenMP_omp_LIBRARY="$(brew --prefix libomp)/lib/libomp.dylib"
make console_solver -j4
```

ビルド成果物: `~/tools/TexasSolver/build/console_solver`。
動作確認: `./console_solver -i <input.txt> -r ../resources`

## バッチ実行

```bash
# スターター6枚（代表テクスチャ）
npm run presolve:batch -- --config srp-btn-bb --starter

# フル 1,755 枚（夜間実行推奨。下記参照）
npm run presolve:batch -- --config srp-btn-bb --all

# オプション
#   --limit N        今回の実行で新規に解く flop 数の上限（分割実行用）
#   --solver <path>  console_solver のパス（既定 ~/tools/TexasSolver/build/console_solver）
#   --resources <path>  リソースディレクトリ（既定 ~/tools/TexasSolver/resources）
```

- **resume 可能**: 出力済み（`public/presolve/srp-btn-bb/<flopIso>.json` が存在する）flop は
  スキップする。中断してもそのまま再実行すれば続きから処理される。
- **直列実行**: メモリ制約（8GB 級）のためソルバーは1プロセスずつ実行する。並列化しないこと。
- 各 flop の最終 exploitability が **1.0% (of pot) を超えた場合は出力しない**
  （max_iteration 300 で1回だけリトライ）。失敗 flop はログに出るので個別に再調整する。
- `meta.json` に構成・入力レンジ・ツリー・ツールコミット・各 flop の精度と日時が記録される。

### フル 1,755 枚の夜間実行

1枚あたり数分〜10分程度（マシン性能に依存）。全量では数日規模になるため:

```bash
# 例: 夜間に回して朝に止める（resume 前提）
nohup npm run presolve:batch -- --config srp-btn-bb --all > presolve-night.log 2>&1 &
# 翌朝: プロセスを止めても出力済み分は保存されている。再開は同じコマンドを再実行
```

`--limit N` で「今夜は N 枚だけ」のような分割もできる。

## 構成

- `configs/srp-btn-bb.ts` — スターター構成: SRP BTN(IP, RFI raise レンジ) vs
  BB(OOP, vsOpen call レンジ)、cash-noante 100bb、pot 5.5bb / eff 97.5bb（sprBucket 'gt6'）。
  入力は bb×10 の整数スケール（set_pot 55 / set_effective_stack 975）。
  ツリー: flop bet {33,75}% + raise {60}% + allin / **turn・river は bet {75}% + allin のみ
  （raise なし）**、allin threshold 0.3。
  **意図的な品質妥協（逸脱・meta の notes に記録）**: 当初計画
  （turn/river raise 60・threshold 0.67・accuracy 0.5・maxIter 120）は SPR 17.7 の木では
  収束不能だった（実測 40反復 3,083秒 / exploitability 10.8%・8コア8GB Mac）ため、
  turn/river の raise 削除と threshold 0.3 で木を縮小し、accuracy 0.9 / maxIter 150 とした。
  exploitability ゲート 1.0% pot は維持（超過 flop は出力しない）。
- `flops.ts` — canonical flop 1,755 枚の列挙と同梱スターター6枚
  （残りテクスチャは夜間バッチに委ねる）。
- `parse.ts` — dump JSON → line ノード抽出 → 169 handClass 集計。
  金額規約（BET/RAISE ラベル = 追加投入額）はテストで凍結済み。
- `solverIO.ts` — 入力 txt 生成・console_solver 実行。
- `run-batch.ts` — バッチ CLI 本体（resume・失敗リトライ・meta 更新）。

レンジ・flop 正規化は `src/core/` から直接 import しており、重複実装はない。
