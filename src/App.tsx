import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { ArrowRight, Heart, LoaderCircle, LockKeyhole, LogOut, Mail, ShieldCheck, UserRound } from 'lucide-react'
import { supabase } from './lib/supabase'

type AuthMode = 'sign-in' | 'sign-up'

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loadingSession, setLoadingSession] = useState(true)
  const [mode, setMode] = useState<AuthMode>('sign-in')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [accessLoading, setAccessLoading] = useState(false)
  const [assignedRoles, setAssignedRoles] = useState<string[]>([])
  const [workspaceCount, setWorkspaceCount] = useState(0)
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

  useEffect(() => {
    if (!session || !supabase) {
      setAssignedRoles([])
      setWorkspaceCount(0)
      return
    }
    let alive = true
    const userId = session.user.id
    setAccessLoading(true)
    async function loadAssignedRoles() {
      const [platformResult, membershipResult] = await Promise.all([
        supabase!.from('platform_roles').select('role_id').eq('user_id', userId),
        supabase!.from('workspace_memberships').select('role_id, workspace_id').eq('user_id', userId),
      ])
      if (!alive) return
      if (platformResult.error || membershipResult.error) {
        setAssignedRoles([])
        setWorkspaceCount(0)
        setAccessLoading(false)
        return
      }
      const roleIds = [...new Set([
        ...(platformResult.data ?? []).map(row => row.role_id),
        ...(membershipResult.data ?? []).map(row => row.role_id),
      ])]
      setWorkspaceCount((membershipResult.data ?? []).length)
      if (roleIds.length === 0) {
        setAssignedRoles([])
        setAccessLoading(false)
        return
      }
      const { data: roles } = await supabase!.from('roles').select('id, name').in('id', roleIds)
      if (alive) {
        setAssignedRoles((roles ?? []).map(role => role.name))
        setAccessLoading(false)
      }
    }
    void loadAssignedRoles()
    return () => { alive = false }
  }, [session])

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
    return <main className="auth-page"><div className="auth-card signed-in-card"><Brand /><div className="success-mark"><ShieldCheck size={25} /></div><span className="auth-eyebrow">ACCOUNT READY</span><h1>You’re signed in.</h1><p className="auth-description">{accessLoading ? 'Checking your access…' : assignedRoles.length > 0 ? 'Your assigned app roles are ready.' : 'Your account is ready. A super admin can assign you to a workspace when access is needed.'}</p><div className="signed-email"><span className="email-avatar"><UserRound size={17} /></span><span>{session.user.email}</span><span className="verified-dot" title="Authenticated" /></div>{!accessLoading && assignedRoles.length > 0 && <div className="access-summary"><span className="section-kicker">YOUR ACCESS</span><div className="role-chips">{assignedRoles.map(role => <span className="role-chip" key={role}>{role}</span>)}</div>{workspaceCount > 0 && <p>Member of {workspaceCount} {workspaceCount === 1 ? 'workspace' : 'workspaces'}</p>}</div>}{error && <p className="form-error">{error}</p>}<button className="secondary-button signout-button" onClick={signOut}><LogOut size={16} /> Sign out</button><div className="auth-footnote">Need access? Ask your workspace administrator.</div></div></main>
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

function Brand() {
  return <a className="brand auth-brand" href="#home"><span className="brand-mark"><Heart size={17} strokeWidth={1.8} /></span><span>knotlist</span></a>
}

export default App
