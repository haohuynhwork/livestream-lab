import { createFileRoute } from '@tanstack/react-router'
import { listMyRecordings } from '~/server/recordings'

export const Route = createFileRoute('/_authed/recordings')({
  loader: () => listMyRecordings(),
  component: Recordings,
})

function Recordings() {
  const recordings = Route.useLoaderData()
  return (
    <main>
      <h1>Recordings</h1>
      {recordings.length === 0 && <p className="muted">Recordings of your streams and calls show up here.</p>}
      <div className="recordings">
        {recordings.map((r) => (
          <div key={r.id} className="card">
            <strong>{r.streamTitle ?? 'Call recording'}</strong>
            <div className="muted small">
              {new Date(r.createdAt).toLocaleString()}
              {r.durationMs ? ` · ${Math.round(r.durationMs / 60000)} min` : ''} · {r.status}
            </div>
            {r.status === 'complete' && <video src={r.url} controls preload="metadata" />}
          </div>
        ))}
      </div>
    </main>
  )
}
