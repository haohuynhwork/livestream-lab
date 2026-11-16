import { useEffect, useState } from 'react'
import { Link, createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import {
  ControlBar,
  GridLayout,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  useLocalParticipantPermissions,
  useParticipants,
  useTracks,
} from '@livekit/components-react'
import { Track, type Participant } from 'livekit-client'
import { Chat } from '~/components/Chat'
import { RecordButton } from '~/components/RecordButton'
import { endStream, getStream, getStreamToken, setFollow, setStagePermission } from '~/server/streams'

export const Route = createFileRoute('/live/$streamId')({
  loader: ({ params }) => getStream({ data: { streamId: params.streamId } }),
  head: ({ loaderData }) => ({ meta: [{ title: loaderData ? `${loaderData.stream.title} · Livestream` : 'Livestream' }] }),
  component: StreamPage,
})

function StreamPage() {
  const { stream, isHost, isFollowing } = Route.useLoaderData()
  const { session } = Route.useRouteContext()
  const router = useRouter()
  const navigate = useNavigate()
  const [conn, setConn] = useState<{ token: string; url: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ended, setEnded] = useState(stream.status !== 'live')

  useEffect(() => {
    if (stream.status !== 'live') return
    getStreamToken({ data: { streamId: stream.id } })
      .then(setConn)
      .catch((e) => setError((e as Error).message))
  }, [stream.id, stream.status])

  return (
    <main className="wide stream-layout">
      <section className="stream-main">
        <div className="stream-stage" data-lk-theme="default">
          {ended ? (
            <div className="stage-message">This stream has ended.</div>
          ) : error ? (
            <div className="stage-message error">{error}</div>
          ) : !conn ? (
            <div className="stage-message muted">Connecting…</div>
          ) : (
            <LiveKitRoom
              token={conn.token}
              serverUrl={conn.url}
              connect
              video={isHost}
              audio={isHost}
              onDisconnected={() => setEnded(true)}
              className="lk-room"
            >
              <Stage />
              <RoomAudioRenderer />
              <PublisherControls />
              {isHost && <HostPanel streamId={stream.id} />}
            </LiveKitRoom>
          )}
        </div>
        <div className="stream-info">
          <div>
            <h1>
              {stream.status === 'live' && !ended && <span className="live-badge">LIVE</span>} {stream.title}
            </h1>
            <p className="muted">{stream.host.name}</p>
            {stream.description && <p>{stream.description}</p>}
          </div>
          <div className="row">
            {session && !isHost && (
              <button
                className={isFollowing ? 'secondary' : ''}
                onClick={async () => {
                  await setFollow({ data: { userId: stream.host.id, follow: !isFollowing } })
                  await router.invalidate()
                }}
              >
                {isFollowing ? 'Following' : 'Follow'}
              </button>
            )}
            {isHost && !ended && (
              <>
                <RecordButton target={{ kind: 'stream', id: stream.id }} />
                <button
                  onClick={async () => {
                    if (!confirm('End the stream for everyone?')) return
                    await endStream({ data: { streamId: stream.id } })
                    await navigate({ to: '/' })
                  }}
                >
                  End stream
                </button>
              </>
            )}
          </div>
        </div>
      </section>
      <aside className="stream-chat">
        {stream.chatConversationId ? (
          <Chat
            conversationId={stream.chatConversationId}
            meId={session?.user.id ?? null}
            variant="stream"
            canModerate={isHost}
          />
        ) : null}
      </aside>
      {!session && (
        <p className="muted">
          <Link to="/login" search={{ redirect: `/live/${stream.id}` }}>
            Sign in
          </Link>{' '}
          to chat or join the stage.
        </p>
      )}
    </main>
  )
}

/** Shows everyone who is publishing: the host plus guests on stage. */
function Stage() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: false },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  )
  if (tracks.length === 0) return <div className="stage-message muted">Waiting for the host's video…</div>
  return (
    <GridLayout tracks={tracks} className="stage-grid">
      <ParticipantTile />
    </GridLayout>
  )
}

function PublisherControls() {
  const perms = useLocalParticipantPermissions()
  if (!perms?.canPublish) return null
  return <ControlBar variation="minimal" controls={{ chat: false, leave: false, settings: false }} />
}

function role(p: Participant) {
  try {
    return (JSON.parse(p.metadata || '{}') as { role?: string }).role ?? 'viewer'
  } catch {
    return 'viewer'
  }
}

function HostPanel({ streamId }: { streamId: string }) {
  const participants = useParticipants()
  const audience = participants.filter((p) => !p.isLocal)
  const [open, setOpen] = useState(false)
  return (
    <div className="host-panel">
      <button className="secondary small" onClick={() => setOpen(!open)}>
        👥 {audience.length} watching
      </button>
      {open && (
        <ul className="audience">
          {audience.length === 0 && <li className="muted">No viewers yet</li>}
          {audience.map((p) => {
            const onStage = role(p) === 'guest' || p.permissions?.canPublish
            return (
              <li key={p.identity}>
                <span>{p.name || 'Guest'}</span>
                {!p.identity.startsWith('guest-') && (
                  <button
                    className="secondary small"
                    onClick={() =>
                      setStagePermission({ data: { streamId, identity: p.identity, onStage: !onStage } })
                    }
                  >
                    {onStage ? 'Remove from stage' : 'Invite to stage'}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
