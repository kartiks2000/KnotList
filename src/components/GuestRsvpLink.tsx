import { useEffect, useState } from 'react'
import { Check, Copy, Link2, LoaderCircle, RotateCcw } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { copyTextToClipboard } from '../lib/copyTextToClipboard'

export function GuestRsvpLink({ workspaceId, guestId, guestName }: { workspaceId: string; guestId: string; guestName: string }) {
  const [token, setToken] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const link = token ? `${window.location.origin}/#rsvp/${token}` : ''

  async function loadLink() {
    if (!supabase) { setError('RSVP links are unavailable.'); setLoading(false); return }
    setLoading(true); setError('')
    try {
      const { data, error: linkError } = await supabase.rpc('get_or_create_guest_rsvp_link', {
        requested_workspace_id: workspaceId,
        requested_guest_group_id: guestId,
        rotate_link: false,
      })
      if (linkError || typeof data !== 'string') setError('Could not create this guest’s RSVP link. Check admin access and try again.')
      else setToken(data)
    } catch {
      setError('Could not create this guest’s RSVP link. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    async function load() {
      if (!supabase) { setError('RSVP links are unavailable.'); setLoading(false); return }
      try {
      const { data, error: linkError } = await supabase.rpc('get_or_create_guest_rsvp_link', { requested_workspace_id: workspaceId, requested_guest_group_id: guestId, rotate_link: false })
      if (!active) return
      if (linkError || typeof data !== 'string') setError('Could not create this guest’s RSVP link. Check admin access and try again.')
      else setToken(data)
      } catch {
        if (active) setError('Could not create this guest’s RSVP link. Check your connection and try again.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [workspaceId, guestId])

  async function copyLink() {
    try {
      await copyTextToClipboard(link)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
      setMessage('Personal RSVP link copied.')
      setError('')
    } catch {
      setError('Could not copy the link. Select and copy it from the field.')
    }
  }

  async function replaceLink() {
    if (!supabase || busy || !window.confirm(`Replace ${guestName}’s RSVP link? The current link will stop working.`)) return
    setBusy(true); setError(''); setMessage('')
    const { data, error: linkError } = await supabase.rpc('get_or_create_guest_rsvp_link', {
      requested_workspace_id: workspaceId,
      requested_guest_group_id: guestId,
      rotate_link: true,
    })
    setBusy(false)
    if (linkError || typeof data !== 'string') setError('Could not replace this guest’s RSVP link. Please try again.')
    else { setToken(data); setMessage('A new link is ready. The old link has been disabled.') }
  }

  return <section className="guest-documents guest-personal-rsvp" aria-labelledby="guest-personal-rsvp-title"><div className="guest-documents-heading"><div><h3 id="guest-personal-rsvp-title">Personal RSVP link</h3><p>Only this guest entry is updated when they reply.</p></div><Link2 size={17} /></div>{loading ? <p className="guest-documents-empty"><LoaderCircle className="spin" size={15} /> Creating link…</p> : token ? <><div className="public-rsvp-copy-row"><input aria-label={`Personal RSVP link for ${guestName}`} value={link} readOnly onFocus={event => event.currentTarget.select()} /><button type="button" className="secondary-button" onClick={() => void copyLink()}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copied' : 'Copy'}</button></div><button type="button" className="text-button guest-personal-rsvp-replace" disabled={busy} onClick={() => void replaceLink()}>{busy ? <LoaderCircle className="spin" size={14} /> : <RotateCcw size={14} />}Replace link</button></> : <button type="button" className="secondary-button" disabled={busy} onClick={() => void loadLink()}><Link2 size={14} />Try again</button>}{error && <p className="guest-documents-error" role="alert">{error}</p>}{message && <p className="guest-documents-message" role="status"><Check size={14} />{message}</p>}</section>
}
