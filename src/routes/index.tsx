import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  const { session } = Route.useRouteContext()
  return (
    <div className="card">
      <h1>Live now</h1>
      <p className="muted">
        {session ? `Welcome, ${session.user.name}.` : 'Sign in to go live, chat and call.'} Streams
        arrive in phase 3.
      </p>
    </div>
  )
}
