// Shared between the app server, the realtime server and the browser.

export type UserSummary = { id: string; name: string; image: string | null }

export type AttachmentDTO = {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number
  url: string
}

export type MessageDTO = {
  id: string
  conversationId: string
  body: string | null
  createdAt: string
  deleted: boolean
  sender: UserSummary | null
  attachments: AttachmentDTO[]
}

export type CallDTO = {
  id: string
  conversationId: string
  video: boolean
  status: 'ringing' | 'active' | 'ended' | 'missed' | 'declined'
  from: UserSummary | null
  conversationTitle: string
}

export type RealtimeEvent =
  | { t: 'message'; message: MessageDTO }
  | { t: 'message.deleted'; conversationId: string; messageId: string }
  | { t: 'typing'; conversationId: string; user: UserSummary }
  | { t: 'read'; conversationId: string; userId: string; messageId: string }
  | { t: 'conversation.updated'; conversationId: string }
  | { t: 'call.incoming'; call: CallDTO }
  | { t: 'call.updated'; callId: string; conversationId: string; status: CallDTO['status'] }
  | { t: 'stream.live'; streamId: string; title: string; host: UserSummary }

export type ClientCommand =
  | { t: 'sub'; conversationId: string }
  | { t: 'unsub'; conversationId: string }
  | { t: 'typing'; conversationId: string }
