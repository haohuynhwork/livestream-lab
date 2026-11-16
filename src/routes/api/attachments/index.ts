import { createFileRoute } from '@tanstack/react-router'
import { db, schema } from '~/db'
import { auth } from '~/lib/auth'
import { buckets, putObject } from '~/lib/storage'
import { assertCanAccess, attachmentUrl, HttpError } from '~/server/access'

const MAX_BYTES = 25 * 1024 * 1024

// Multipart upload: fields `file` and `conversationId`. Returns an unlinked attachment
// that sendMessage attaches to a message.
export const Route = createFileRoute('/api/attachments/')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await auth.api.getSession({ headers: request.headers })
        if (!session) return new Response('Unauthorized', { status: 401 })
        const form = await request.formData()
        const file = form.get('file')
        const conversationId = String(form.get('conversationId') ?? '')
        if (!(file instanceof File)) return new Response('Missing file', { status: 400 })
        if (file.size > MAX_BYTES) return new Response('File too large (25MB max)', { status: 413 })
        try {
          const m = await assertCanAccess(conversationId, session.user.id)
          if (m.kind === 'stream') throw new HttpError(400, 'Attachments are not allowed in stream chat')
        } catch (e) {
          const err = e as HttpError
          return new Response(err.message, { status: err.status ?? 400 })
        }
        const mimeType = file.type || 'application/octet-stream'
        const key = `${conversationId}/${crypto.randomUUID()}`
        await putObject(buckets.attachments, key, new Uint8Array(await file.arrayBuffer()), mimeType)
        const [row] = await db
          .insert(schema.attachments)
          .values({
            uploaderId: session.user.id,
            storageKey: key,
            fileName: file.name.slice(0, 255),
            mimeType,
            sizeBytes: file.size,
          })
          .returning()
        return Response.json({
          id: row.id,
          fileName: row.fileName,
          mimeType: row.mimeType,
          sizeBytes: row.sizeBytes,
          url: attachmentUrl(row.id),
        })
      },
    },
  },
})
