// Server-only helpers shared by call server functions and the LiveKit webhook.
import { and, eq, inArray } from 'drizzle-orm'
import { db, schema } from '~/db'
import { roomService } from '~/lib/livekit'
import { channels, publish, publishToUsers } from '~/lib/valkey'
import type { CallDTO } from '~/lib/events'
import { memberIds } from './access'

const { calls } = schema

export async function broadcastStatus(call: { id: string; conversationId: string }, status: CallDTO['status']) {
  const members = await memberIds(call.conversationId)
  await publishToUsers(members, { t: 'call.updated', callId: call.id, conversationId: call.conversationId, status })
}

export async function finishCall(call: { id: string; conversationId: string; roomName: string }) {
  const updated = await db
    .update(calls)
    .set({ status: 'ended', endedAt: new Date() })
    .where(and(eq(calls.id, call.id), inArray(calls.status, ['ringing', 'active'])))
    .returning()
  await roomService()
    .deleteRoom(call.roomName)
    .catch(() => {})
  if (updated.length) {
    await broadcastStatus(call, 'ended')
    await publish(channels.conversation(call.conversationId), {
      t: 'call.updated',
      callId: call.id,
      conversationId: call.conversationId,
      status: 'ended',
    })
  }
}
