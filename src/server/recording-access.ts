import { eq } from 'drizzle-orm'
import { db, schema } from '~/db'
import { assertCanAccess } from './access'

const { recordings, streams, calls } = schema

/** Used by the download route. */
export async function canViewRecording(recordingId: string, userId: string) {
  const [r] = await db
    .select({ rec: recordings, hostId: streams.hostId, conversationId: calls.conversationId })
    .from(recordings)
    .leftJoin(streams, eq(streams.id, recordings.streamId))
    .leftJoin(calls, eq(calls.id, recordings.callId))
    .where(eq(recordings.id, recordingId))
  if (!r) return null
  if (r.hostId === userId) return r.rec
  if (r.conversationId) {
    try {
      await assertCanAccess(r.conversationId, userId)
      return r.rec
    } catch {
      return null
    }
  }
  return null
}
