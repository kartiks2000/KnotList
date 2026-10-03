import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { CalendarDays, Check, FileText, Heart, LoaderCircle, Users, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { dateOptionLabel, normalizePublicRsvpSettings } from '../lib/publicRsvp'
import type { PublicRsvpSettings } from '../lib/publicRsvp'

function countWords(value: string) {
  return value.trim() ? value.trim().split(/\s+/).length : 0
}

const identificationTypes = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'])

export function PublicRsvpPage({ token }: { token: string }) {
  const [workspaceName, setWorkspaceName] = useState('')
  const [settings, setSettings] = useState<PublicRsvpSettings | null>(null)
  const [name, setName] = useState('')
  const [guestCount, setGuestCount] = useState('1')
  const [rsvp, setRsvp] = useState<'confirmed' | 'declined' | ''>('')
  const [checkinDate, setCheckinDate] = useState('')
  const [checkoutDate, setCheckoutDate] = useState('')
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({})
  const [identificationDocuments, setIdentificationDocuments] = useState<File[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const tooManyTextWords = rsvp === 'confirmed' && (settings?.customQuestions.some(question => question.type === 'text' && countWords(customAnswers[question.id] ?? '') > 100) ?? false)
  const [submitted, setSubmitted] = useState(false)
  const [alreadySubmitted, setAlreadySubmitted] = useState(false)
  const [error, setError] = useState('')

  function selectIdentificationDocuments(files: FileList | null) {
    const selected = [...identificationDocuments, ...Array.from(files ?? [])]
      .filter((file, index, all) => all.findIndex(other => other.name === file.name && other.size === file.size && other.lastModified === file.lastModified) === index)
    if (selected.length > 8) {
      setError('Choose up to 8 identification documents.')
      return
    }
    if (selected.some(file => file.size < 1 || file.size > 2 * 1024 * 1024)) {
      setError('Each identification document must be no larger than 2 MB.')
      return
    }
    if (selected.some(file => !identificationTypes.has(file.type))) {
      setError('Choose PDF or image files for identification.')
      return
    }
    setError('')
    setIdentificationDocuments(selected)
  }

  useEffect(() => {
    let active = true
    async function load() {
      if (!supabase) {
        setError('RSVPs are temporarily unavailable. Please try again later.')
        setLoading(false)
        return
      }
      const { data, error: loadError } = await supabase.functions.invoke('public-rsvp', { body: { action: 'load', token } })
      if (!active) return
      if (loadError || !data?.workspaceName) setError(data?.error || 'This RSVP link is invalid or has been turned off.')
      else if (!data.settings || typeof data.settings !== 'object') {
        setWorkspaceName(data.workspaceName)
        setError('This RSVP form needs a server update before it can show the latest questions. Please contact the planner.')
      }
      else {
        setWorkspaceName(data.workspaceName)
        setSettings(normalizePublicRsvpSettings(data.settings))
        setAlreadySubmitted(data.alreadySubmitted === true)
      }
      setLoading(false)
    }
    void load()
    return () => { active = false }
  }, [token])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !rsvp) return
    if (rsvp === 'confirmed' && settings?.askIdentificationDocument && settings.requireIdentificationDocument && !identificationDocuments.length) {
      setError('Upload at least one identification document to submit this RSVP.')
      return
    }
    setSaving(true)
    setError('')
    const payload = {
        action: 'submit',
        token,
        name: name.trim(),
        rsvp,
        ...(settings?.askGuestCount && rsvp === 'confirmed' ? { guestCount: Number(guestCount) } : {}),
        ...(settings?.askCheckinDate && rsvp === 'confirmed' ? { checkinDate } : {}),
        ...(settings?.askCheckoutDate && rsvp === 'confirmed' ? { checkoutDate } : {}),
        ...(rsvp === 'confirmed' && settings?.customQuestions.length ? { customAnswers } : {}),
    }
    const body = identificationDocuments.length ? (() => {
      const form = new FormData()
      Object.entries(payload).forEach(([key, value]) => form.append(key, typeof value === 'string' ? value : JSON.stringify(value)))
      identificationDocuments.forEach(file => form.append('identificationDocument', file))
      return form
    })() : payload
    const { data, error: submitError } = await supabase.functions.invoke('public-rsvp', { body })
    setSaving(false)
    if (submitError || !data?.success) {
      setError(data?.error || 'Could not save your RSVP. Please try again.')
      return
    }
    setWorkspaceName(data.workspaceName || workspaceName)
    setSubmitted(true)
  }

  return <main className="public-rsvp-page">
    <section className="public-rsvp-card">
      <a className="public-rsvp-brand" href="/" aria-label="KnotList"><span><Heart size={21} /></span><strong>knotlist</strong></a>
      {!submitted && !alreadySubmitted && <div className="public-rsvp-heading"><span className="guest-eyebrow">YOU’RE INVITED</span><h1>{loading ? 'One moment…' : settings?.title || 'RSVP'}</h1>{(settings ? settings.intro : workspaceName ? `RSVP for ${workspaceName}` : 'We’d love to know if you can join us.') && <p>{settings ? settings.intro : workspaceName ? `RSVP for ${workspaceName}` : 'We’d love to know if you can join us.'}</p>}</div>}
      {loading ? <div className="public-rsvp-loading"><LoaderCircle className="spin" size={21} /> Loading invitation…</div>
        : !settings ? <div className="public-rsvp-error" role="alert">{error || 'Could not load the RSVP form settings. Please contact the planner.'}</div>
          : submitted || alreadySubmitted ? <div className="public-rsvp-success" role="status"><span><Check size={21} /></span><h2>RSVP submitted</h2><p>A response has already been recorded</p></div>
            : <form className="public-rsvp-form" onSubmit={submit}>
              <label className="public-rsvp-label">Your name<input autoComplete="name" value={name} onChange={event => setName(event.target.value)} maxLength={140} placeholder="Enter your name" required /></label>
              <fieldset className="public-rsvp-options"><legend>Will you be joining us?</legend><div className="public-rsvp-choice-row"><label className={rsvp === 'confirmed' ? 'public-rsvp-choice selected' : 'public-rsvp-choice'}><input type="radio" name="rsvp" value="confirmed" checked={rsvp === 'confirmed'} onChange={() => setRsvp('confirmed')} required /><span>{settings?.yesLabel || 'Yes'}</span></label><label className={rsvp === 'declined' ? 'public-rsvp-choice selected' : 'public-rsvp-choice'}><input type="radio" name="rsvp" value="declined" checked={rsvp === 'declined'} onChange={() => { setRsvp('declined'); setCheckinDate(''); setCheckoutDate(''); setIdentificationDocuments([]) }} /><span>{settings?.noLabel || 'No'}</span></label></div></fieldset>
              {rsvp === 'confirmed' && <>
                {settings.askGuestCount && <label className="public-rsvp-label">Number of people<div className="public-rsvp-input-icon"><Users size={17} /><input type="number" min="1" max="500" step="1" value={guestCount} onChange={event => setGuestCount(event.target.value)} required /></div></label>}
                {settings.askCheckinDate && <fieldset className="public-rsvp-options"><legend><CalendarDays size={15} /> Check-in date</legend><div className="public-rsvp-choice-row">{settings.checkinOptions.map(option => <label key={option.date} className={checkinDate === option.date ? 'public-rsvp-choice selected' : 'public-rsvp-choice'}><input type="radio" name="checkin" value={option.date} checked={checkinDate === option.date} onChange={() => setCheckinDate(option.date)} required /><span>{option.label || dateOptionLabel(option.date)}</span></label>)}</div></fieldset>}
                {settings.askCheckoutDate && <fieldset className="public-rsvp-options"><legend><CalendarDays size={15} /> Check-out date</legend><div className="public-rsvp-choice-row">{settings.checkoutOptions.map(option => <label key={option.date} className={checkoutDate === option.date ? 'public-rsvp-choice selected' : 'public-rsvp-choice'}><input type="radio" name="checkout" value={option.date} checked={checkoutDate === option.date} onChange={() => setCheckoutDate(option.date)} required /><span>{option.label || dateOptionLabel(option.date)}</span></label>)}</div></fieldset>}
                {settings.askIdentificationDocument && <div className="public-rsvp-label public-rsvp-document"><span><FileText size={16} /> Identification documents{settings.requireIdentificationDocument && <span className="public-rsvp-required">Required</span>}</span><small>Upload one identification document for every attendee (Aadhaar card, passport, or Indian driving licence). Up to 8 PDF or image files, 2 MB each.</small><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif" multiple onChange={event => { selectIdentificationDocuments(event.target.files); event.target.value = '' }} />{identificationDocuments.length > 0 && <ul className="public-rsvp-document-list">{identificationDocuments.map((file, index) => <li key={`${file.name}-${file.lastModified}-${index}`}><span>{file.name}</span><small>{(file.size / (1024 * 1024)).toFixed(2)} MB</small><button type="button" aria-label={`Remove ${file.name}`} onClick={() => setIdentificationDocuments(current => current.filter((_, fileIndex) => fileIndex !== index))}><X size={15} /></button></li>)}</ul>}</div>}
                {settings.customQuestions.map(question => <fieldset className="public-rsvp-options public-rsvp-custom-question" key={question.id}>
                {question.type === 'text'
                  ? <label className="public-rsvp-label">{question.label}{question.required && <span className="public-rsvp-required">Required</span>}<textarea value={customAnswers[question.id] ?? ''} onChange={event => setCustomAnswers(current => ({ ...current, [question.id]: event.target.value }))} maxLength={2000} rows={5} placeholder="Your answer (up to 100 words)" required={question.required} /><small className={`public-rsvp-answer-count${countWords(customAnswers[question.id] ?? '') > 100 ? ' over-limit' : ''}`}>{countWords(customAnswers[question.id] ?? '')}/100 words</small></label>
                  : <><legend>{question.label}{question.required && <span className="public-rsvp-required">Required</span>}</legend><div className="public-rsvp-choice-row">{(question.type === 'yes_no' ? [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] : question.options.map(option => ({ value: option, label: option }))).map(option => <label key={option.value} className={customAnswers[question.id] === option.value ? 'public-rsvp-choice selected' : 'public-rsvp-choice'}><input type="radio" name={`custom-${question.id}`} value={option.value} checked={customAnswers[question.id] === option.value} onChange={() => setCustomAnswers(current => ({ ...current, [question.id]: option.value }))} required={question.required} /><span>{option.label}</span></label>)}</div></>}
                </fieldset>)}
              </>}
              {error && <p className="public-rsvp-error" role="alert">{error}</p>}
              <button className="primary-button public-rsvp-submit" disabled={saving || tooManyTextWords || !rsvp || (rsvp === 'confirmed' && Boolean(settings?.askCheckinDate && !checkinDate || settings?.askCheckoutDate && !checkoutDate || settings?.requireIdentificationDocument && !identificationDocuments.length))}>{saving ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}{saving ? 'Sending RSVP…' : 'Send RSVP'}</button>
            </form>}
    </section>
  </main>
}
