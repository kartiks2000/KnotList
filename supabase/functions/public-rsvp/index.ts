import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push'

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
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) return response({ error: 'RSVP submissions are not configured yet.' }, 503)

  let input: {
    action?: unknown
    token?: unknown
    name?: unknown
    guestCount?: unknown
    rsvp?: unknown
    checkinDate?: unknown
    checkoutDate?: unknown
  }
  try {
    input = await request.json()
  } catch {
    return response({ error: 'Submit a valid RSVP form.' }, 400)
  }

  const action = input.action
  const token = typeof input.token === 'string' ? input.token : ''
  if (!/^[a-f0-9]{64}$/i.test(token)) return response({ error: 'This RSVP link is invalid or has been turned off.' }, 404)
  if (action !== 'load' && action !== 'submit') return response({ error: 'Choose a valid RSVP action.' }, 400)

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  if (action === 'load') {
    const { data, error } = await adminClient.rpc('get_public_workspace_rsvp_form', { requested_token: token })
    if (error) return response({ error: 'Could not load this RSVP page.' }, 500)
    const workspaceName = data?.[0]?.workspace_name
    if (!workspaceName) return response({ error: 'This RSVP link is invalid or has been turned off.' }, 404)
    return response({ workspaceName, settings: data[0].settings })
  }

  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const rsvp = input.rsvp
  if (!name || name.length > 140) return response({ error: 'Enter your name (up to 140 characters).' }, 400)
  if (rsvp !== 'confirmed' && rsvp !== 'declined') return response({ error: 'Choose Yes or No for your RSVP.' }, 400)

  const { data, error } = await adminClient.rpc('submit_public_workspace_rsvp', {
    requested_token: token,
    requested_form_data: {
      name,
      ...(input.guestCount !== undefined ? { guestCount: input.guestCount } : {}),
      rsvp,
      ...(input.checkinDate !== undefined ? { checkinDate: input.checkinDate } : {}),
      ...(input.checkoutDate !== undefined ? { checkoutDate: input.checkoutDate } : {}),
    },
  })
  if (error) {
    const invalidLink = error.message.includes('invalid or has been turned off')
    return response({ error: invalidLink ? 'This RSVP link is invalid or has been turned off.' : 'Could not save your RSVP. Please check your answers and try again.' }, invalidLink ? 404 : 400)
  }
  const workspaceName = data?.[0]?.workspace_name
  if (!workspaceName) return response({ error: 'Could not save your RSVP. Please try again.' }, 500)

  // The in-app notification is created in the same database transaction as the RSVP.
  // Browser push is best-effort so a missing VAPID setup or a stale subscription
  // never makes a successfully saved RSVP appear to fail.
  const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')
  const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  const vapidSubject = Deno.env.get('VAPID_SUBJECT')
  const appUrl = Deno.env.get('APP_URL')
  const submitted = data[0]
  if (vapidPublicKey && vapidPrivateKey && vapidSubject && appUrl && submitted.workspace_id && submitted.notification_event_id) {
    try {
      const { data: recipients } = await adminClient.rpc('get_workspace_rsvp_notification_recipient_ids', {
        requested_workspace_id: submitted.workspace_id,
      })
      const recipientIds = [...new Set((recipients ?? []).map((row: { user_id: string }) => row.user_id))]
      if (recipientIds.length) {
        const { data: subscriptions } = await adminClient.from('browser_push_subscriptions')
          .select('user_id, endpoint, p256dh, auth')
          .in('user_id', recipientIds)
        webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)
        const answer = submitted.rsvp_status === 'confirmed' ? 'Yes' : 'No'
        const guestCount = Number(submitted.guest_count)
        const payload = JSON.stringify({
          title: 'New self RSVP',
          body: `${name} replied ${answer} (${guestCount} ${guestCount === 1 ? 'person' : 'people'}).`,
          url: new URL('/#home', appUrl).toString(),
        })
        await Promise.allSettled((subscriptions ?? []).map(async subscription => {
          try {
            await webpush.sendNotification({
              endpoint: subscription.endpoint,
              keys: { p256dh: subscription.p256dh, auth: subscription.auth },
            }, payload)
          } catch (pushError) {
            const statusCode = typeof pushError === 'object' && pushError !== null && 'statusCode' in pushError
              ? Number((pushError as { statusCode: unknown }).statusCode)
              : 0
            if (statusCode === 404 || statusCode === 410) {
              await adminClient.from('browser_push_subscriptions')
                .delete()
                .eq('user_id', subscription.user_id)
                .eq('endpoint', subscription.endpoint)
            }
          }
        }))
      }
    } catch (pushError) {
      console.error('Could not send public RSVP browser push notification:', pushError)
    }
  }
  return response({ success: true, workspaceName })
})
