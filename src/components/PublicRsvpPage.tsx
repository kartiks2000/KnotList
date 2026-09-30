import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { CalendarDays, Check, FileText, Heart, LoaderCircle, Users } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { dateOptionLabel, normalizePublicRsvpSettings } from '../lib/publicRsvp'
import type { PublicRsvpSettings } from '../lib/publicRsvp'

function countWords(value: string) {
  return value.trim() ? value.trim().split(/\s+/).length : 0
}

export function PublicRsvpPage({ token }: { token: string }) {
  const [workspaceName, setWorkspaceName] = useState('')
  const [settings, setSettings] = useState<PublicRsvpSettings | null>(null)
  const [personalized, setPersonalized] = useState(false)
  const [name, setName] = useState('')
  const [guestCount, setGuestCount] = useState('1')
  const [rsvp, setRsvp] = useState<'confirmed' | 'declined' | ''>('')
  const [checkinDate, setCheckinDate] = useState('')
  const [checkoutDate, setCheckoutDate] = useState('')
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({})
  const [identificationDocument, setIdentificationDocument] = useState<File | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const tooManyTextWords = settings?.customQuestions.some(question => question.type === 'text' && countWords(customAnswers[question.id] ?? '') > 100) ?? false
  const [submitted, setSubmitted] = useState(false)
  const [alreadySubmitted, setAlreadySubmitted] = useState(false)
  const [error, setError] = useState('')

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
        setPersonalized(data.isPersonalized === true)
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
    if (identificationDocument && (identificationDocument.size > 20 * 1024 * 1024 || !identificationDocument.type.startsWith('image/') && identificationDocument.type !== 'application/pdf')) {
      setError('Choose a PDF or image no larger than 20 MB.')
      return
    }
    setSaving(true)
    setError('')
    const payload = {
        action: 'submit',
        token,
        name: name.trim(),
        rsvp,
        ...(settings?.askGuestCount ? { guestCount: Number(guestCount) } : {}),
        ...(settings?.askCheckinDate && rsvp === 'confirmed' ? { checkinDate } : {}),
        ...(settings?.askCheckoutDate && rsvp === 'confirmed' ? { checkoutDate } : {}),
        ...(settings?.customQuestions.length ? { customAnswers } : {}),
    }
    const body = identificationDocument ? (() => {
      const form = new FormData()
      Object.entries(payload).forEach(([key, value]) => form.append(key, typeof value === 'string' ? value : JSON.stringify(value)))
      form.append('identificationDocument', identificationDocument)
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
              <label className="public-rsvp-label">Your name<input autoComplete="name" value={name} onChange={event => setName(event.target.value)} maxLength={140} placeholder="Enter your name" required />{personalized && <small>This name is saved as an RSVP answer. The guest name in the planner’s list stays unchanged.</small>}</label>
              {settings?.askGuestCount && <label className="public-rsvp-label">Number of people<div className="public-rsvp-input-icon"><Users size={17} /><input type="number" min="1" max="500" step="1" value={guestCount} onChange={event => setGuestCount(event.target.value)} required /></div></label>}
              <fieldset className="public-rsvp-options"><legend>Will you be joining us?</legend><div className="public-rsvp-choice-row"><label className={rsvp === 'confirmed' ? 'public-rsvp-choice selected' : 'public-rsvp-choice'}><input type="radio" name="rsvp" value="confirmed" checked={rsvp === 'confirmed'} onChange={() => setRsvp('confirmed')} required /><span>{settings?.yesLabel || 'Yes'}</span></label><label className={rsvp === 'declined' ? 'public-rsvp-choice selected' : 'public-rsvp-choice'}><input type="radio" name="rsvp" value="declined" checked={rsvp === 'declined'} onChange={() => { setRsvp('declined'); setCheckinDate(''); setCheckoutDate(''); setIdentificationDocument(null) }} /><span>{settings?.noLabel || 'No'}</span></label></div></fieldset>
              {settings?.askCheckinDate && rsvp === 'confirmed' && <fieldset className="public-rsvp-options"><legend><CalendarDays size={15} /> Check-in date</legend><div className="public-rsvp-choice-row">{settings.checkinOptions.map(option => <label key={option.date} className={checkinDate === option.date ? 'public-rsvp-choice selected' : 'public-rsvp-choice'}><input type="radio" name="checkin" value={option.date} checked={checkinDate === option.date} onChange={() => setCheckinDate(option.date)} required /><span>{option.label || dateOptionLabel(option.date)}</span></label>)}</div></fieldset>}
              {settings?.askCheckoutDate && rsvp === 'confirmed' && <fieldset className="public-rsvp-options"><legend><CalendarDays size={15} /> Check-out date</legend><div className="public-rsvp-choice-row">{settings.checkoutOptions.map(option => <label key={option.date} className={checkoutDate === option.date ? 'public-rsvp-choice selected' : 'public-rsvp-choice'}><input type="radio" name="checkout" value={option.date} checked={checkoutDate === option.date} onChange={() => setCheckoutDate(option.date)} required /><span>{option.label || dateOptionLabel(option.date)}</span></label>)}</div></fieldset>}
              {settings.askIdentificationDocument && rsvp === 'confirmed' && <label className="public-rsvp-label public-rsvp-document"><span><FileText size={16} /> Identification document{settings.requireIdentificationDocument && <span className="public-rsvp-required">Required</span>}</span><small>Upload an Aadhaar card, passport, or Indian driving licence. PDF or image, up to 20 MB.</small><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif" required={settings.requireIdentificationDocument} onChange={event => setIdentificationDocument(event.target.files?.[0] ?? null)} />{identificationDocument && <small>{identificationDocument.name}</small>}</label>}
              {settings.customQuestions.map(question => <fieldset className="public-rsvp-options public-rsvp-custom-question" key={question.id}>
                {question.type === 'text'
                  ? <label className="public-rsvp-label">{question.label}{question.required && <span className="public-rsvp-required">Required</span>}<textarea value={customAnswers[question.id] ?? ''} onChange={event => setCustomAnswers(current => ({ ...current, [question.id]: event.target.value }))} maxLength={2000} rows={5} placeholder="Your answer (up to 100 words)" required={question.required} /><small className={`public-rsvp-answer-count${countWords(customAnswers[question.id] ?? '') > 100 ? ' over-limit' : ''}`}>{countWords(customAnswers[question.id] ?? '')}/100 words</small></label>
                  : <><legend>{question.label}{question.required && <span className="public-rsvp-required">Required</span>}</legend><div className="public-rsvp-choice-row">{(question.type === 'yes_no' ? [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] : question.options.map(option => ({ value: option, label: option }))).map(option => <label key={option.value} className={customAnswers[question.id] === option.value ? 'public-rsvp-choice selected' : 'public-rsvp-choice'}><input type="radio" name={`custom-${question.id}`} value={option.value} checked={customAnswers[question.id] === option.value} onChange={() => setCustomAnswers(current => ({ ...current, [question.id]: option.value }))} required={question.required} /><span>{option.label}</span></label>)}</div></>}
              </fieldset>)}
              {error && <p className="public-rsvp-error" role="alert">{error}</p>}
              <button className="primary-button public-rsvp-submit" disabled={saving || tooManyTextWords || !rsvp || (rsvp === 'confirmed' && Boolean(settings?.askCheckinDate && !checkinDate || settings?.askCheckoutDate && !checkoutDate))}>{saving ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}{saving ? 'Sending RSVP…' : 'Send RSVP'}</button>
              <p className="public-rsvp-note">Your response will be shared with the planning team.</p>
            </form>}
    </section>
  </main>
}
