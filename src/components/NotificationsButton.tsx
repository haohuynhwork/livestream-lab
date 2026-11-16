import { useEffect, useState } from 'react'
import { getVapidPublicKey, savePushSubscription } from '~/server/push'

type State = 'unsupported' | 'default' | 'granted' | 'denied'

function urlBase64ToUint8Array(base64: string) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
}

async function subscribe() {
  const key = await getVapidPublicKey()
  if (!key) throw new Error('Push is not configured on the server')
  const reg = await navigator.serviceWorker.register('/sw.js')
  await navigator.serviceWorker.ready
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) }))
  const json = sub.toJSON()
  await savePushSubscription({
    data: { endpoint: json.endpoint!, keys: { p256dh: json.keys!.p256dh, auth: json.keys!.auth } },
  })
}

export function NotificationsButton() {
  const [state, setState] = useState<State>('unsupported')

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    setState(Notification.permission as State)
    // keep the server's copy of the subscription fresh
    if (Notification.permission === 'granted') subscribe().catch(console.error)
  }, [])

  if (state === 'unsupported' || state === 'granted') return null
  return (
    <button
      className="secondary"
      disabled={state === 'denied'}
      title={state === 'denied' ? 'Notifications are blocked in browser settings' : undefined}
      onClick={async () => {
        const result = await Notification.requestPermission()
        setState(result as State)
        if (result === 'granted') await subscribe()
      }}
    >
      🔔 Enable notifications
    </button>
  )
}
