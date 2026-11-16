# Livestream Platform

TanStack Start + Better Auth + Drizzle/Postgres + Valkey + SeaweedFS + LiveKit.

## Dev setup
```bash
pnpm install
cp .env.example .env            # then set BETTER_AUTH_SECRET (openssl rand -base64 32)
pnpm infra:up                   # postgres:5442, valkey:6390, seaweedfs:8333, livekit:7880
pnpm db:migrate
pnpm dev                        # http://localhost:3000
```

## Roadmap
1. ✅ Scaffold, infra, schema, auth (email/password + GitHub)
2. DMs + stream chat over WebSocket, Valkey pub/sub, attachments via SeaweedFS presigned URLs
3. Livestreams on LiveKit (go live, watch, guests on stage)
4. Calls: 1:1, group, screen share, recording via LiveKit Egress
5. Web Push notifications
