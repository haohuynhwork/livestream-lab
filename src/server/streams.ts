import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '~/db'
import { authMiddleware, optionalAuthMiddleware } from '~/lib/middleware'
import { createToken, roomService } from '~/lib/livekit'
import { publishToUsers } from '~/lib/valkey'
import { sendPush } from '~/lib/push'
import { HttpError, toUserSummary } from './access'

const { streams, conversations, conversationMembers, follows, user } = schema

const streamWithHost = () =>
  db
    .select({
      id: streams.id,
      title: streams.title,
      description: streams.description,
      status: streams.status,
      roomName: streams.roomName,
      chatConversationId: streams.chatConversationId,
      startedAt: streams.startedAt,
      endedAt: streams.endedAt,
      host: { id: user.id, name: user.name, image: user.image },
    })
    .from(streams)
    .innerJoin(user, eq(user.id, streams.hostId))

async function loadStream(streamId: string) {
  const [s] = await streamWithHost().where(eq(streams.id, streamId))
  if (!s) throw new HttpError(404, 'Stream not found')
  return s
}

function serialize(s: Awaited<ReturnType<typeof loadStream>>) {
  return {
    ...s,
    startedAt: s.startedAt?.toISOString() ?? null,
    endedAt: s.endedAt?.toISOString() ?? null,
  }
}

export type StreamDTO = ReturnType<typeof serialize>

export const listLiveStreams = createServerFn({ method: 'GET' }).handler(async () => {
  const rows = await streamWithHost().where(eq(streams.status, 'live')).orderBy(desc(streams.startedAt)).limit(100)
  return rows.map(serialize)
})

export const getStream = createServerFn({ method: 'GET' })
  .middleware([optionalAuthMiddleware])
  .validator(z.object({ streamId: z.uuid() }))
  .handler(async ({ data, context }) => {
    const s = await loadStream(data.streamId)
    let isFollowing = false
    if (context.user) {
      const [f] = await db
        .select()
        .from(follows)
        .where(and(eq(follows.followerId, context.user.id), eq(follows.followingId, s.host.id)))
      isFollowing = !!f
    }
    return { stream: serialize(s), isHost: context.user?.id === s.host.id, isFollowing }
  })

export const goLive = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ title: z.string().trim().min(1).max(120), description: z.string().trim().max(1000).optional() }))
  .handler(async ({ data, context }) => {
    const me = context.user
    const streamId = await db.transaction(async (tx) => {
      // a host has at most one live stream
      await tx
        .update(streams)
        .set({ status: 'ended', endedAt: new Date() })
        .where(and(eq(streams.hostId, me.id), eq(streams.status, 'live')))
      const [chat] = await tx.insert(conversations).values({ kind: 'stream', title: data.title, createdBy: me.id }).returning()
      await tx.insert(conversationMembers).values({ conversationId: chat.id, userId: me.id, role: 'owner' })
      const [s] = await tx
        .insert(streams)
        .values({
          hostId: me.id,
          title: data.title,
          description: data.description || null,
          status: 'live',
          roomName: `stream-${crypto.randomUUID()}`,
          chatConversationId: chat.id,
          startedAt: new Date(),
        })
        .returning()
      return s.id
    })

    const followers = (await db.select({ id: follows.followerId }).from(follows).where(eq(follows.followingId, me.id))).map(
      (f) => f.id,
    )
    await publishToUsers(followers, { t: 'stream.live', streamId, title: data.title, host: toUserSummary(me) })
    await sendPush(followers, {
      title: `${me.name} is live`,
      body: data.title,
      url: `/live/${streamId}`,
      tag: `stream-${streamId}`,
    })
    return { streamId }
  })

export const endStream = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ streamId: z.uuid() }))
  .handler(async ({ data, context }) => {
    const s = await loadStream(data.streamId)
    if (s.host.id !== context.user.id) throw new HttpError(403, 'Only the host can end the stream')
    await db.update(streams).set({ status: 'ended', endedAt: new Date() }).where(eq(streams.id, s.id))
    await roomService()
      .deleteRoom(s.roomName)
      .catch(() => {})
  })

export const getStreamToken = createServerFn({ method: 'POST' })
  .middleware([optionalAuthMiddleware])
  .validator(z.object({ streamId: z.uuid() }))
  .handler(async ({ data, context }) => {
    const s = await loadStream(data.streamId)
    if (s.status !== 'live') throw new HttpError(409, 'Stream is not live')
    const isHost = context.user?.id === s.host.id
    return createToken({
      room: s.roomName,
      identity: context.user?.id ?? `guest-${crypto.randomUUID()}`,
      name: context.user?.name ?? 'Guest',
      canPublish: isHost,
      metadata: JSON.stringify({ role: isHost ? 'host' : 'viewer' }),
    })
  })

export const setStagePermission = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ streamId: z.uuid(), identity: z.string().min(1), onStage: z.boolean() }))
  .handler(async ({ data, context }) => {
    const s = await loadStream(data.streamId)
    if (s.host.id !== context.user.id) throw new HttpError(403, 'Only the host can manage the stage')
    if (data.identity.startsWith('guest-')) throw new HttpError(400, 'Guests must sign in to join the stage')
    await roomService().updateParticipant(s.roomName, data.identity, {
      metadata: JSON.stringify({ role: data.onStage ? 'guest' : 'viewer' }),
      permission: { canSubscribe: true, canPublish: data.onStage, canPublishData: data.onStage },
    })
  })

export const setFollow = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ userId: z.string().min(1), follow: z.boolean() }))
  .handler(async ({ data, context }) => {
    if (data.userId === context.user.id) throw new HttpError(400, "You can't follow yourself")
    if (data.follow) {
      await db.insert(follows).values({ followerId: context.user.id, followingId: data.userId }).onConflictDoNothing()
    } else {
      await db.delete(follows).where(and(eq(follows.followerId, context.user.id), eq(follows.followingId, data.userId)))
    }
  })
