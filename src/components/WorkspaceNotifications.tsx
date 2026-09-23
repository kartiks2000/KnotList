import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bell, Check, LoaderCircle, X } from 'lucide-react'
import { supabase } from '../lib/supabase'

type WorkspaceNotification = {
  id: string
  event_type: 'checked_in' | 'checked_out' | 'rsvp_confirmed' | 'rsvp_maybe' | 'rsvp_declined'
  guest_name: string
  created_at: string
  read_at: string | null
}

function notificationTitle(notification: WorkspaceNotification) {
  switch (notification.event_type) {
    case 'checked_in': return `${notification.guest_name} checked in`
    case 'checked_out': return `${notification.guest_name} checked out`
    case 'rsvp_confirmed': return `${notification.guest_name} RSVP: Confirmed`
    case 'rsvp_maybe': return `${notification.guest_name} RSVP: Not sure yet`
    case 'rsvp_declined': return `${notification.guest_name} RSVP: Declined`
  }
}

const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? ''

function decodeApplicationServerKey(value: string) {
  const padding = '='.repeat((4 - value.length % 4) % 4)
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(window.atob(base64), character => character.charCodeAt(0))
}

function timeLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function WorkspaceNotifications({ workspaceId }: { workspaceId: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mobileBellRef = useRef<HTMLButtonElement>(null)
  const [notifications, setNotifications] = useState<WorkspaceNotification[]>([])
  const [mobileNav, setMobileNav] = useState<HTMLElement | null>(null)
  const [open, setOpen] = useState(false)
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    setMobileNav(document.querySelector<HTMLElement>('.mobile-workspace-nav'))
  }, [])

  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target) && !mobileBellRef.current?.contains(event.target)) {
        setOpen(false)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const loadNotifications = useCallback(async () => {
    if (!supabase) return
    const { data } = await supabase.from('workspace_notifications')
      .select('id, event_type, guest_name, created_at, read_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(25)
    if (data) setNotifications(data as WorkspaceNotification[])
  }, [workspaceId])

  useEffect(() => {
    if (!supabase) return
    void loadNotifications()
    const channel = supabase.channel(`workspace-notifications-${workspaceId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'workspace_notifications',
        filter: `workspace_id=eq.${workspaceId}`,
      }, payload => {
        const notification = payload.new as WorkspaceNotification
        setNotifications(current => [notification, ...current.filter(item => item.id !== notification.id)].slice(0, 25))
      })
      .subscribe()
    return () => { void supabase?.removeChannel(channel) }
  }, [workspaceId, loadNotifications])

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return
    void navigator.serviceWorker.getRegistration('/').then(async registration => {
      const subscription = await registration?.pushManager.getSubscription()
      setPushEnabled(Boolean(subscription))
    }).catch(() => setPushEnabled(false))
  }, [])

  async function getCurrentUserId() {
    if (!supabase) throw new Error('Supabase is not configured.')
    const { data, error } = await supabase.auth.getUser()
    if (error || !data.user) throw new Error('Sign in again to manage browser notifications.')
    return data.user.id
  }

  async function enablePush() {
    if (!supabase) return
    setPushBusy(true)
    setMessage('')
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        throw new Error('This browser does not support push notifications.')
      }
      if (!window.isSecureContext) throw new Error('Browser notifications require HTTPS.')
      if (!vapidPublicKey) throw new Error('Browser push is not configured yet. Add the public VAPID key to the web app environment.')
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') throw new Error(permission === 'denied' ? 'Allow notifications in your browser’s site settings, then try again.' : 'Allow notifications to turn on browser push.')

      const registration = await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeApplicationServerKey(vapidPublicKey),
      })
      const keys = subscription.toJSON().keys
      if (!keys?.p256dh || !keys.auth) throw new Error('The browser did not return a valid push subscription.')
      const userId = await getCurrentUserId()
      const { error } = await supabase.from('browser_push_subscriptions').upsert({
        user_id: userId,
        endpoint: subscription.endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,endpoint' })
      if (error) throw error
      setPushEnabled(true)
      setMessage('Browser notifications are on for this device.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not enable browser notifications.')
    } finally {
      setPushBusy(false)
    }
  }

  async function disablePush() {
    if (!supabase) return
    setPushBusy(true)
    setMessage('')
    try {
      const registration = await navigator.serviceWorker.getRegistration('/')
      const subscription = await registration?.pushManager.getSubscription()
      if (subscription) {
        const userId = await getCurrentUserId()
        const { error } = await supabase.from('browser_push_subscriptions')
          .delete()
          .eq('user_id', userId)
          .eq('endpoint', subscription.endpoint)
        if (error) throw error
        await subscription.unsubscribe()
      }
      setPushEnabled(false)
      setMessage('Browser notifications are off for this device.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not turn off browser notifications.')
    } finally {
      setPushBusy(false)
    }
  }

  async function markRead(notification: WorkspaceNotification) {
    if (!supabase || notification.read_at) return
    const readAt = new Date().toISOString()
    setNotifications(current => current.map(item => item.id === notification.id ? { ...item, read_at: readAt } : item))
    const { error } = await supabase.from('workspace_notifications').update({ read_at: readAt }).eq('id', notification.id)
    if (error) void loadNotifications()
  }

  const unreadCount = notifications.reduce((count, item) => count + (item.read_at ? 0 : 1), 0)
  const canPush = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

  const toggleNotifications = () => { setOpen(value => !value); setMessage('') }
  const bellLabel = `Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`
  const mobileBell = mobileNav ? createPortal(<button ref={mobileBellRef} type="button" className="notification-bell mobile-notification-bell" aria-label={bellLabel} aria-expanded={open} onClick={toggleNotifications}>
    <span className="mobile-notification-icon"><Bell size={18} />{unreadCount > 0 && <span className="notification-count">{unreadCount > 9 ? '9+' : unreadCount}</span>}</span><span>Alerts</span>
  </button>, mobileNav) : null

  return <>{mobileBell}<div className="workspace-notifications" ref={containerRef}>
    <button type="button" className="notification-bell desktop-notification-bell" aria-label={bellLabel} aria-expanded={open} onClick={toggleNotifications}>
      <Bell size={17} />{unreadCount > 0 && <span className="notification-count">{unreadCount > 9 ? '9+' : unreadCount}</span>}
    </button>
    {open && <button type="button" className="notification-backdrop" aria-label="Close notifications" onClick={() => setOpen(false)} />}
    {open && <section className="notification-popover" aria-label="Notifications">
      <header className="notification-popover-header"><div><strong>Notifications</strong><small>{unreadCount ? `${unreadCount} unread` : 'Lodging and RSVP updates'}</small></div><button type="button" onClick={() => setOpen(false)} aria-label="Close notifications"><X size={17} /></button></header>
      <div className="notification-push-setting">
        <div><strong>Browser push</strong><small>{pushEnabled ? 'Enabled on this device' : 'Get planning updates when KnotList is closed'}</small></div>
        {!canPush ? <span className="notification-unavailable">Unsupported</span> : <button type="button" className="notification-push-button" disabled={pushBusy} onClick={() => void (pushEnabled ? disablePush() : enablePush())}>{pushBusy ? <LoaderCircle className="spin" size={14} /> : pushEnabled ? 'Turn off' : 'Enable'}</button>}
      </div>
      {message && <p className="notification-message" role="status">{message}</p>}
      <div className="notification-list">
        {notifications.length === 0 ? <p className="notification-empty">No notifications yet.</p> : notifications.map(notification => <button type="button" className={`notification-item ${notification.read_at ? '' : 'notification-unread'}`} key={notification.id} onClick={() => void markRead(notification)}>
          <span className="notification-item-icon"><Check size={14} /></span>
          <span className="notification-item-copy"><strong>{notificationTitle(notification)}</strong><small>{timeLabel(notification.created_at)}</small></span>
          {!notification.read_at && <span className="notification-unread-dot" />}
        </button>)}
      </div>
      <p className="notification-device-note">On iPhone or iPad, add KnotList to your Home Screen before enabling push.</p>
    </section>}
  </div></>
}
