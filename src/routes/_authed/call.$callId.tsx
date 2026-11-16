import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { LiveKitRoom, RoomAudioRenderer, VideoConference, useParticipants } from '@livekit/components-react'
import { RecordButton } from '~/components/RecordButton'
import { useRealtimeEvent } from '~/lib/realtime-client'
import { endCall, getCall, joinCall } from '~/server/calls'

export const Route = createFileRoute('/_authed/call/$callId')({
  loader: ({ params }) => getCall({ data: { callId: params.callId } }),
  component: CallPage,
})

const RING_TIMEOUT_MS = 45_000

function CallPage() {
  const call = Route.useLoaderData()
  const navigate = useNavigate()
  const [conn, setConn] = useState<{ token: string; url: string } | null>(null)
  const [status, setStatus] = useState(call.status)
  const [error, setError] = useState<string | null>(null)

  const leave = async (forEveryone = false) => {
    await endCall({ data: { callId: call.id, forEveryone } }).catch(() => {})
    await navigate({ to: '/messages/$conversationId', params: { conversationId: call.conversationId } })
  }

  useEffect(() => {
    joinCall({ data: { callId: call.id } })
      .then(setConn)
      .catch((e) => setError((e as Error).message))
  }, [call.id])

  useRealtimeEvent((e) => {
    if (e.t === 'call.updated' && e.callId === call.id) setStatus(e.status)
  })

  // caller gives up after the ring timeout
  useEffect(() => {
    if (status !== 'ringing' || !call.isInitiator) return
    const t = setTimeout(() => void leave(), RING_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [status])

  const over = status === 'ended' || status === 'missed' || status === 'declined'

  if (error || over) {
    return (
      <main className="narrow">
        <div className="card center">
          <h2>{error ?? (status === 'declined' ? 'Call declined' : status === 'missed' ? 'No answer' : 'Call ended')}</h2>
          <button onClick={() => leave()}>Back to conversation</button>
        </div>
      </main>
    )
  }

  return (
    <main className="call" data-lk-theme="default">
      {!conn ? (
        <div className="stage-message muted">Connecting…</div>
      ) : (
        <LiveKitRoom
          token={conn.token}
          serverUrl={conn.url}
          connect
          video={call.video}
          audio
          onDisconnected={() => void leave()}
          className="lk-room"
        >
          <div className="call-topbar">
            {status === 'ringing' ? <RingingLabel /> : <RecordButton target={{ kind: 'call', id: call.id }} />}
          </div>
          <VideoConference />
          <RoomAudioRenderer />
        </LiveKitRoom>
      )}
    </main>
  )
}

function RingingLabel() {
  const participants = useParticipants()
  return <span className="muted">{participants.length > 1 ? 'Connecting…' : 'Ringing…'}</span>
}
