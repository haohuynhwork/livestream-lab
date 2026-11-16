import { AccessToken, EgressClient, RoomServiceClient } from 'livekit-server-sdk'

const apiKey = () => process.env.LIVEKIT_API_KEY!
const apiSecret = () => process.env.LIVEKIT_API_SECRET!
const httpUrl = () => process.env.LIVEKIT_URL!.replace(/^ws/, 'http')

export const roomService = () => new RoomServiceClient(httpUrl(), apiKey(), apiSecret())
export const egressClient = () => new EgressClient(httpUrl(), apiKey(), apiSecret())

export async function createToken(opts: {
  room: string
  identity: string
  name: string
  canPublish: boolean
  canPublishData?: boolean
  metadata?: string
}) {
  const at = new AccessToken(apiKey(), apiSecret(), {
    identity: opts.identity,
    name: opts.name,
    metadata: opts.metadata,
    ttl: '6h',
  })
  at.addGrant({
    room: opts.room,
    roomJoin: true,
    canSubscribe: true,
    canPublish: opts.canPublish,
    canPublishData: opts.canPublishData ?? opts.canPublish,
  })
  return { token: await at.toJwt(), url: process.env.LIVEKIT_PUBLIC_URL ?? process.env.LIVEKIT_URL! }
}
