import { createServerFn } from '@tanstack/react-start'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '~/db'
import { authMiddleware } from '~/lib/middleware'
import { createToken, roomService } from '~/lib/livekit'
import { publishToUsers } from '~/lib/valkey'
import { sendPush } from '~/lib/push'
import type { CallDTO } from '~/lib/events'
import { HttpError, assertCanAccess, memberIds, toUserSummary } from './access'
import { broadcastStatus, finishCall } from './call-lifecycle'

const { calls, conversations } = schema

async function loadCall(callId: string, userId: string) {
  const [call] = await db.select().from(calls).where(eq(calls.id, callId))
  if (!call) throw new HttpError(404, 'Call not found')
  await assertCanAccess(call.conversationId, userId)
  return call
}

export const startCall = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ conversationId: z.uuid(), video: z.boolean() }))
  .handler(async ({ data, context }) => {
    const me = context.user
    const m = await assertCanAccess(data.conversationId, me.id)
    if (m.kind === 'stream') throw new HttpError(400, 'Use the stage to join a stream')

    // join an existing call in this conversation instead of starting a second one
    const [existing] = await db
      .select()
      .from(calls)
      .where(and(eq(calls.conversationId, data.conversationId), inArray(calls.status, ['ringing', 'active'])))
    if (existing) return { callId: existing.id }

    const [call] = await db
      .insert(calls)
      .values({
        conversationId: data.conversationId,
        initiatorId: me.id,
        video: data.video,
        roomName: `call-${crypto.randomUUID()}`,
      })
      .returning()
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, data.conversationId))
    const others = (await memberIds(data.conversationId)).filter((id) => id !== me.id)
    const dto: CallDTO = {
      id: call.id,
      conversationId: call.conversationId,
      video: call.video,
      status: 'ringing',
      from: toUserSummary(me),
      conversationTitle: conv.title ?? me.name,
    }
    await publishToUsers(others, { t: 'call.incoming', call: dto })
    await sendPush(others, {
      title: `Incoming ${data.video ? 'video' : 'voice'} call`,
      body: `${me.name} is calling`,
      url: `/call/${call.id}`,
      tag: `call-${call.id}`,
    })
    return { callId: call.id }
  })

export const getCall = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(z.object({ callId: z.uuid() }))
  .handler(async ({ data, context }) => {
    const call = await loadCall(data.callId, context.user.id)
    return {
      id: call.id,
      conversationId: call.conversationId,
      video: call.video,
      status: call.status,
      roomName: call.roomName,
      isInitiator: call.initiatorId === context.user.id,
    }
  })

export const joinCall = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ callId: z.uuid() }))
  .handler(async ({ data, context }) => {
    const call = await loadCall(data.callId, context.user.id)
    if (call.status === 'ended' || call.status === 'missed' || call.status === 'declined') {
      throw new HttpError(409, 'Call has ended')
    }
    // the call goes active once someone other than the caller answers
    if (call.status === 'ringing' && call.initiatorId !== context.user.id) {
      await db.update(calls).set({ status: 'active', startedAt: new Date() }).where(eq(calls.id, call.id))
      await broadcastStatus(call, 'active')
    }
    return createToken({
      room: call.roomName,
      identity: context.user.id,
      name: context.user.name,
      canPublish: true,
    })
  })

export const declineCall = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ callId: z.uuid() }))
  .handler(async ({ data, context }) => {
    const call = await loadCall(data.callId, context.user.id)
    if (call.status !== 'ringing') return
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, call.conversationId))
    // in groups one decline doesn't end the call for everyone
    if (conv.kind !== 'direct') return
    await db.update(calls).set({ status: 'declined', endedAt: new Date() }).where(eq(calls.id, call.id))
    await broadcastStatus(call, 'declined')
  })

export const endCall = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ callId: z.uuid(), forEveryone: z.boolean().default(false) }))
  .handler(async ({ data, context }) => {
    const call = await loadCall(data.callId, context.user.id)
    if (call.status === 'ringing') {
      if (call.initiatorId !== context.user.id) return
      await db.update(calls).set({ status: 'missed', endedAt: new Date() }).where(eq(calls.id, call.id))
      await broadcastStatus(call, 'missed')
      return
    }
    if (call.status !== 'active') return
    const room = await roomService()
      .listParticipants(call.roomName)
      .catch(() => [])
    const remaining = room.filter((p) => p.identity !== context.user.id)
    if (data.forEveryone || remaining.length === 0) await finishCall(call)
  })
