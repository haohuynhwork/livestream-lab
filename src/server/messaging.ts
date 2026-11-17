import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, inArray, isNull, lt, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '~/db'
import { authMiddleware } from '~/lib/middleware'
import { channels, onlineUserIds, publish, publishToUsers } from '~/lib/valkey'
import { sendPush } from '~/lib/push'
import { fetchGiphy } from './giphy'
import { HttpError, assertCanAccess, hydrateMessages, memberIds, toUserSummary } from './access'

const { conversations, conversationMembers, messages, attachments, user } = schema

export type ConversationListItem = {
  id: string
  kind: 'direct' | 'group' | 'stream'
  title: string
  lastMessageAt: string | null
  lastMessagePreview: string | null
  unread: number
  members: { id: string; name: string; image: string | null }[]
}

export const listConversations = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<ConversationListItem[]> => {
    const me = context.user.id
    const mine = await db
      .select({
        id: conversations.id,
        kind: conversations.kind,
        title: conversations.title,
        lastMessageAt: conversations.lastMessageAt,
        lastRead: conversationMembers.lastReadMessageId,
      })
      .from(conversationMembers)
      .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
      .where(and(eq(conversationMembers.userId, me), ne(conversations.kind, 'stream')))
      .orderBy(desc(sql`coalesce(${conversations.lastMessageAt}, ${conversations.createdAt})`))
    if (mine.length === 0) return []
    const ids = mine.map((c) => c.id)

    const [members, lastMessages, unreadRows] = await Promise.all([
      db
        .select({ conversationId: conversationMembers.conversationId, id: user.id, name: user.name, image: user.image })
        .from(conversationMembers)
        .innerJoin(user, eq(user.id, conversationMembers.userId))
        .where(inArray(conversationMembers.conversationId, ids)),
      db
        .selectDistinctOn([messages.conversationId], {
          conversationId: messages.conversationId,
          kind: messages.kind,
          body: messages.body,
          deletedAt: messages.deletedAt,
        })
        .from(messages)
        .where(inArray(messages.conversationId, ids))
        .orderBy(messages.conversationId, desc(messages.createdAt)),
      // unread = messages from others newer than my last-read message
      db.execute<{ conversation_id: string; unread: number }>(sql`
        select m.conversation_id, count(*)::int as unread
        from ${messages} m
        join ${conversationMembers} cm on cm.conversation_id = m.conversation_id and cm.user_id = ${me}
        left join ${messages} lr on lr.id = cm.last_read_message_id
        where m.conversation_id in ${ids}
          and m.sender_id is distinct from ${me}
          and m.deleted_at is null
          and (lr.created_at is null or m.created_at > lr.created_at)
        group by m.conversation_id`),
    ])

    const unread = new Map(unreadRows.map((r) => [r.conversation_id, r.unread]))
    const last = new Map(lastMessages.map((m) => [m.conversationId, m]))
    return mine.map((c) => {
      const ms = members.filter((m) => m.conversationId === c.id).map(({ id, name, image }) => ({ id, name, image }))
      const others = ms.filter((m) => m.id !== me)
      const lm = last.get(c.id)
      return {
        id: c.id,
        kind: c.kind,
        title: c.title ?? (others.map((o) => o.name).join(', ') || 'Just you'),
        lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
        lastMessagePreview: lm ? (lm.deletedAt ? 'Message deleted' : (lm.body ?? (lm.kind === 'text' ? '📎 Attachment' : lm.kind === 'gif' ? 'GIF' : 'Sticker'))) : null,
        unread: unread.get(c.id) ?? 0,
        members: ms,
      }
    })
  })

export const getConversation = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(z.object({ conversationId: z.uuid() }))
  .handler(async ({ data, context }) => {
    const m = await assertCanAccess(data.conversationId, context.user.id)
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, data.conversationId))
    const members = await db
      .select({ id: user.id, name: user.name, image: user.image, lastRead: conversationMembers.lastReadMessageId })
      .from(conversationMembers)
      .innerJoin(user, eq(user.id, conversationMembers.userId))
      .where(eq(conversationMembers.conversationId, data.conversationId))
    const others = members.filter((x) => x.id !== context.user.id)
    return {
      id: conv.id,
      kind: conv.kind,
      title: conv.title ?? (others.map((o) => o.name).join(', ') || 'Just you'),
      myRole: m.role,
      members,
    }
  })

const PAGE = 50

export const getMessages = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(z.object({ conversationId: z.uuid(), before: z.iso.datetime().optional() }))
  .handler(async ({ data, context }) => {
    await assertCanAccess(data.conversationId, context.user.id)
    const rows = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, data.conversationId),
          data.before ? lt(messages.createdAt, new Date(data.before)) : undefined,
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(PAGE)
    const hydrated = await hydrateMessages(rows.reverse())
    return { messages: hydrated, hasMore: rows.length === PAGE }
  })

async function findOrCreateDirect(me: string, other: string) {
  const existing = await db.execute<{ id: string }>(sql`
    select c.id from ${conversations} c
    where c.kind = 'direct'
      and exists (select 1 from ${conversationMembers} where conversation_id = c.id and user_id = ${me})
      and exists (select 1 from ${conversationMembers} where conversation_id = c.id and user_id = ${other})
    limit 1`)
  if (existing[0]) return existing[0].id
  return db.transaction(async (tx) => {
    const [c] = await tx.insert(conversations).values({ kind: 'direct', createdBy: me }).returning()
    await tx.insert(conversationMembers).values([
      { conversationId: c.id, userId: me, role: 'owner' },
      { conversationId: c.id, userId: other, role: 'owner' },
    ])
    return c.id
  })
}

export const startConversation = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(
    z.object({
      emails: z.array(z.email()).min(1).max(50),
      title: z.string().trim().max(100).optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const me = context.user.id
    const found = await db
      .select({ id: user.id, email: user.email })
      .from(user)
      .where(inArray(user.email, data.emails.map((e) => e.toLowerCase())))
    const missing = data.emails.filter((e) => !found.some((f) => f.email === e.toLowerCase()))
    if (missing.length) throw new HttpError(404, `No user with email: ${missing.join(', ')}`)
    const others = found.map((f) => f.id).filter((id) => id !== me)
    if (others.length === 0) throw new HttpError(400, 'Add someone other than yourself')

    if (others.length === 1 && !data.title) return { conversationId: await findOrCreateDirect(me, others[0]) }

    const conversationId = await db.transaction(async (tx) => {
      const [c] = await tx
        .insert(conversations)
        .values({ kind: 'group', title: data.title || null, createdBy: me })
        .returning()
      await tx.insert(conversationMembers).values([
        { conversationId: c.id, userId: me, role: 'owner' as const },
        ...others.map((id) => ({ conversationId: c.id, userId: id, role: 'member' as const })),
      ])
      return c.id
    })
    await publishToUsers(others, { t: 'conversation.updated', conversationId })
    return { conversationId }
  })

export const sendMessage = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(
    z
      .object({
        conversationId: z.uuid(),
        body: z.string().trim().max(4000).optional(),
        attachmentIds: z.array(z.uuid()).max(10).default([]),
        // GIFs and stickers are sent on their own, without text or attachments
        media: z.object({ kind: z.enum(['gif', 'sticker']), id: z.string().regex(/^\w{1,64}$/) }).optional(),
      })
      .refine((d) => d.body || d.attachmentIds.length || d.media, 'Message is empty')
      .refine((d) => !d.media || (!d.body && !d.attachmentIds.length), 'GIFs and stickers are sent alone'),
  )
  .handler(async ({ data, context }) => {
    const me = context.user
    const membership = await assertCanAccess(data.conversationId, me.id)
    if (membership.kind === 'stream' && data.attachmentIds.length) {
      throw new HttpError(400, 'Attachments are not allowed in stream chat')
    }

    // resolve the GIF server-side so clients can't inject arbitrary image URLs
    const payload = data.media ? await fetchGiphy(data.media.id) : null

    const row = await db.transaction(async (tx) => {
      const [msg] = await tx
        .insert(messages)
        .values({
          conversationId: data.conversationId,
          senderId: me.id,
          kind: data.media?.kind ?? 'text',
          body: data.body || null,
          payload,
        })
        .returning()
      if (data.attachmentIds.length) {
        const linked = await tx
          .update(attachments)
          .set({ messageId: msg.id })
          .where(
            and(
              inArray(attachments.id, data.attachmentIds),
              eq(attachments.uploaderId, me.id),
              isNull(attachments.messageId),
            ),
          )
          .returning({ id: attachments.id })
        if (linked.length !== data.attachmentIds.length) throw new HttpError(400, 'Invalid attachment')
      }
      await tx.update(conversations).set({ lastMessageAt: msg.createdAt }).where(eq(conversations.id, data.conversationId))
      if (membership.role) {
        await tx
          .update(conversationMembers)
          .set({ lastReadMessageId: msg.id })
          .where(and(eq(conversationMembers.conversationId, data.conversationId), eq(conversationMembers.userId, me.id)))
      }
      return msg
    })

    const [message] = await hydrateMessages([row])
    await publish(channels.conversation(data.conversationId), { t: 'message', message })

    if (membership.kind !== 'stream') {
      const others = (await memberIds(data.conversationId)).filter((id) => id !== me.id)
      // update inbox lists for everyone; push only to people who aren't connected
      await publishToUsers(others, { t: 'conversation.updated', conversationId: data.conversationId })
      const online = await onlineUserIds(others)
      await sendPush(
        others.filter((id) => !online.has(id)),
        {
          title: me.name,
          body: data.body?.slice(0, 120) || (data.media ? `Sent a ${data.media.kind}` : '📎 Sent an attachment'),
          url: `/messages/${data.conversationId}`,
          tag: `conv-${data.conversationId}`,
        },
      )
    }
    return message
  })

export const deleteMessage = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ messageId: z.uuid() }))
  .handler(async ({ data, context }) => {
    const [msg] = await db.select().from(messages).where(eq(messages.id, data.messageId))
    if (!msg) throw new HttpError(404, 'Message not found')
    const m = await assertCanAccess(msg.conversationId, context.user.id)
    const isModerator = m.role === 'owner' || m.role === 'moderator'
    if (msg.senderId !== context.user.id && !isModerator) throw new HttpError(403, 'Not allowed')
    await db.update(messages).set({ deletedAt: new Date() }).where(eq(messages.id, msg.id))
    await publish(channels.conversation(msg.conversationId), {
      t: 'message.deleted',
      conversationId: msg.conversationId,
      messageId: msg.id,
    })
  })

export const markRead = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ conversationId: z.uuid(), messageId: z.uuid() }))
  .handler(async ({ data, context }) => {
    const me = context.user.id
    // only move the pointer forward
    const updated = await db
      .update(conversationMembers)
      .set({ lastReadMessageId: data.messageId })
      .where(
        and(
          eq(conversationMembers.conversationId, data.conversationId),
          eq(conversationMembers.userId, me),
          sql`(${conversationMembers.lastReadMessageId} is null or
               (select created_at from ${messages} where id = ${conversationMembers.lastReadMessageId})
               < (select created_at from ${messages} where id = ${data.messageId} and conversation_id = ${data.conversationId}))`,
        ),
      )
      .returning({ userId: conversationMembers.userId })
    if (updated.length) {
      await publish(channels.conversation(data.conversationId), {
        t: 'read',
        conversationId: data.conversationId,
        userId: me,
        messageId: data.messageId,
      })
    }
  })

export const findUserByEmail = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(z.object({ email: z.email() }))
  .handler(async ({ data }) => {
    const [u] = await db
      .select({ id: user.id, name: user.name, image: user.image })
      .from(user)
      .where(eq(user.email, data.email.toLowerCase()))
    return u ? toUserSummary(u) : null
  })
