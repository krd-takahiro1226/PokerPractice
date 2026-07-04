# ユーザー視点レビュー — 2026-07-04

Fable5 による監査 + Sonnet サブエージェント3体(ドリル・学習系 / CPU対戦 / オンライン・認証)のレビューを統合したもの。
**このドキュメントは修正セッションへの引き継ぎ資料。** 前回の `REVIEW-FINDINGS-2026-07.md` の指摘(コミット 0bc7ce2 で修正済み)とは別に、今回は「エンドユーザーにとっての問題点・気になる点」の観点で洗い出した。

## 現状ステータス

- `npm run test`: 全32ファイル・323テスト成功
- `npm run build`: 成功(メインチャンク 677kB の警告のみ)
- `npm run sync:functions` 実行後の差分ゼロ(src/core と supabase/functions/_shared/core は同期済み)

## 修正セッションへの注意事項

- `src/core/ranges/yokosawa.ts` は手修正済み ground truth。**変更禁止**
- `src/core/` 配下を修正したら **必ず `npm run sync:functions` を実行**して supabase 側に反映すること
- CLAUDE.md のモデル分担ポリシーに従い、実装は Sonnet サブエージェントへ委譲を推奨
- 「検証」マーク: ✅=Fable5がソース裏取り済み / ▶=サブエージェントがソース確認済み / ⚠=推測含む・要確認

## 推奨修正順序

1. **REPO-1**(リポジトリ衛生)— 1回の `git rm --cached` で済み、以後の全コミットが軽くなる
2. **高**の7件 — データ消失・機能不全・学習内容の誤りに直結
3. **中**のうちユーザーが日常的に踏むもの(ON-B, ON-C, VS-2, UX-1, UX-2, UX-3)
4. 残りは余力に応じて

---

## リポジトリ衛生(最優先・機械的に直せる)

### REPO-1. `node_modules/`(6,767ファイル)と `dist/` が git にコミットされている ✅

- 場所: リポジトリ全体。`git ls-files` の 6,972 件中 6,767 件が `node_modules/`
- 内容: `.gitignore` は作成済みだが**未コミット**(`git status` で untracked)。かつ `.gitignore` は既に追跡済みのファイルには効かないため、`node_modules/` と `dist/` が全コミットに含まれ続けている。`.git` が既に 72MB。依存更新のたびに履歴が肥大化し、diff・レビュー・clone すべてが劣化する
- 修正の方向性: `.gitignore` をコミットし、`git rm -r --cached node_modules dist` で追跡解除(ワーキングツリーには残る)。過去履歴の削除(filter-repo)までやるかはユーザーに確認

---

## 高

### VS-1. バストしたCPUがゾンビ席として残り続け、ブラインド構造が崩れる ✅

- 場所: `src/core/game/session.ts`(バスト席の除外ロジックが皆無)、`src/core/game/engine.ts:149-150`(ブラインド投下)
- 内容: ローカル対戦のセッションモードは常に6席固定(`startSession` が `Array(6).fill(...)`)で、CPUがバストしても座席から除外されない。スタック0のゾンビ席がポジションローテーションに乗り続け、SB/BBに回ると `Math.min(config.bb, bbPlayer.stack)` = 0 となり `currentBet` が 0 になる → そのハンドのビッグブラインドが実質無効化され、既にSBを払った生存者の `committedStreet` が `currentBet` を上回る不整合が生じる。オンライン対戦用 `src/core/online/tournament.ts` には `status: 'playing'|'busted'|'left'` があるのに、ローカルセッションには同等の仕組みがない
- ユーザー影響: トーナメントモードで終盤(CPUがバストし始めた後)のハンドが毎回ルール的に壊れる。本来起きるべき「卓が縮小してヘッズアップ化」も起きない
- 修正の方向性: `commitHandResult` 後に `seatStacks <= 0` の席を次ハンドから除外する(有効席リストを縮小して `startHand` に渡す)。engine 側にも「stack 0 の席にはブラインドを課さない/配らない」防御を入れる

### ON-A. 「部屋が閉じられました」通知が実際には発火しない(realtime publication 漏れ) ✅

- 場所: `supabase/migrations/0002_online.sql:130-133`、消費側 `src/hooks/useOnlineRoom.ts:211-227`
- 内容: 前回レビューON-5の修正としてクライアントは `rooms` テーブルの DELETE を購読するようになったが、マイグレーションの `alter publication supabase_realtime add table ...` は `room_states` / `room_players` / `room_hole_cards` のみで **`public.rooms` が追加されていない**。publication に載っていないテーブルの変更は配信されないため、このDELETE購読は原理的に発火しない。ホスト退出後、残った参加者は空のロビーに取り残されたまま
- 修正の方向性: `alter publication supabase_realtime add table public.rooms;` をマイグレーションに追加(DELETEイベントには replica identity の確認も)。実環境への適用も忘れずに

### AUTH-1. 匿名ログイン→Googleログインでクラウドデータが孤立し、UIも実態と食い違う ✅

- 場所: `src/pages/Online.tsx:82`(`signInAnonymously`)、`src/store/auth.ts`(`onAuthStateChange` で `migrateLocalToCloud`)、`src/components/AuthButton.tsx:28-55`
- 内容: 「ゲストとして参加」は匿名ログインを使い、その uid にローカルデータがクラウド移行される。しかし `linkIdentity` の呼び出しがコードベースに一切なく、その後「Googleでログイン」すると**別の新uid**になり、匿名uid配下のデータ(対戦履歴・ドリル記録)は二度と紐付かない。さらに `AuthButton.tsx:28` は `status === 'signedIn' && email` を条件にするため、匿名ユーザー(email=null)には「ゲスト（ローカル保存）」と表示される — 実際はクラウド保存中なのに。サインアウト手段も表示されない
- 修正の方向性: 匿名ユーザー向けのUI状態(「ゲスト参加中」+サインアウト)を追加し、Google切替は `linkIdentity` で同一アカウントに統合するか、切替前に警告を出す

### UX-A1. ログイン⇔ログアウト切替でドリル履歴・ブックマーク・カスタムレンジが前アカウントのまま残留する ▶

- 場所: `src/store/attempts.ts:25-65`、`src/store/bookmarks.ts`、`src/store/customRanges.ts`、`src/pages/Review.tsx:28-31`、`src/pages/Stats.tsx:59-61`
- 内容: 各ストアの `loaded` フラグは一度 `true` になると戻らず、ページ側は `if (!loaded) load()` のみで auth 状態を購読していない。ゲスト→ログインしてもクラウド履歴が読み込まれず(リロードまで見えない)、逆に**ログアウト後も前アカウントの間違い履歴・ブックマーク・カスタムレンジがメモリに残ったまま表示される**
- 修正の方向性: `userId` の変化を監視して各ストアの `loaded` リセット+state クリア+再 `load()`

### UX-A2. ログアウト後も前アカウントのセッション履歴が localStorage に残留する ▶

- 場所: `src/store/sessions.ts:111-122`(`loadFromCloud`)、`src/components/SessionHistory.tsx:44-48`
- 内容: ログイン中に `loadFromCloud` がクラウドのセッションを state に入れると persist が `poker-trainer-sessions` へ自動保存する。ログアウト時に戻す処理がなく、共有端末では前アカウントの対戦成績がゲストにそのまま見える
- 修正の方向性: `status` が `guest` に変化したら state をクリアしローカル元データを再読込。UX-A1 と合わせて「auth 切替時のストアリセット」として一括対応するのが良い

### UX-1. レンジ訓練の「進捗をリセット」が確認なしで全ドリルの進捗を消す ✅

- 場所: `src/pages/RangeTrainer.tsx:566-568`、`src/store/progress.ts:75-86`
- 内容: レンジ訓練ページの正答率カード直下のボタンだが、実体は `useProgress.getState().reset()` で quiz・potOdds・reqEquity・mdf・cbet・perceived・byScenario まで**全カテゴリを消去**。`confirm()` もない。「このドリルだけ」と思って押したユーザーが全学習記録を失う
- 修正の方向性: 確認ダイアログ追加+文言を「全ドリルの進捗をリセット」に変更、または range 単体リセットのアクションを新設

### UX-2. エクイティ計算機がボード1〜2枚でも無警告で「勝率」を表示する ✅

- 場所: `src/pages/EquityCalc.tsx:29`(`canRun = heroReady && villainReady && !running`)、`:54-58`
- 内容: ボード枚数(正しくは 0/3/4/5 枚)を検証せず、1枚や2枚置いた「ポーカーとしてありえない局面」の数値をエラーなく表示する。学習者に誤った直感を与える
- 修正の方向性: `canRun` に `[0,3,4,5].includes(boardCards.length)` を追加し、不正時はボタン無効化+案内文

---

## 中

### ON-B. AFK/未接続プレイヤーを排除する手段がなく、その手番のたびに卓全体が最大30秒待たされる ▶

- 場所: `src/components/online/OnlineLobby.tsx`(kick UIなし)、`supabase/functions/_shared/rooms.ts`(host専用操作は `startGame` のみ)、`src/hooks/useOnlineRoom.ts:489-502`
- 内容: ロビー参加者がタブを閉じてもホストに退室させる機能がなく、ゴースト込みでゲーム開始できる。対戦中はその手番のたびに他クライアントの `claim_timeout` 頼みで最大30秒停止し、ブラインドで自然バストするまで毎ハンド繰り返される。小規模な友人対戦で頻発しうる体験劣化
- 修正の方向性: ホストがロビーで未接続参加者を退室させるAPI/UIを追加。対戦中は未接続が続くプレイヤーの自動 leave も検討

### ON-C. Realtime 切断時にUIへ何の表示も出ず、再接続後の状態キャッチアップもない ▶

- 場所: `src/store/online.ts:14,61,129`(`connectionStatus`)、`src/hooks/useOnlineRoom.ts:234-240`
- 内容: WebSocket 切断は検知して `connectionStatus: 'disconnected'` に更新するが、**この値を読むUIがひとつもない**。モバイルのスリープ/回線切替で切れても「相手が固まった」ようにしか見えない。再購読後の明示的リフェッチもなく、次のイベントが来るまで表示が古いまま
- 修正の方向性: `connectionStatus` を OnlineTable/OnlineLobby にバナー表示し、再 `SUBSCRIBED` 時に `room_states`/`room_players` を再フェッチ

### VS-2. キャッシュ形式で対戦相手が全滅すると「次のハンド」が無反応のまま固まる ✅

- 場所: `src/core/game/session.ts:104-117`(cash 分岐に終了判定なし)、`src/hooks/useVersusSession.ts:227-229`(`canContinue` ガード)
- 内容: cash 形式には勝利判定がなく `status` は `'active'` のまま、しかし `canContinue` は有効席2未満で `false` を返す。結果、UIは進行中のまま「次のハンド」を押しても何も起きず、案内もない(ソフトロック)
- 修正の方向性: cash でも有効な対戦相手が0になったら終了状態にするか、「対戦相手がいなくなりました」を表示。VS-1(ゾンビ席)の修正内容と整合させること

### VS-3. ハンドレビューのエクイティが常に「相手1人」前提で、マルチウェイでは楽観的に出る ▶

- 場所: `src/core/review/reviewHand.ts:494-566`(`buildVillainRangeFromLog` は単一villainのみ)、`src/core/ai/estimateEquity.ts`
- 内容: 3人以上生存のポットでも1人分のレンジに対するヘッズアップエクイティで good/mistake 判定するため、必要勝率が実態より甘く出る
- 修正の方向性: 最低限「マルチウェイのため目安」の注記を表示。可能なら生存者全員のレンジ合成

### VS-4. 「つよい」CPUが相手レンジを常に完全ランダム(169クラス均等)と想定している ▶

- 場所: `src/core/ai/postflop.ts:166-176`(`buildVillainRange` — コメントに「MVP: 全169ハンドクラスを均等に」)
- 内容: 実際のプリフロップアクションを無視してランダムレンジ相手のエクイティで判断するため、コール/ブラフが本来より楽観的になり、「つよい」のに理不尽に見える挙動の一因になる
- 修正の方向性: プリフロップの生存者アクション(RFI/vsOpen)から簡易レンジを構築して渡す。`reviewHand.ts` の `buildVillainRangeFromLog` 相当を流用可

### UX-3. レンジ訓練ドリルはモバイルで回答後のレンジ表が一切表示されない ▶

- 場所: `src/pages/RangeTrainer.tsx:557`(`<Panel title="このシナリオのレンジ" className="hidden lg:block">`)
- 内容: 正解ハンドをハイライトする RangeGrid がスマホで丸ごと非表示。中核ドリルなのに視覚学習を得られない。同種の PerceivedRange はモバイルでも表示しており一貫性がない
- 修正の方向性: 回答後はモバイルでもメインカラム側に RangeGrid を表示

### UX-4. Home とサイドバーの「総合正答率」の集計範囲が異なり、同一画面で数字が食い違う ▶

- 場所: `src/pages/Home.tsx:112-115`(range+potOdds+quiz の3種)、`src/components/AppShell.tsx:61-64`(7種全部)
- 内容: デスクトップでは両方同時に見えるのに同じラベルで異なる値が並ぶ。やり込むほど乖離する
- 修正の方向性: `progress.ts` に共通ヘルパーを切り出して7種で統一

### UX-5. CBクイズのテクスチャチップが「dry」と「wet/monotone」を同時表示して矛盾に見える ▶

- 場所: `src/data/cbetQuestions.ts:93, 404, 431` 等(例: `['A-high-dry', 'monotone', 'wet']`)、表示元 `src/pages/Cbet.tsx:80-88`
- 内容: アーキタイプ名に含まれる `-dry` と湿度タグ `wet` が並び、テクスチャを学ぶ初心者に自己矛盾に見える
- 修正の方向性: アーキタイプ名を `A-high` 等に短縮し、湿度系タグは1つだけ付与

### UX-6. ブックマークは「間違えた問題」からしか追加できない ▶

- 場所: `src/pages/Review.tsx:101-110`(`useBookmarks.toggle` の唯一の呼び出し元)
- 内容: 各ドリル画面にブックマークボタンがなく、正解したが見直したい問題を保存できない。機能名への期待と実装のギャップが大きい
- 修正の方向性: 各ドリルの回答後フィードバックにブックマークボタンを追加

### UX-7. Home の機能カード一覧に「vs CPU 対戦」(/versus)がない ▶

- 場所: `src/pages/Home.tsx:24-109`(FEATURES 12件に /versus なし)
- 内容: ガイドの学習ロードマップは対戦を重要ステップと案内しているのに、トップの機能一覧に入り口がない(サイドバー/モバイルタブにはある)
- 修正の方向性: FEATURES に対戦カードを1件追加

### VS-5. 難易度・モード変更が「次のハンドから」しか反映されないのに、UIは即座に確定表示する ▶

- 場所: `src/hooks/useVersusGame.ts:60-69, 200-208`(`pendingDifficulty`/`pendingMode` ref)、`src/pages/Versus.tsx:171-206`
- 内容: ボタンは押した瞬間ハイライトが切り替わるが実際の反映は次の `newHand()` 時のみ。「変えたのに反映されない」という誤解を生む。案内文言なし
- 修正の方向性: 「次のハンドから適用されます」の一文を添える

---

## 低

### VS-6. 全員オールイン時、フロップ〜リバーが一瞬で結果まで進み盤面の展開が見えない ▶

- 場所: `src/core/game/engine.ts:491-502, 534-563`(`runOut` が1回の状態遷移で全ストリート進める)、`src/hooks/useVersusGame.ts:78-96`
- 内容: ボード5枚と結果が同時に出るため、初心者がどのカードで勝敗が決まったか分からない
- 修正の方向性: `runOut` をストリートごとの複数 state 更新に分割し、遅延を挟んで段階表示

### VS-7. トーナメント設定の「開始スタック（チップ）」表記が実態(bb単位)と食い違う ▶

- 場所: `src/pages/Versus.tsx:454-456`
- 内容: 選択肢 50/100/200 はそのまま bb 単位の `startingStack` に入るのに、tournament のみ「チップ」表記。cash 側は「（bb）」。「200チップ=浅い」という誤解を招く
- 修正の方向性: 「（bb）」に統一

### VS-8. サイドポット発生時もテーブル上は合算ポット額のみ表示 ▶

- 場所: `src/components/versus/PotDisplay.tsx`
- 内容: 対戦中にメイン/サイドの区別が見えず、初心者がサイドポットの仕組みを対戦中に理解しづらい
- 修正の方向性: サイドポットがある場合はメイン/サイドを分けて表示

### ON-D. 対戦から離脱したプレイヤーが同じ部屋コードで再入室すると「観戦中(次のハンドから配られます)」と誤表示される ▶

- 場所: `supabase/functions/_shared/rooms.ts:326-334`(`joinRoom` が既存行の `status` を見ず成功を返す)、`src/components/online/OnlineTable.tsx:213-218`
- 内容: `status:'left'` のプレイヤーは二度と配牌されないのに「戻れた」ように見える
- 修正の方向性: `existing.status === 'left'` なら `already_left` エラーを返すか、「このトーナメントには戻れません」を表示

### ON-E. 全員失踪した `playing` 部屋が永久にDBへ残る ▶

- 場所: `supabase/functions/_shared/rooms.ts:111-118`(24hクリーンアップが `lobby`/`finished` のみ対象)
- 内容: 前回ON-6対応の裏返し。誰も戻らない進行中部屋を回収する仕組みがなくゴミデータが増え続ける。ユーザー影響は薄い
- 修正の方向性: `action_deadline` と全員の `last_seen` が長時間停止した playing 部屋を `create_room` 時にベストエフォートで `finished` 化

### UX-8. 復習一覧の重複表示: ブックマークが「シナリオ×ハンド」単位で、複数行に見えて1回の解除で全部消える ▶

- 場所: `src/pages/Review.tsx:34-37, 121-125`(`problemKeyOf` がタイムスタンプを含まない)
- 修正の方向性: 一覧を問題キー単位でユニーク化して代表1行のみ表示

### UX-9. ログイン時、復習ページの一覧が「古い順」になる(ゲスト時と逆) ▶

- 場所: `src/pages/Review.tsx:33-38`(`.reverse()` は「配列が古い順」前提)、`src/store/remote/attempts.ts:28`(クラウドは `ascending: false` で取得)
- 修正の方向性: ストア側で並びを統一するか、Review 側で `ts` による明示ソート

### UX-10. 用語集のミニマムレイズ説明「前のベット額の2倍」が一般化しすぎ ▶

- 場所: `src/data/glossary.ts:505`(および `:491` の「レイズ」項)
- 内容: 「2倍」が正しいのは最初のレイズのみ。リレイズの最小額は「直前のレイズ幅と同額の上乗せ」。初心者が誤って覚える恐れ
- 修正の方向性: 「最初のベットに対しては2倍、リレイズは直前のレイズ幅ぶんの上乗せが最小」と補足

### UX-11. CardPicker の13列グリッドがスマホ幅で1セル15〜20px程度になり誤タップしやすい ⚠

- 場所: `src/components/CardPicker.tsx:40-61`(`grid-cols-[repeat(13,...)]` + `max-w-lg` モーダル)
- 内容: 推奨タップ領域44pxを大きく下回ると推測(実機未検証)
- 修正の方向性: モバイル幅では折り返すかセルを拡大

### REPO-2. メインチャンク 677kB(gzip 202kB)でモバイル初回ロードが重い ✅

- 場所: ビルド出力(`dist/assets/index-*.js`)
- 修正の方向性: React Router の route 単位で `lazy()` によるコード分割(特に Versus/Online/EquityCalc 系の重いページ)

---

## 問題なしを確認済みの領域(修正セッションで触らなくてよい)

- ホールカード秘匿(`toPublicState`)、RLS(`0001`/`0002`)、`room_engine` のクライアント読取不可 — 今回も健全。認可漏れなし
- `src/core/potOdds.ts` の計算式(potOdds/MDF/アウツ/インプライドオッズ)とUIラベル対応、`quizQuestions.ts` の判定・解説 — 数式レベルで誤りなし
- `HandRankings.tsx` の役一覧、`core/stats/aggregate.ts` の集計式、`migrateLocal.ts` の二重移行防止 — 妥当
- `resolveShowdown` の uncalled bet 返還、`buildPots`/`distributePots` のサイドポット計算 — ロジック正常(表示の問題は VS-8 のみ)
- 前回レビューの修正(CORE-1/3, UI-3, ActionButtons, localStorage レース, Stats ラベル, ガイド文言, Home 導線)— いずれも意図通り実装されていることを確認
