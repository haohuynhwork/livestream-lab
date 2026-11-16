import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { CallDTO } from '~/lib/events'
import { useRealtimeEvent } from '~/lib/realtime-client'
import { declineCall } from '~/server/calls'

export function IncomingCall() {
  const [call, setCall] = useState<CallDTO | null>(null)
  const navigate = useNavigate()

  useRealtimeEvent((e) => {
    if (e.t === 'call.incoming') setCall(e.call)
    if (e.t === 'call.updated' && e.callId === call?.id && e.status !== 'ringing') setCall(null)
  })

  // stop ringing after 45s even if nobody tells us
  useEffect(() => {
    if (!call) return
    const t = setTimeout(() => setCall(null), 45_000)
    const ring = startRingtone()
    return () => {
      clearTimeout(t)
      ring()
    }
  }, [call])

  if (!call) return null
  return (
    <div className="overlay">
      <div className="card incoming">
        <p className="muted">Incoming {call.video ? 'video' : 'voice'} call</p>
        <h2>{call.from?.name ?? 'Someone'}</h2>
        {call.conversationTitle !== call.from?.name && <p className="muted">{call.conversationTitle}</p>}
        <div className="row">
          <button
            className="secondary"
            onClick={async () => {
              setCall(null)
              await declineCall({ data: { callId: call.id } })
            }}
          >
            Decline
          </button>
          <button
            className="accept"
            onClick={() => {
              setCall(null)
              void navigate({ to: '/call/$callId', params: { callId: call.id } })
            }}
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  )
}

function startRingtone() {
  try {
    const ctx = new AudioContext()
    const gain = ctx.createGain()
    gain.gain.value = 0
    gain.connect(ctx.destination)
    const osc = ctx.createOscillator()
    osc.frequency.value = 480
    osc.connect(gain)
    osc.start()
    // 1s on / 2s off
    const tick = () => {
      const t = ctx.currentTime
      gain.gain.setValueAtTime(0.08, t)
      gain.gain.setValueAtTime(0, t + 1)
    }
    tick()
    const i = setInterval(tick, 3000)
    return () => {
      clearInterval(i)
      void ctx.close()
    }
  } catch {
    return () => {}
  }
}
