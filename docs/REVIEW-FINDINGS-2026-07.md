# コードレビュー結果 — 2026-07-04

Fable5 による監査 + Sonnet サブエージェント3体(オンライン対戦 / コアロジック / UI・ページ)のレビューを統合したもの。
**このドキュメントは修正セッションへの引き継ぎ資料。** レビュー時点のワーキングツリー(未コミット変更含む)が対象。

## 現状ステータス

- `npm run test`: 全25ファイル・277テスト成功
- `npm run build`: 成功(型エラーなし。チャンクサイズ警告 675kB のみ)
- `src/core/` と `supabase/functions/_shared/core/` の同期: 差分はヘッダ・importパス変換のみで**同期済み**

## 修正セッションへの注意事項

- `src/core/ranges/yokosawa.ts` は手修正済み ground truth。**変更禁止**
- `src/core/` 配下を修正したら **必ず `npm run sync:functions` を実行**して supabase 側に反映すること
- CLAUDE.md のモデル分担ポリシーに従い、実装は Sonnet サブエージェントへ委譲を推奨
- 「検証」欄: ✅=Fable5がソース裏取り済み / ▶=エージェントが実行して再現確認済み / ⚠=要確認(推測含む)

## 推奨修正順序

1. **高**の4件(ON-1, ON-2, CORE-1, CORE-2)— チップ整合性・アプリ中核機能の信頼性に直結
2. **中**のうちユーザーが日常的に踏むもの(UI-1, UI-2, UI-3, ON-4)
3. 残りの中・低は余力に応じて

---

## 高

### ON-1. `player_action` の bet/raise `amount` がサーバー側で未検証 ✅

- 場所: `supabase/functions/_shared/rooms.ts` の `playerAction`(434行付近)、`src/core/game/engine.ts` の `applyAction` bet/raise ケース(312-360行付近)
- 内容: `playerAction` は `move.type` が legalActions のフラグに合致するかだけを検証し、`move.amount` の値域を一切見ずに `applyAction` へ渡す。`applyAction` 側も `additional = Math.min(betTo - p.committedStreet, p.stack)` で上限クランプのみ。負数・NaN・Infinity の `amount` を直接 Edge Function に送ると `additional` が負になり `p.stack -= additional` でスタック増加、pot がマイナス等、チップ経済が壊れる。設計書(docs/ONLINE-VERSUS.md §6.2)は「clampして再検証」を要求しているが未実装。通常UIは正しくクランプ済みの値を送るため、発現は直接API呼び出しのみ。
- 修正の方向性: `playerAction` 内で bet/raise の `amount` を `legal.minBetTo`〜`maxBetTo` で検証(範囲外・非有限数は `illegal_action`)。加えて `applyAction` 側にも防御的な下限ガードを入れると堅い。

### ON-2. ハンド中の `leave_room` で離脱者の勝ち分チップが消失し得る ✅

- 場所: `supabase/functions/_shared/rooms.ts` の `leaveRoom` ハンド中分岐(353-368行付近)、`src/core/online/tournament.ts` の `applyHandResult`(124-131行付近)
- 内容: 離脱者が「まさに手番」(`toAct === seatIndex` かつ active)の場合のみ強制 check/fold し、それ以外(手番でないが active/allin でハンド参加中)は何もせず `markLeft` する。engine 側ではそのプレイヤーが active のままハンドが続行し、後で勝った場合(他家全員フォールド、showdown勝利)、`applyHandResult` が「status !== 'playing'」を理由に反映をスキップ → **勝ち分が誰にも配分されず消失(チップ保存則が壊れる)**。また allin 中に離脱すると、ハンド結果確定前に `finishRank` が早期確定してしまう。UIの「退出」ボタンはハンド中いつでも押せるため実運用で普通に起こる。
- 修正の方向性: ハンド中の離脱は手番かどうかに関わらず engine 席を処理する(active なら強制 fold、allin はハンド確定まで順位を保留)。fold 後に `progressToActionable` を回してから `markLeft`。

### CORE-1. AIのストレートドロー判定がボード単独のテクスチャを誤検知 ▶

- 場所: `src/core/ai/handStrength.ts` の `detectStraightDraw`(143-173行付近)
- 内容: ホールカードとボードのランクを単純結合して5枚窓を走査するだけで、ホールカードが窓に寄与しているか確認していない。再現確認済み: `classifyStrength(['2s','2h'], ['4s','5d','6h','7c'])` → `{ made: 'mid-pair', draw: 'oesd', ... }`(heroのカードは無関係な純ボードテクスチャ)。これが `postflop.ts` のセミブラフ・ドローコール判断に直結し、**AIが持っていないドローを根拠に不合理なベット/コールをする**。単体テストなし。
- 修正の方向性: 5枚窓の判定に「窓内ランクの少なくとも1つがホールカード由来」の条件を追加。`detectStraightDraw` の単体テストも追加(ボード単独テクスチャで none になること)。

### CORE-2. ハンドレビューが「heroオープン→3bet された」ケースで相手レンジを誤採用 ✅

- 場所: `src/core/review/reviewHand.ts` の `buildVillainRangeFromLog`(494-560行付近)
- 内容: `preflopLogs` は最初から hero を除外しているため、`opener = preflopLogs.find(raise/bet)` は「非heroの最初のraise」= heroオープンへの**3betログ**を拾ってしまい、その3bettorのポジションの **RFIオープンレンジ(遥かに広い)** で早期 return する。下にある正しい vsOpen(3bet/コールレンジ)分岐は、該当ポジションに RFI シナリオがある限り(BB以外全部ある)**到達不能**。結果、heroがオープンして3betを受けたハンドのポストフロップ・エクイティ計算と good/mistake 判定が信頼できない。ハンドレビューはアプリの中核機能で影響大。テスト未カバー。
- 修正の方向性: hero の最初のオープンより**前**の非heroレイズだけを opener として採用し、heroが先にオープンしている場合は必ず vsOpen 分岐を使うよう分岐順序を修正。「heroオープン→非BBポジションから3bet」のテストを追加。

---

## 中

### CORE-3. 最小レイズ未満のショートオールインでベッティングが全員に再オープンされる

- 場所: `src/core/game/engine.ts` の `applyAction` allin ケース(362-383行付近)
- 内容: `newCommit > currentBet` なら無条件に全 active プレイヤーの `hasActedThisStreet` をリセットしている。実際のNLHルールでは、レイズ幅が最小レイズに満たないショートオールインは再レイズ権を生まない(既にアクション済みのプレイヤーはコール/フォールドのみ)。テスト未カバー。
- 修正の方向性: `newCommit - currentBet >= minRaise` の場合のみ全員リセット。それ未満はコール待ちのプレイヤーのみ再アクション対象とし、レイズ選択肢を与えない。

### CORE-4. MDF計算が villain のオールインベットを見落とす

- 場所: `src/core/review/reviewHand.ts` の `computeVillainBet`(615-621行付近)
- 内容: `computeCallAmount`(594行付近)は `'allin'` を含むのに、`computeVillainBet` は `bet`/`raise` のみ。相手が allin でベットしたハンドでは `villainBetAmount` が 0 になり MDF フィードバックが欠落する。
- 修正の方向性: フィルタ条件に `'allin'` を追加して `computeCallAmount` と一貫させる。

### ON-3. `room_players.connected` がハートビート失効で更新されない(設計書 §13.1 未実装)

- 場所: `supabase/functions/_shared/rooms.ts` の `heartbeat`(561行付近)、`src/components/online/OnlineLobby.tsx:252`
- 内容: `heartbeat` は `connected:true, last_seen:now` を書くだけで、`last_seen` 閾値超過を検知して表示を切り替える仕組みがサーバー・クライアントどちらにも無い。タブを閉じた相手も緑ドット「接続中」のまま。
- 修正の方向性: クライアント側で `now - last_seen` を閾値(例40秒)と比較して表示上の接続状態を導出するのが最小修正(サーバーの `connected` 列に頼らない)。

### ON-4. オンライン対戦でアクション送信失敗が無言で握りつぶされる

- 場所: `src/components/online/OnlineTable.tsx:283` 付近、`src/hooks/useOnlineRoom.ts` の `act`(278-285行付近)
- 内容: `BetControls` の `onAction` に非同期の `act` を渡しているが reject を catch しておらず、`stale` / `illegal_action` / `not_your_turn` 等の失敗が unhandled rejection になるだけ。ユーザーにはボタンを押しても何も起きないように見える。
- 修正の方向性: `act` の失敗を catch して簡易トースト/インラインエラーを表示。`stale` は自動リフェッチ+再試行案内でも良い。

### ON-5. ホストのロビー離脱で部屋が消えても残った参加者に通知されない

- 場所: `supabase/functions/_shared/rooms.ts` の `leaveRoom` lobby分岐(322-331行付近)、`src/hooks/useOnlineRoom.ts` の realtime 購読(158-199行付近)
- 内容: ホスト退出で `rooms` 行が cascade delete されるが、クライアントは `rooms` テーブルの変更を購読していない。残った参加者は空のロビーに取り残され、手動退出まで気づけない。
- 修正の方向性: `rooms` の DELETE イベントも購読し、「部屋が閉じられました」を表示してロビー前状態へ戻す。

### ON-6. 24時間クリーンアップが進行中(`playing`)の部屋も削除する

- 場所: `supabase/functions/_shared/rooms.ts:93-99` 付近(`createRoom` 内)
- 内容: 部屋作成時の古い部屋削除が `status` を問わないため、24時間超の進行中対戦が第三者の部屋作成で消され得る。発生確率は低いが影響が大きい。
- 修正の方向性: 削除対象を `status IN ('lobby','finished')` に限定。

### UI-1. `ActionButtons` が2択でも `grid-cols-3` 固定でレイアウトが崩れる

- 場所: `src/components/ActionButtons.tsx:27`。呼び出し元: `src/pages/RangeTrainer.tsx`(fold/raise 2択)、`src/pages/PotOdds.tsx`(fold/call 2択、2箇所)
- 内容: options が2件でもボタンが左2/3に詰まり右1/3が空白になる。レンジ訓練・ポットオッズドリルで実際に発生。
- 修正の方向性: `options.length` で `grid-cols-2` / `grid-cols-3` を出し分け(Tailwindの動的クラス生成は不可なので固定クラスの分岐で)。

### UI-2. モバイルで CB・統計・復習・用語集への導線が事実上存在しない

- 場所: `src/pages/Home.tsx` の `FEATURES`(9-66行付近)、`src/components/AppShell.tsx` の `NAV_SECTIONS`/`MOBILE_NAV`(12-46行付近)
- 内容: デスクトップのサイドバーは全11ページを持つが、モバイルはボトムタブ5項目のみでサイドバー非表示。Home のカードにも cbet/stats/review/glossary が無く、ガイドページ内リンク経由でしか到達できない行き止まり導線。
- 修正の方向性: Home の `FEATURES` に4ページを追加する(最小修正)。あるいはモバイル用「もっと見る」ナビを追加。

### UI-3. `HandRankInfo` が非セットのスリーカードを「ツーペア」と矛盾表示(新規追加分)

- 場所: `src/core/ai/handStrength.ts:69-70`(`isSet` でなければ `'two-pair'` を返す)、`src/components/versus/HandRankInfo.tsx:73-76`
- 内容: ボードペア由来のトリップスを `'two-pair'` に分類するのは元々AI内部スコア用の近似だったが、新設の `HandRankInfo` バッジが役名と併記するため「スリーカード / ツーペア」という矛盾表示が出る。初心者が自分の役を誤解する恐れ。
- 修正の方向性: `classifyMade` に `'trips'` を追加してラベルを用意するか、`HandRankInfo` 側で実際の役カテゴリと矛盾する `detailLabel` を抑制。※ `classifyMade` の返り値を変える場合は `postflop.ts` の強さスコアへの影響を確認すること。

### UI-4. ゲスト時 localStorage 書き込みの read-modify-write レース

- 場所: `src/store/attempts.ts:41-55`、`src/store/bookmarks.ts:33-49`、`src/store/customRanges.ts:40-63`
- 内容: 「メモリ更新 → 非同期で localStorage を読み直し → 追記保存」のため、連続回答・連続クリックで古い内容を後勝ち保存し、リロード後に履歴/ブックマーク/カスタムレンジの一部が欠落し得る。
- 修正の方向性: `port.load()` を経由せず in-memory の最新 state をそのまま `port.save()` する、または書き込みを直列化。

---

## 低

### CORE-5. `computeEquity` に単体テストが無く、`iterations <= 0` で NaN の可能性 ⚠

- 場所: `src/core/equity.ts:21-89`
- 内容: モンテカルロのコア関数だがテストファイルが存在しない。`iterations <= 0` だと `0/0 = NaN`。現状UIは固定プリセットのみ渡すため実害は薄い(0以下が渡る導線があるかは未確認)。
- 修正の方向性: 先頭で `iterations` を最低1にクランプ + 決定論的ケース(確定勝敗・split・`need===0`)の単体テスト追加。

### CORE-6. 6-max RFIティア表が `mode.ts` と `seats.ts` に重複定義 ⚠

- 場所: `src/core/ranges/mode.ts:20-27`(`BASE_MAX_TIER`)と `src/core/ranges/seats.ts:29-41`(`maxTierForSeats`)
- 内容: 現状 n=6 で両者は一致しているが、片方だけ将来修正すると 6-max と 7max+ で無言のままズレる。一致を検証するテストも無い。
- 修正の方向性: 一方から他方を導出するか、一致を保証する回帰テストを追加。

### ON-7. `next_hand` / `claim_timeout` にルームメンバーシップ検証が無い

- 場所: `supabase/functions/_shared/rooms.ts` の `nextHand`(479行付近、`uid` 未使用)・`claimTimeout`(512行付近、`_uid` として無視)
- 内容: 認証済みなら roomId(UUID)を知っている第三者が呼べる。実害は進行の強制程度でカード漏洩・資金操作には至らないが、認可漏れ。
- 修正の方向性: 関数冒頭で `room_players` に `uid` の行があるかチェック。

### ON-8. 参加時の座席割当に TOCTOU 競合

- 場所: `supabase/functions/_shared/rooms.ts` の `joinLobbyRoom`(144-168行付近)・`joinPlayingRoom`(193-214行付近)
- 内容: 空席 select と insert の間にロックが無く、同時参加で unique制約違反 → 片方に `internal` エラー。再試行で解消するが案内が無い。
- 修正の方向性: 一意制約違反時に1回だけ座席再計算リトライ、またはエラーを「もう一度お試しください」にマップ。

### ON-9. チップ推移グラフで途中参加者のX軸が実ハンド番号とズレる

- 場所: `src/components/charts/MultiLineChart.tsx:24-27`、`src/core/online/tournament.ts` の `addLatePlayer`(260-280行付近)
- 内容: 途中参加者の `stackCurve` は参加時点から始まるのに、グラフは配列インデックスを共通軸で正規化するため左端(開始点)にプロットされる。表示のみの問題。
- 修正の方向性: `stackCurve` エントリに実ハンド番号を持たせて絶対軸でプロット。優先度低。

### ON-10. Edge Function ロジック(`rooms.ts`)に自動テストが無い

- 場所: `supabase/functions/_shared/rooms.ts` 全体
- 内容: core側(tournament/publicState)は手厚くテストされているが、権威ロジック層(playerAction/leaveRoom/join系の楽観ロック・リトライ)にテストが無い。ON-1/ON-2 のような分岐漏れの温床。
- 修正の方向性: 純粋関数部分を切り出した単体テスト、または `supabase functions serve` を使った統合テストの整備。

### UI-5. Stats ページのドリル種別ラベルに `perceived` が無い

- 場所: `src/pages/Stats.tsx:10-17`(比較: `src/pages/Review.tsx:10-18` には `perceived: '相手目線レンジ'` がある)
- 内容: 相手目線レンジドリルの記録がドリル種別バーで英語生キー `perceived` のまま表示される。
- 修正の方向性: `DRILL_KIND_LABEL` に `perceived: '相手目線レンジ'` を1行追加。

### UI-6. ガイドの例題ハンド文言が読みにくい / villain の行動理由が無い ⚠

- 場所: `src/pages/guide/ExampleHandWalkthrough.tsx:60`(「K♥K のペア」等の表記)、同 40-43行(フロップでエアのままチェックコールする描写に理由の説明が無い)
- 内容: 初心者向けチュートリアルとして、①「K♥K のペア」という表記が一読で分かりにくい、②villain がペアもドローも無い状態でコールする理由が書かれておらず誤った印象を与えかねない(意図的簡略化かもしれないため要確認)。
- 修正の方向性: ①スート記号を外すか「ボードのKと合わせてKのペア」と明示。②コールの理由を一言添える。

---

## 問題なしを確認済みの領域(修正セッションで触らなくてよい)

- ホールカード秘匿: `toPublicState` の秘匿、`room_engine` の SELECT ポリシー不在、`room_hole_cards` の本人限定 RLS はいずれも設計通り。他人のカードが漏れる経路は見つからなかった
- `tournament.ts` のバスト順位・チップ保存則・途中参加は Vitest で手厚くカバー済み(ON-2 は rooms.ts 側の呼び出し方の問題)
- `evaluator.ts` の役判定(ホイール・キッカー含む)、`engine.ts` の uncalled bet 返還・サイドポット、`ranges/expand.ts`、`vsOpen.ts` の人数対応版: ロジック・テストとも問題なし
- ルーティング(`App.tsx`)に定義漏れなし。`useHistory`/`useSessions` の persist マイグレーションも実装済み
