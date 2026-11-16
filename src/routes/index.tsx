import { Link, createFileRoute } from '@tanstack/react-router'
import { listLiveStreams } from '~/server/streams'

export const Route = createFileRoute('/')({
  loader: () => listLiveStreams(),
  component: Home,
})

function Home() {
  const streams = Route.useLoaderData()
  const { session } = Route.useRouteContext()
  return (
    <main>
      <h1>Live now</h1>
      {streams.length === 0 ? (
        <div className="card empty">
          <p>Nobody is live right now.</p>
          {session ? (
            <Link to="/go-live" className="button">
              Start a stream
            </Link>
          ) : (
            <Link to="/login" className="button">
              Sign in to go live
            </Link>
          )}
        </div>
      ) : (
        <div className="stream-grid">
          {streams.map((s) => (
            <Link key={s.id} to="/live/$streamId" params={{ streamId: s.id }} className="stream-card">
              <div className="stream-thumb">
                <span className="live-badge">LIVE</span>
              </div>
              <strong>{s.title}</strong>
              <span className="muted">{s.host.name}</span>
            </Link>
          ))}
        </div>
      )}
    </main>
  )
}
