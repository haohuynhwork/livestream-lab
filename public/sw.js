self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {}
  event.waitUntil(
    self.registration.showNotification(data.title || 'Livestream', {
      body: data.body,
      tag: data.tag,
      data: { url: data.url || '/' },
      icon: '/favicon.svg',
      renotify: !!data.tag,
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href
  event.waitUntil(
    (async () => {
      const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const w of windows) {
        if (w.url === url && 'focus' in w) return w.focus()
      }
      const existing = windows.find((w) => 'navigate' in w)
      if (existing) {
        await existing.navigate(url)
        return existing.focus()
      }
      return clients.openWindow(url)
    })(),
  )
})
