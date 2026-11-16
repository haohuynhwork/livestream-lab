import { createFileRoute } from '@tanstack/react-router'
import { and, eq } from 'drizzle-orm'
import { EgressStatus, WebhookReceiver } from 'livekit-server-sdk'
import { db, schema } from '~/db'
import { finishCall } from '~/server/call-lifecycle'

const receiver = () => new WebhookReceiver(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!)

const egressStatus: Partial<Record<EgressStatus, string>> = {
  [EgressStatus.EGRESS_STARTING]: 'starting',
  [EgressStatus.EGRESS_ACTIVE]: 'active',
  [EgressStatus.EGRESS_ENDING]: 'stopping',
  [EgressStatus.EGRESS_COMPLETE]: 'complete',
  [EgressStatus.EGRESS_FAILED]: 'failed',
  [EgressStatus.EGRESS_ABORTED]: 'failed',
  [EgressStatus.EGRESS_LIMIT_REACHED]: 'complete',
}

export const Route = createFileRoute('/api/livekit/webhook')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.text()
        let event
        try {
          event = await receiver().receive(body, request.headers.get('authorization') ?? undefined)
        } catch {
          return new Response('Invalid signature', { status: 401 })
        }

        if (event.egressInfo) {
          const info = event.egressInfo
          const file = info.fileResults[0]
          await db
            .update(schema.recordings)
            .set({
              status: egressStatus[info.status] ?? 'active',
              ...(file?.filename ? { storageKey: file.filename } : {}),
              ...(file?.duration ? { durationMs: Number(file.duration / 1_000_000n) } : {}),
            })
            .where(eq(schema.recordings.egressId, info.egressId))
        }

        // everyone left: close out calls and streams that weren't ended explicitly
        if (event.event === 'room_finished' && event.room) {
          const name = event.room.name
          if (name.startsWith('call-')) {
            const [call] = await db.select().from(schema.calls).where(eq(schema.calls.roomName, name))
            if (call?.status === 'active') await finishCall(call)
          } else if (name.startsWith('stream-')) {
            await db
              .update(schema.streams)
              .set({ status: 'ended', endedAt: new Date() })
              .where(and(eq(schema.streams.roomName, name), eq(schema.streams.status, 'live')))
          }
        }
        return new Response('ok')
      },
    },
  },
})
