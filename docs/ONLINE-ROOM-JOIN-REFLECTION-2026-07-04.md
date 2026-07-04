# オンライン部屋参加がホスト側に反映されない事象の調査メモ

作成日: 2026-07-04

## 結論

「参加者がホスト側のロビーに出ない / 反映が遅い」事象は、現状の実装を見る限りポーリング間隔の問題ではない。ロビー参加者一覧はポーリングしておらず、Supabase Realtime の `room_players` 変更イベントに依存している。

参加自体は Edge Function の `join_room` が `room_players` に `insert` しており、ホスト側はその INSERT/UPDATE/DELETE イベントを受けたら `room_players` を全件 `select` し直す設計になっている。したがって、ホスト側で反映されない場合の主因候補は次のどれか。

1. ホスト側の Realtime 購読が `SUBSCRIBED` になっていない、または途中で `CHANNEL_ERROR` / `TIMED_OUT` / `CLOSED` になっている。
2. 実デプロイ先 DB で `room_players` が `supabase_realtime` publication に追加されていない、またはマイグレーションが未適用 / 部分適用になっている。
3. Realtime イベントが一時的に取りこぼされても、ロビーに再同期用のポーリング / フォールバック SELECT がないため、ホスト側の `players` が古いままになる。
4. `rooms` DELETE 購読だけは実装と migration がずれており、今回の参加者反映とは別件だが、Realtime 設定の不整合として確認対象に含めるべき。

## 追加観測

ユーザー報告:

- `room_players` の DB 行には参加者が反映されているように見える。
- ホストが一度抜けて再度入ると、部屋に参加しているメンバーは正常に表示される。
- ただし、その状態から開始しようとすると「この部屋 / 対戦はすでに終了しています」系のエラーになる。

この観測から、`join_room` の insert 失敗ではなく、ホスト滞在中の Realtime 反映漏れである可能性がさらに高い。

理由:

- 再入室時は `enterRoom` の初期同期 SELECT が走るため、DB に存在する `room_players` を取得できる。
- 滞在中にだけ表示されないなら、`room_players` の `postgres_changes` callback が発火していない、または callback 後の `refetchPlayers` が成功していない可能性が高い。
- `start_game` 成功後の画面遷移も Realtime の `room_states` 更新に依存しているため、Realtime が壊れているとサーバーでは開始済みなのにホスト画面がロビーのまま残り、次の開始操作で `already_started` が返る可能性がある。

## 該当実装

### サーバー側の参加処理

`supabase/functions/_shared/rooms.ts`

- `createRoom` は `rooms`、ホストの `room_players`、`room_states` を作成する。
- `joinRoom` は部屋コードから `rooms` を取得し、既存参加者でなければ `joinLobbyRoom` / `joinPlayingRoom` に進む。
- ロビー中の参加は `joinLobbyRoom` が `room_players` に行を `insert` する。
- 同時参加で seat が競合した場合は一度だけ seat を取り直す。

根拠:

- `createRoom`: `supabase/functions/_shared/rooms.ts:103`
- `joinLobbyRoom`: `supabase/functions/_shared/rooms.ts:177`
- `room_players.insert`: `supabase/functions/_shared/rooms.ts:187`
- `joinRoom`: `supabase/functions/_shared/rooms.ts:312`

### クライアント側の同期処理

`src/hooks/useOnlineRoom.ts`

- `enterRoom(roomId)` で Realtime channel `room:${roomId}` を作成する。
- `room_players` の `postgres_changes` を `event: '*'` / `filter: room_id=eq.${roomId}` で購読する。
- `room_players` イベントを受けると、payload を直接マージせず `refetchPlayers(roomId)` で全参加者を SELECT し直す。
- `enterRoom` の直後にも初期同期として `rooms` / `room_states` / `room_players` を一度 SELECT する。

根拠:

- `refetchPlayers`: `src/hooks/useOnlineRoom.ts:136`
- `room_players` 購読: `src/hooks/useOnlineRoom.ts:192`
- 初期同期 SELECT: `src/hooks/useOnlineRoom.ts:244`
- `joinRoom` 成功後の `enterRoom`: `src/hooks/useOnlineRoom.ts:285`

### ロビー UI

`src/components/online/OnlineLobby.tsx`

- ロビーの参加者一覧は `players` prop をそのまま `map` している。
- 5 秒 interval は `last_seen` 表示を再評価するためだけで、参加者一覧の再取得はしていない。
- `players.length < 2` の間はホストの開始ボタンが disabled になるため、ホスト側が Realtime 更新を受け取れないと「参加者が来ているのに開始できない」状態になる。

根拠:

- 表示用 5 秒 interval: `src/components/online/OnlineLobby.tsx:225`
- 参加者一覧描画: `src/components/online/OnlineLobby.tsx:283`
- 開始ボタン disabled 条件: `src/components/online/OnlineLobby.tsx:314`

### 開始処理と「すでに終了」表示

`supabase/functions/_shared/rooms.ts`

- `startGame` は `rooms.status !== 'lobby'` のとき `already_started` を返す。
- `already_started` は「finished」だけでなく「playing」でも返る。
- クライアント側の `mapError` は `already_started` を常に「この対戦はすでに終了しています」と表示するため、実際には「すでに開始済み」のケースでも「終了」と見える。

根拠:

- `startGame` の status 判定: `supabase/functions/_shared/rooms.ts:428`
- `room.status !== 'lobby'` で `already_started`: `supabase/functions/_shared/rooms.ts:433`
- `already_started` の表示文言: `src/components/online/OnlineLobby.tsx:52`

特に、`startGame` 成功時のクライアント処理は `version` を store に入れるだけで、`room_states` / `rooms` を即時 refetch しない。テーブル画面への遷移は Realtime で `room_states.phase = 'in_hand'` が届くことに依存している。

根拠:

- `startGame` 成功時のクライアント処理: `src/hooks/useOnlineRoom.ts:312`

## ポーリング間隔について

現状、ロビー参加者一覧に対するポーリングは実装されていない。

存在する interval は以下のみ。

- `useOnlineRoom` の heartbeat: 15 秒ごとに `room_players.last_seen` を更新する。
- `OnlineLobby` の表示用タイマー: 5 秒ごとに `last_seen` が stale かどうかを再評価する。
- アクションタイマー: ハンド中の残り時間表示用。

そのため「ポーリング間隔が長いから参加者反映が遅い」というより、「Realtime が届けば即座に refetch、届かなければロビーでは自己修復しない」という構造。

## 確認すべき点

### 1. ホスト側の Realtime 接続状態

`useOnlineRoom` は channel status を store の `connectionStatus` に入れているが、ロビー UI では表示していない。ブラウザ DevTools で一時的にログを入れる、または Zustand state を確認して、ホスト側で `connected` になっているか確認する。

見るべき状態:

- `SUBSCRIBED` になっているか。
- `CHANNEL_ERROR` / `TIMED_OUT` / `CLOSED` が出ていないか。
- 参加者が join した瞬間に `room_players` の postgres_changes callback が呼ばれているか。

### 2. DB publication

実 DB で `room_players` が `supabase_realtime` publication に入っているか確認する。

```sql
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public'
  and tablename in ('rooms', 'room_players', 'room_states', 'room_hole_cards')
order by tablename;
```

期待:

- `room_players`
- `room_states`
- `room_hole_cards`

注意:

- 現行 migration は `rooms` を publication に追加していない。一方、クライアントは `rooms` の DELETE を購読しているため、ホスト退出時の部屋削除通知は実 DB 設定によっては届かない可能性がある。今回の参加者一覧反映とは別件だが、Realtime 設定の齟齬として扱うべき。

### 3. RLS と初期 SELECT

ホストは `rooms.host_uid = auth.uid()` かつ `room_players` に自分の行があるため、`room_players_select_member` により同室参加者を SELECT できる設計。

join した側も、`join_room` が成功してから `enterRoom` するため、初期 SELECT では自分を含む参加者一覧が取れるはず。

確認 SQL:

```sql
select room_id, uid, seat, display_name, connected, last_seen, status
from public.room_players
where room_id = '<対象 room_id>'
order by seat;
```

DB 上で参加者が増えているのにホスト UI だけ増えない場合は、サーバーの join 処理ではなく Realtime / クライアント同期側の問題と見てよい。

### 4. Realtime 取りこぼし時の自己修復

`room_players` イベントを受けた場合は全件 refetch するため、payload マージのバグは起きにくい。一方で、ロビーには定期 refetch がないため、イベントが来ないケースでは次のような契機まで古い一覧が残る。

- ホストがページを再読み込みする。
- 別の `room_players` UPDATE が届く。
- 別の状態更新で画面遷移や再入室が起きる。

「遅いだけ」に見える場合は、参加者の heartbeat 更新や別イベントを契機に後から refetch されている可能性がある。

### 5. 開始エラー発生時の DB 状態

「再入室後に開始すると `already_started` 系のエラーになる」場合は、開始ボタンを押す直前または直後に以下を確認する。

```sql
select id, code, host_uid, status, created_at, updated_at
from public.rooms
where code = '<部屋コード>';
```

```sql
select room_id, version, hand_number, phase, action_deadline, updated_at
from public.room_states
where room_id = '<対象 room_id>';
```

```sql
select room_id, version, updated_at, seat_uids
from public.room_engine
where room_id = '<対象 room_id>';
```

読み方:

- `rooms.status = 'lobby'` なのに `start_game` が `already_started` なら、別の roomId / code を見ている、または Edge Function 側の実デプロイコードがローカルと異なる可能性がある。
- `rooms.status = 'playing'` かつ `room_states.phase = 'in_hand'` なら、開始自体は成功している。ホスト UI がロビーのままなのは `room_states` Realtime が届いていないことが本線。
- `rooms.status = 'finished'` なら、本当に終了済み扱いの部屋に再入室している。
- `room_engine` が存在し、`room_states.phase = 'idle'` のままなら、開始処理の途中またはデプロイ差分を疑う。

## 実装上の懸念

### 重要: ロビー参加者一覧に Realtime 失敗時のフォールバックがない

現行設計は Realtime が正常に届く前提では妥当。ただし実運用ではタブ復帰、ネットワーク揺れ、Supabase Realtime の一時切断、publication 未反映などが起きるため、ロビーだけは低頻度の再同期を入れたほうが堅い。

修正する場合の候補:

- `connectionStatus !== 'connected'` の間だけ `room_players` を数秒ごとに refetch。
- ロビー表示中だけ 3〜5 秒程度の低頻度 refetch。
- `SUBSCRIBED` 直後にも `room_players` を再 SELECT する。
- `room_players` イベント受信時の refetch 失敗をログ / UI に出す。

今回は修正不要のため、実装変更はしていない。

### 中程度: `rooms` DELETE 購読と migration が不整合

`useOnlineRoom` は `rooms` DELETE を購読しているが、`supabase/migrations/0002_online.sql` は `rooms` を `supabase_realtime` publication に追加していない。

根拠:

- `rooms` DELETE 購読: `src/hooks/useOnlineRoom.ts:211`
- publication 追加対象: `supabase/migrations/0002_online.sql:130`

この不整合は「参加者がホストに反映されない」直接原因ではない。ただし Realtime 周辺の設定確認時に一緒に直す候補。

### 低〜中程度: Realtime 接続状態がロビー上で見えない

`connectionStatus` は store にあるが、ロビー UI で表示されていない。問題発生時にユーザーから見ると「参加者が来ていない」のか「同期が切れている」のか区別できない。

修正する場合の候補:

- ロビーに「同期中 / 接続中 / 再接続中」表示を出す。
- `CHANNEL_ERROR` / `TIMED_OUT` 時に手動更新や再入室を促す。

## 切り分け手順

1. 参加者が join した直後、DB の `room_players` に行が増えているか確認する。
2. DB に増えていない場合は `join_room` 側を調べる。
3. DB に増えている場合は、ホスト側で `room_players` の Realtime callback が発火しているか確認する。
4. callback が発火していない場合は、publication / Realtime 接続状態 / RLS を確認する。
5. callback が発火している場合は、`refetchPlayers` の SELECT 結果と `setPlayers` 後の store を確認する。
6. store は増えているのに UI が増えない場合は、`OnlineLobby` に渡っている `players` prop と React render を確認する。
7. 開始後もロビーに残る場合は、DB の `rooms.status` / `room_states.phase` を確認する。`playing` / `in_hand` なら開始は成功しており、`room_states` Realtime 反映漏れとして扱う。

## 今回の調査範囲

- ローカルコードの静的確認のみ。
- Supabase 実環境への接続、Realtime の実受信確認、DB publication の実値確認は未実施。
- 修正は行っていない。

## 修正(2026-07-04 同日、上記調査を受けて実施)

`src/hooks/useOnlineRoom.ts`:

- `syncRoomSnapshot(roomId)` を追加: `rooms` / `room_states` / `room_players` をまとめて SELECT して store に反映する共通関数。SELECT 中の退出(roomId 変化)と、Realtime で先に適用された新しい version への巻き戻しをガードする。`enterRoom` の初期同期もこれに置き換え。
- ロビー表示中(`phase` が null/idle かつ未 finished)に限り 5 秒間隔で `syncRoomSnapshot` を実行。Realtime が死んでいても参加者一覧・開始状態が自己修復される(今回の主症状の直接対策)。
- channel が `SUBSCRIBED` になるたびに `syncRoomSnapshot` を実行(再接続までの間に取りこぼしたイベントの補償)。
- `startGame` 成功後に `syncRoomSnapshot` を実行し、テーブル画面への遷移を Realtime 配信だけに依存させない。
- `startGame` が `already_started` で失敗した場合も `syncRoomSnapshot` を実行し、実際は `playing`(=前回の開始が成功済みで UI だけロビーに残っていた)ならエラーにせずそのまま遷移させる。「この対戦はすでに終了しています」が誤表示されるのは本当に finished の場合のみになった。

`supabase/migrations/0003_realtime_rooms.sql`(新規):

- `rooms` を `supabase_realtime` publication に追加し、クライアントが購読している `rooms` DELETE(ホスト退出による部屋クローズ通知, ON-5)が実際に配信されるようにした。**実環境への migration 適用が必要。**

未対応(候補として残す):

- ロビー UI での `connectionStatus` 表示(同期切れの可視化)。
