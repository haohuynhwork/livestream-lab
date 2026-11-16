// Standalone WebSocket gateway. The app server publishes events to Valkey;
// this process fans them out to connected browsers and tracks presence.
import 'dotenv/config'
import { createServer } from 'node:http'
import Redis from 'ioredis'
import { WebSocketServer, type WebSocket } from 'ws'
import { auth } from '~/lib/auth'
import type { ClientCommand, RealtimeEvent, UserSummary } from '~/lib/events'
import { channels, presenceKey, publish } from '~/lib/valkey'
import { assertCanAccess, toUserSummary } from '~/server/access'

const PORT = Number(process.env.REALTIME_PORT ?? 3001)
const PRESENCE_TTL = 60
const allowedOrigin = new URL(process.env.BETTER_AUTH_URL ?? 'http://localhost:3000').origin

type Client = { ws: WebSocket; user: UserSummary; conversations: Set<string>; lastTyping: Map<string, number> }

const sub = new Redis(process.env.VALKEY_URL!)
const cmd = new Redis(process.env.VALKEY_URL!)
// channel -> sockets listening on it
const listeners = new Map<string, Set<Client>>()
const socketsByUser = new Map<string, Set<Client>>()

function listen(channel: string, client: Client) {
  let set = listeners.get(channel)
  if (!set) {
    set = new Set()
    listeners.set(channel, set)
    void sub.subscribe(channel)
  }
  set.add(client)
}

function unlisten(channel: string, client: Client) {
  const set = listeners.get(channel)
  if (!set) return
  set.delete(client)
  if (set.size === 0) {
    listeners.delete(channel)
    void sub.unsubscribe(channel)
  }
}

sub.on('message', (channel, payload) => {
  const set = listeners.get(channel)
  if (!set) return
  let event: RealtimeEvent | undefined
  for (const client of set) {
    if (client.ws.readyState !== client.ws.OPEN) continue
    // don't echo typing indicators back to the typist
    if (channel.startsWith('conv:')) {
      event ??= JSON.parse(payload) as RealtimeEvent
      if (event.t === 'typing' && event.user.id === client.user.id) continue
    }
    client.ws.send(payload)
  }
})

async function refreshPresence(userId: string) {
  await cmd.set(presenceKey(userId), '1', 'EX', PRESENCE_TTL)
}

async function handleCommand(client: Client, msg: ClientCommand) {
  switch (msg.t) {
    case 'sub': {
      if (client.conversations.has(msg.conversationId)) return
      await assertCanAccess(msg.conversationId, client.user.id)
      client.conversations.add(msg.conversationId)
      listen(channels.conversation(msg.conversationId), client)
      return
    }
    case 'unsub': {
      client.conversations.delete(msg.conversationId)
      unlisten(channels.conversation(msg.conversationId), client)
      return
    }
    case 'typing': {
      if (!client.conversations.has(msg.conversationId)) return
      const now = Date.now()
      if (now - (client.lastTyping.get(msg.conversationId) ?? 0) < 2000) return
      client.lastTyping.set(msg.conversationId, now)
      await publish(channels.conversation(msg.conversationId), {
        t: 'typing',
        conversationId: msg.conversationId,
        user: client.user,
      })
      return
    }
  }
}

const http = createServer((_req, res) => {
  res.writeHead(200).end('ok')
})
const wss = new WebSocketServer({ noServer: true })

http.on('upgrade', async (req, socket, head) => {
  if (req.headers.origin && req.headers.origin !== allowedOrigin) {
    socket.destroy()
    return
  }
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
  const session = await auth.api.getSession({ headers }).catch(() => null)
  if (!session) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
    socket.destroy()
    return
  }
  wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, toUserSummary(session.user)))
})

function onConnection(ws: WebSocket, user: UserSummary) {
  const client: Client = { ws, user, conversations: new Set(), lastTyping: new Map() }
  let userSockets = socketsByUser.get(user.id)
  if (!userSockets) socketsByUser.set(user.id, (userSockets = new Set()))
  userSockets.add(client)
  listen(channels.user(user.id), client)
  void refreshPresence(user.id)

  let alive = true
  const heartbeat = setInterval(() => {
    if (!alive) return ws.terminate()
    alive = false
    ws.ping()
    void refreshPresence(user.id)
  }, 25_000)
  ws.on('pong', () => (alive = true))

  ws.on('message', async (raw) => {
    try {
      await handleCommand(client, JSON.parse(String(raw)) as ClientCommand)
    } catch (err) {
      ws.send(JSON.stringify({ t: 'error', message: (err as Error).message }))
    }
  })

  ws.on('close', () => {
    clearInterval(heartbeat)
    unlisten(channels.user(user.id), client)
    for (const c of client.conversations) unlisten(channels.conversation(c), client)
    userSockets.delete(client)
    if (userSockets.size === 0) {
      socketsByUser.delete(user.id)
      void cmd.del(presenceKey(user.id))
    }
  })
}

http.listen(PORT, () => console.log(`realtime listening on :${PORT}`))
