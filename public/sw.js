self.addEventListener('push', event => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    if (clients.some(client => client.visibilityState === 'visible')) return undefined
    return self.registration.showNotification(data.title || 'KnotList', {
      body: data.body || 'There is a lodging update.',
      icon: '/heart-icon.svg',
      badge: '/heart-icon.svg',
      data: { url: data.url || '/' },
    })
  }))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const targetUrl = new URL(event.notification.data?.url || '/', self.location.origin).href
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => {
    for (const client of clients) {
      if (client.url.startsWith(self.location.origin) && 'focus' in client) {
        await client.focus()
        if ('navigate' in client && client.url !== targetUrl) await client.navigate(targetUrl)
        return
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(targetUrl)
  }))
})
