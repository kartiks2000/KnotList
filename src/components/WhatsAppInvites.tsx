import { useEffect, useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import { ImagePlus, LoaderCircle, MessageCircle, Save, Video, X } from 'lucide-react'
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
  const message = template
  const attachmentName = mediaFile?.name ?? (!removeSavedMedia ? savedTemplate?.media_file_name : null)
  const templateHasAttachment = Boolean(attachmentName)
  const templateIsDirty = !savedTemplate || template !== savedTemplate.message || mediaChanged || removeSavedMedia

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
    setNotice(`${prefix} Choose a guest first if you want KnotList to record the invite timestamp. WhatsApp can’t confirm delivery.`)
  }

  async function openWhatsAppFromFallback() {
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
    <header className="guest-heading-row whatsapp-heading"><div><span className="guest-eyebrow">GUEST INVITES</span><h1>Invite</h1><p>Save a message and optional media to reuse when inviting guests.</p></div></header>
    <div className="whatsapp-editor">
      {loading ? <div className="guest-loading"><LoaderCircle className="spin" size={22} /> Loading invitation…</div> : <>
        <label className="form-field whatsapp-message-field">Invitation message<textarea rows={5} maxLength={3000} value={template} onChange={event => setTemplate(event.target.value)} placeholder="Write your invitation…" /></label>
        <label className="form-field whatsapp-guest-field">Select guest to track invitation <span className="optional-label">optional</span><select value={selectedGuestId} onChange={event => setSelectedGuestId(event.target.value)}><option value="">No guest selected</option>{guests.map(guest => <option value={guest.id} key={guest.id}>{guest.contact_name ? `${guest.contact_name} · ${guest.family_name}` : guest.family_name}</option>)}</select></label>
        <div className="whatsapp-preview"><span>MESSAGE PREVIEW</span><p>{message || 'Your invitation preview will appear here.'}</p></div>
        <div className="whatsapp-media-row"><div className="whatsapp-media-copy"><strong>Image or video</strong><small>{attachmentName || 'Optional · up to 20 MB'}</small></div>{attachmentName && <button type="button" className="whatsapp-remove-media" aria-label="Remove attached media" title="Remove attachment" onClick={() => { setMediaFile(null); setMediaChanged(false); setRemoveSavedMedia(Boolean(savedTemplate?.media_path)) }}><X size={16} /></button>}<label className="secondary-button whatsapp-attach-button"><ImagePlus size={16} />{attachmentName ? 'Change media' : 'Add media'}<input type="file" accept="image/*,video/*" onChange={event => void chooseMedia(event)} /></label></div>
        {attachmentName && <div className="whatsapp-file-note">{(mediaFile?.type ?? savedTemplate?.media_mime_type ?? '').startsWith('video/') ? <Video size={15} /> : <ImagePlus size={15} />} This file is saved with the template. On supported browsers, use the share sheet to choose WhatsApp and a contact.</div>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {notice && <p className="form-message" role="status">{notice}</p>}
        <div className="whatsapp-actions"><button type="button" className="secondary-button" onClick={() => void saveTemplate()} disabled={saving || loading}>{saving ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}{saving ? 'Saving…' : templateIsDirty ? 'Save template' : 'Save changes'}</button><button type="button" className="primary-button" onClick={() => void shareInvitation()} disabled={loading || sharing || !template.trim()}>{sharing ? <LoaderCircle className="spin" size={16} /> : <MessageCircle size={17} />}{sharing ? 'Opening share options…' : templateHasAttachment ? 'Share message and media' : 'Open WhatsApp'}</button></div>
        {showAttachmentFallback && mediaFile && <div className="whatsapp-fallback" role="status"><div><strong>Your browser can’t attach media to WhatsApp directly.</strong><p>Download the file, then open WhatsApp with the message and attach it in the chat.</p></div><button type="button" className="secondary-button" onClick={downloadAttachment}>Download media</button><button type="button" className="secondary-button" onClick={() => void openWhatsAppFromFallback()}>Open WhatsApp</button></div>}
      </>}
    </div>
    <footer className="guest-footer">Messages are prepared in KnotList. WhatsApp opens separately so you can choose who receives each invitation.</footer>
  </section>
}
