import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db, schema } from '~/db'
import { authMiddleware } from '~/lib/middleware'

export const getVapidPublicKey = createServerFn({ method: 'GET' }).handler(async () => process.env.VAPID_PUBLIC_KEY ?? null)

export const savePushSubscription = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ endpoint: z.url(), keys: z.object({ p256dh: z.string(), auth: z.string() }) }))
  .handler(async ({ data, context }) => {
    await db
      .insert(schema.pushSubscriptions)
      .values({ userId: context.user.id, endpoint: data.endpoint, keys: data.keys })
      .onConflictDoUpdate({
        target: schema.pushSubscriptions.endpoint,
        set: { userId: context.user.id, keys: data.keys },
      })
  })
