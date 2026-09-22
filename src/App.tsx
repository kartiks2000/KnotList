import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { ArrowRight, Heart, LoaderCircle, LockKeyhole, LogOut, Mail, Plus, ShieldCheck, UserRound, Users } from 'lucide-react'
import { supabase } from './lib/supabase'
import { GuestList } from './components/GuestList'

type Workspace = { id: string; name: string }

type AuthMode = 'sign-in' | 'sign-up'

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loadingSession, setLoadingSession] = useState(true)
  const [mode, setMode] = useState<AuthMode>('sign-in')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!supabase) {
      setLoadingSession(false)
      return
    }
    let alive = true
    supabase.auth.getSession().then(({ data }) => {
      if (alive) {
        setSession(data.session)
        setLoadingSession(false)
      }
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
    })
    return () => {
      alive = false
      subscription.unsubscribe()
    }
  }, [])

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      if (mode === 'sign-up') {
        const { data, error: authError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { display_name: name.trim() } },
        })
        if (authError) throw authError
        if (!data.session) setMessage('Check your inbox to confirm your email. You can sign in after confirming it.')
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (authError) throw authError
      }
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function signOut() {
    if (!supabase) return
    const { error: authError } = await supabase.auth.signOut()
    if (authError) setError(authError.message)
    else setError('')
  }

  if (!supabase) {
    return <main className="auth-page"><div className="auth-card setup-error"><Brand /><h1>Connect your Supabase project</h1><p>Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to <code>.env.local</code>, then restart the dev server.</p></div></main>
  }

  if (loadingSession) return <main className="auth-page"><div className="loading-state"><LoaderCircle className="spin" size={24} /><span>Loading your account…</span></div></main>

  if (session) {
    const invitedUser = session.user.user_metadata.knotlist_workspace_invite === true
      && session.user.user_metadata.knotlist_invite_completed !== true
    return invitedUser
      ? <CompleteInvitedAccount session={session} />
      : <AuthenticatedHome session={session} onSignOut={signOut} />
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <Brand />
        <div className="auth-heading"><span className="auth-eyebrow">A LITTLE SPACE FOR WHAT MATTERS</span><h1>{mode === 'sign-in' ? 'Welcome back.' : 'Make yourself at home.'}</h1><p className="auth-description">{mode === 'sign-in' ? 'Sign in to continue to your planning space.' : 'Create your account to get started.'}</p></div>
        <div className="auth-tabs" role="tablist" aria-label="Account access">
          <button role="tab" aria-selected={mode === 'sign-in'} className={mode === 'sign-in' ? 'selected' : ''} onClick={() => { setMode('sign-in'); setMessage(''); setError('') }}>Sign in</button>
          <button role="tab" aria-selected={mode === 'sign-up'} className={mode === 'sign-up' ? 'selected' : ''} onClick={() => { setMode('sign-up'); setMessage(''); setError('') }}>Create account</button>
        </div>
        <form className="auth-form" onSubmit={submitAuth}>
          {mode === 'sign-up' && <label className="field-label">Your name<div className="input-wrap"><UserRound size={17} /><input autoComplete="name" value={name} onChange={event => setName(event.target.value)} placeholder="How should we call you?" required maxLength={100} /></div></label>}
          <label className="field-label">Email address<div className="input-wrap"><Mail size={17} /><input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" required /></div></label>
          <label className="field-label">Password<div className="input-wrap"><LockKeyhole size={17} /><input type="password" autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} value={password} onChange={event => setPassword(event.target.value)} placeholder="At least 8 characters" minLength={8} required /></div></label>
          {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-message" role="status">{message}</p>}
          <button className="primary-button auth-submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <>{mode === 'sign-in' ? 'Sign in' : 'Create account'} <ArrowRight size={17} /></>}</button>
        </form>
        <div className="auth-footnote">By continuing, you agree to use this space respectfully.</div>
      </div>
      <div className="auth-decoration" aria-hidden="true"><span className="deco-orbit orbit-a" /><span className="deco-orbit orbit-b" /><span className="deco-sun" /><span className="deco-flower">✳</span><span className="deco-heart">♡</span><span className="deco-caption">A new chapter, together</span></div>
    </main>
  )
}

function CompleteInvitedAccount({ session }: { session: Session }) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function setAccountPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    if (password !== confirmPassword) {
      setError('Those passwords do not match.')
      return
    }
    setBusy(true)
    setError('')
    const { error: updateError } = await supabase.auth.updateUser({
      password,
      data: { ...session.user.user_metadata, knotlist_invite_completed: true },
    })
    setBusy(false)
    if (updateError) setError(updateError.message)
  }

  return <main className="auth-page"><div className="auth-card"><Brand /><div className="auth-heading"><span className="auth-eyebrow">YOU’RE INVITED</span><h1>Set your password.</h1><p className="auth-description">Choose a password to finish joining this planning space.</p></div><form className="auth-form" onSubmit={setAccountPassword}><label className="field-label">Password<div className="input-wrap"><LockKeyhole size={17} /><input type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="At least 8 characters" minLength={8} required /></div></label><label className="field-label">Confirm password<div className="input-wrap"><LockKeyhole size={17} /><input type="password" autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} placeholder="Enter the password again" minLength={8} required /></div></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button auth-submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}Finish setup</button></form></div><div className="auth-decoration" aria-hidden="true"><span className="deco-orbit orbit-a" /><span className="deco-orbit orbit-b" /><span className="deco-sun" /><span className="deco-flower">✳</span><span className="deco-heart">♡</span><span className="deco-caption">A new chapter, together</span></div></main>
}

function AuthenticatedHome({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const [loading, setLoading] = useState(true)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [assignedRoles, setAssignedRoles] = useState<string[]>([])
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState('')
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [newWorkspaceName, setNewWorkspaceName] = useState('')
  const [creatingWorkspace, setCreatingWorkspace] = useState(false)

  useEffect(() => {
    if (!supabase) return
    let alive = true
    async function loadAccess() {
      setLoading(true)
      setError('')
      const [platformResult, membershipResult] = await Promise.all([
        supabase!.from('platform_roles').select('role_id').eq('user_id', session.user.id),
        supabase!.from('workspace_memberships').select('role_id, workspace_id').eq('user_id', session.user.id),
      ])
      if (!alive) return
      if (platformResult.error || membershipResult.error) {
        setError(platformResult.error?.message ?? membershipResult.error?.message ?? 'Could not load your access.')
        setLoading(false)
        return
      }

      const platformRoleIds = (platformResult.data ?? []).map(row => row.role_id)
      const memberships = membershipResult.data ?? []
      const roleIds = [...new Set([...platformRoleIds, ...memberships.map(row => row.role_id)])]
      const rolesResult = roleIds.length
        ? await supabase!.from('roles').select('id, key, name').in('id', roleIds)
        : { data: [], error: null }
      if (!alive) return
      if (rolesResult.error) {
        setError(rolesResult.error.message)
        setLoading(false)
        return
      }
      const roles = rolesResult.data ?? []
      const superAdmin = roles.some(role => role.key === 'super_admin')
      setIsSuperAdmin(superAdmin)
      setAssignedRoles(roles.map(role => role.name))

      const workspaceIds = [...new Set(memberships.map(row => row.workspace_id))]
      const workspaceResult = superAdmin
        ? await supabase!.from('workspaces').select('id, name').order('created_at', { ascending: true })
        : workspaceIds.length
          ? await supabase!.from('workspaces').select('id, name').in('id', workspaceIds).order('created_at', { ascending: true })
          : { data: [], error: null }
      if (!alive) return
      if (workspaceResult.error) {
        setError(workspaceResult.error.message)
        setLoading(false)
        return
      }
      const available = (workspaceResult.data ?? []) as Workspace[]
      setWorkspaces(available)
      setActiveWorkspaceId(current => available.some(item => item.id === current) ? current : (available[0]?.id ?? ''))
      setLoading(false)
    }
    void loadAccess()
    return () => { alive = false }
  }, [session, retry])

  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    setCreatingWorkspace(true)
    setError('')
    const { data, error: createError } = await supabase.from('workspaces').insert({ name: newWorkspaceName.trim(), created_by: session.user.id }).select('id, name').single()
    setCreatingWorkspace(false)
    if (createError) {
      setError(createError.message)
      return
    }
    const workspace = data as Workspace
    setWorkspaces(current => [...current, workspace])
    setActiveWorkspaceId(workspace.id)
    setNewWorkspaceName('')
  }

  if (loading) return <main className="auth-page"><div className="loading-state"><LoaderCircle className="spin" size={24} /><span>Loading your planning space…</span></div></main>

  if (workspaces.length > 0 && activeWorkspaceId) {
    const activeWorkspace = workspaces.find(item => item.id === activeWorkspaceId)!
    return <GuestList workspaceId={activeWorkspace.id} workspaces={workspaces} onWorkspaceChange={setActiveWorkspaceId} accountEmail={session.user.email ?? ''} onSignOut={onSignOut} />
  }

  if (isSuperAdmin) return <main className="auth-page"><div className="auth-card workspace-setup-card"><Brand /><div className="success-mark"><Users size={24} /></div><span className="auth-eyebrow">SUPER ADMIN</span><h1>Create your planning space.</h1><p className="auth-description">A planning space keeps a wedding’s guest list private and organized.</p><div className="signed-email"><span className="email-avatar"><UserRound size={17} /></span><span>{session.user.email}</span><span className="verified-dot" /></div><form className="workspace-create-form" onSubmit={createWorkspace}><label className="field-label">Planning space name<div className="input-wrap"><input autoFocus value={newWorkspaceName} onChange={event => setNewWorkspaceName(event.target.value)} placeholder="e.g. Asha & Rahul’s wedding" maxLength={120} required /></div></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button auth-submit" disabled={creatingWorkspace}>{creatingWorkspace ? <LoaderCircle className="spin" size={17} /> : <PlusIcon />}Create planning space</button></form><button className="secondary-button signout-button" onClick={onSignOut}><LogOut size={16} /> Sign out</button></div></main>

  return <main className="auth-page"><div className="auth-card signed-in-card"><Brand /><div className="success-mark"><ShieldCheck size={25} /></div><span className="auth-eyebrow">ACCOUNT READY</span><h1>You’re signed in.</h1><p className="auth-description">Your account doesn’t have a planning space yet. Ask a super admin to assign you to one.</p><div className="signed-email"><span className="email-avatar"><UserRound size={17} /></span><span>{session.user.email}</span><span className="verified-dot" title="Authenticated" /></div>{assignedRoles.length > 0 && <div className="access-summary"><span className="section-kicker">YOUR ACCESS</span><div className="role-chips">{assignedRoles.map(role => <span className="role-chip" key={role}>{role}</span>)}</div></div>}{error && <><p className="form-error" role="alert">{error}</p><button className="text-button" onClick={() => setRetry(value => value + 1)}>Try loading access again</button></>}<button className="secondary-button signout-button" onClick={onSignOut}><LogOut size={16} /> Sign out</button></div></main>
}

function PlusIcon() { return <Plus size={17} /> }

function Brand() {
  return <a className="brand auth-brand" href="#home"><span className="brand-mark"><Heart size={17} strokeWidth={1.8} /></span><span>knotlist</span></a>
}

export default App
