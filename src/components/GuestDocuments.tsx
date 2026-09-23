import { useEffect, useState } from 'react'
import type { ChangeEvent } from 'react'
import { FileText, Image as ImageIcon, LoaderCircle, Trash2, Upload } from 'lucide-react'
import { supabase } from '../lib/supabase'

const bucket = 'guest-documents'
const maxFileBytes = 20 * 1024 * 1024
const allowedTypes = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'])
const acceptedFileTypes = 'application/pdf,image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif'

export async function uploadGuestDocuments(workspaceId: string, guestId: string, files: File[]) {
  if (!supabase || files.length === 0) return { uploadedCount: 0, error: '' }
  const invalidFile = files.find(file => !allowedTypes.has(file.type) || file.size > maxFileBytes)
  if (invalidFile) {
    return {
      uploadedCount: 0,
      error: !allowedTypes.has(invalidFile.type)
        ? `${invalidFile.name} is not a supported PDF or image file.`
        : `${invalidFile.name} is larger than the 20 MB limit.`,
    }
  }

  let uploadedCount = 0
  for (const file of files) {
    const safeName = file.name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^\.+/, '').slice(-120) || 'document'
    const path = `${workspaceId}/${guestId}/${crypto.randomUUID()}-${safeName}`
    const { error: storageError } = await supabase.storage.from(bucket).upload(path, file, {
      cacheControl: '3600',
      contentType: file.type,
      upsert: false,
    })
    if (storageError) return { uploadedCount, error: `Could not upload ${file.name}. Check the storage migration and try again.` }

    const { error: metadataError } = await supabase.from('guest_documents').insert({
      workspace_id: workspaceId,
      guest_group_id: guestId,
      storage_path: path,
      file_name: file.name,
      mime_type: file.type,
      size_bytes: file.size,
    })
    if (metadataError) {
      await supabase.storage.from(bucket).remove([path])
      return { uploadedCount, error: `Could not save ${file.name} to this guest. Please try again.` }
    }
    uploadedCount += 1
  }
  return { uploadedCount, error: '' }
}

type GuestDocument = {
  id: string
  workspace_id: string
  guest_group_id: string
  storage_path: string
  file_name: string
  mime_type: string
  size_bytes: number
  created_at: string
}

function formatFileSize(size: number) {
  return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function formatAddedAt(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))
}

export function GuestDocuments({ workspaceId, guestId, canManage }: { workspaceId: string; guestId: string; canManage: boolean }) {
  const [documents, setDocuments] = useState<GuestDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function loadDocuments() {
    if (!supabase) return
    setLoading(true)
    const { data, error: queryError } = await supabase
      .from('guest_documents')
      .select('id, workspace_id, guest_group_id, storage_path, file_name, mime_type, size_bytes, created_at')
      .eq('workspace_id', workspaceId)
      .eq('guest_group_id', guestId)
      .order('created_at', { ascending: false })
    if (queryError) {
      setError('Documents are not set up yet. Ask a project admin to apply the guest documents migration.')
      setDocuments([])
    } else {
      setError('')
      setDocuments((data ?? []) as GuestDocument[])
    }
    setLoading(false)
  }

  useEffect(() => { void loadDocuments() }, [workspaceId, guestId])

  async function uploadFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!supabase || !canManage || files.length === 0) return
    setUploading(true)
    setError('')
    setMessage('')
    const { uploadedCount, error: uploadError } = await uploadGuestDocuments(workspaceId, guestId, files)
    if (uploadError) setError(uploadError)
    if (uploadedCount) setMessage(`${uploadedCount} ${uploadedCount === 1 ? 'file' : 'files'} added.`)
    setUploading(false)
    await loadDocuments()
  }

  async function openDocument(document: GuestDocument) {
    if (!supabase) return
    setBusyId(document.id)
    setError('')
    const newTab = window.open('about:blank', '_blank')
    const { data, error: linkError } = await supabase.storage.from(bucket).createSignedUrl(document.storage_path, 60 * 10)
    setBusyId('')
    if (linkError || !data?.signedUrl) {
      newTab?.close()
      setError('Could not open this file. Check your access and try again.')
      return
    }
    if (newTab) newTab.location.href = data.signedUrl
    else window.location.href = data.signedUrl
  }

  async function deleteDocument(document: GuestDocument) {
    if (!supabase || !canManage || busyId) return
    if (!window.confirm('Delete this guest document?')) return
    setBusyId(document.id)
    setError('')
    const { error: storageError } = await supabase.storage.from(bucket).remove([document.storage_path])
    if (storageError) {
      setBusyId('')
      setError('Could not delete this file. Check your access and try again.')
      return
    }
    const { error: rowError } = await supabase.from('guest_documents').delete().eq('workspace_id', workspaceId).eq('id', document.id)
    setBusyId('')
    if (rowError) {
      setError('The file was removed, but its document record could not be updated. Refresh and try again.')
      await loadDocuments()
      return
    }
    setDocuments(current => current.filter(item => item.id !== document.id))
    setMessage('Document deleted.')
  }

  return <section className="guest-documents" aria-labelledby="guest-documents-title">
    <div className="guest-documents-heading"><div><h3 id="guest-documents-title">Documents</h3><p>PDFs and images for this guest.</p></div>{canManage && <label className={`guest-document-upload ${uploading ? 'uploading' : ''}`}><input type="file" accept={acceptedFileTypes} multiple disabled={uploading} onChange={event => void uploadFiles(event)} /><span>{uploading ? <LoaderCircle className="spin" size={15} /> : <Upload size={15} />}{uploading ? 'Adding…' : 'Add files'}</span></label>}</div>
    {error && <p className="guest-documents-error" role="alert">{error}</p>}
    {message && <p className="guest-documents-message" role="status">{message}</p>}
    {loading ? <p className="guest-documents-empty"><LoaderCircle className="spin" size={15} /> Loading documents…</p>
      : documents.length === 0 ? <p className="guest-documents-empty">No documents added yet.</p>
        : <ul className="guest-document-list">{documents.map(document => <li key={document.id}><span className="guest-document-icon">{document.mime_type === 'application/pdf' ? <FileText size={17} /> : <ImageIcon size={17} />}</span><span className="guest-document-info"><strong>{document.file_name}</strong><small>{formatFileSize(Number(document.size_bytes))} · Added {formatAddedAt(document.created_at)}</small></span><button type="button" className="guest-document-open" disabled={busyId === document.id} onClick={() => void openDocument(document)}>{busyId === document.id ? <LoaderCircle className="spin" size={15} /> : 'Open'}</button>{canManage && <button type="button" className="guest-document-delete" aria-label={`Delete ${document.file_name}`} title="Delete document" disabled={busyId === document.id || uploading} onClick={() => void deleteDocument(document)}><Trash2 size={15} /></button>}</li>)}</ul>}
  </section>
}
