import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { CalendarDays, Check, Copy, Eye, Link2, LoaderCircle, Plus, RotateCcw, Save, Settings2, Trash2, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { DEFAULT_PUBLIC_RSVP_SETTINGS, dateOptionLabel, normalizePublicRsvpSettings } from '../lib/publicRsvp'
import type { PublicRsvpDateOption, PublicRsvpSettings } from '../lib/publicRsvp'

export function RsvpSettingsModule({ workspaceId, workspaceName }: { workspaceId: string; workspaceName: string }) {
  const [settings, setSettings] = useState<PublicRsvpSettings>(DEFAULT_PUBLIC_RSVP_SETTINGS)
  const [token, setToken] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [linkBusy, setLinkBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)

  const webLink = token ? `${window.location.origin}/#rsvp/${token}` : ''
  const apiEndpoint = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/public-rsvp`
  const requestExample = useMemo(() => JSON.stringify({
    action: 'submit',
    token: token || 'YOUR_RSVP_TOKEN',
    name: 'Guest name',
    ...(settings.askGuestCount ? { guestCount: 2 } : {}),
    rsvp: 'confirmed',
    ...(settings.askCheckinDate && settings.checkinOptions[0] ? { checkinDate: settings.checkinOptions[0].date } : {}),
    ...(settings.askCheckoutDate && settings.checkoutOptions[0] ? { checkoutDate: settings.checkoutOptions[0].date } : {}),
  }, null, 2), [token, settings])

  useEffect(() => {
    let active = true
    async function loadSettings() {
      if (!supabase) {
        setError('Settings are unavailable because Supabase is not configured.')
        setLoading(false)
        return
      }
      const [settingsResult, linkResult] = await Promise.all([
        supabase.rpc('get_workspace_public_rsvp_settings', { requested_workspace_id: workspaceId }),
        supabase.rpc('get_active_workspace_rsvp_link', { requested_workspace_id: workspaceId }),
      ])
      if (!active) return
      if (settingsResult.error) setError('Could not load RSVP settings. Apply the RSVP settings database migration, then try again.')
      else setSettings(normalizePublicRsvpSettings(settingsResult.data))
      if (!linkResult.error && typeof linkResult.data === 'string') setToken(linkResult.data)
      setLoading(false)
    }
    void loadSettings()
    return () => { active = false }
  }, [workspaceId])

  function update<K extends keyof PublicRsvpSettings>(key: K, value: PublicRsvpSettings[K]) {
    setSettings(current => ({ ...current, [key]: value }))
    setMessage('')
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    setError('')
    setMessage('')
    if (settings.askCheckinDate && settings.checkinOptions.length === 0) {
      setError('Add at least one check-in date option, or turn that field off.')
      return
    }
    if (settings.askCheckoutDate && settings.checkoutOptions.length === 0) {
      setError('Add at least one check-out date option, or turn that field off.')
      return
    }
    if ((settings.askCheckinDate && new Set(settings.checkinOptions.map(option => option.date)).size !== settings.checkinOptions.length)
      || (settings.askCheckoutDate && new Set(settings.checkoutOptions.map(option => option.date)).size !== settings.checkoutOptions.length)) {
      setError('Remove duplicate dates from the choices.')
      return
    }
    if ((settings.askCheckinDate && settings.checkinOptions.some(option => !option.date))
      || (settings.askCheckoutDate && settings.checkoutOptions.some(option => !option.date))) {
      setError('Choose a date for each option, or remove the empty option.')
      return
    }
    setSaving(true)
    const { error: saveError } = await supabase.rpc('save_workspace_public_rsvp_settings', {
      requested_workspace_id: workspaceId,
      requested_settings: settings,
    })
    setSaving(false)
    if (saveError) setError('Could not save RSVP settings. Check your access and try again.')
    else setMessage('RSVP form settings saved.')
  }

  async function createLink(rotate = false) {
    if (!supabase) return
    if (rotate && !window.confirm('Replace the active link? The current web URL and tokens in saved integrations will stop working.')) return
    setLinkBusy(true)
    setError('')
    setMessage('')
    const { data, error: linkError } = await supabase.rpc('get_or_create_workspace_rsvp_link', {
      requested_workspace_id: workspaceId,
      rotate_link: rotate,
    })
    setLinkBusy(false)
    if (linkError || !data) setError('Could not create the RSVP link. Check your access and try again.')
    else {
      setToken(data as string)
      setMessage(rotate ? 'A replacement link is active. The previous link has been disabled.' : 'Your shared RSVP link is active.')
    }
  }

  async function turnOffLink() {
    if (!supabase || !token || !window.confirm('Turn off this RSVP link? The web page and direct POST submissions using its token will stop working.')) return
    setLinkBusy(true)
    setError('')
    const { error: revokeError } = await supabase.rpc('revoke_workspace_rsvp_link', { requested_workspace_id: workspaceId })
    setLinkBusy(false)
    if (revokeError) setError('Could not turn off the RSVP link. Please try again.')
    else {
      setToken('')
      setMessage('The RSVP link has been turned off.')
    }
  }

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value)
      setMessage(`${label} copied.`)
      setError('')
    } catch {
      setError(`Could not copy ${label.toLowerCase()}. Select and copy it from the field.`)
    }
  }

  function updateDateOptions(key: 'checkinOptions' | 'checkoutOptions', options: PublicRsvpDateOption[]) {
    update(key, options)
  }

  if (loading) return <div className="guest-loading"><LoaderCircle className="spin" size={22} /> Loading settings…</div>

  return <section className="rsvp-settings-page">
    <header className="rsvp-settings-heading"><div><span className="guest-eyebrow">PLANNING SPACE SETTINGS</span><h1>RSVP form</h1><p>Choose what guests are asked and manage the links they use to reply.</p></div><button type="button" className="secondary-button rsvp-preview-toggle" onClick={() => setPreviewOpen(value => !value)}><Eye size={15} />{previewOpen ? 'Hide preview' : 'Preview form'}</button></header>

    <div className="rsvp-settings-layout">
      <form className="rsvp-settings-form" onSubmit={saveSettings}>
        <section className="rsvp-settings-card">
          <div className="rsvp-settings-card-heading"><span className="rsvp-settings-icon"><Settings2 size={17} /></span><div><h2>Form introduction</h2><p>Set the message guests see before they reply.</p></div></div>
          <label className="form-field">Heading<input value={settings.title} onChange={event => update('title', event.target.value)} maxLength={80} required /></label>
          <label className="form-field">Welcome message<textarea value={settings.intro} onChange={event => update('intro', event.target.value)} rows={2} maxLength={280} /></label>
        </section>

        <section className="rsvp-settings-card">
          <div className="rsvp-settings-card-heading"><span className="rsvp-settings-icon"><Check size={17} /></span><div><h2>Guest questions</h2><p>Name and RSVP are required so replies can be added to your guest list.</p></div></div>
          <div className="rsvp-fixed-field"><span><strong>Guest name</strong><small>Always required</small></span><span className="rsvp-required-label">Required</span></div>
          <div className="rsvp-fixed-field"><span><strong>RSVP response</strong><small>Yes or No</small></span><span className="rsvp-required-label">Required</span></div>
          <ToggleField title="Number of people" description="Ask how many people are included in this reply." checked={settings.askGuestCount} onChange={value => update('askGuestCount', value)} />
          <div className="rsvp-settings-divider" />
          <label className="form-field">Yes response label<input value={settings.yesLabel} onChange={event => update('yesLabel', event.target.value)} maxLength={80} required /></label>
          <label className="form-field">No response label<input value={settings.noLabel} onChange={event => update('noLabel', event.target.value)} maxLength={80} required /></label>
        </section>

        <DateQuestionEditor title="Check-in date" description="Offer a set of check-in dates for guests to choose from." enabled={settings.askCheckinDate} options={settings.checkinOptions} onEnabled={value => update('askCheckinDate', value)} onChange={options => updateDateOptions('checkinOptions', options)} />
        <DateQuestionEditor title="Check-out date" description="Optionally collect a check-out date from a set of choices." enabled={settings.askCheckoutDate} options={settings.checkoutOptions} onEnabled={value => update('askCheckoutDate', value)} onChange={options => updateDateOptions('checkoutOptions', options)} />

        {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-message" role="status"><Check size={15} />{message}</p>}
        <div className="rsvp-settings-save"><button className="primary-button" disabled={saving}><Save size={16} />{saving ? 'Saving…' : 'Save form settings'}</button></div>
      </form>

      <aside className="rsvp-settings-aside">
        {previewOpen && <RsvpFormPreview workspaceName={workspaceName} settings={settings} />}
        <section className="rsvp-settings-card rsvp-share-card">
          <div className="rsvp-settings-card-heading"><span className="rsvp-settings-icon"><Link2 size={17} /></span><div><h2>Share your RSVP form</h2><p>Both options use the same active token and add replies to {workspaceName}.</p></div></div>
          <div className="rsvp-share-option"><div className="rsvp-share-title"><strong>Guest-facing web link</strong>{token && <span className="public-rsvp-active-badge"><Check size={12} />Active</span>}</div><small>Share this page with guests to fill in the form.</small>{token ? <><CopyField label="Web RSVP link" value={webLink} onCopy={() => void copy(webLink, 'Web RSVP link')} /><button type="button" className="secondary-button rsvp-share-manage" disabled={linkBusy} onClick={() => void createLink(true)}>{linkBusy ? <LoaderCircle className="spin" size={15} /> : <RotateCcw size={15} />}Replace link</button><button type="button" className="text-button rsvp-turn-off" disabled={linkBusy} onClick={() => void turnOffLink()}><Trash2 size={14} />Turn off link</button></> : <button type="button" className="primary-button rsvp-create-link" disabled={linkBusy} onClick={() => void createLink()}>{linkBusy ? <LoaderCircle className="spin" size={15} /> : <Link2 size={15} />}{linkBusy ? 'Creating…' : 'Create web link'}</button>}</div>
          <div className="rsvp-share-option"><div className="rsvp-share-title"><strong>POST endpoint</strong><span className="public-rsvp-method">POST</span></div><small>For another website, form, or integration that sends JSON.</small><CopyField label="POST endpoint" value={apiEndpoint} onCopy={() => void copy(apiEndpoint, 'POST endpoint')} /><details className="public-rsvp-json-details"><summary>View JSON example</summary><pre>{requestExample}</pre><button type="button" className="text-button" onClick={() => void copy(requestExample, 'JSON example')}><Copy size={14} />Copy JSON</button><p>Send the active token, guest name, and the enabled question values.</p></details></div>
        </section>
        <section className="rsvp-settings-tip"><strong>One active link per planning space</strong><p>Replacing the link disables the old web URL and API token. Existing form settings are shared by both submission methods.</p></section>
      </aside>
    </div>
  </section>
}

function ToggleField({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="rsvp-toggle-field"><span><strong>{title}</strong><small>{description}</small></span><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} /></label>
}

function DateQuestionEditor({ title, description, enabled, options, onEnabled, onChange }: {
  title: string
  description: string
  enabled: boolean
  options: PublicRsvpDateOption[]
  onEnabled: (value: boolean) => void
  onChange: (options: PublicRsvpDateOption[]) => void
}) {
  function setDate(index: number, date: string) {
    onChange(options.map((option, optionIndex) => optionIndex === index ? { date, label: dateOptionLabel(date) } : option))
  }
  return <section className="rsvp-settings-card">
    <div className="rsvp-settings-card-heading"><span className="rsvp-settings-icon"><CalendarDays size={17} /></span><div><h2>{title}</h2><p>{description}</p></div></div>
    <ToggleField title={`Ask guests for a ${title.toLowerCase()}`} description="Guests choose one of the date options you add below." checked={enabled} onChange={onEnabled} />
    {enabled && <div className="rsvp-date-options"><div className="rsvp-date-options-heading"><strong>Available date options</strong><small>{options.length} {options.length === 1 ? 'option' : 'options'}</small></div>{options.map((option, index) => <div className="rsvp-date-option" key={`${title}-${index}`}><label><span className="sr-only">{title} option {index + 1}</span><input type="date" value={option.date} onChange={event => setDate(index, event.target.value)} required /></label><span className="rsvp-date-preview">{option.date ? dateOptionLabel(option.date) : 'Choose a date'}</span><button type="button" className="rsvp-remove-date" aria-label={`Remove ${title} option ${index + 1}`} title="Remove option" onClick={() => onChange(options.filter((_, optionIndex) => optionIndex !== index))}><X size={15} /></button></div>)}<button type="button" className="rsvp-add-date" onClick={() => onChange([...options, { date: '', label: '' }])}><Plus size={15} />Add date option</button></div>}
  </section>
}

function CopyField({ label, value, onCopy }: { label: string; value: string; onCopy: () => void }) {
  return <div className="public-rsvp-copy-row"><input aria-label={label} value={value} readOnly onFocus={event => event.currentTarget.select()} /><button type="button" className="secondary-button" onClick={onCopy}><Copy size={14} />Copy</button></div>
}

function RsvpFormPreview({ workspaceName, settings }: { workspaceName: string; settings: PublicRsvpSettings }) {
  return <section className="rsvp-preview-card"><div className="rsvp-preview-heading"><Eye size={15} /><span>GUEST PREVIEW</span></div><span className="guest-eyebrow">YOU’RE INVITED</span><h2>{settings.title || 'RSVP'}</h2><p>{settings.intro || `RSVP for ${workspaceName}`}</p><div className="rsvp-preview-field"><strong>Guest name</strong><span>Name</span></div>{settings.askGuestCount && <div className="rsvp-preview-field"><strong>Number of people</strong><span>1</span></div>}<div className="rsvp-preview-field"><strong>RSVP response</strong><span>{settings.yesLabel}</span><span>{settings.noLabel}</span></div>{settings.askCheckinDate && <div className="rsvp-preview-field"><strong>Check-in date</strong>{settings.checkinOptions.map(option => <span key={option.date}>{option.label || dateOptionLabel(option.date)}</span>)}</div>}{settings.askCheckoutDate && <div className="rsvp-preview-field"><strong>Check-out date</strong>{settings.checkoutOptions.map(option => <span key={option.date}>{option.label || dateOptionLabel(option.date)}</span>)}</div>}<button type="button" className="primary-button" disabled>Send RSVP</button></section>
}
