import { createClient } from 'npm:@supabase/supabase-js@2'

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
  const appUrl = Deno.env.get('APP_URL')
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !appUrl) {
    return response({ error: 'The invite function is missing required Supabase or APP_URL secrets.' }, 500)
  }

  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) return response({ error: 'Sign in to invite people.' }, 401)
  const accessToken = authorization.slice('Bearer '.length)

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: callerData, error: callerError } = await callerClient.auth.getUser(accessToken)
  if (callerError || !callerData.user) return response({ error: 'Your session is invalid or expired. Sign in again.' }, 401)

  let input: { workspaceId?: unknown; email?: unknown }
  try {
    input = await request.json()
  } catch {
    return response({ error: 'Provide a valid invite request.' }, 400)
  }
  const workspaceId = typeof input.workspaceId === 'string' ? input.workspaceId : ''
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workspaceId)) return response({ error: 'Choose a valid planning space.' }, 400)
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response({ error: 'Enter a valid email address.' }, 400)

  const { data: canManageUsers, error: permissionError } = await callerClient.rpc('has_permission', {
    requested_permission: 'users.manage',
    requested_workspace_id: null,
  })
  if (permissionError) return response({ error: 'Could not verify your workspace permissions.' }, 500)
  if (!canManageUsers) return response({ error: 'Only a super admin can invite people to a planning space.' }, 403)

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: workspace, error: workspaceError } = await adminClient
    .from('workspaces')
    .select('id')
    .eq('id', workspaceId)
    .maybeSingle()
  if (workspaceError) return response({ error: 'Could not verify the planning space.' }, 500)
  if (!workspace) return response({ error: 'That planning space does not exist.' }, 404)

  const { data: adminRole, error: roleError } = await adminClient
    .from('roles')
    .select('id')
    .eq('key', 'admin')
    .is('workspace_id', null)
    .single()
  if (roleError || !adminRole) return response({ error: 'The built-in Admin role is missing. Apply the role migration first.' }, 500)

  const { data: existingProfile, error: profileError } = await adminClient
    .from('profiles')
    .select('id, email_confirmed_at')
    .eq('email', email)
    .maybeSingle()
  if (profileError) return response({ error: 'Could not look up that account.' }, 500)

  if (existingProfile?.email_confirmed_at) {
    const { data: existingMembership, error: membershipLookupError } = await adminClient
      .from('workspace_memberships')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', existingProfile.id)
      .maybeSingle()
    if (membershipLookupError) return response({ error: 'Could not check existing workspace access.' }, 500)
    if (existingMembership) return response({ error: 'That person is already a member of this planning space.' }, 409)

    const { error: membershipError } = await adminClient.from('workspace_memberships').insert({
      workspace_id: workspaceId,
      user_id: existingProfile.id,
      role_id: adminRole.id,
    })
    if (membershipError) return response({ error: 'Could not add this person to the planning space.' }, 500)
    return response({ status: 'added', email })
  }

  if (existingProfile) {
    const { error: membershipError } = await adminClient.from('workspace_memberships').insert({
      workspace_id: workspaceId,
      user_id: existingProfile.id,
      role_id: adminRole.id,
    })
    if (membershipError && membershipError.code !== '23505') return response({ error: 'Could not add this person to the planning space.' }, 500)
    return response({ status: 'pending_confirmation', email })
  }

  const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
    redirectTo: appUrl,
    data: { knotlist_workspace_invite: true },
  })
  if (inviteError || !inviteData.user) {
    const alreadyRegistered = inviteError?.message.toLowerCase().includes('already')
    return response({
      error: alreadyRegistered
        ? 'This email already has an account. Ask them to sign in, then invite that account again.'
        : 'Supabase could not send the invitation. Check Auth email settings and try again.',
    }, 400)
  }

  const { error: membershipError } = await adminClient.from('workspace_memberships').insert({
    workspace_id: workspaceId,
    user_id: inviteData.user.id,
    role_id: adminRole.id,
  })
  if (membershipError && membershipError.code !== '23505') {
    return response({ error: 'The Auth invitation was sent, but workspace access could not be assigned. Retry the invite after checking the workspace membership table.' }, 500)
  }

  return response({ status: 'invited', email })
})
