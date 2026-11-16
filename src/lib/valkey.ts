import Redis from 'ioredis'
import type { RealtimeEvent } from './events'

let client: Redis | undefined

export function valkey() {
  client ??= new Redis(process.env.VALKEY_URL!)
  return client
}

export const channels = {
  conversation: (id: string) => `conv:${id}`,
  user: (id: string) => `user:${id}`,
}

export function publish(channel: string, event: RealtimeEvent) {
  return valkey().publish(channel, JSON.stringify(event))
}

export function publishToUsers(userIds: string[], event: RealtimeEvent) {
  const pipe = valkey().pipeline()
  for (const id of userIds) pipe.publish(channels.user(id), JSON.stringify(event))
  return pipe.exec()
}

export const presenceKey = (userId: string) => `presence:${userId}`

export async function onlineUserIds(userIds: string[]) {
  if (userIds.length === 0) return new Set<string>()
  const vals = await valkey().mget(userIds.map(presenceKey))
  return new Set(userIds.filter((_, i) => vals[i] !== null))
}
