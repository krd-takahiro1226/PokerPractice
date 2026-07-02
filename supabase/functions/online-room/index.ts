// online-room: オンライン対戦の単一ルーター Edge Function（Deno）。
// 認証(JWT)→ uid 解決、action でルーティング、DB 書込は service role クライアント。
// デプロイ: `supabase functions deploy online-room`（JWT 検証はデフォルト有効なのでフラグ不要。
// 設計書 §15.3 の `--no-verify-jwt=false` は誤記）。
import { createClient } from 'npm:@supabase/supabase-js@2';
import * as rooms from '../_shared/rooms.ts';
import { OnlineError, type OnlineErrorCode } from '../_shared/rooms.ts';
import type { PlayerActionType } from '../_shared/core/game/types.ts';
import type { TournamentConfigInput } from '../_shared/core/online/tournament.ts';

export type OnlineRequest =
  | { action: 'create_room'; config: TournamentConfigInput; displayName: string }
  | { action: 'join_room'; code: string; displayName: string }
  | { action: 'leave_room'; roomId: string }
  | { action: 'start_game'; roomId: string }
  | { action: 'player_action'; roomId: string; version: number; move: { type: PlayerActionType; amount?: number } }
  | { action: 'next_hand'; roomId: string }
  | { action: 'claim_timeout'; roomId: string; version: number; targetUid: string }
  | { action: 'heartbeat'; roomId: string };

export type OnlineResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: OnlineErrorCode };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // service role クライアント（RLS バイパス）。ユーザーセッションは持たせない。
  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  let body: OnlineRequest;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'internal' }, 400);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ ok: false, error: 'unauthorized' });

  // 呼び出し元の JWT を明示的に検証して uid を得る（db 自体は service role なので
  // auth.getUser(jwt) と引数付きで呼ぶこと — 引数なしだとクライアント自身のセッションを見にいく）。
  const { data: userData, error: authError } = await db.auth.getUser(jwt);
  if (authError || !userData?.user) return json({ ok: false, error: 'unauthorized' });
  const uid = userData.user.id;

  try {
    switch (body.action) {
      case 'create_room':
        return json({ ok: true, data: await rooms.createRoom(db, uid, body.config ?? {}, body.displayName ?? '') });
      case 'join_room':
        return json({ ok: true, data: await rooms.joinRoom(db, uid, body.code, body.displayName ?? '') });
      case 'leave_room':
        return json({ ok: true, data: await rooms.leaveRoom(db, uid, body.roomId) });
      case 'start_game':
        return json({ ok: true, data: await rooms.startGame(db, uid, body.roomId) });
      case 'player_action':
        return json({ ok: true, data: await rooms.playerAction(db, uid, body.roomId, body.version, body.move) });
      case 'next_hand':
        return json({ ok: true, data: await rooms.nextHand(db, uid, body.roomId) });
      case 'claim_timeout':
        return json({ ok: true, data: await rooms.claimTimeout(db, uid, body.roomId, body.version, body.targetUid) });
      case 'heartbeat':
        return json({ ok: true, data: await rooms.heartbeat(db, uid, body.roomId) });
      default:
        return json({ ok: false, error: 'internal' });
    }
  } catch (e) {
    if (e instanceof OnlineError) return json({ ok: false, error: e.code });
    console.error(e);
    return json({ ok: false, error: 'internal' });
  }
});
