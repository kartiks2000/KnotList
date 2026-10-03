import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Check, ChevronDown, ImagePlus, LoaderCircle, MessageCircle, Save, Search, Video, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { GuestGroup } from './GuestList'

const bucket = 'whatsapp-invite-media'
const starterMessage = 'We would love for you to join us as we celebrate our wedding. We hope you can be there!'

type SavedTemplate = {
  workspace_id: string
  message: string
  media_path: string | null
  media_file_name: string | null
  media_mime_type: string | null
}

type WebShareNavigator = Navigator & {
  canShare?: (data?: ShareData) => boolean
  share?: (data?: ShareData) => Promise<void>
}

function safeFileName(name: string) {
  return name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'invite-media'
}

function removePersonalizationTokens(value: string) {
  if (value === 'Hi {guest}! We would love to invite you to {workspace}. We hope you can join us!') return starterMessage
  return value.replaceAll('{guest}', '').replaceAll('{workspace}', '').replace(/\s+/g, ' ').replace(/\s+([,.!?])/g, '$1').trim()
}

function whatsappUrl(message: string) {
  return `https://wa.me/?text=${encodeURIComponent(message)}`
}

export function WhatsAppInvites({ workspaceId, workspaceName, guests, onMarkInvitationSent }: {
  workspaceId: string
  workspaceName: string
  guests: GuestGroup[]
  onMarkInvitationSent: (guestId: string, sentAt: string) => Promise<boolean>
}) {
  const [template, setTemplate] = useState(starterMessage)
  const [savedTemplate, setSavedTemplate] = useState<SavedTemplate | null>(null)
  const [mediaFile, setMediaFile] = useState<File | null>(null)
  const [mediaChanged, setMediaChanged] = useState(false)
  const [removeSavedMedia, setRemoveSavedMedia] = useState(false)
  const [selectedGuestId, setSelectedGuestId] = useState('')
  const [guestSearch, setGuestSearch] = useState('')
  const [guestPickerOpen, setGuestPickerOpen] = useState(false)
  const [personalRsvpLink, setPersonalRsvpLink] = useState('')
  const [loadingPersonalLink, setLoadingPersonalLink] = useState(false)
  const guestPickerRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showAttachmentFallback, setShowAttachmentFallback] = useState(false)

  useEffect(() => {
    let alive = true
    async function loadTemplate() {
      setLoading(true)
      setError('')
      if (!supabase) {
        setError('Connect the Supabase project to use WhatsApp invitations.')
        setLoading(false)
        return
      }
      const { data, error: loadError } = await supabase.from('whatsapp_invite_templates').select('*').eq('workspace_id', workspaceId).maybeSingle()
      if (!alive) return
      if (loadError) {
        setError(loadError.message.includes('whatsapp_invite_templates')
          ? 'Apply the WhatsApp invitation migration before using this section.'
          : 'Could not load the saved invitation. Check your connection and try again.')
        setLoading(false)
        return
      }
      if (!data) {
        setTemplate(starterMessage)
        setSavedTemplate(null)
        setMediaFile(null)
        setLoading(false)
        return
      }
      const saved = data as SavedTemplate
      setSavedTemplate(saved)
      setTemplate(removePersonalizationTokens(saved.message))
      setMediaChanged(false)
      setRemoveSavedMedia(false)
      if (saved.media_path) {
        const { data: blob, error: downloadError } = await supabase.storage.from(bucket).download(saved.media_path)
        if (!alive) return
        if (downloadError) {
          setError('The saved media could not be loaded. You can remove it or select it again.')
          setMediaFile(null)
        } else {
          setMediaFile(new File([blob], saved.media_file_name ?? 'invite-media', { type: saved.media_mime_type ?? blob.type }))
        }
      } else {
        setMediaFile(null)
      }
      setLoading(false)
    }
    void loadTemplate()
    return () => { alive = false }
  }, [workspaceId])

  const selectedGuest = useMemo(() => guests.find(guest => guest.id === selectedGuestId), [guests, selectedGuestId])
  const filteredGuests = useMemo(() => {
    const query = guestSearch.trim().toLocaleLowerCase()
    if (!query) return guests
    return guests.filter(guest => [guest.contact_name, guest.family_name, guest.phone]
      .some(value => value?.toLocaleLowerCase().includes(query)))
  }, [guests, guestSearch])
  const message = useMemo(() => {
    if (!personalRsvpLink) return template
    if (template.includes('{rsvp_link}')) return template.replaceAll('{rsvp_link}', personalRsvpLink)
    return `${template.trim()}\n\nPlease RSVP using your personal link:\n${personalRsvpLink}`
  }, [personalRsvpLink, template])
  const selectedGuestLabel = selectedGuest
    ? selectedGuest.contact_name ? `${selectedGuest.contact_name} · ${selectedGuest.family_name}` : selectedGuest.family_name
    : ''
  const attachmentName = mediaFile?.name ?? (!removeSavedMedia ? savedTemplate?.media_file_name : null)
  const templateHasAttachment = Boolean(attachmentName)
  const templateIsDirty = !savedTemplate || template !== savedTemplate.message || mediaChanged || removeSavedMedia

  useEffect(() => {
    if (!guestPickerOpen) return
    function closeOnOutsideClick(event: PointerEvent) {
      if (!guestPickerRef.current?.contains(event.target as Node)) setGuestPickerOpen(false)
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setGuestPickerOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [guestPickerOpen])

  useEffect(() => {
    let alive = true
    async function loadPersonalLink() {
      setPersonalRsvpLink('')
      if (!selectedGuestId || !supabase) {
        setLoadingPersonalLink(false)
        return
      }
      setLoadingPersonalLink(true)
      setError('')
      try {
        const { data, error: linkError } = await supabase.rpc('get_or_create_guest_rsvp_link', {
          requested_workspace_id: workspaceId,
          requested_guest_group_id: selectedGuestId,
          rotate_link: false,
        })
        if (!alive) return
        if (linkError || typeof data !== 'string') setError('Could not load this guest’s personal RSVP link. Try selecting them again.')
        else setPersonalRsvpLink(`${window.location.origin}/#rsvp/${data}`)
      } catch {
        if (alive) setError('Could not load this guest’s personal RSVP link. Check your connection and try again.')
      } finally {
        if (alive) setLoadingPersonalLink(false)
      }
    }
    void loadPersonalLink()
    return () => { alive = false }
  }, [selectedGuestId, workspaceId])

  async function chooseMedia(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0] ?? null
    event.currentTarget.value = ''
    if (!file) return
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
      setError('Choose an image or video file.')
      return
    }
    if (file.size > 20 * 1024 * 1024) {
      setError('Choose a file smaller than 20 MB.')
      return
    }
    setError('')
    setNotice('')
    setMediaFile(file)
    setMediaChanged(true)
    setRemoveSavedMedia(false)
  }

  async function saveTemplate() {
    if (!supabase) return
    setSaving(true)
    setError('')
    setNotice('')
    let newPath = savedTemplate?.media_path ?? null
    let uploadedPath: string | null = null
    if (mediaChanged && mediaFile) {
      newPath = `${workspaceId}/${crypto.randomUUID()}-${safeFileName(mediaFile.name)}`
      const { error: uploadError } = await supabase.storage.from(bucket).upload(newPath, mediaFile, { contentType: mediaFile.type, upsert: false })
      if (uploadError) {
        setError('Could not save the image or video. Check the file type and try again.')
        setSaving(false)
        return
      }
      uploadedPath = newPath
    } else if (removeSavedMedia) {
      newPath = null
    }
    const mediaName = newPath && mediaChanged && mediaFile ? mediaFile.name : newPath ? savedTemplate?.media_file_name ?? null : null
    const mediaType = newPath && mediaChanged && mediaFile ? mediaFile.type : newPath ? savedTemplate?.media_mime_type ?? null : null
    const row = {
      workspace_id: workspaceId,
      message: template,
      media_path: newPath,
      media_file_name: mediaName,
      media_mime_type: mediaType,
      updated_by: (await supabase.auth.getUser()).data.user?.id ?? null,
    }
    const { error: saveError } = await supabase.from('whatsapp_invite_templates').upsert(row, { onConflict: 'workspace_id' })
    if (saveError) {
      if (uploadedPath) await supabase.storage.from(bucket).remove([uploadedPath])
      setError(saveError.message.includes('whatsapp_invite_templates')
        ? 'Apply the WhatsApp invitation migration before saving.'
        : 'Could not save the invitation template. Try again.')
      setSaving(false)
      return
    }
    const oldPath = savedTemplate?.media_path
    const saved: SavedTemplate = { workspace_id: workspaceId, message: template, media_path: newPath, media_file_name: mediaName, media_mime_type: mediaType }
    setSavedTemplate(saved)
    setMediaChanged(false)
    setRemoveSavedMedia(false)
    if (oldPath && oldPath !== newPath) await supabase.storage.from(bucket).remove([oldPath])
    setNotice('Invitation template saved for this planning space.')
    setSaving(false)
  }

  async function shareInvitation() {
    setError('')
    setNotice('')
    if (!selectedGuest) {
      setError('Select a guest before sending an invitation.')
      return
    }
    if (loadingPersonalLink || !personalRsvpLink) {
      setError('The guest’s personal RSVP link is not ready. Please wait and try again.')
      return
    }
    if (selectedGuest.invitation_sent && !window.confirm(`${selectedGuest.contact_name || selectedGuest.family_name} is already marked as invited. Send another invitation?`)) return
    if (templateHasAttachment && !mediaFile) {
      setError('The saved attachment is unavailable. Select it again or remove it before sharing.')
      return
    }
    if (mediaFile) {
      const webShare = navigator as WebShareNavigator
      const shareData: ShareData = { title: `${workspaceName} invitation`, text: message, files: [mediaFile] }
      if (webShare.share && webShare.canShare?.({ files: [mediaFile] })) {
        setSharing(true)
        const sentAt = new Date().toISOString()
        const trackingPromise = selectedGuest ? onMarkInvitationSent(selectedGuest.id, sentAt).catch(() => false) : Promise.resolve(null)
        let shareFailed = false
        let shareCancelled = false
        try {
          await webShare.share.call(navigator, shareData)
        } catch (shareError) {
          shareCancelled = shareError instanceof DOMException && shareError.name === 'AbortError'
          shareFailed = !shareCancelled
        } finally {
          setSharing(false)
        }
        const tracked = await trackingPromise
        if (shareFailed) setShowAttachmentFallback(true)
        setTrackingStatus(tracked, sentAt, shareCancelled ? 'The share sheet was closed.' : 'Sharing started.')
        return
      }
      setShowAttachmentFallback(true)
      return
    }
    window.open(whatsappUrl(message), '_blank', 'noopener,noreferrer')
    const sentAt = new Date().toISOString()
    const tracked = selectedGuest ? await onMarkInvitationSent(selectedGuest.id, sentAt).catch(() => false) : null
    setTrackingStatus(tracked, sentAt, 'WhatsApp opened with your message.')
  }

  function setTrackingStatus(tracked: boolean | null, sentAt: string, prefix: string) {
    if (tracked === false) {
      setError(`${prefix} KnotList could not save the guest’s invite status. Please update it from the guest details.`)
      return
    }
    if (tracked === true && selectedGuest) {
      setNotice(`${selectedGuest.contact_name || selectedGuest.family_name} marked as invited at ${new Date(sentAt).toLocaleString()}. WhatsApp can’t confirm delivery.`)
      return
    }
    setNotice(`${prefix} WhatsApp can’t confirm delivery.`)
  }

  async function openWhatsAppFromFallback() {
    if (!selectedGuest || !personalRsvpLink) {
      setError('Select a guest and wait for their personal RSVP link before opening WhatsApp.')
      return
    }
    if (selectedGuest.invitation_sent && !window.confirm(`${selectedGuest.contact_name || selectedGuest.family_name} is already marked as invited. Send another invitation?`)) return
    window.open(whatsappUrl(message), '_blank', 'noopener,noreferrer')
    const sentAt = new Date().toISOString()
    const tracked = selectedGuest ? await onMarkInvitationSent(selectedGuest.id, sentAt).catch(() => false) : null
    setTrackingStatus(tracked, sentAt, 'WhatsApp opened with your message.')
  }

  function downloadAttachment() {
    if (!mediaFile) return
    const objectUrl = URL.createObjectURL(mediaFile)
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = mediaFile.name
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
  }

  return <section className="whatsapp-page">
    <header className="guest-heading-row whatsapp-heading"><div><h1>Invite</h1></div></header>
    <div className="whatsapp-editor">
      {loading ? <div className="guest-loading"><LoaderCircle className="spin" size={22} /> Loading invitation…</div> : <>
        <label className="form-field whatsapp-message-field">Invitation message<textarea rows={5} maxLength={3000} value={template} onChange={event => setTemplate(event.target.value)} placeholder="Write your invitation…" /><small className="whatsapp-template-help">The selected guest’s personal RSVP link is added automatically. Use <code>{'{rsvp_link}'}</code> to choose where it appears.</small></label>
        <div className="form-field whatsapp-guest-field"><span id="invite-guest-label">Select guest <span className="required-mark">Required</span></span><div className="whatsapp-guest-picker" ref={guestPickerRef}><button type="button" className="whatsapp-guest-trigger" aria-haspopup="listbox" aria-expanded={guestPickerOpen} aria-labelledby="invite-guest-label" onClick={() => { setGuestPickerOpen(open => !open); setGuestSearch('') }}><span>{selectedGuestLabel || 'Search and select a guest'}</span>{loadingPersonalLink ? <LoaderCircle className="spin" size={16} /> : <ChevronDown size={16} />}</button>{guestPickerOpen && <div className="whatsapp-guest-popover"><label className="whatsapp-guest-search"><Search size={15} /><input type="search" value={guestSearch} onChange={event => setGuestSearch(event.target.value)} placeholder="Search name or phone" aria-label="Search guests by name or phone" /></label><div className="whatsapp-guest-options" role="listbox" aria-labelledby="invite-guest-label">{filteredGuests.length ? filteredGuests.map(guest => <button key={guest.id} type="button" role="option" aria-selected={guest.id === selectedGuestId} className={`whatsapp-guest-option${guest.invitation_sent ? ' whatsapp-guest-option-invited' : ''}${guest.id === selectedGuestId ? ' whatsapp-guest-option-selected' : ''}`} onClick={() => { setSelectedGuestId(guest.id); setGuestPickerOpen(false); setGuestSearch(''); setNotice(''); setError('') }}><span className="whatsapp-guest-option-identity"><strong>{guest.contact_name ? `${guest.contact_name} · ${guest.family_name}` : guest.family_name}</strong>{guest.phone && <small>{guest.phone}</small>}</span>{guest.invitation_sent && <span className="whatsapp-guest-invited-badge"><Check size={12} />Already invited</span>}</button>) : <p className="whatsapp-guest-no-results">No guests match that search.</p>}</div></div>}</div>{selectedGuest && <small className="whatsapp-guest-link-status">{loadingPersonalLink ? 'Preparing personal RSVP link…' : personalRsvpLink ? 'Their personal RSVP link will be included in the message.' : 'Personal RSVP link unavailable.'}</small>}</div>
        <div className="whatsapp-preview"><span>MESSAGE PREVIEW</span><p>{message || 'Your invitation preview will appear here.'}</p></div>
        <div className="whatsapp-media-row"><div className="whatsapp-media-copy"><strong>Image or video</strong><small>{attachmentName || 'Optional · up to 20 MB'}</small></div>{attachmentName && <button type="button" className="whatsapp-remove-media" aria-label="Remove attached media" title="Remove attachment" onClick={() => { setMediaFile(null); setMediaChanged(false); setRemoveSavedMedia(Boolean(savedTemplate?.media_path)) }}><X size={16} /></button>}<label className="secondary-button whatsapp-attach-button"><ImagePlus size={16} />{attachmentName ? 'Change media' : 'Add media'}<input type="file" accept="image/*,video/*" onChange={event => void chooseMedia(event)} /></label></div>
        {attachmentName && <div className="whatsapp-file-note">{(mediaFile?.type ?? savedTemplate?.media_mime_type ?? '').startsWith('video/') ? <Video size={15} /> : <ImagePlus size={15} />} This file is saved with the template. On supported browsers, use the share sheet to choose WhatsApp and a contact.</div>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {notice && <p className="form-message" role="status">{notice}</p>}
        <div className="whatsapp-actions"><button type="button" className="secondary-button" onClick={() => void saveTemplate()} disabled={saving || loading}>{saving ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}{saving ? 'Saving…' : templateIsDirty ? 'Save template' : 'Save changes'}</button><button type="button" className="primary-button" onClick={() => void shareInvitation()} disabled={loading || sharing || !template.trim() || !selectedGuest || loadingPersonalLink || !personalRsvpLink}>{sharing ? <LoaderCircle className="spin" size={16} /> : <MessageCircle size={17} />}{sharing ? 'Opening share options…' : templateHasAttachment ? 'Share message and media' : 'Open WhatsApp'}</button></div>
        {showAttachmentFallback && mediaFile && <div className="whatsapp-fallback" role="status"><div><strong>Your browser can’t attach media to WhatsApp directly.</strong><p>Download the file, then open WhatsApp with the message and attach it in the chat.</p></div><button type="button" className="secondary-button" onClick={downloadAttachment}>Download media</button><button type="button" className="secondary-button" onClick={() => void openWhatsAppFromFallback()}>Open WhatsApp</button></div>}
      </>}
    </div>
  </section>
}
