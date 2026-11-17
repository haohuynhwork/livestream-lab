import { and, eq, inArray } from 'drizzle-orm'
import { db, schema } from '~/db'
import type { AttachmentDTO, MessageDTO, UserSummary } from '~/lib/events'

const { conversations, conversationMembers, messages, attachments, user } = schema

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export async function getMembership(conversationId: string, userId: string) {
  const [row] = await db
    .select({ kind: conversations.kind, role: conversationMembers.role })
    .from(conversations)
    .leftJoin(
      conversationMembers,
      and(eq(conversationMembers.conversationId, conversations.id), eq(conversationMembers.userId, userId)),
    )
    .where(eq(conversations.id, conversationId))
  return row ?? null
}

/** Stream chats are open to any signed-in user; other conversations require membership. */
export async function assertCanAccess(conversationId: string, userId: string) {
  const m = await getMembership(conversationId, userId)
  if (!m) throw new HttpError(404, 'Conversation not found')
  if (m.kind !== 'stream' && !m.role) throw new HttpError(403, 'Not a member')
  return m
}

export async function memberIds(conversationId: string) {
  const rows = await db
    .select({ userId: conversationMembers.userId })
    .from(conversationMembers)
    .where(eq(conversationMembers.conversationId, conversationId))
  return rows.map((r) => r.userId)
}

export function toUserSummary(u: { id: string; name: string; image?: string | null }): UserSummary {
  return { id: u.id, name: u.name, image: u.image ?? null }
}

export function attachmentUrl(id: string) {
  return `/api/attachments/${id}`
}

/** Load messages with sender + attachments, preserving the given order. */
export async function hydrateMessages(rows: (typeof messages.$inferSelect)[]): Promise<MessageDTO[]> {
  if (rows.length === 0) return []
  const senderIds = [...new Set(rows.map((r) => r.senderId).filter((x): x is string => !!x))]
  const [senders, atts] = await Promise.all([
    senderIds.length
      ? db.select({ id: user.id, name: user.name, image: user.image }).from(user).where(inArray(user.id, senderIds))
      : [],
    db
      .select()
      .from(attachments)
      .where(inArray(attachments.messageId, rows.map((r) => r.id))),
  ])
  const senderMap = new Map(senders.map((s) => [s.id, s]))
  const attMap = new Map<string, AttachmentDTO[]>()
  for (const a of atts) {
    const list = attMap.get(a.messageId!) ?? []
    list.push({ id: a.id, fileName: a.fileName, mimeType: a.mimeType, sizeBytes: a.sizeBytes, url: attachmentUrl(a.id) })
    attMap.set(a.messageId!, list)
  }
  return rows.map((r) => {
    const deleted = !!r.deletedAt
    const s = r.senderId ? senderMap.get(r.senderId) : undefined
    return {
      id: r.id,
      conversationId: r.conversationId,
      kind: r.kind,
      body: deleted ? null : r.body,
      media: deleted ? null : r.payload,
      createdAt: r.createdAt.toISOString(),
      deleted,
      sender: s ? toUserSummary(s) : null,
      attachments: deleted ? [] : (attMap.get(r.id) ?? []),
    }
  })
}
