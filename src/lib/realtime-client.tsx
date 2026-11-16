import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { ClientCommand, RealtimeEvent } from './events'

type Handler = (event: RealtimeEvent) => void

class RealtimeConnection {
  private ws: WebSocket | null = null
  private handlers = new Set<Handler>()
  private subs = new Map<string, number>()
  private retry = 0
  private closed = false
  private timer: ReturnType<typeof setTimeout> | undefined
  onStatus: (connected: boolean) => void = () => {}

  constructor(private url: string) {
    this.connect()
  }

  private connect() {
    const ws = new WebSocket(this.url)
    this.ws = ws
    ws.onopen = () => {
      this.retry = 0
      this.onStatus(true)
      // restore subscriptions after a reconnect
      for (const id of this.subs.keys()) this.send({ t: 'sub', conversationId: id })
    }
    ws.onmessage = (e) => {
      const event = JSON.parse(e.data) as RealtimeEvent
      for (const h of this.handlers) h(event)
    }
    ws.onclose = () => {
      this.onStatus(false)
      if (this.closed) return
      const delay = Math.min(30_000, 500 * 2 ** this.retry++)
      this.timer = setTimeout(() => this.connect(), delay)
    }
  }

  send(cmd: ClientCommand) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(cmd))
  }

  subscribe(conversationId: string) {
    const n = this.subs.get(conversationId) ?? 0
    this.subs.set(conversationId, n + 1)
    if (n === 0) this.send({ t: 'sub', conversationId })
    return () => {
      const left = (this.subs.get(conversationId) ?? 1) - 1
      if (left > 0) return void this.subs.set(conversationId, left)
      this.subs.delete(conversationId)
      this.send({ t: 'unsub', conversationId })
    }
  }

  on(handler: Handler) {
    this.handlers.add(handler)
    return () => void this.handlers.delete(handler)
  }

  close() {
    this.closed = true
    clearTimeout(this.timer)
    this.ws?.close()
  }
}

const Ctx = createContext<{ conn: RealtimeConnection | null; connected: boolean }>({ conn: null, connected: false })

export function RealtimeProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [conn, setConn] = useState<RealtimeConnection | null>(null)
  const [connected, setConnected] = useState(false)
  useEffect(() => {
    if (!enabled) return
    const url = import.meta.env.VITE_REALTIME_URL ?? `ws://${location.hostname}:3001`
    const c = new RealtimeConnection(url)
    c.onStatus = setConnected
    setConn(c)
    return () => {
      c.close()
      setConn(null)
    }
  }, [enabled])
  return <Ctx.Provider value={{ conn, connected }}>{children}</Ctx.Provider>
}

export function useRealtime() {
  return useContext(Ctx)
}

/** Calls `handler` for every realtime event; the latest handler is always used. */
export function useRealtimeEvent(handler: Handler) {
  const { conn } = useRealtime()
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => conn?.on((e) => ref.current(e)), [conn])
}

export function useConversationChannel(conversationId: string | null | undefined) {
  const { conn } = useRealtime()
  useEffect(() => {
    if (!conn || !conversationId) return
    return conn.subscribe(conversationId)
  }, [conn, conversationId])
  return {
    typing: () => conversationId && conn?.send({ t: 'typing', conversationId }),
  }
}
