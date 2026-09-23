import { useEffect, useMemo, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { ArrowLeft, BedDouble, CalendarDays, Check, ChevronDown, ChevronRight, Edit3, FileDown, FileSpreadsheet, Gift, Heart, ListChecks, LoaderCircle, Mail, Phone, Plus, Search, Table2, Trash2, Upload, UserPlus, Users, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { TasksView } from './TasksView'
import { GuestDocuments, uploadGuestDocuments } from './GuestDocuments'

type RsvpStatus = 'pending' | 'confirmed' | 'maybe' | 'declined'
type Filter = 'all' | 'invite' | 'rsvp' | 'confirmed'
type ViewMode = 'cards' | 'spreadsheet'
type WorkspaceSection = 'guests' | 'lodging' | 'gifts' | 'tasks'
type GiftField = 'welcome_gift_given' | 'final_gift_given'

export type GuestGroup = {
  id: string
  workspace_id: string
  family_name: string
  contact_name: string
  phone: string
  guest_count: number
  invitation_sent: boolean
  invitation_sent_at: string | null
  invitation_call_made: boolean
  last_called_at: string | null
  rsvp_status: RsvpStatus
  check_in_at: string | null
  check_out_at: string | null
  room_count: number | null
  assigned_room_numbers: string[]
  notes: string
  welcome_gift_given?: boolean
  final_gift_given?: boolean
  created_at: string
  updated_at: string
}

const statusLabels: Record<RsvpStatus, string> = {
  pending: 'Awaiting RSVP',
  confirmed: 'Confirmed',
  maybe: 'Maybe',
  declined: 'Declined',
}

function rsvpLabel(guest: GuestGroup) {
  return guest.rsvp_status === 'pending' && !guest.invitation_sent
    ? 'Not invited'
    : statusLabels[guest.rsvp_status]
}

const filterLabels: Record<Filter, string> = {
  all: 'All guests',
  invite: 'To invite',
  rsvp: 'Awaiting RSVP',
  confirmed: 'Confirmed',
}

function toLocalDateTime(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function toIso(value: string) {
  return value ? new Date(value).toISOString() : null
}

function formatDate(value: string | null) {
  if (!value) return ''
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value))
}

type ExportTable = { title: string; headers: string[]; rows: (string | number)[][] }

function fileSlug(value: string) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'planning-space'
}

async function saveExcelExport(filename: string, tables: ExportTable[]) {
  const XLSX = await import('xlsx')
  const workbook = XLSX.utils.book_new()
  for (const table of tables) {
    const worksheet = XLSX.utils.aoa_to_sheet([table.headers, ...table.rows])
    worksheet['!cols'] = table.headers.map((header, index) => ({ wch: Math.min(34, Math.max(14, header.length + (index === 0 ? 8 : 2))) }))
    if (worksheet['!ref']) worksheet['!autofilter'] = { ref: worksheet['!ref'] }
    XLSX.utils.book_append_sheet(workbook, worksheet, table.title.slice(0, 31))
  }
  XLSX.writeFile(workbook, filename, { compression: true })
}

async function savePdfExport(filename: string, reportTitle: string, tables: ExportTable[]) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  pdf.setProperties({ title: reportTitle })
  tables.forEach((table, index) => {
    if (index > 0) pdf.addPage()
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(15)
    pdf.text(reportTitle, 12, 13)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(9)
    pdf.text(table.title, 12, 19)
    pdf.setFontSize(8)
    pdf.text(`Exported ${new Date().toLocaleString()} · ${table.rows.length} guests`, 12, 24)
    autoTable(pdf, {
      head: [table.headers],
      body: table.rows.map(row => row.map(value => String(value ?? ''))),
      startY: 29,
      margin: { left: 12, right: 12 },
      styles: { font: 'helvetica', fontSize: 7, cellPadding: 1.5, overflow: 'linebreak' },
      headStyles: { fillColor: [83, 105, 85], textColor: 255 },
      alternateRowStyles: { fillColor: [247, 246, 242] },
      rowPageBreak: 'avoid',
    })
  })
  pdf.save(filename)
}

function ExportActions({ onExcel, onPdf, disabled = false }: { onExcel: () => void; onPdf: () => void; disabled?: boolean }) {
  return <div className="export-actions" role="group" aria-label="Export data"><button className="export-button" onClick={onExcel} disabled={disabled} title="Download Excel workbook"><FileSpreadsheet size={15} /><span>Excel</span></button><button className="export-button" onClick={onPdf} disabled={disabled} title="Download PDF report"><FileDown size={15} /><span>PDF</span></button></div>
}

export function GuestList({ workspaceId, workspaces, onWorkspaceChange, onBackToSpaces, accountEmail, onSignOut }: {
  workspaceId: string
  workspaces: { id: string; name: string }[]
  onWorkspaceChange: (workspaceId: string) => void
  onBackToSpaces: () => void
  accountEmail: string
  onSignOut: () => void
}) {
  const [guests, setGuests] = useState<GuestGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [viewMode, setViewMode] = useState<ViewMode>('cards')
  const [lodgingViewMode, setLodgingViewMode] = useState<ViewMode>('spreadsheet')
  const [section, setSection] = useState<WorkspaceSection>('guests')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingGuest, setEditingGuest] = useState<GuestGroup | null>(null)
  const [lodgingEditingGuest, setLodgingEditingGuest] = useState<GuestGroup | null>(null)
  const [detailsGuest, setDetailsGuest] = useState<GuestGroup | null>(null)
  const [toast, setToast] = useState('')
  const [canManagePeople, setCanManagePeople] = useState(false)
  const [canInviteAdmins, setCanInviteAdmins] = useState(false)
  const [canInviteLodging, setCanInviteLodging] = useState(false)
  const [canAccessGuests, setCanAccessGuests] = useState(false)
  const [canAccessLodging, setCanAccessLodging] = useState(false)
  const [canAccessGifts, setCanAccessGifts] = useState(false)
  const [canAccessTasks, setCanAccessTasks] = useState(false)
  const [canManageTasks, setCanManageTasks] = useState(false)
  const [canManageLodging, setCanManageLodging] = useState(false)
  const [canManageGifts, setCanManageGifts] = useState(false)
  const [canManageGuests, setCanManageGuests] = useState(false)
  const [deletingGuestId, setDeletingGuestId] = useState<string | null>(null)
  const [savingGiftFields, setSavingGiftFields] = useState<Set<string>>(() => new Set())
  const [peopleOpen, setPeopleOpen] = useState(false)

  async function loadGuests() {
    if (!supabase) return
    setLoading(true)
    setLoadError('')
    const [guestRead, guestManage, lodgingRead, lodgingManage, giftsRead, giftsManage, workspaceRead, tasksManage] = await Promise.all([
      supabase.rpc('has_permission', { requested_permission: 'app_data.read', requested_workspace_id: workspaceId }),
      supabase.rpc('has_permission', { requested_permission: 'app_data.manage', requested_workspace_id: workspaceId }),
      supabase.rpc('has_permission', { requested_permission: 'lodging.read', requested_workspace_id: workspaceId }),
      supabase.rpc('has_permission', { requested_permission: 'lodging.manage', requested_workspace_id: workspaceId }),
      supabase.rpc('has_permission', { requested_permission: 'gifts.read', requested_workspace_id: workspaceId }),
      supabase.rpc('has_permission', { requested_permission: 'gifts.manage', requested_workspace_id: workspaceId }),
      supabase.rpc('has_permission', { requested_permission: 'workspace.read', requested_workspace_id: workspaceId }),
      supabase.rpc('has_permission', { requested_permission: 'tasks.manage', requested_workspace_id: workspaceId }),
    ])
    const canReadGuestData = !guestRead.error && guestRead.data === true
    const canManageGuestData = !guestManage.error && guestManage.data === true
    const canReadLodgingData = !lodgingRead.error && lodgingRead.data === true
    const canManageLodgingData = !lodgingManage.error && lodgingManage.data === true
    setCanAccessGuests(canReadGuestData)
    setCanManageGuests(canManageGuestData)
    setCanAccessLodging(canReadLodgingData)
    setCanAccessGifts(!giftsRead.error && giftsRead.data === true)
    // Tasks are an Admin-only module, even though other workspace roles can read workspace data.
    setCanAccessTasks(!tasksManage.error && tasksManage.data === true)
    setCanManageTasks(!tasksManage.error && tasksManage.data === true)
    setCanManageLodging(canManageLodgingData)
    setCanManageGifts(!giftsManage.error && giftsManage.data === true)

    if (canReadGuestData) {
      const { data, error } = await supabase.from('guest_groups').select('*').eq('workspace_id', workspaceId).order('family_name', { ascending: true })
      if (error) {
        setLoadError(error.message)
        setGuests([])
      } else {
        setGuests((data ?? []) as GuestGroup[])
        setSection('guests')
      }
    } else if (canReadLodgingData) {
      const { data, error } = await supabase.rpc('get_workspace_lodging', { requested_workspace_id: workspaceId })
      if (error) {
        setLoadError(error.message)
        setGuests([])
      } else {
        setGuests((data ?? []) as GuestGroup[])
        setSection('lodging')
      }
    } else if (!workspaceRead.error && workspaceRead.data === true) {
      setGuests([])
      setSection('tasks')
    } else {
      setLoadError('You do not have access to guest or lodging details in this planning space.')
      setGuests([])
    }
    setLoading(false)
  }

  useEffect(() => {
    setEditorOpen(false)
    setDetailsGuest(null)
    setGuests([])
    setCanAccessGuests(false)
    setCanAccessLodging(false)
    setCanAccessGifts(false)
    setCanAccessTasks(false)
    setCanManageTasks(false)
    setCanManageLodging(false)
    setCanManageGifts(false)
    setSavingGiftFields(new Set())
    setSection('guests')
    void loadGuests()
  }, [workspaceId])

  useEffect(() => {
    let alive = true
    setCanManagePeople(false)
    setCanInviteAdmins(false)
    setCanInviteLodging(false)
    if (!supabase) return () => { alive = false }
    void Promise.all([
      supabase.rpc('has_permission', { requested_permission: 'users.manage', requested_workspace_id: null }),
      supabase.rpc('has_permission', { requested_permission: 'lodging.members.manage', requested_workspace_id: workspaceId }),
    ]).then(([adminResult, lodgingResult]) => {
      if (!alive) return
      const adminAllowed = !adminResult.error && adminResult.data === true
      const lodgingAllowed = !lodgingResult.error && lodgingResult.data === true
      setCanInviteAdmins(adminAllowed)
      setCanInviteLodging(adminAllowed || lodgingAllowed)
      setCanManagePeople(adminAllowed || lodgingAllowed)
    })
    return () => { alive = false }
  }, [workspaceId])

  const filteredGuests = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase()
    return guests.filter(guest => {
      const matchesSearch = !needle || [guest.family_name, guest.contact_name, guest.phone].some(value => value.toLocaleLowerCase().includes(needle))
      const matchesFilter = filter === 'all'
        || (filter === 'invite' && !guest.invitation_sent)
        || (filter === 'rsvp' && guest.invitation_sent && guest.rsvp_status === 'pending')
        || (filter === 'confirmed' && guest.rsvp_status === 'confirmed')
      return matchesSearch && matchesFilter
    })
  }, [guests, search, filter])

  const guestTotal = guests.reduce((total, guest) => total + guest.guest_count, 0)
  const inviteTotal = guests.filter(guest => !guest.invitation_sent).length
  const waitingTotal = guests.filter(guest => guest.invitation_sent && guest.rsvp_status === 'pending').length
  const confirmedTotal = guests.filter(guest => guest.rsvp_status === 'confirmed').length
  const assignedRoomTotal = guests.reduce((total, guest) => total + (guest.assigned_room_numbers ?? []).filter(room => room.trim()).length, 0)
  const workspaceName = workspaces.find(workspace => workspace.id === workspaceId)?.name ?? 'Planning space'

  async function updateGiftField(guest: GuestGroup, field: GiftField, value: boolean) {
    if (!supabase || !canManageGifts) return
    const key = `${guest.id}:${field}`
    setSavingGiftFields(current => new Set(current).add(key))
    setGuests(current => current.map(item => item.id === guest.id ? { ...item, [field]: value } : item))
    const { data, error: updateError } = await supabase.rpc('update_workspace_gift_status', {
      requested_workspace_id: workspaceId,
      requested_guest_group_id: guest.id,
      requested_gift_type: field === 'welcome_gift_given' ? 'welcome' : 'final',
      requested_given: value,
    })
    setSavingGiftFields(current => { const next = new Set(current); next.delete(key); return next })
    if (updateError || data !== true) {
      setGuests(current => current.map(item => item.id === guest.id ? { ...item, [field]: !value } : item))
      setToast('Could not save the gift status. Please try again.')
      window.setTimeout(() => setToast(''), 3500)
    }
  }

  async function deleteGuest(guest: GuestGroup) {
    if (!supabase || !canManageGuests || deletingGuestId) return
    if (!window.confirm(`Delete ${guest.family_name}? This will permanently remove this guest and their details from the planning space.`)) return

    setDeletingGuestId(guest.id)
    const { data: documents } = await supabase.from('guest_documents').select('storage_path').eq('workspace_id', workspaceId).eq('guest_group_id', guest.id)
    if (documents?.length) {
      const { error: storageError } = await supabase.storage.from('guest-documents').remove(documents.map(document => document.storage_path))
      if (storageError) {
        setDeletingGuestId(null)
        setToast('Could not remove this guest’s documents. Try again before deleting the guest.')
        window.setTimeout(() => setToast(''), 3500)
        return
      }
    }
    const { error } = await supabase.from('guest_groups').delete().eq('workspace_id', workspaceId).eq('id', guest.id)
    setDeletingGuestId(null)
    if (error) {
      setToast('Could not delete guest. Check your access and try again.')
      window.setTimeout(() => setToast(''), 3500)
      return
    }
    setGuests(current => current.filter(item => item.id !== guest.id))
    setDetailsGuest(current => current?.id === guest.id ? null : current)
    setToast(`${guest.family_name} deleted`)
    window.setTimeout(() => setToast(''), 3500)
  }

  async function exportGuests(format: 'excel' | 'pdf') {
    const headers = ['Guest name', 'Contact name', 'Phone', 'Guests', 'RSVP status', 'Invitation sent', 'Invitation sent at', 'Invitation call made', 'Last call at', 'Check-in', 'Check-out', 'Number of rooms', 'Allotted room numbers', 'Notes']
    const rows = filteredGuests.map(guest => [guest.family_name, guest.contact_name, guest.phone, guest.guest_count, rsvpLabel(guest), guest.invitation_sent ? 'Yes' : 'No', formatDate(guest.invitation_sent_at), guest.invitation_call_made ? 'Yes' : 'No', formatDate(guest.last_called_at), formatDate(guest.check_in_at), formatDate(guest.check_out_at), guest.room_count ?? '', guest.assigned_room_numbers.filter(room => room.trim()).join(', '), guest.notes])
    const table = { title: 'Guest details', headers, rows }
    const name = `knotlist-${fileSlug(workspaceName)}-guests`
    try {
      if (format === 'excel') await saveExcelExport(`${name}.xlsx`, [table])
      else await savePdfExport(`${name}.pdf`, `${workspaceName} · Guests`, [table])
    } catch {
      setToast(`Could not create the ${format === 'excel' ? 'Excel' : 'PDF'} export. Please try again.`)
      window.setTimeout(() => setToast(''), 3500)
    }
  }

  function showEditor(guest?: GuestGroup) {
    setDetailsGuest(null)
    setEditingGuest(guest ?? null)
    setEditorOpen(true)
  }

  function notifySaved(guest: GuestGroup, wasEditing: boolean, documentStatus = '') {
    setEditorOpen(false)
    setEditingGuest(null)
    setLodgingEditingGuest(null)
    setDetailsGuest(null)
    setToast(documentStatus || `${guest.family_name} ${wasEditing ? 'saved' : 'added'}`)
    window.setTimeout(() => setToast(''), documentStatus ? 6500 : 3000)
    void loadGuests()
  }

  return (
    <div className="guest-app">
      <header className="guest-topbar">
        <a className="brand guest-brand" href="#home"><span className="brand-mark"><Heart size={17} strokeWidth={1.8} /></span><span>knotlist</span></a>
        <label className="workspace-picker-label" htmlFor="workspace-select">Planning space</label>
        <div className="workspace-picker-wrap"><select id="workspace-select" className="workspace-picker" value={workspaceId} onChange={event => onWorkspaceChange(event.target.value)} aria-label="Planning space">{workspaces.map(workspace => <option value={workspace.id} key={workspace.id}>{workspace.name}</option>)}</select>{workspaces.length > 1 && <ChevronDown size={15} />}</div>
        <div className="account-area">{canManagePeople && <button className="manage-people-button" onClick={() => setPeopleOpen(true)} aria-label="Manage people in this planning space" title="Manage people"><UserPlus size={16} /><span>People</span></button>}<span>{accountEmail}</span><button className="account-signout" onClick={onSignOut}>Sign out</button></div>
      </header>

      <div className="planning-workspace-layout">
        <aside className="planning-sidebar" aria-label="Planning space navigation">
          <button className="back-to-spaces" onClick={onBackToSpaces}><ArrowLeft size={16} /><span>All spaces</span></button>
          <div className="sidebar-space-name">{workspaces.find(workspace => workspace.id === workspaceId)?.name}</div>
          <span className="sidebar-label">PLAN</span>
          <nav className="workspace-section-nav" aria-label="Sections">
            {canAccessGuests && <button className={section === 'guests' ? 'section-selected' : ''} aria-current={section === 'guests' ? 'page' : undefined} onClick={() => setSection('guests')}><Users size={17} /><span>Guests</span></button>}
            {canAccessLodging && <button className={section === 'lodging' ? 'section-selected' : ''} aria-current={section === 'lodging' ? 'page' : undefined} onClick={() => setSection('lodging')}><BedDouble size={17} /><span>Lodging</span></button>}
            {canAccessGifts && <button className={section === 'gifts' ? 'section-selected' : ''} aria-current={section === 'gifts' ? 'page' : undefined} onClick={() => setSection('gifts')}><Gift size={17} /><span>Gifts</span></button>}
            {canAccessTasks && <button className={section === 'tasks' ? 'section-selected' : ''} aria-current={section === 'tasks' ? 'page' : undefined} onClick={() => setSection('tasks')}><ListChecks size={17} /><span>Tasks</span></button>}
          </nav>
        </aside>

      <main className={`guest-main ${section === 'guests' && viewMode === 'spreadsheet' ? 'spreadsheet-main' : ''}`}>
        {section === 'guests' && canAccessGuests ? <>
        <div className="guest-heading-row"><div><span className="guest-eyebrow">YOUR PLANNING SPACE</span><h1>Guests</h1><p>Keep track of guests, replies, and stays.</p></div><button className="primary-button add-family-button" onClick={() => showEditor()}><Plus size={18} /> Add guest</button></div>
        <section className="guest-summary" aria-label="Guest list summary"><div><Users size={16} /><strong>{guests.length}</strong><span>{guests.length === 1 ? 'guest' : 'guests'}</span></div><span className="summary-divider" /><div><strong>{guestTotal}</strong><span>guests</span></div><span className="summary-divider" /><div><strong>{inviteTotal}</strong><span>to invite</span></div><span className="summary-divider" /><div><strong>{waitingTotal}</strong><span>awaiting RSVP</span></div><span className="summary-divider" /><div><strong>{assignedRoomTotal}</strong><span>rooms assigned</span></div></section>

        <div className="guest-toolbar"><label className="guest-search"><Search size={18} /><input aria-label="Search guests or contacts" placeholder="Search guests or contacts" value={search} onChange={event => setSearch(event.target.value)} /></label><button className="mobile-add-button" onClick={() => showEditor()} aria-label="Add guest"><Plus size={18} /><span>Add</span></button></div>

        <nav className="guest-filters" aria-label="Filter guest list">{(Object.keys(filterLabels) as Filter[]).map(key => <button key={key} className={`filter-chip ${filter === key ? 'filter-active' : ''}`} aria-pressed={filter === key} onClick={() => setFilter(key)}>{filterLabels[key]}{key === 'invite' && inviteTotal > 0 && <span className="filter-count">{inviteTotal}</span>}{key === 'rsvp' && waitingTotal > 0 && <span className="filter-count">{waitingTotal}</span>}{key === 'confirmed' && confirmedTotal > 0 && <span className="filter-count">{confirmedTotal}</span>}</button>)}</nav>

        {!loading && !loadError && guests.length > 0 && <div className="guest-view-row"><span>{filteredGuests.length} {filteredGuests.length === 1 ? 'guest' : 'guests'}</span><div className="data-toolbar-controls"><ExportActions onExcel={() => void exportGuests('excel')} onPdf={() => void exportGuests('pdf')} disabled={filteredGuests.length === 0} /><div className="guest-view-switch" role="group" aria-label="Guest list view"><button aria-pressed={viewMode === 'cards'} className={viewMode === 'cards' ? 'view-selected' : ''} onClick={() => setViewMode('cards')}>Cards</button><button aria-pressed={viewMode === 'spreadsheet'} className={viewMode === 'spreadsheet' ? 'view-selected' : ''} onClick={() => setViewMode('spreadsheet')}><Table2 size={15} />Spreadsheet</button></div></div></div>}

        <div className="guest-data-scroll">
          {loading ? <div className="guest-loading"><LoaderCircle className="spin" size={22} /> Loading guests…</div> : loadError ? <div className="guest-state error-state"><h2>Couldn’t load the guest list</h2><p>{loadError.includes('schema cache') || loadError.includes('guest_groups') ? 'The guest-list database setup hasn’t been applied yet. Ask your project admin to apply the guest-list migration.' : 'Check your connection or workspace access, then try again.'}</p><button className="secondary-button" onClick={() => void loadGuests()}>Try again</button></div> : guests.length === 0 ? <div className="guest-state"><div className="empty-mark"><Users size={23} /></div><h2>Start with one guest</h2><p>Add a guest you’re inviting. You can fill in invitation, RSVP, and stay details now or later.</p><button className="primary-button" onClick={() => showEditor()}><Plus size={17} /> Add your first guest</button></div> : filteredGuests.length === 0 ? <div className="guest-state compact-state"><h2>No guests match this view</h2><p>Try a different search or filter.</p><button className="text-button" onClick={() => { setSearch(''); setFilter('all') }}>Clear search and filters</button></div> : viewMode === 'spreadsheet' ? <GuestSpreadsheet guests={filteredGuests} canDelete={canManageGuests} deletingGuestId={deletingGuestId} onDelete={guest => void deleteGuest(guest)} onOpen={guest => setDetailsGuest(guest)} onEdit={guest => showEditor(guest)} /> : <section className="guest-list" aria-label="Guests you are inviting">{filteredGuests.map(guest => <GuestCard key={guest.id} guest={guest} canDelete={canManageGuests} deleting={deletingGuestId === guest.id} onDelete={() => void deleteGuest(guest)} onOpen={() => setDetailsGuest(guest)} onEdit={() => showEditor(guest)} />)}</section>}
          <footer className="guest-footer">Your guest list is shared with people who have access to this planning space.</footer>
        </div>
        </> : section === 'lodging' && canAccessLodging ? <LodgingView guests={guests} workspaceName={workspaceName} loading={loading} loadError={loadError} viewMode={lodgingViewMode} onViewModeChange={setLodgingViewMode} canEdit={canManageLodging} onRetry={() => void loadGuests()} onEdit={setLodgingEditingGuest} /> : section === 'gifts' && canAccessGifts ? <GiftTracker guests={guests} workspaceName={workspaceName} loading={loading} loadError={loadError} canEdit={canManageGifts} savingGiftFields={savingGiftFields} onRetry={() => void loadGuests()} onToggle={updateGiftField} /> : section === 'tasks' && canAccessTasks ? <TasksView workspaceId={workspaceId} canManage={canManageTasks} /> : <div className="guest-loading"><LoaderCircle className="spin" size={22} />{loading ? 'Loading workspace access…' : loadError || 'No sections are available for your access level.'}</div>}
      </main>
      <nav className="mobile-workspace-nav" aria-label="Planning space sections">{canAccessGuests && <button className={section === 'guests' ? 'section-selected' : ''} aria-current={section === 'guests' ? 'page' : undefined} onClick={() => setSection('guests')}><Users size={18} /><span>Guests</span></button>}{canAccessLodging && <button className={section === 'lodging' ? 'section-selected' : ''} aria-current={section === 'lodging' ? 'page' : undefined} onClick={() => setSection('lodging')}><BedDouble size={18} /><span>Lodging</span></button>}{canAccessGifts && <button className={section === 'gifts' ? 'section-selected' : ''} aria-current={section === 'gifts' ? 'page' : undefined} onClick={() => setSection('gifts')}><Gift size={18} /><span>Gifts</span></button>}{canAccessTasks && <button className={section === 'tasks' ? 'section-selected' : ''} aria-current={section === 'tasks' ? 'page' : undefined} onClick={() => setSection('tasks')}><ListChecks size={18} /><span>Tasks</span></button>}<button onClick={onBackToSpaces}><ArrowLeft size={18} /><span>Spaces</span></button></nav>
      </div>

      {editorOpen && <GuestEditor key={editingGuest?.id ?? 'new'} workspaceId={workspaceId} guest={editingGuest} onClose={() => setEditorOpen(false)} onSaved={(guest, documentStatus) => notifySaved(guest, Boolean(editingGuest), documentStatus)} />}
      {lodgingEditingGuest && <LodgingEditor key={lodgingEditingGuest.id} workspaceId={workspaceId} guest={lodgingEditingGuest} onClose={() => setLodgingEditingGuest(null)} onSaved={guest => notifySaved(guest, true)} />}
      {detailsGuest && <GuestDetails workspaceId={workspaceId} guest={detailsGuest} canDelete={canManageGuests} deleting={deletingGuestId === detailsGuest.id} onDelete={() => void deleteGuest(detailsGuest)} onClose={() => setDetailsGuest(null)} onEdit={() => showEditor(detailsGuest)} />}
      {peopleOpen && canManagePeople && <WorkspacePeopleDialog workspaceId={workspaceId} workspaceName={workspaces.find(workspace => workspace.id === workspaceId)?.name ?? 'Planning space'} canInviteAdmins={canInviteAdmins} canInviteLodging={canInviteLodging} onClose={() => setPeopleOpen(false)} />}
      {toast && <div className="toast-message" role="status"><Check size={17} /> {toast}</div>}
    </div>
  )
}

type WorkspacePerson = {
  id: string
  email: string
  display_name: string
  email_confirmed_at: string | null
  role_key: string
  role_name: string
}

type InviteRoleKey = 'admin' | 'lodging_manager'

function GiftTracker({ guests, workspaceName, loading, loadError, canEdit, savingGiftFields, onRetry, onToggle }: {
  guests: GuestGroup[]
  workspaceName: string
  loading: boolean
  loadError: string
  canEdit: boolean
  savingGiftFields: Set<string>
  onRetry: () => void
  onToggle: (guest: GuestGroup, field: GiftField, value: boolean) => void
}) {
  const [module, setModule] = useState<'welcome' | 'final'>('welcome')
  const [search, setSearch] = useState('')
  const [giftFilter, setGiftFilter] = useState<'all' | 'given' | 'not_given'>('all')
  const [exportError, setExportError] = useState('')
  const field: GiftField = module === 'welcome' ? 'welcome_gift_given' : 'final_gift_given'
  const title = module === 'welcome' ? 'Welcome gift' : 'Final gift'
  const givenCount = guests.filter(guest => guest[field] === true).length
  const notGivenCount = guests.length - givenCount
  const visibleGuests = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase()
    return guests.filter(guest => {
      const matchesSearch = !needle || guest.family_name.toLocaleLowerCase().includes(needle)
      const matchesFilter = giftFilter === 'all' || (giftFilter === 'given' ? guest[field] === true : guest[field] !== true)
      return matchesSearch && matchesFilter
    })
  }, [guests, search, giftFilter, field])

  async function exportGift(format: 'excel' | 'pdf') {
    const headers = ['Guest name', `${title} given`]
    const rows = visibleGuests.map(guest => [guest.family_name, guest[field] === true ? 'Yes' : 'No'])
    const table = { title, headers, rows }
    const name = `knotlist-${fileSlug(workspaceName)}-${fileSlug(title)}`
    setExportError('')
    try {
      if (format === 'excel') await saveExcelExport(`${name}.xlsx`, [table])
      else await savePdfExport(`${name}.pdf`, `${workspaceName} · ${title}`, [table])
    } catch {
      setExportError(`Could not create the ${format === 'excel' ? 'Excel' : 'PDF'} export. Please try again.`)
    }
  }

  return <>
    <div className="gift-heading"><div><span className="guest-eyebrow">GIFT TRACKING</span><h1>Gifts</h1><p>Mark each gift as given with one tap.</p></div></div>
    <nav className="gift-module-tabs" role="tablist" aria-label="Gift modules">
      <button role="tab" aria-selected={module === 'welcome'} className={module === 'welcome' ? 'gift-module-selected' : ''} onClick={() => { setModule('welcome'); setGiftFilter('all') }}><Gift size={16} />Welcome gift</button>
      <button role="tab" aria-selected={module === 'final'} className={module === 'final' ? 'gift-module-selected' : ''} onClick={() => { setModule('final'); setGiftFilter('all') }}><Gift size={16} />Final gift</button>
    </nav>
    <section className="gift-module-panel" role="tabpanel">
      <div className="gift-module-summary"><div><h2>{title}</h2><p>Tick the box when this guest has received it.</p></div><span>{givenCount} of {guests.length} given</span></div>
      <label className="guest-search gift-search"><Search size={17} /><input aria-label={`Search guests for ${title.toLowerCase()}`} placeholder="Search guests" value={search} onChange={event => setSearch(event.target.value)} />{search && <button type="button" className="search-clear" aria-label="Clear search" onClick={() => setSearch('')}><X size={15} /></button>}</label>
      <nav className="gift-filters" aria-label={`Filter ${title.toLowerCase()} status`}>
        <button className={`filter-chip ${giftFilter === 'all' ? 'filter-active' : ''}`} aria-pressed={giftFilter === 'all'} onClick={() => setGiftFilter('all')}>All <span className="filter-count">{guests.length}</span></button>
        <button className={`filter-chip ${giftFilter === 'given' ? 'filter-active' : ''}`} aria-pressed={giftFilter === 'given'} onClick={() => setGiftFilter('given')}>Given <span className="filter-count">{givenCount}</span></button>
        <button className={`filter-chip ${giftFilter === 'not_given' ? 'filter-active' : ''}`} aria-pressed={giftFilter === 'not_given'} onClick={() => setGiftFilter('not_given')}>Not given <span className="filter-count">{notGivenCount}</span></button>
      </nav>
      <div className="gift-list-toolbar"><span className="gift-visible-count">Showing {visibleGuests.length} {visibleGuests.length === 1 ? 'guest' : 'guests'}</span><ExportActions onExcel={() => void exportGift('excel')} onPdf={() => void exportGift('pdf')} disabled={visibleGuests.length === 0} /></div>
      {exportError && <p className="export-error" role="alert">{exportError}</p>}
      <div className="gift-table-scroll">
        {loading ? <div className="guest-loading"><LoaderCircle className="spin" size={22} />Loading gifts…</div>
          : loadError ? <div className="guest-state error-state"><h2>Couldn’t load gift tracking</h2><p>Check your connection or workspace access, then try again.</p><button className="secondary-button" onClick={onRetry}>Try again</button></div>
            : guests.length === 0 ? <div className="guest-state"><div className="empty-mark"><Gift size={23} /></div><h2>No guests yet</h2><p>Add guests in Guests, then track their gifts here.</p></div>
              : visibleGuests.length === 0 ? <div className="guest-state compact-state"><h2>No guests match this view</h2><p>Try another name or gift status.</p><button className="text-button" onClick={() => { setSearch(''); setGiftFilter('all') }}>Clear search and filters</button></div>
                : <table className="gift-table"><thead><tr><th scope="col">Guest</th><th scope="col">{title} given</th></tr></thead><tbody>{visibleGuests.map(guest => {
                const key = `${guest.id}:${field}`
                const saving = savingGiftFields.has(key)
                return <tr key={guest.id}><th scope="row">{guest.family_name}</th><td><label className="gift-checkbox"><input type="checkbox" checked={guest[field] === true} disabled={!canEdit || saving} aria-label={`${guest[field] ? 'Unmark' : 'Mark'} ${title.toLowerCase()} given for ${guest.family_name}`} onChange={event => onToggle(guest, field, event.target.checked)} /><span className="sr-only">{saving ? 'Saving' : guest[field] ? 'Given' : 'Not given'}</span></label></td></tr>
              })}</tbody></table>}
      </div>
    </section>
  </>
}

function LodgingView({ guests, workspaceName, loading, loadError, viewMode, onViewModeChange, canEdit, onRetry, onEdit }: {
  guests: GuestGroup[]
  workspaceName: string
  loading: boolean
  loadError: string
  viewMode: ViewMode
  onViewModeChange: (viewMode: ViewMode) => void
  canEdit: boolean
  onRetry: () => void
  onEdit: (guest: GuestGroup) => void
}) {
  const [roomFilter, setRoomFilter] = useState<'all' | 'allocated' | 'unallocated'>('all')
  const [search, setSearch] = useState('')
  const [exportError, setExportError] = useState('')
  const guestTotal = guests.reduce((count, guest) => count + guest.guest_count, 0)
  const roomTotal = guests.reduce((count, guest) => count + (guest.room_count ?? 0), 0)
  const hasAssignedRooms = (guest: GuestGroup) => (guest.assigned_room_numbers ?? []).some(room => room.trim().length > 0)
  const allocatedGuests = guests.filter(hasAssignedRooms).length
  const unallocatedGuests = guests.length - allocatedGuests
  const searchTerm = search.trim().toLocaleLowerCase()
  const visibleGuests = guests.filter(guest => {
    const matchesRoomFilter = roomFilter === 'all' || (roomFilter === 'allocated' ? hasAssignedRooms(guest) : !hasAssignedRooms(guest))
    const matchesSearch = !searchTerm || guest.family_name.toLocaleLowerCase().includes(searchTerm) || guest.assigned_room_numbers.some(room => room.toLocaleLowerCase().includes(searchTerm))
    return matchesRoomFilter && matchesSearch
  })

  async function exportLodging(format: 'excel' | 'pdf') {
    const headers = ['Guest name', 'Number of guests', 'Total rooms', 'Allotted room numbers']
    const rows = visibleGuests.map(guest => [guest.family_name, guest.guest_count, guest.room_count ?? '', guest.assigned_room_numbers.filter(room => room.trim()).join(', ')])
    const table = { title: 'Lodging assignments', headers, rows }
    const name = `knotlist-${fileSlug(workspaceName)}-lodging`
    setExportError('')
    try {
      if (format === 'excel') await saveExcelExport(`${name}.xlsx`, [table])
      else await savePdfExport(`${name}.pdf`, `${workspaceName} · Lodging`, [table])
    } catch {
      setExportError(`Could not create the ${format === 'excel' ? 'Excel' : 'PDF'} export. Please try again.`)
    }
  }

  return <>
    <div className="lodging-heading"><div><span className="guest-eyebrow">ROOM OVERVIEW</span><h1>Lodging</h1><p>Guests, room totals, and allotted room numbers.</p></div><div className="lodging-summary"><strong>{guestTotal}</strong><span>guests</span><i /><strong>{roomTotal}</strong><span>total rooms</span></div></div>
    {!loading && !loadError && guests.length > 0 && <label className="lodging-search"><Search size={17} /><span className="sr-only">Search guests or room numbers</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search guests or room numbers" /><button type="button" onClick={() => setSearch('')} aria-label="Clear lodging search" title="Clear search" disabled={!search}><X size={15} /></button></label>}
    {!loading && !loadError && guests.length > 0 && <div className="lodging-view-row"><div className="lodging-filters" role="group" aria-label="Filter by room allocation"><button className={`filter-chip ${roomFilter === 'all' ? 'filter-active' : ''}`} aria-pressed={roomFilter === 'all'} onClick={() => setRoomFilter('all')}>All <span className="filter-count">{guests.length}</span></button><button className={`filter-chip ${roomFilter === 'allocated' ? 'filter-active' : ''}`} aria-pressed={roomFilter === 'allocated'} onClick={() => setRoomFilter('allocated')}>Allocated <span className="filter-count">{allocatedGuests}</span></button><button className={`filter-chip ${roomFilter === 'unallocated' ? 'filter-active' : ''}`} aria-pressed={roomFilter === 'unallocated'} onClick={() => setRoomFilter('unallocated')}>Unallocated <span className="filter-count">{unallocatedGuests}</span></button></div><div className="data-toolbar-controls"><ExportActions onExcel={() => void exportLodging('excel')} onPdf={() => void exportLodging('pdf')} disabled={visibleGuests.length === 0} /><div className="guest-view-switch" role="group" aria-label="Lodging view"><button aria-pressed={viewMode === 'cards'} className={viewMode === 'cards' ? 'view-selected' : ''} onClick={() => onViewModeChange('cards')}>Cards</button><button aria-pressed={viewMode === 'spreadsheet'} className={viewMode === 'spreadsheet' ? 'view-selected' : ''} onClick={() => onViewModeChange('spreadsheet')}><Table2 size={15} />Spreadsheet</button></div></div></div>}
    {exportError && <p className="export-error" role="alert">{exportError}</p>}
    <div className={`lodging-data-scroll ${viewMode === 'cards' ? 'lodging-cards-mode' : ''}`}>
      {loading ? <div className="guest-loading"><LoaderCircle className="spin" size={22} /> Loading lodging…</div>
        : loadError ? <div className="guest-state error-state"><h2>Couldn’t load lodging</h2><p>Check your connection or workspace access, then try again.</p><button className="secondary-button" onClick={onRetry}>Try again</button></div>
          : guests.length === 0 ? <div className="guest-state"><div className="empty-mark"><BedDouble size={23} /></div><h2>No guests yet</h2><p>Add guests in Guests, then record their stay and room details here.</p></div>
            : visibleGuests.length === 0 ? <div className="guest-state compact-state"><h2>No guests match this view</h2><p>Try another name, room number, or allocation filter.</p><button className="text-button" onClick={() => { setSearch(''); setRoomFilter('all') }}>Clear search and filters</button></div>
            : viewMode === 'spreadsheet' ? <><div className="lodging-table-scroll" role="region" aria-label="Lodging spreadsheet" tabIndex={0}><table className="lodging-table"><thead><tr><th>Guest</th><th>Guests</th><th>Total rooms</th><th>Allotted room numbers</th>{canEdit && <th className="lodging-action-heading"><span className="sr-only">Edit</span></th>}</tr></thead><tbody>{visibleGuests.map(guest => <tr key={guest.id}><th scope="row"><strong>{guest.family_name}</strong></th><td>{guest.guest_count}</td><td>{guest.room_count ?? <span className="sheet-muted">Not set</span>}</td><td>{guest.assigned_room_numbers?.filter(room => room.trim()).join(', ') || <span className="sheet-muted">Not allotted</span>}</td>{canEdit && <td className="lodging-action"><button className="sheet-edit-button" aria-label={`Edit lodging for ${guest.family_name}`} title="Edit lodging" onClick={() => onEdit(guest)}><Edit3 size={16} /></button></td>}</tr>)}</tbody></table></div><p className="spreadsheet-hint lodging-spreadsheet-hint">Scroll sideways to see more columns.</p></>
              : <section className="lodging-card-list" aria-label="Lodging cards">{visibleGuests.map(guest => <article className="lodging-card" key={guest.id}><div className="lodging-card-heading"><div><h2>{guest.family_name}</h2><span>{guest.guest_count} {guest.guest_count === 1 ? 'guest' : 'guests'}</span></div>{canEdit && <button className="lodging-card-edit" aria-label={`Edit lodging for ${guest.family_name}`} title="Edit lodging" onClick={() => onEdit(guest)}><Edit3 size={17} /></button>}</div><dl className="lodging-card-details"><div><dt>Total rooms</dt><dd>{guest.room_count ?? 'Not set'}</dd></div><div><dt>Allotted room numbers</dt><dd>{guest.assigned_room_numbers?.filter(room => room.trim()).join(', ') || 'Not allotted'}</dd></div></dl></article>)}</section>}
    </div>
    {!loading && !loadError && guests.length > 0 && <footer className="guest-footer lodging-footer">Your lodging details are shared with people who have access to this planning space.</footer>}
  </>
}

function LodgingEditor({ workspaceId, guest, onClose, onSaved }: {
  workspaceId: string
  guest: GuestGroup
  onClose: () => void
  onSaved: (guest: GuestGroup) => void
}) {
  const [guestCount, setGuestCount] = useState(String(guest.guest_count))
  const [roomCount, setRoomCount] = useState(guest.room_count == null ? '' : String(guest.room_count))
  const [roomNumbers, setRoomNumbers] = useState<string[]>(guest.assigned_room_numbers ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    setSaving(true)
    setError('')
    const { data, error: saveError } = await supabase.rpc('update_workspace_lodging', {
      requested_workspace_id: workspaceId,
      requested_guest_group_id: guest.id,
      requested_guest_count: Number(guestCount),
      requested_room_count: roomCount === '' ? null : Number(roomCount),
      requested_room_numbers: roomNumbers.map(room => room.trim()).filter(Boolean),
    })
    setSaving(false)
    if (saveError) {
      setError('Could not update these lodging details. Check your access and try again.')
      return
    }
    const updated = Array.isArray(data) ? data[0] : data
    if (!updated) {
      setError('Could not find this guest in the selected planning space.')
      return
    }
    onSaved({ ...guest, ...updated } as GuestGroup)
  }

  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !saving) onClose() }}><section className="guest-dialog lodging-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="lodging-editor-title"><header className="dialog-header"><div><span className="guest-eyebrow">{guest.family_name}</span><h2 id="lodging-editor-title">Update lodging</h2></div><button className="dialog-close" onClick={onClose} aria-label="Close" disabled={saving}><X size={20} /></button></header><form className="guest-form lodging-editor-form" onSubmit={save}>
    <label className="form-field">Number of guests<input type="number" inputMode="numeric" min="0" max="500" value={guestCount} onChange={event => setGuestCount(event.target.value)} required /></label>
    <label className="form-field">Total rooms<input type="number" inputMode="numeric" min="0" max="100" value={roomCount} onChange={event => setRoomCount(event.target.value)} placeholder="Not set" /></label>
    <div className="assigned-rooms-editor"><div className="assigned-rooms-heading">Allotted room numbers</div>{roomNumbers.length === 0 && <p className="room-assignment-hint">No room numbers allotted.</p>}{roomNumbers.map((room, index) => <div className="assigned-room-row" key={index}><label className="sr-only" htmlFor={`lodging-room-${guest.id}-${index}`}>Allotted room number {index + 1}</label><input id={`lodging-room-${guest.id}-${index}`} value={room} maxLength={30} onChange={event => setRoomNumbers(current => current.map((value, roomIndex) => roomIndex === index ? event.target.value : value))} placeholder={`Room number ${index + 1}`} /><button type="button" className="remove-room-button" onClick={() => setRoomNumbers(current => current.filter((_, roomIndex) => roomIndex !== index))} aria-label={`Remove room ${room || index + 1}`}><X size={17} /></button></div>)}<button type="button" className="add-room-button" onClick={() => setRoomNumbers(current => [...current, ''])}><Plus size={15} /> Add room number</button></div>
    {error && <p className="form-error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}{saving ? 'Saving…' : 'Save changes'}</button></div>
    </form></section></div>
}

function WorkspacePeopleDialog({ workspaceId, workspaceName, canInviteAdmins, canInviteLodging, onClose }: {
  workspaceId: string
  workspaceName: string
  canInviteAdmins: boolean
  canInviteLodging: boolean
  onClose: () => void
}) {
  const [members, setMembers] = useState<WorkspacePerson[]>([])
  const [membersLoading, setMembersLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [removingMemberId, setRemovingMemberId] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const inviteRoles: { key: InviteRoleKey; name: string }[] = [
    ...(canInviteAdmins ? [{ key: 'admin' as const, name: 'Admin' }] : []),
    ...(canInviteLodging ? [{ key: 'lodging_manager' as const, name: 'Lodging' }] : []),
  ]
  const [roleKey, setRoleKey] = useState<InviteRoleKey>(canInviteAdmins ? 'admin' : 'lodging_manager')
  const selectedRoleName = inviteRoles.find(role => role.key === roleKey)?.name ?? inviteRoles[0]?.name ?? 'Lodging'

  useEffect(() => {
    if (!inviteRoles.some(role => role.key === roleKey) && inviteRoles[0]) setRoleKey(inviteRoles[0].key)
  }, [canInviteAdmins, canInviteLodging, roleKey])

  async function loadMembers() {
    if (!supabase) return
    setMembersLoading(true)
    setError('')
    const { data: membershipRows, error: membershipError } = await supabase
      .from('workspace_memberships')
      .select('id, user_id, role_id')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true })
    if (membershipError) {
      setError('Could not load people. Apply the workspace invitation migration and try again.')
      setMembersLoading(false)
      return
    }

    const rows = membershipRows ?? []
    const userIds = [...new Set(rows.map(row => row.user_id))]
    const roleIds = [...new Set(rows.map(row => row.role_id))]
    const [profilesResult, rolesResult] = await Promise.all([
      userIds.length ? supabase.from('profiles').select('id, email, display_name, email_confirmed_at').in('id', userIds) : Promise.resolve({ data: [], error: null }),
      roleIds.length ? supabase.from('roles').select('id, key, name').in('id', roleIds) : Promise.resolve({ data: [], error: null }),
    ])
    if (profilesResult.error || rolesResult.error) {
      setError('Could not load member details. Check that the workspace invitation migration is applied.')
      setMembersLoading(false)
      return
    }
    const profiles = profilesResult.data ?? []
    const roles = rolesResult.data ?? []
    setMembers(rows.map(row => {
      const profile = profiles.find(item => item.id === row.user_id)
      const role = roles.find(item => item.id === row.role_id)
      return {
        id: row.id,
        email: profile?.email ?? '',
        display_name: profile?.display_name ?? '',
        email_confirmed_at: profile?.email_confirmed_at ?? null,
        role_key: role?.key ?? '',
        role_name: role?.name ?? 'Member',
      }
    }))
    setMembersLoading(false)
  }

  useEffect(() => { void loadMembers() }, [workspaceId])

  async function invitePerson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    setSubmitting(true)
    setError('')
    setMessage('')
    const { data, error: inviteError } = await supabase.functions.invoke('invite-workspace-admin', {
      body: { workspaceId, email: email.trim(), roleKey },
    })
    if (inviteError) {
      let detail = inviteError.message
      const context = (inviteError as { context?: unknown }).context
      if (context instanceof Response) {
        const body = await context.clone().json().catch(() => null) as { error?: string } | null
        if (body?.error) detail = body.error
      }
      setError(detail || 'Could not send the invitation. Try again.')
      setSubmitting(false)
      return
    }
    setEmail('')
    const accessLabel = roleKey === 'lodging_manager' ? 'Lodging' : 'Admin'
    setMessage(data?.status === 'added'
      ? `This person already had an account. ${accessLabel} access was added; they can sign in to open the planning space.`
      : data?.status === 'pending_confirmation'
        ? `${accessLabel} access is ready and will work after this person confirms their existing account.`
        : 'Invitation sent. They can create their account from the email.')
    setSubmitting(false)
    await loadMembers()
  }

  async function removeAdmin(person: WorkspacePerson) {
    if (!supabase || !canInviteAdmins || person.role_key !== 'admin' || removingMemberId) return
    const personLabel = person.display_name || person.email || 'this Admin'
    if (!window.confirm(`Remove ${personLabel} as an Admin from ${workspaceName}? They will lose access to this planning space.`)) return
    setRemovingMemberId(person.id)
    setError('')
    setMessage('')
    const { error: removeError } = await supabase.from('workspace_memberships').delete().eq('id', person.id).eq('workspace_id', workspaceId)
    setRemovingMemberId('')
    if (removeError) {
      setError('Could not remove this Admin. Check your access and try again.')
      return
    }
    setMembers(current => current.filter(member => member.id !== person.id))
    setMessage(`${personLabel} no longer has access to this planning space.`)
  }

  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><section className="guest-dialog people-dialog" role="dialog" aria-modal="true" aria-labelledby="people-dialog-title"><header className="dialog-header"><div><span className="guest-eyebrow">PLANNING SPACE ACCESS</span><h2 id="people-dialog-title">People</h2><p className="people-workspace-name">{workspaceName}</p></div><button className="dialog-close" onClick={onClose} aria-label="Close"><X size={20} /></button></header><div className="people-dialog-body"><form className="people-invite-form" onSubmit={invitePerson}><label className="form-field">Email address<input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="person@example.com" maxLength={254} required /></label><div className="people-role-line"><span>Access level</span>{inviteRoles.length > 1 ? <select aria-label="Access level" value={roleKey} onChange={event => setRoleKey(event.target.value as InviteRoleKey)}>{inviteRoles.map(role => <option key={role.key} value={role.key}>{role.name}</option>)}</select> : <strong>{selectedRoleName}</strong>}</div><p className="people-help">{roleKey === 'lodging_manager' ? 'This gives access to guest counts, room totals, and allotted room numbers in this planning space. It does not include guest contacts, invitations, replies, or notes.' : 'This adds Admin access to this planning space only.'} New users receive an invite email; existing accounts are added directly.</p>{error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-message" role="status">{message}</p>}<button className="primary-button" disabled={submitting || inviteRoles.length === 0}>{submitting ? <LoaderCircle className="spin" size={17} /> : <Mail size={16} />}{submitting ? 'Sending…' : `Invite ${selectedRoleName}`}</button></form><div className="people-list-heading"><h3>People with access</h3><span>{members.length}</span></div>{membersLoading ? <div className="people-loading"><LoaderCircle className="spin" size={18} /> Loading people…</div> : error && members.length === 0 ? null : members.length === 0 ? <p className="people-empty">No one has access yet.</p> : <ul className="people-list">{members.map(person => <li key={person.id}><span className="people-avatar"><Users size={16} /></span><span className="people-identity"><strong>{person.display_name || person.email || 'Workspace member'}</strong>{person.display_name && person.email && <small>{person.email}</small>}</span><span className="people-role"><strong>{person.role_name}</strong><small>{person.email_confirmed_at ? 'Active' : 'Invite pending'}</small></span>{canInviteAdmins && person.role_key === 'admin' && <button type="button" className="people-remove-button" aria-label={`Remove ${person.display_name || person.email || 'Admin'} from this planning space`} title="Remove from this space" disabled={removingMemberId === person.id} onClick={() => void removeAdmin(person)}>{removingMemberId === person.id ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}</button>}</li>)}</ul>}</div><footer className="dialog-actions people-dialog-actions"><button className="secondary-button" onClick={onClose}>Done</button></footer></section></div>
}

function GuestCard({ guest, canDelete, deleting, onDelete, onOpen, onEdit }: { guest: GuestGroup; canDelete: boolean; deleting: boolean; onDelete: () => void; onOpen: () => void; onEdit: () => void }) {
  const stay = guest.check_in_at && guest.check_out_at
    ? `${formatDate(guest.check_in_at)} – ${formatDate(guest.check_out_at)}`
    : guest.check_in_at ? `Arrives ${formatDate(guest.check_in_at)}` : ''
  const roomDetails = [
    guest.room_count === null ? '' : `${guest.room_count} ${guest.room_count === 1 ? 'room' : 'rooms'}`,
    guest.assigned_room_numbers.length ? guest.assigned_room_numbers.join(', ') : '',
  ].filter(Boolean).join(' · ')
  return (
    <article className="guest-card">
      <button className="guest-card-main" onClick={onOpen} aria-label={`View ${guest.family_name}`}>
        <div className="guest-card-title"><div><h2>{guest.family_name}</h2>{guest.contact_name && <span className="guest-contact">{guest.contact_name}{guest.phone ? ` · ${guest.phone}` : ''}</span>}</div><ChevronRight size={18} /></div>
        <div className="guest-card-meta"><span className="expected-count"><Users size={15} />{guest.guest_count} {guest.guest_count === 1 ? 'guest' : 'guests'}</span><span className={`rsvp-pill ${guest.rsvp_status === 'pending' && !guest.invitation_sent ? 'rsvp-not-invited' : `rsvp-${guest.rsvp_status}`}`}>{rsvpLabel(guest)}</span></div>
        <div className="guest-card-status"><span className={guest.invitation_sent ? 'state-done' : 'state-todo'}><Mail size={14} />Invite {guest.invitation_sent ? `sent${guest.invitation_sent_at ? ` · ${formatDate(guest.invitation_sent_at)}` : ''}` : 'not sent'}</span><span className={guest.invitation_call_made ? 'state-done' : 'state-todo'}><Phone size={14} />Call {guest.invitation_call_made ? `made${guest.last_called_at ? ` · ${formatDate(guest.last_called_at)}` : ''}` : 'not made'}</span></div>
        {(stay || roomDetails) && <div className="guest-stay"><CalendarDays size={15} /><span>{stay || 'Stay dates not added'}</span>{roomDetails && <span className="room-count">{roomDetails}</span>}</div>}
      </button>
      <div className="guest-card-actions"><button className="guest-card-edit" onClick={onEdit}><Edit3 size={15} /><span>Edit</span></button>{canDelete && <button className="guest-card-delete" onClick={onDelete} disabled={deleting} aria-label={`Delete ${guest.family_name}`} title="Delete guest"><Trash2 size={15} /></button>}</div>
    </article>
  )
}

function GuestSpreadsheet({ guests, canDelete, deletingGuestId, onDelete, onOpen, onEdit }: {
  guests: GuestGroup[]
  canDelete: boolean
  deletingGuestId: string | null
  onDelete: (guest: GuestGroup) => void
  onOpen: (guest: GuestGroup) => void
  onEdit: (guest: GuestGroup) => void
}) {
  return (
    <div className="spreadsheet-panel">
      <div className="spreadsheet-scroll" role="region" aria-label="Guest spreadsheet" tabIndex={0}>
        <table className={`guest-spreadsheet ${canDelete ? 'has-delete-actions' : ''}`}>
          <thead><tr><th className="sticky-family">Guest</th><th>Guests</th><th>RSVP</th><th>Invitation sent</th><th>Last call</th><th>Check-in</th><th>Check-out</th><th>Number of rooms</th><th>Room numbers</th><th className="sheet-action-heading"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{guests.map(guest => <tr key={guest.id}><th scope="row" className="sticky-family"><button className="sheet-family-button" onClick={() => onOpen(guest)}>{guest.family_name}<small>{guest.contact_name || guest.phone || 'View details'}</small></button></th><td>{guest.guest_count}</td><td><span className={`rsvp-pill ${guest.rsvp_status === 'pending' && !guest.invitation_sent ? 'rsvp-not-invited' : `rsvp-${guest.rsvp_status}`}`}>{rsvpLabel(guest)}</span></td><td>{guest.invitation_sent ? <span className="sheet-complete"><Check size={14} />{formatDate(guest.invitation_sent_at)}</span> : <span className="sheet-muted">Not sent</span>}</td><td>{guest.invitation_call_made ? <span className="sheet-complete"><Phone size={14} />{formatDate(guest.last_called_at)}</span> : <span className="sheet-muted">Not called</span>}</td><td>{formatDate(guest.check_in_at) || '—'}</td><td>{formatDate(guest.check_out_at) || '—'}</td><td>{guest.room_count ?? '—'}</td><td>{guest.assigned_room_numbers.join(', ') || '—'}</td><td className="sheet-action"><span className="sheet-row-actions"><button className="sheet-edit-button" aria-label={`Edit ${guest.family_name}`} title="Edit guest" onClick={() => onEdit(guest)}><Edit3 size={16} /></button>{canDelete && <button className="sheet-delete-button" aria-label={`Delete ${guest.family_name}`} title="Delete guest" disabled={deletingGuestId === guest.id} onClick={() => onDelete(guest)}><Trash2 size={15} /></button>}</span></td></tr>)}</tbody>
        </table>
      </div>
      <p className="spreadsheet-hint">Scroll sideways to see more columns.</p>
    </div>
  )
}

function GuestEditor({ workspaceId, guest, onClose, onSaved }: {
  workspaceId: string
  guest: GuestGroup | null
  onClose: () => void
  onSaved: (guest: GuestGroup, documentStatus?: string) => void
}) {
  const [guestName, setGuestName] = useState(guest?.family_name ?? '')
  const [contactName, setContactName] = useState(guest?.contact_name ?? '')
  const [phone, setPhone] = useState(guest?.phone ?? '')
  const [guestCount, setGuestCount] = useState(String(guest?.guest_count ?? 1))
  const [invitationSent, setInvitationSent] = useState(guest?.invitation_sent ?? false)
  const [callMade, setCallMade] = useState(guest?.invitation_call_made ?? false)
  const [lastCalledAt, setLastCalledAt] = useState(guest?.last_called_at ?? '')
  const [rsvpStatus, setRsvpStatus] = useState<RsvpStatus>(guest?.rsvp_status ?? 'pending')
  const [checkIn, setCheckIn] = useState(toLocalDateTime(guest?.check_in_at ?? null))
  const [checkOut, setCheckOut] = useState(toLocalDateTime(guest?.check_out_at ?? null))
  const [roomCount, setRoomCount] = useState(guest?.room_count == null ? '' : String(guest.room_count))
  const [assignedRooms, setAssignedRooms] = useState<string[]>(guest?.assigned_room_numbers ?? [])
  const [notes, setNotes] = useState(guest?.notes ?? '')
  const [documentFiles, setDocumentFiles] = useState<File[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function selectDocuments(event: ChangeEvent<HTMLInputElement>) {
    setDocumentFiles(Array.from(event.target.files ?? []))
    event.target.value = ''
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    setSaving(true)
    setError('')
    const payload = {
      workspace_id: workspaceId,
      family_name: guestName.trim(),
      contact_name: contactName.trim(),
      phone: phone.trim(),
      guest_count: Number(guestCount),
      invitation_sent: invitationSent,
      invitation_sent_at: invitationSent ? (guest?.invitation_sent_at ?? new Date().toISOString()) : null,
      invitation_call_made: callMade,
      last_called_at: callMade ? (lastCalledAt || new Date().toISOString()) : null,
      rsvp_status: rsvpStatus,
      check_in_at: toIso(checkIn),
      check_out_at: toIso(checkOut),
      room_count: roomCount === '' ? null : Number(roomCount),
      assigned_room_numbers: assignedRooms.map(room => room.trim()).filter(Boolean),
      notes: notes.trim(),
      updated_by: (await supabase.auth.getUser()).data.user?.id ?? null,
    }
    const result = guest
      ? await supabase.from('guest_groups').update(payload).eq('workspace_id', workspaceId).eq('id', guest.id).select().single()
      : await supabase.from('guest_groups').insert(payload).select().single()
    if (result.error) {
      const message = result.error.message
      setError(message.includes('guest_groups_checkout_after_checkin')
        ? 'Check-out needs to be after check-in.'
        : message.toLowerCase().includes('row-level security') || message.toLowerCase().includes('permission')
          ? 'You don’t have permission to save this guest. Ask your workspace admin for access.'
          : 'Couldn’t save this guest. Check your connection and try again.')
      setSaving(false)
      return
    }
    const savedGuest = result.data as GuestGroup
    let documentStatus = ''
    if (!guest && documentFiles.length > 0) {
      const { uploadedCount, error: uploadError } = await uploadGuestDocuments(workspaceId, savedGuest.id, documentFiles)
      if (uploadError) {
        documentStatus = uploadedCount
          ? `${savedGuest.family_name} added; ${uploadedCount} ${uploadedCount === 1 ? 'document was' : 'documents were'} uploaded. ${uploadError}`
          : `${savedGuest.family_name} added, but the documents could not be uploaded: ${uploadError}`
      }
    }
    onSaved(savedGuest, documentStatus)
  }

  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><section className="guest-dialog editor-dialog" role="dialog" aria-modal="true" aria-labelledby="guest-editor-title"><header className="dialog-header"><div><span className="guest-eyebrow">GUEST DETAILS</span><h2 id="guest-editor-title">{guest ? 'Edit guest' : 'Add a guest'}</h2></div><button className="dialog-close" onClick={onClose} aria-label="Close"><X size={20} /></button></header><form className="guest-form" onSubmit={save}>
    <fieldset className="form-section"><legend>Guest</legend><label className="form-field">Guest name <span className="required-mark">*</span><input autoFocus value={guestName} onChange={event => setGuestName(event.target.value)} placeholder="e.g. Patel guest" maxLength={140} required /></label><div className="form-two-col"><label className="form-field">Main contact <span className="optional-label">Optional</span><input value={contactName} onChange={event => setContactName(event.target.value)} placeholder="Contact name" maxLength={120} /></label><label className="form-field">Phone number <span className="optional-label">Optional</span><input type="tel" autoComplete="tel" value={phone} onChange={event => setPhone(event.target.value)} placeholder="Phone number" maxLength={40} /></label></div><label className="form-field short-field">Number of guests<input type="number" inputMode="numeric" min="0" max="500" value={guestCount} onChange={event => setGuestCount(event.target.value)} required /><small className="field-hint">Start with your estimate. Update this number as replies come in.</small></label></fieldset>
    <fieldset className="form-section"><legend>Invitation and reply</legend><label className="check-row"><input type="checkbox" checked={invitationSent} onChange={event => setInvitationSent(event.target.checked)} /><span><strong>Invitation sent</strong><small>Mark this when their invitation has been sent.</small></span></label><div className="call-status-control"><label className="check-row"><input type="checkbox" checked={callMade} onChange={event => setCallMade(event.target.checked)} /><span><strong>Call made</strong><small>{lastCalledAt ? `Last called ${formatDate(lastCalledAt)}.` : 'Mark this after calling.'}</small></span></label>{guest && callMade && <button type="button" className="record-call-button" onClick={() => setLastCalledAt(new Date().toISOString())}>Record another call</button>}</div><label className="form-field rsvp-select-field">RSVP status<select value={rsvpStatus} onChange={event => setRsvpStatus(event.target.value as RsvpStatus)}><option value="pending">No reply yet</option><option value="confirmed">Confirmed</option><option value="maybe">Not sure yet</option><option value="declined">Declined</option></select></label></fieldset>
    <fieldset className="form-section"><legend>Stay details <span className="optional-label">Optional</span></legend><div className="form-two-col"><label className="form-field">Check-in date and time<input type="datetime-local" value={checkIn} onChange={event => setCheckIn(event.target.value)} /></label><label className="form-field">Check-out date and time<input type="datetime-local" value={checkOut} onChange={event => setCheckOut(event.target.value)} /></label></div><label className="form-field short-field">Number of rooms<input type="number" inputMode="numeric" min="0" max="100" value={roomCount} onChange={event => setRoomCount(event.target.value)} placeholder="Leave blank if not sure" /></label><div className="assigned-rooms-editor"><div className="assigned-rooms-heading">Room numbers assigned <span className="optional-label">Optional</span></div>{assignedRooms.length === 0 && <p className="room-assignment-hint">Add room numbers once the hotel assigns them.</p>}{assignedRooms.map((room, index) => <div className="assigned-room-row" key={index}><label className="sr-only" htmlFor={`assigned-room-${index}`}>Room number {index + 1}</label><input id={`assigned-room-${index}`} value={room} maxLength={30} onChange={event => setAssignedRooms(current => current.map((value, roomIndex) => roomIndex === index ? event.target.value : value))} placeholder={`Room ${index + 1} number`} /><button type="button" className="remove-room-button" onClick={() => setAssignedRooms(current => current.filter((_, roomIndex) => roomIndex !== index))} aria-label={`Remove room ${room || index + 1}`}><X size={17} /></button></div>)}<button type="button" className="add-room-button" onClick={() => setAssignedRooms(current => [...current, ''])}><Plus size={15} /> Add a room number</button></div></fieldset>
    <label className="form-field notes-field">Note <span className="optional-label">Optional</span><textarea value={notes} onChange={event => setNotes(event.target.value)} rows={2} maxLength={1000} placeholder="Anything helpful to remember" /></label>
    {!guest && <section className="guest-create-documents" aria-label="Documents"><div><strong>Documents</strong><small>Optional · PDFs or images, up to 20 MB each</small></div><label className="guest-document-upload"><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif" multiple onChange={selectDocuments} /><span><Upload size={15} />Choose files</span></label>{documentFiles.length > 0 && <p>{documentFiles.length === 1 ? documentFiles[0].name : `${documentFiles.length} files selected`}</p>}</section>}
    {error && <p className="form-error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}{guest ? 'Save changes' : 'Save guest'}</button></div>
    </form></section></div>
}

function GuestDetails({ workspaceId, guest, canDelete, deleting, onDelete, onClose, onEdit }: { workspaceId: string; guest: GuestGroup; canDelete: boolean; deleting: boolean; onDelete: () => void; onClose: () => void; onEdit: () => void }) {
  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><section className="guest-dialog detail-dialog" role="dialog" aria-modal="true" aria-labelledby="guest-detail-title"><header className="dialog-header"><div><span className="guest-eyebrow">GUEST DETAILS</span><h2 id="guest-detail-title">{guest.family_name}</h2></div><button className="dialog-close" onClick={onClose} aria-label="Close"><X size={20} /></button></header><div className="detail-body"><div className="detail-highlight"><Users size={18} /><strong>{guest.guest_count} {guest.guest_count === 1 ? 'guest' : 'guests'}</strong><span className={`rsvp-pill ${guest.rsvp_status === 'pending' && !guest.invitation_sent ? 'rsvp-not-invited' : `rsvp-${guest.rsvp_status}`}`}>{rsvpLabel(guest)}</span></div><dl className="detail-list"><DetailLine label="Main contact" value={guest.contact_name || 'Not added'} /><DetailLine label="Phone number" value={guest.phone || 'Not added'} /><DetailLine label="Invitation" value={guest.invitation_sent ? `Sent${guest.invitation_sent_at ? ` · ${formatDate(guest.invitation_sent_at)}` : ''}` : 'Not sent'} /><DetailLine label="Invitation call" value={guest.invitation_call_made ? `Made${guest.last_called_at ? ` · ${formatDate(guest.last_called_at)}` : ''}` : 'Not made'} /><DetailLine label="Check-in" value={formatDate(guest.check_in_at) || 'Not added'} /><DetailLine label="Check-out" value={formatDate(guest.check_out_at) || 'Not added'} /><DetailLine label="Number of rooms" value={guest.room_count === null ? 'Not added' : String(guest.room_count)} /><DetailLine label="Room numbers assigned" value={guest.assigned_room_numbers.join(', ') || 'Not assigned'} /><DetailLine label="Note" value={guest.notes || 'None'} /></dl><GuestDocuments workspaceId={workspaceId} guestId={guest.id} canManage={canDelete} /></div><footer className="dialog-actions detail-actions"><button className="secondary-button" onClick={onClose}>Close</button><button className="primary-button" onClick={onEdit}><Edit3 size={16} /> Edit guest</button>{canDelete && <button className="danger-button danger-icon-button" onClick={onDelete} disabled={deleting} aria-label="Delete guest" title="Delete guest"><Trash2 size={15} /></button>}</footer></section></div>
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return <div className="detail-line"><dt>{label}</dt><dd>{value}</dd></div>
}
