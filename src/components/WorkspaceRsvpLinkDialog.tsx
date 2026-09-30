import { useEffect, useState } from 'react'
import { Check, Copy, Link2, LoaderCircle, RotateCcw, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { copyTextToClipboard } from '../lib/copyTextToClipboard'

export function WorkspaceRsvpLinkDialog({ workspaceId, workspaceName, onClose }: { workspaceId: string; workspaceName: string; onClose: () => void }) {
  const [token, setToken] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [copiedLabel, setCopiedLabel] = useState('')
  const link = token ? `${window.location.origin}/#rsvp/${token}` : ''
  const apiEndpoint = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/public-rsvp`
  const submitJson = JSON.stringify({
    action: 'submit',
    token: token || 'YOUR_RSVP_TOKEN',
    name: 'Guest name',
    guestCount: 2,
    rsvp: 'confirmed',
    checkinDate: '2027-02-19',
  }, null, 2)

  useEffect(() => {
    let active = true
    async function loadActiveLink() {
      if (!supabase) {
        setError('RSVP links are unavailable because Supabase is not configured.')
        setLoading(false)
        return
      }
      const { data, error: loadError } = await supabase.rpc('get_active_workspace_rsvp_link', {
        requested_workspace_id: workspaceId,
      })
      if (!active) return
      if (loadError) setError('Could not load the active RSVP link. Please try again.')
      else if (typeof data === 'string') setToken(data)
      setLoading(false)
    }
    void loadActiveLink()
    return () => { active = false }
  }, [workspaceId])

  async function createLink(rotate = false) {
    if (!supabase) return
    if (rotate && !window.confirm('Create a new link? The old shared RSVP link will stop working.')) return
    setBusy(true)
    setError('')
    setMessage('')
    const { data, error: linkError } = await supabase.rpc('get_or_create_workspace_rsvp_link', {
      requested_workspace_id: workspaceId,
      rotate_link: rotate,
    })
    setBusy(false)
    if (linkError || !data) {
      setError('Could not create the shared RSVP link. Check your access and try again.')
      return
    }
    setToken(data as string)
    setMessage(rotate ? 'A new link is ready. The old one no longer works.' : 'Your shared RSVP link is ready.')
  }

  async function copyValue(value: string, label: string) {
    try {
      await copyTextToClipboard(value)
      setCopiedLabel(label)
      window.setTimeout(() => setCopiedLabel(current => current === label ? '' : current), 2000)
      setMessage(`${label} copied.`)
      setError('')
    } catch {
      setError(`Could not copy the ${label.toLowerCase()}. Select and copy it from the field.`)
    }
  }

  async function revokeLink() {
    if (!supabase || !token || !window.confirm('Turn off this RSVP link? Anyone with it will no longer be able to submit a response.')) return
    setBusy(true)
    setError('')
    const { error: revokeError } = await supabase.rpc('revoke_workspace_rsvp_link', { requested_workspace_id: workspaceId })
    setBusy(false)
    if (revokeError) {
      setError('Could not turn off the RSVP link. Please try again.')
      return
    }
    setToken('')
    setMessage('The shared RSVP link has been turned off.')
  }

  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><section className="guest-dialog public-rsvp-link-dialog" role="dialog" aria-modal="true" aria-labelledby="public-rsvp-link-title">
    <header className="dialog-header"><div><span className="guest-eyebrow">SHARE WITH EVERYONE</span><h2 id="public-rsvp-link-title">RSVP link</h2><p className="people-workspace-name">{workspaceName}</p></div><button className="dialog-close" onClick={onClose} aria-label="Close"><X size={20} /></button></header>
    <div className="public-rsvp-link-body"><p>Use the web page for guests, or the POST endpoint to connect another app. Both submit to this planning space.</p>
      <div className="public-rsvp-link-options">
        <section className="public-rsvp-link-option web-link-option">
          <div className="public-rsvp-link-option-heading"><span className="public-rsvp-link-icon"><Link2 size={17} /></span><div><span className="public-rsvp-link-kicker">FOR GUESTS</span><h3>Web RSVP page</h3></div>{token && <span className="public-rsvp-active-badge"><Check size={12} />Active</span>}</div>
          <p>Share this page so guests can fill in the RSVP form themselves.</p>
          {loading ? <div className="public-rsvp-link-loading"><LoaderCircle className="spin" size={16} />Checking active link…</div>
            : token ? <><div className="public-rsvp-copy-row"><input aria-label="Active web RSVP link" value={link} readOnly onFocus={event => event.currentTarget.select()} /><button type="button" className="secondary-button" onClick={() => void copyValue(link, 'Web link')}>{copiedLabel === 'Web link' ? <Check size={15} /> : <Copy size={15} />}{copiedLabel === 'Web link' ? 'Copied' : 'Copy'}</button></div><div className="public-rsvp-link-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => void createLink(true)}>{busy ? <LoaderCircle className="spin" size={15} /> : <RotateCcw size={15} />}Replace link</button><button type="button" className="danger-button" disabled={busy} onClick={() => void revokeLink()}><X size={15} />Turn off</button></div><small className="public-rsvp-link-note">Replacing it immediately disables the old URL.</small></>
              : <button type="button" className="primary-button" disabled={busy} onClick={() => void createLink()}>{busy ? <LoaderCircle className="spin" size={16} /> : <Link2 size={16} />}{busy ? 'Creating…' : 'Create web RSVP link'}</button>}
        </section>

        <section className="public-rsvp-link-option api-link-option">
          <div className="public-rsvp-link-option-heading"><span className="public-rsvp-link-icon api-link-icon"><span>{'{ }'}</span></span><div><span className="public-rsvp-link-kicker">FOR INTEGRATIONS</span><h3>POST endpoint</h3></div><span className="public-rsvp-method">POST</span></div>
          <p>Send JSON from another app. Include the active RSVP token in the request body.</p>
          <div className="public-rsvp-copy-row"><input aria-label="RSVP POST endpoint" value={apiEndpoint} readOnly onFocus={event => event.currentTarget.select()} /><button type="button" className="secondary-button" onClick={() => void copyValue(apiEndpoint, 'POST endpoint')}>{copiedLabel === 'POST endpoint' ? <Check size={15} /> : <Copy size={15} />}{copiedLabel === 'POST endpoint' ? 'Copied' : 'Copy'}</button></div>
          <small className="public-rsvp-link-note">Use <code>Content-Type: application/json</code> and your public Supabase key in the <code>apikey</code> header. Never use the service-role key.</small>
          <details className="public-rsvp-json-details"><summary>View request JSON</summary><pre>{submitJson}</pre><button type="button" className="text-button" onClick={() => void copyValue(submitJson, 'Request JSON')}>{copiedLabel === 'Request JSON' ? <Check size={14} /> : <Copy size={14} />}{copiedLabel === 'Request JSON' ? 'Copied' : 'Copy JSON'}</button></details>
        </section>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-message" role="status"><Check size={15} />{message}</p>}
    </div><footer className="dialog-actions"><button className="secondary-button" onClick={onClose}>Done</button></footer>
  </section></div>
}
