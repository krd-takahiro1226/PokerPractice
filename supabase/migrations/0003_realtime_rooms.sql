-- クライアント(useOnlineRoom)は rooms の DELETE を購読して「ホスト退出による部屋クローズ」を
-- 検知している(ON-5)が、0002 では rooms を supabase_realtime publication に追加しておらず
-- イベントが一切配信されていなかった。その不整合の修正。
-- replica identity full は 0002 の方針(DELETE/UPDATE の old record 全カラム配信)に合わせる。
alter table public.rooms replica identity full;
alter publication supabase_realtime add table public.rooms;
