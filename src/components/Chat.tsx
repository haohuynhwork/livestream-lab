import { useCallback, useEffect, useRef, useState } from 'react'
import type { AttachmentDTO, MessageDTO, UserSummary } from '~/lib/events'
import { useConversationChannel, useRealtimeEvent } from '~/lib/realtime-client'
import { deleteMessage, getMessages, markRead, sendMessage } from '~/server/messaging'

type Props = {
  conversationId: string
  meId: string | null
  variant: 'thread' | 'stream'
  canModerate?: boolean
  /** members' last-read message ids, for "Seen" receipts in threads */
  readState?: { id: string; name: string; lastRead: string | null }[]
}

export function Chat({ conversationId, meId, variant, canModerate, readState }: Props) {
  const [messages, setMessages] = useState<MessageDTO[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [typing, setTyping] = useState<Map<string, { user: UserSummary; until: number }>>(new Map())
  const [reads, setReads] = useState(() => new Map(readState?.map((r) => [r.id, r.lastRead]) ?? []))
  const listRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const channel = useConversationChannel(meId ? conversationId : null)

  useEffect(() => {
    let cancelled = false
    setMessages([])
    getMessages({ data: { conversationId } }).then((res) => {
      if (cancelled) return
      setMessages(res.messages)
      setHasMore(res.hasMore)
      stickToBottom.current = true
    })
    return () => {
      cancelled = true
    }
  }, [conversationId])

  useEffect(() => {
    setReads(new Map(readState?.map((r) => [r.id, r.lastRead]) ?? []))
  }, [readState])

  useRealtimeEvent((e) => {
    if (e.t === 'message' && e.message.conversationId === conversationId) {
      setMessages((prev) => (prev.some((m) => m.id === e.message.id) ? prev : [...prev, e.message]))
      setTyping((prev) => {
        if (!e.message.sender || !prev.has(e.message.sender.id)) return prev
        const next = new Map(prev)
        next.delete(e.message.sender.id)
        return next
      })
    } else if (e.t === 'message.deleted' && e.conversationId === conversationId) {
      setMessages((prev) =>
        prev.map((m) => (m.id === e.messageId ? { ...m, deleted: true, body: null, attachments: [] } : m)),
      )
    } else if (e.t === 'typing' && e.conversationId === conversationId) {
      setTyping((prev) => new Map(prev).set(e.user.id, { user: e.user, until: Date.now() + 4000 }))
    } else if (e.t === 'read' && e.conversationId === conversationId) {
      setReads((prev) => new Map(prev).set(e.userId, e.messageId))
    }
  })

  // expire typing indicators
  useEffect(() => {
    if (typing.size === 0) return
    const t = setInterval(() => {
      setTyping((prev) => {
        const now = Date.now()
        const next = new Map([...prev].filter(([, v]) => v.until > now))
        return next.size === prev.size ? prev : next
      })
    }, 1000)
    return () => clearInterval(t)
  }, [typing.size])

  // keep scrolled to the newest message unless the user scrolled up
  useEffect(() => {
    const el = listRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [messages, typing])

  // read receipts for threads
  const last = messages[messages.length - 1]
  useEffect(() => {
    if (variant !== 'thread' || !meId || !last || last.sender?.id === meId) return
    if (document.visibilityState !== 'visible') return
    void markRead({ data: { conversationId, messageId: last.id } })
  }, [variant, meId, last?.id, conversationId])

  async function loadOlder() {
    const before = messages[0]?.createdAt
    if (!before) return
    const el = listRef.current
    const prevHeight = el?.scrollHeight ?? 0
    const res = await getMessages({ data: { conversationId, before } })
    stickToBottom.current = false
    setMessages((prev) => [...res.messages, ...prev])
    setHasMore(res.hasMore)
    requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight - prevHeight
    })
  }

  const lastOwnSeenBy = (() => {
    if (variant !== 'thread' || !meId) return null
    const idx = new Map(messages.map((m, i) => [m.id, i]))
    const lastOwn = messages.findLastIndex((m) => m.sender?.id === meId)
    if (lastOwn < 0) return null
    const seers = (readState ?? []).filter((r) => {
      if (r.id === meId) return false
      const readId = reads.get(r.id)
      return readId != null && (idx.get(readId) ?? -1) >= lastOwn
    })
    return seers.length ? { index: lastOwn, names: seers.map((s) => s.name) } : null
  })()

  const typers = [...typing.values()].map((t) => t.user.name)

  return (
    <div className={`chat chat-${variant}`}>
      <div
        className="chat-list"
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
      >
        {hasMore && (
          <button className="secondary small" onClick={loadOlder}>
            Load older
          </button>
        )}
        {messages.length === 0 && <p className="muted center">No messages yet</p>}
        {messages.map((m, i) => (
          <MessageRow
            key={m.id}
            message={m}
            mine={m.sender?.id === meId}
            compact={variant === 'stream'}
            canDelete={!m.deleted && (m.sender?.id === meId || !!canModerate)}
            seenBy={lastOwnSeenBy?.index === i ? lastOwnSeenBy.names : null}
          />
        ))}
      </div>
      <div className="chat-typing muted">
        {typers.length > 0 && `${typers.slice(0, 3).join(', ')} ${typers.length > 1 ? 'are' : 'is'} typing…`}
      </div>
      {meId ? (
        <Composer
          conversationId={conversationId}
          allowAttachments={variant === 'thread'}
          onTyping={channel.typing}
          onSent={(m) => {
            stickToBottom.current = true
            setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]))
          }}
        />
      ) : (
        <p className="muted center">
          <a href="/login">Sign in</a> to chat
        </p>
      )}
    </div>
  )
}

function MessageRow(props: {
  message: MessageDTO
  mine: boolean
  compact: boolean
  canDelete: boolean
  seenBy: string[] | null
}) {
  const { message: m, mine, compact } = props
  const time = new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return (
    <div className={`msg ${mine && !compact ? 'mine' : ''} ${compact ? 'compact' : ''}`}>
      <div className="msg-bubble">
        {(compact || !mine) && <strong className="msg-sender">{m.sender?.name ?? 'Deleted user'}</strong>}
        {m.deleted ? (
          <em className="muted">Message deleted</em>
        ) : (
          <>
            {m.body && <span className="msg-body">{m.body}</span>}
            {m.attachments.map((a) => (
              <Attachment key={a.id} a={a} />
            ))}
          </>
        )}
        <span className="msg-meta muted">
          {time}
          {props.canDelete && (
            <button
              className="link"
              title="Delete message"
              onClick={() => deleteMessage({ data: { messageId: m.id } })}
            >
              delete
            </button>
          )}
        </span>
      </div>
      {props.seenBy && <div className="msg-seen muted">Seen by {props.seenBy.join(', ')}</div>}
    </div>
  )
}

function Attachment({ a }: { a: AttachmentDTO }) {
  if (a.mimeType.startsWith('image/')) {
    return (
      <a href={a.url} target="_blank" rel="noreferrer">
        <img className="att-media" src={a.url} alt={a.fileName} loading="lazy" />
      </a>
    )
  }
  if (a.mimeType.startsWith('video/')) return <video className="att-media" src={a.url} controls preload="metadata" />
  if (a.mimeType.startsWith('audio/')) return <audio src={a.url} controls preload="metadata" />
  return (
    <a className="att-file" href={a.url} target="_blank" rel="noreferrer">
      📎 {a.fileName} <span className="muted">({formatBytes(a.sizeBytes)})</span>
    </a>
  )
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 ** 2).toFixed(1)} MB`
}

function Composer(props: {
  conversationId: string
  allowAttachments: boolean
  onTyping: () => void
  onSent: (m: MessageDTO) => void
}) {
  const [body, setBody] = useState('')
  const [pending, setPending] = useState<AttachmentDTO[]>([])
  const [uploading, setUploading] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const upload = useCallback(
    async (files: FileList | File[]) => {
      setError(null)
      for (const file of Array.from(files)) {
        setUploading((n) => n + 1)
        try {
          const form = new FormData()
          form.set('file', file)
          form.set('conversationId', props.conversationId)
          const res = await fetch('/api/attachments', { method: 'POST', body: form })
          if (!res.ok) throw new Error(await res.text())
          const att = (await res.json()) as AttachmentDTO
          setPending((p) => [...p, att])
        } catch (e) {
          setError((e as Error).message)
        } finally {
          setUploading((n) => n - 1)
        }
      }
    },
    [props.conversationId],
  )

  async function submit() {
    const text = body.trim()
    if ((!text && pending.length === 0) || uploading || sending) return
    setSending(true)
    setError(null)
    try {
      const m = await sendMessage({
        data: { conversationId: props.conversationId, body: text || undefined, attachmentIds: pending.map((p) => p.id) },
      })
      setBody('')
      setPending([])
      props.onSent(m)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div
      className="composer"
      onDragOver={(e) => props.allowAttachments && e.preventDefault()}
      onDrop={(e) => {
        if (!props.allowAttachments) return
        e.preventDefault()
        void upload(e.dataTransfer.files)
      }}
    >
      {(pending.length > 0 || uploading > 0) && (
        <div className="composer-pending">
          {pending.map((p) => (
            <span key={p.id} className="chip">
              {p.fileName}
              <button className="link" onClick={() => setPending((x) => x.filter((y) => y.id !== p.id))}>
                ×
              </button>
            </span>
          ))}
          {uploading > 0 && <span className="muted">Uploading {uploading}…</span>}
        </div>
      )}
      {error && <p className="error small">{error}</p>}
      <div className="composer-row">
        {props.allowAttachments && (
          <>
            <button className="secondary icon" title="Attach files" onClick={() => fileRef.current?.click()}>
              📎
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) void upload(e.target.files)
                e.target.value = ''
              }}
            />
          </>
        )}
        <textarea
          rows={1}
          value={body}
          placeholder="Message"
          maxLength={4000}
          onChange={(e) => {
            setBody(e.target.value)
            props.onTyping()
          }}
          onPaste={(e) => {
            if (props.allowAttachments && e.clipboardData.files.length) void upload(e.clipboardData.files)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void submit()
            }
          }}
        />
        <button onClick={submit} disabled={sending || uploading > 0}>
          Send
        </button>
      </div>
    </div>
  )
}
