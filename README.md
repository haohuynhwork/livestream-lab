# Livestream Platform

TanStack Start + Better Auth + Drizzle/Postgres + Valkey + SeaweedFS + LiveKit.

## Dev setup
```bash
pnpm install
cp .env.example .env            # set BETTER_AUTH_SECRET (openssl rand -base64 32) and VAPID keys (npx web-push generate-vapid-keys)
pnpm infra:up                   # postgres:5442 valkey:6390 seaweedfs:8333 livekit:7880 + egress
pnpm db:migrate
pnpm dev                        # app http://localhost:3000 + realtime ws://localhost:3001
```

## Architecture
```
browser ──HTTP/server fns──▶ TanStack Start (src/) ──▶ Postgres
   │                               │  publish
   │◀──── WebSocket ──── realtime/server.ts ◀── Valkey pub/sub (conv:<id>, user:<id>, presence)
   │
   └──── WebRTC ────▶ LiveKit SFU ──▶ Egress (recordings → SeaweedFS) ──webhook──▶ /api/livekit/webhook
```

- **Messaging** (`src/server/messaging.ts`, `src/components/Chat.tsx`): DMs, groups, stream chat, typing,
  read receipts, unread counts, deletes/moderation. Attachments go through `/api/attachments` into SeaweedFS.
- **Livestreams** (`src/server/streams.ts`, `src/routes/live.$streamId.tsx`): host publishes over WebRTC,
  viewers (including anonymous) subscribe; host can invite signed-in viewers to the stage; follow hosts.
- **Calls** (`src/server/calls.ts`, `src/routes/_authed/call.$callId.tsx`): 1:1 and group voice/video
  with screen share; ringing over the realtime socket + push; recording via LiveKit Egress.
- **Push** (`src/lib/push.ts`, `public/sw.js`): new messages (when offline), incoming calls, followed host goes live.

## Production notes
- Set `LIVEKIT_PUBLIC_URL` (wss://), enable TURN in `infra/livekit.yaml`, and use real secrets.
- Run `pnpm build && pnpm start` plus `pnpm realtime:start`; both scale horizontally via Valkey.
