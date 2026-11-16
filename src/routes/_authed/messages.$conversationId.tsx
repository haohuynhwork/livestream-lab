import { useState } from 'react'
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { Chat } from '~/components/Chat'
import { useRealtimeEvent } from '~/lib/realtime-client'
import { getConversation } from '~/server/messaging'
import { startCall } from '~/server/calls'

export const Route = createFileRoute('/_authed/messages/$conversationId')({
  loader: ({ params }) => getConversation({ data: { conversationId: params.conversationId } }),
  component: Thread,
})

function Thread() {
  const conv = Route.useLoaderData()
  const { session } = Route.useRouteContext()
  const navigate = useNavigate()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  // refresh the inbox (unread counts) when we read or receive messages here
  useRealtimeEvent((e) => {
    const id = e.t === 'message' ? e.message.conversationId : e.t === 'read' ? e.conversationId : null
    if (id === conv.id) {
      void router.invalidate({ filter: (m) => m.routeId === '/_authed/messages' })
    }
  })

  async function call(video: boolean) {
    try {
      const { callId } = await startCall({ data: { conversationId: conv.id, video } })
      await navigate({ to: '/call/$callId', params: { callId } })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <>
      <div className="thread-header">
        <div>
          <strong>{conv.title}</strong>
          {conv.kind === 'group' && <div className="muted small">{conv.members.length} members</div>}
        </div>
        <div className="row">
          {error && <span className="error small">{error}</span>}
          <button className="secondary" title="Voice call" onClick={() => call(false)}>
            📞
          </button>
          <button className="secondary" title="Video call" onClick={() => call(true)}>
            🎥
          </button>
        </div>
      </div>
      <Chat
        key={conv.id}
        conversationId={conv.id}
        meId={session.user.id}
        variant="thread"
        canModerate={conv.kind === 'group' && (conv.myRole === 'owner' || conv.myRole === 'moderator')}
        readState={conv.members}
      />
    </>
  )
}
