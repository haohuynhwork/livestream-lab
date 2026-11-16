import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { db, schema } from '~/db'
import { auth } from '~/lib/auth'
import { buckets, getObjectResponse } from '~/lib/storage'
import { assertCanAccess } from '~/server/access'

export const Route = createFileRoute('/api/attachments/$attachmentId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await auth.api.getSession({ headers: request.headers })
        if (!session) return new Response('Unauthorized', { status: 401 })
        const [row] = await db
          .select({ att: schema.attachments, conversationId: schema.messages.conversationId })
          .from(schema.attachments)
          .leftJoin(schema.messages, eq(schema.messages.id, schema.attachments.messageId))
          .where(eq(schema.attachments.id, params.attachmentId))
        if (!row) return new Response('Not found', { status: 404 })
        if (row.conversationId) {
          try {
            await assertCanAccess(row.conversationId, session.user.id)
          } catch {
            return new Response('Forbidden', { status: 403 })
          }
        } else if (row.att.uploaderId !== session.user.id) {
          return new Response('Forbidden', { status: 403 })
        }
        return getObjectResponse(buckets.attachments, row.att.storageKey, {
          fileName: row.att.fileName,
          range: request.headers.get('range'),
        })
      },
    },
  },
})
