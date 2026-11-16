import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, inArray, or } from 'drizzle-orm'
import { z } from 'zod'
import { EncodedFileOutput, EncodedFileType } from 'livekit-server-sdk'
import { db, schema } from '~/db'
import { authMiddleware } from '~/lib/middleware'
import { egressClient } from '~/lib/livekit'
import { HttpError, assertCanAccess } from './access'

const { recordings, streams, calls, conversationMembers } = schema

const target = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('stream'), id: z.uuid() }),
  z.object({ kind: z.literal('call'), id: z.uuid() }),
])

async function resolveTarget(t: z.infer<typeof target>, userId: string) {
  if (t.kind === 'stream') {
    const [s] = await db.select().from(streams).where(eq(streams.id, t.id))
    if (!s) throw new HttpError(404, 'Stream not found')
    if (s.hostId !== userId) throw new HttpError(403, 'Only the host can record')
    if (s.status !== 'live') throw new HttpError(409, 'Stream is not live')
    return { roomName: s.roomName, streamId: s.id, callId: null }
  }
  const [c] = await db.select().from(calls).where(eq(calls.id, t.id))
  if (!c) throw new HttpError(404, 'Call not found')
  await assertCanAccess(c.conversationId, userId)
  if (c.status !== 'active') throw new HttpError(409, 'Call is not active')
  return { roomName: c.roomName, streamId: null, callId: c.id }
}

function activeFilter(t: z.infer<typeof target>) {
  return and(
    t.kind === 'stream' ? eq(recordings.streamId, t.id) : eq(recordings.callId, t.id),
    inArray(recordings.status, ['starting', 'active']),
  )
}

export const getActiveRecording = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(target)
  .handler(async ({ data }) => {
    const [r] = await db.select({ id: recordings.id }).from(recordings).where(activeFilter(data))
    return r ?? null
  })

export const startRecording = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(target)
  .handler(async ({ data, context }) => {
    const t = await resolveTarget(data, context.user.id)
    const [active] = await db.select().from(recordings).where(activeFilter(data))
    if (active) return { recordingId: active.id }
    const output = new EncodedFileOutput({
      fileType: EncodedFileType.MP4,
      // uploaded to the S3 bucket configured in infra/egress.yaml
      filepath: `${t.roomName}/{time}.mp4`,
    })
    const info = await egressClient().startRoomCompositeEgress(t.roomName, { file: output }, { layout: 'grid' })
    const [row] = await db
      .insert(recordings)
      .values({ egressId: info.egressId, streamId: t.streamId, callId: t.callId, status: 'starting' })
      .returning()
    return { recordingId: row.id }
  })

export const stopRecording = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(target)
  .handler(async ({ data, context }) => {
    await resolveTarget(data, context.user.id)
    const [active] = await db.select().from(recordings).where(activeFilter(data))
    if (!active) return
    await egressClient().stopEgress(active.egressId)
    await db.update(recordings).set({ status: 'stopping' }).where(eq(recordings.id, active.id))
  })

export const listMyRecordings = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const me = context.user.id
    const rows = await db
      .selectDistinct({
        id: recordings.id,
        status: recordings.status,
        durationMs: recordings.durationMs,
        createdAt: recordings.createdAt,
        streamTitle: streams.title,
        callId: recordings.callId,
      })
      .from(recordings)
      .leftJoin(streams, eq(streams.id, recordings.streamId))
      .leftJoin(calls, eq(calls.id, recordings.callId))
      .leftJoin(
        conversationMembers,
        and(eq(conversationMembers.conversationId, calls.conversationId), eq(conversationMembers.userId, me)),
      )
      .where(or(eq(streams.hostId, me), eq(conversationMembers.userId, me)))
      .orderBy(desc(recordings.createdAt))
      .limit(100)
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), url: `/api/recordings/${r.id}` }))
  })
