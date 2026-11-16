import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}

// ---------- Better Auth ----------

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  username: text('username').unique(),
  ...timestamps,
})

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  token: text('token').notNull().unique(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  ...timestamps,
})

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'),
  ...timestamps,
})

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ...timestamps,
})

// ---------- Livestreams ----------

export const streamStatus = pgEnum('stream_status', ['scheduled', 'live', 'ended'])

export const streams = pgTable(
  'streams',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    hostId: text('host_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    status: streamStatus('status').notNull().default('scheduled'),
    // LiveKit room name; one room per stream
    roomName: text('room_name').notNull().unique(),
    chatConversationId: uuid('chat_conversation_id'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index('streams_status_idx').on(t.status), index('streams_host_idx').on(t.hostId)],
)

export const follows = pgTable(
  'follows',
  {
    followerId: text('follower_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    followingId: text('following_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.followerId, t.followingId] })],
)

// ---------- Messaging ----------

export const conversationKind = pgEnum('conversation_kind', ['direct', 'group', 'stream'])

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: conversationKind('kind').notNull(),
  title: text('title'),
  createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
  ...timestamps,
})

export const memberRole = pgEnum('member_role', ['owner', 'moderator', 'member'])

export const conversationMembers = pgTable(
  'conversation_members',
  {
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: memberRole('role').notNull().default('member'),
    lastReadMessageId: uuid('last_read_message_id'),
    mutedUntil: timestamp('muted_until', { withTimezone: true }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.userId] }),
    index('members_user_idx').on(t.userId),
  ],
)

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    senderId: text('sender_id').references(() => user.id, { onDelete: 'set null' }),
    body: text('body'),
    replyToId: uuid('reply_to_id'),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('messages_conversation_created_idx').on(t.conversationId, t.createdAt)],
)

export const attachments = pgTable('attachments', {
  id: uuid('id').primaryKey().defaultRandom(),
  messageId: uuid('message_id').references(() => messages.id, { onDelete: 'cascade' }),
  uploaderId: text('uploader_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  // Object key in SeaweedFS (S3 API)
  storageKey: text('storage_key').notNull(),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  width: integer('width'),
  height: integer('height'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ---------- Calls ----------

export const callStatus = pgEnum('call_status', ['ringing', 'active', 'ended', 'missed', 'declined'])

export const calls = pgTable('calls', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  initiatorId: text('initiator_id').references(() => user.id, { onDelete: 'set null' }),
  roomName: text('room_name').notNull().unique(),
  video: boolean('video').notNull().default(true),
  status: callStatus('status').notNull().default('ringing'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ---------- Recordings (LiveKit Egress -> SeaweedFS) ----------

export const recordings = pgTable('recordings', {
  id: uuid('id').primaryKey().defaultRandom(),
  egressId: text('egress_id').notNull().unique(),
  streamId: uuid('stream_id').references(() => streams.id, { onDelete: 'cascade' }),
  callId: uuid('call_id').references(() => calls.id, { onDelete: 'cascade' }),
  storageKey: text('storage_key'),
  durationMs: integer('duration_ms'),
  status: text('status').notNull().default('starting'),
  ...timestamps,
})

// ---------- Web Push ----------

export const pushSubscriptions = pgTable('push_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  endpoint: text('endpoint').notNull().unique(),
  keys: jsonb('keys').$type<{ p256dh: string; auth: string }>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
