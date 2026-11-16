import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authed/messages/')({
  component: () => <div className="thread-empty muted">Select a conversation or start a new one.</div>,
})
