import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return response({ error: 'Method not allowed.' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')
  const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  const vapidSubject = Deno.env.get('VAPID_SUBJECT')
  const appUrl = Deno.env.get('APP_URL')
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey || !vapidSubject || !appUrl) {
    return response({ error: 'Browser push is not configured on the server.' }, 503)
  }

  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) return response({ error: 'Sign in to send this notification.' }, 401)
  const accessToken = authorization.slice('Bearer '.length)
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: callerData, error: callerError } = await callerClient.auth.getUser(accessToken)
  if (callerError || !callerData.user) return response({ error: 'Your session is invalid or expired.' }, 401)

  let input: { notificationEventId?: unknown }
  try {
    input = await request.json()
  } catch {
    return response({ error: 'Provide a valid lodging event.' }, 400)
  }
  const notificationEventId = typeof input.notificationEventId === 'string' ? input.notificationEventId : ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(notificationEventId)) {
    return response({ error: 'Choose a valid lodging notification.' }, 400)
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: event, error: eventError } = await adminClient.from('lodging_notification_events')
    .select('id, actor_user_id, workspace_id, event_type, guest_name, notification_detail, push_claimed_at')
    .eq('id', notificationEventId)
    .maybeSingle()
  if (eventError) return response({ error: 'Could not verify the lodging event.' }, 500)
  if (!event || event.actor_user_id !== callerData.user.id) return response({ error: 'This lodging event is not available to your account.' }, 403)
  if (event.push_claimed_at) return response({ sent: 0, alreadyProcessed: true })

  const { data: claimedEvent, error: claimError } = await adminClient.from('lodging_notification_events')
    .update({ push_claimed_at: new Date().toISOString() })
    .eq('id', notificationEventId)
    .eq('actor_user_id', callerData.user.id)
    .is('push_claimed_at', null)
    .select('id, workspace_id, event_type, guest_name, notification_detail')
    .maybeSingle()
  if (claimError) return response({ error: 'Could not claim the lodging notification.' }, 500)
  if (!claimedEvent) return response({ sent: 0, alreadyProcessed: true })

  const recipientFunction = claimedEvent.event_type.startsWith('task_')
    ? 'get_workspace_task_notification_recipient_ids'
    : claimedEvent.event_type.startsWith('rsvp_')
      ? 'get_workspace_rsvp_notification_recipient_ids'
      : 'get_lodging_notification_recipient_ids'
  const { data: recipients, error: recipientsError } = await adminClient.rpc(recipientFunction, {
    requested_workspace_id: claimedEvent.workspace_id,
  })
  if (recipientsError) return response({ error: 'Could not find notification recipients.' }, 500)
  const recipientIds = [...new Set((recipients ?? []).map((row: { user_id: string }) => row.user_id))]
    .filter(userId => userId !== callerData.user.id)
  if (recipientIds.length === 0) return response({ sent: 0 })

  const { data: subscriptions, error: subscriptionsError } = await adminClient
    .from('browser_push_subscriptions')
    .select('user_id, endpoint, p256dh, auth')
    .in('user_id', recipientIds)
  if (subscriptionsError) return response({ error: 'Could not load browser subscriptions.' }, 500)

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)
  const isTaskUpdate = claimedEvent.event_type.startsWith('task_')
  const isRsvpUpdate = claimedEvent.event_type.startsWith('rsvp_')
  const title = isTaskUpdate ? (claimedEvent.event_type === 'task_created' ? 'New task' : 'New task comment') : isRsvpUpdate ? 'Guest RSVP update' : 'Lodging update'
  const body = isTaskUpdate
    ? claimedEvent.event_type === 'task_created' ? `A task was created: ${claimedEvent.guest_name}` : `A comment was added to: ${claimedEvent.guest_name}`
    : isRsvpUpdate ? 'A guest RSVP status has changed.'
      : claimedEvent.event_type === 'checked_in' ? 'A guest has been checked in.' : 'A guest has been checked out.'
  const payload = JSON.stringify({ title, body, url: new URL('/#home', appUrl).toString() })
  const results = await Promise.allSettled((subscriptions ?? []).map(async subscription => {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, payload)
      return true
    } catch (error) {
      const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error
        ? Number((error as { statusCode: unknown }).statusCode)
        : 0
      if (statusCode === 404 || statusCode === 410) {
        await adminClient.from('browser_push_subscriptions')
          .delete()
          .eq('user_id', subscription.user_id)
          .eq('endpoint', subscription.endpoint)
      }
      return false
    }
  }))
  const sent = results.filter(result => result.status === 'fulfilled' && result.value).length
  return response({ sent })
})
