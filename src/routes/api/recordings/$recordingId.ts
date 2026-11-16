import { createFileRoute } from '@tanstack/react-router'
import { auth } from '~/lib/auth'
import { buckets, getObjectResponse } from '~/lib/storage'
import { canViewRecording } from '~/server/recording-access'

export const Route = createFileRoute('/api/recordings/$recordingId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await auth.api.getSession({ headers: request.headers })
        if (!session) return new Response('Unauthorized', { status: 401 })
        const rec = await canViewRecording(params.recordingId, session.user.id)
        if (!rec) return new Response('Not found', { status: 404 })
        if (!rec.storageKey) return new Response('Recording is still processing', { status: 409 })
        return getObjectResponse(buckets.recordings, rec.storageKey, { range: request.headers.get('range') })
      },
    },
  },
})
