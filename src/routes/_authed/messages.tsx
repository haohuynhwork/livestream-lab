import { useState } from 'react'
import { Link, Outlet, createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { useRealtimeEvent } from '~/lib/realtime-client'
import { listConversations, startConversation } from '~/server/messaging'

export const Route = createFileRoute('/_authed/messages')({
  loader: () => listConversations(),
  component: MessagesLayout,
})

function MessagesLayout() {
  const conversations = Route.useLoaderData()
  const router = useRouter()

  useRealtimeEvent((e) => {
    if (e.t === 'conversation.updated') void router.invalidate({ filter: (m) => m.routeId === Route.id })
  })

  return (
    <main className="wide messages-layout">
      <aside className="inbox">
        <NewConversation />
        <ul>
          {conversations.length === 0 && <li className="muted">No conversations yet</li>}
          {conversations.map((c) => (
            <li key={c.id}>
              <Link to="/messages/$conversationId" params={{ conversationId: c.id }} className="inbox-item">
                <span className="inbox-title">
                  {c.title}
                  {c.unread > 0 && <span className="badge">{c.unread}</span>}
                </span>
                <span className="muted truncate">{c.lastMessagePreview ?? (c.kind === 'group' ? 'Group created' : 'Say hi')}</span>
              </Link>
            </li>
          ))}
        </ul>
      </aside>
      <section className="thread">
        <Outlet />
      </section>
    </main>
  )
}

function NewConversation() {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const router = useRouter()
  if (!open)
    return (
      <button className="full" onClick={() => setOpen(true)}>
        New message
      </button>
    )
  return (
    <form
      className="new-conv"
      onSubmit={async (e) => {
        e.preventDefault()
        const form = new FormData(e.currentTarget)
        const emails = String(form.get('emails'))
          .split(/[\s,;]+/)
          .filter(Boolean)
        const title = String(form.get('title') || '').trim()
        try {
          const { conversationId } = await startConversation({ data: { emails, title: title || undefined } })
          setOpen(false)
          await router.invalidate({ filter: (m) => m.routeId === Route.id })
          await navigate({ to: '/messages/$conversationId', params: { conversationId } })
        } catch (err) {
          setError((err as Error).message)
        }
      }}
    >
      <input name="emails" placeholder="Emails, comma separated" required autoFocus />
      <input name="title" placeholder="Group name (optional)" maxLength={100} />
      {error && <p className="error small">{error}</p>}
      <div className="row">
        <button type="button" className="secondary" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button>Start</button>
      </div>
    </form>
  )
}
