import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { goLive } from '~/server/streams'

export const Route = createFileRoute('/_authed/go-live')({
  component: GoLive,
})

function GoLive() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  return (
    <main className="narrow">
      <div className="card">
        <h1>Go live</h1>
        <p className="muted">Your camera and microphone start streaming as soon as the stream opens.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            const form = new FormData(e.currentTarget)
            setPending(true)
            try {
              const { streamId } = await goLive({
                data: {
                  title: String(form.get('title')),
                  description: String(form.get('description') || '') || undefined,
                },
              })
              await navigate({ to: '/live/$streamId', params: { streamId } })
            } catch (err) {
              setError((err as Error).message)
              setPending(false)
            }
          }}
        >
          <input name="title" placeholder="Stream title" maxLength={120} required autoFocus />
          <textarea name="description" placeholder="Description (optional)" rows={3} maxLength={1000} />
          {error && <p className="error">{error}</p>}
          <button disabled={pending}>{pending ? 'Starting…' : 'Start streaming'}</button>
        </form>
      </div>
    </main>
  )
}
