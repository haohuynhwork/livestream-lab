import { sendNotification, setVapidDetails } from 'web-push'
import { inArray, eq } from 'drizzle-orm'
import { db, schema } from '~/db'

let configured = false
function configure() {
  if (configured) return true
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return false
  setVapidDetails(
    process.env.VAPID_SUBJECT ?? 'mailto:admin@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  )
  configured = true
  return true
}

export type PushPayload = { title: string; body: string; url: string; tag?: string }

export async function sendPush(userIds: string[], payload: PushPayload) {
  if (userIds.length === 0 || !configure()) return
  const subs = await db
    .select()
    .from(schema.pushSubscriptions)
    .where(inArray(schema.pushSubscriptions.userId, userIds))
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify(payload), { TTL: 60 })
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) {
          await db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.id, sub.id))
        } else {
          console.error('push failed', status, err)
        }
      }
    }),
  )
}
