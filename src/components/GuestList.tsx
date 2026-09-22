import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowLeft, BedDouble, CalendarDays, Check, ChevronDown, ChevronRight, Edit3, Heart, LoaderCircle, Mail, Plus, Search, Table2, UserPlus, Users, X } from 'lucide-react'
import { supabase } from '../lib/supabase'

type RsvpStatus = 'pending' | 'confirmed' | 'maybe' | 'declined'
type Filter = 'all' | 'invite' | 'rsvp' | 'confirmed'
type ViewMode = 'cards' | 'spreadsheet'
type WorkspaceSection = 'guests' | 'lodging'

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
  all: 'All families',
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
  const [section, setSection] = useState<WorkspaceSection>('guests')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingGuest, setEditingGuest] = useState<GuestGroup | null>(null)
  const [lodgingEditingGuest, setLodgingEditingGuest] = useState<GuestGroup | null>(null)
  const [detailsGuest, setDetailsGuest] = useState<GuestGroup | null>(null)
  const [toast, setToast] = useState('')
  const [canManagePeople, setCanManagePeople] = useState(false)
  const [peopleOpen, setPeopleOpen] = useState(false)

  async function loadGuests() {
    if (!supabase) return
    setLoading(true)
    setLoadError('')
    const { data, error } = await supabase
      .from('guest_groups')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('family_name', { ascending: true })
    if (error) {
      setLoadError(error.message)
      setGuests([])
    } else {
      setGuests((data ?? []) as GuestGroup[])
    }
    setLoading(false)
  }

  useEffect(() => {
    setEditorOpen(false)
    setDetailsGuest(null)
    void loadGuests()
  }, [workspaceId])

  useEffect(() => {
    let alive = true
    setCanManagePeople(false)
    if (!supabase) return () => { alive = false }
    void supabase.rpc('has_permission', {
      requested_permission: 'users.manage',
      requested_workspace_id: workspaceId,
    }).then(({ data, error }) => {
      if (alive) setCanManagePeople(!error && data === true)
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

  function showEditor(guest?: GuestGroup) {
    setDetailsGuest(null)
    setEditingGuest(guest ?? null)
    setEditorOpen(true)
  }

  function notifySaved(guest: GuestGroup, wasEditing: boolean) {
    setEditorOpen(false)
    setEditingGuest(null)
    setLodgingEditingGuest(null)
    setDetailsGuest(null)
    setToast(`${guest.family_name} ${wasEditing ? 'saved' : 'added'}`)
    window.setTimeout(() => setToast(''), 3000)
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
            <button className={section === 'guests' ? 'section-selected' : ''} aria-current={section === 'guests' ? 'page' : undefined} onClick={() => setSection('guests')}><Users size={17} /><span>Guests</span></button>
            <button className={section === 'lodging' ? 'section-selected' : ''} aria-current={section === 'lodging' ? 'page' : undefined} onClick={() => setSection('lodging')}><BedDouble size={17} /><span>Lodging</span></button>
          </nav>
        </aside>

      <main className={`guest-main ${section === 'guests' && viewMode === 'spreadsheet' ? 'spreadsheet-main' : ''}`}>
        {section === 'guests' ? <>
        <div className="guest-heading-row"><div><span className="guest-eyebrow">YOUR PLANNING SPACE</span><h1>Guests</h1><p>Keep track of families, replies, and stays.</p></div><button className="primary-button add-family-button" onClick={() => showEditor()}><Plus size={18} /> Add family</button></div>
        <section className="guest-summary" aria-label="Guest list summary"><div><Users size={16} /><strong>{guests.length}</strong><span>{guests.length === 1 ? 'family' : 'families'}</span></div><span className="summary-divider" /><div><strong>{guestTotal}</strong><span>guests</span></div><span className="summary-divider" /><div><strong>{inviteTotal}</strong><span>to invite</span></div><span className="summary-divider" /><div><strong>{waitingTotal}</strong><span>awaiting RSVP</span></div><span className="summary-divider" /><div><strong>{assignedRoomTotal}</strong><span>rooms assigned</span></div></section>

        <div className="guest-toolbar"><label className="guest-search"><Search size={18} /><input aria-label="Search families or contacts" placeholder="Search families or contacts" value={search} onChange={event => setSearch(event.target.value)} /></label><button className="mobile-add-button" onClick={() => showEditor()} aria-label="Add family"><Plus size={18} /><span>Add</span></button></div>

        <nav className="guest-filters" aria-label="Filter guest list">{(Object.keys(filterLabels) as Filter[]).map(key => <button key={key} className={`filter-chip ${filter === key ? 'filter-active' : ''}`} aria-pressed={filter === key} onClick={() => setFilter(key)}>{filterLabels[key]}{key === 'invite' && inviteTotal > 0 && <span className="filter-count">{inviteTotal}</span>}{key === 'rsvp' && waitingTotal > 0 && <span className="filter-count">{waitingTotal}</span>}{key === 'confirmed' && confirmedTotal > 0 && <span className="filter-count">{confirmedTotal}</span>}</button>)}</nav>

        {!loading && !loadError && guests.length > 0 && <div className="guest-view-row"><span>{filteredGuests.length} {filteredGuests.length === 1 ? 'family' : 'families'}</span><div className="guest-view-switch" role="group" aria-label="Guest list view"><button aria-pressed={viewMode === 'cards'} className={viewMode === 'cards' ? 'view-selected' : ''} onClick={() => setViewMode('cards')}>Cards</button><button aria-pressed={viewMode === 'spreadsheet'} className={viewMode === 'spreadsheet' ? 'view-selected' : ''} onClick={() => setViewMode('spreadsheet')}><Table2 size={15} />Spreadsheet</button></div></div>}

        <div className="guest-data-scroll">
          {loading ? <div className="guest-loading"><LoaderCircle className="spin" size={22} /> Loading families…</div> : loadError ? <div className="guest-state error-state"><h2>Couldn’t load the guest list</h2><p>{loadError.includes('schema cache') || loadError.includes('guest_groups') ? 'The guest-list database setup hasn’t been applied yet. Ask your project admin to apply the guest-list migration.' : 'Check your connection or workspace access, then try again.'}</p><button className="secondary-button" onClick={() => void loadGuests()}>Try again</button></div> : guests.length === 0 ? <div className="guest-state"><div className="empty-mark"><Users size={23} /></div><h2>Start with one family</h2><p>Add a family you’re inviting. You can fill in invitation, RSVP, and stay details now or later.</p><button className="primary-button" onClick={() => showEditor()}><Plus size={17} /> Add your first family</button></div> : filteredGuests.length === 0 ? <div className="guest-state compact-state"><h2>No families match this view</h2><p>Try a different search or filter.</p><button className="text-button" onClick={() => { setSearch(''); setFilter('all') }}>Clear search and filters</button></div> : viewMode === 'spreadsheet' ? <GuestSpreadsheet guests={filteredGuests} onOpen={guest => setDetailsGuest(guest)} onEdit={guest => showEditor(guest)} /> : <section className="guest-list" aria-label="Families you are inviting">{filteredGuests.map(guest => <GuestCard key={guest.id} guest={guest} onOpen={() => setDetailsGuest(guest)} onEdit={() => showEditor(guest)} />)}</section>}
          <footer className="guest-footer">Your guest list is shared with people who have access to this planning space.</footer>
        </div>
        </> : <LodgingView guests={guests} loading={loading} loadError={loadError} onRetry={() => void loadGuests()} onEdit={setLodgingEditingGuest} />}
      </main>
      <nav className="mobile-workspace-nav" aria-label="Planning space sections"><button className={section === 'guests' ? 'section-selected' : ''} aria-current={section === 'guests' ? 'page' : undefined} onClick={() => setSection('guests')}><Users size={18} /><span>Guests</span></button><button className={section === 'lodging' ? 'section-selected' : ''} aria-current={section === 'lodging' ? 'page' : undefined} onClick={() => setSection('lodging')}><BedDouble size={18} /><span>Lodging</span></button><button onClick={onBackToSpaces}><ArrowLeft size={18} /><span>Spaces</span></button></nav>
      </div>

      {editorOpen && <GuestEditor key={editingGuest?.id ?? 'new'} workspaceId={workspaceId} guest={editingGuest} onClose={() => setEditorOpen(false)} onSaved={guest => notifySaved(guest, Boolean(editingGuest))} />}
      {lodgingEditingGuest && <LodgingEditor key={lodgingEditingGuest.id} workspaceId={workspaceId} guest={lodgingEditingGuest} onClose={() => setLodgingEditingGuest(null)} onSaved={guest => notifySaved(guest, true)} />}
      {detailsGuest && <GuestDetails guest={detailsGuest} onClose={() => setDetailsGuest(null)} onEdit={() => showEditor(detailsGuest)} />}
      {peopleOpen && canManagePeople && <WorkspacePeopleDialog workspaceId={workspaceId} workspaceName={workspaces.find(workspace => workspace.id === workspaceId)?.name ?? 'Planning space'} onClose={() => setPeopleOpen(false)} />}
      {toast && <div className="toast-message" role="status"><Check size={17} /> {toast}</div>}
    </div>
  )
}

type WorkspacePerson = {
  id: string
  email: string
  display_name: string
  email_confirmed_at: string | null
  role_name: string
}

function LodgingView({ guests, loading, loadError, onRetry, onEdit }: {
  guests: GuestGroup[]
  loading: boolean
  loadError: string
  onRetry: () => void
  onEdit: (guest: GuestGroup) => void
}) {
  const guestTotal = guests.reduce((count, guest) => count + guest.guest_count, 0)
  const roomTotal = guests.reduce((count, guest) => count + (guest.room_count ?? 0), 0)

  return <>
    <div className="lodging-heading"><div><span className="guest-eyebrow">ROOM OVERVIEW</span><h1>Lodging</h1><p>Guests, room totals, and allotted room numbers.</p></div><div className="lodging-summary"><strong>{guestTotal}</strong><span>guests</span><i /><strong>{roomTotal}</strong><span>total rooms</span></div></div>
    <div className="lodging-data-scroll">
      {loading ? <div className="guest-loading"><LoaderCircle className="spin" size={22} /> Loading lodging…</div>
        : loadError ? <div className="guest-state error-state"><h2>Couldn’t load lodging</h2><p>Check your connection or workspace access, then try again.</p><button className="secondary-button" onClick={onRetry}>Try again</button></div>
          : guests.length === 0 ? <div className="guest-state"><div className="empty-mark"><BedDouble size={23} /></div><h2>No families yet</h2><p>Add families in Guests, then record their stay and room details here.</p></div>
            : <div className="lodging-table-scroll" role="region" aria-label="Lodging spreadsheet" tabIndex={0}><table className="lodging-table"><thead><tr><th>Family</th><th>Guests</th><th>Total rooms</th><th>Allotted room numbers</th><th className="lodging-action-heading">Action</th></tr></thead><tbody>{guests.map(guest => <tr key={guest.id}><th scope="row"><strong>{guest.family_name}</strong><small>{guest.contact_name || guest.phone || 'No contact added'}</small></th><td>{guest.guest_count}</td><td>{guest.room_count ?? <span className="sheet-muted">Not set</span>}</td><td>{guest.assigned_room_numbers?.filter(room => room.trim()).join(', ') || <span className="sheet-muted">Not allotted</span>}</td><td className="lodging-action"><button className="sheet-edit-button" onClick={() => onEdit(guest)}><Edit3 size={14} /> Edit</button></td></tr>)}</tbody></table><p className="spreadsheet-hint">Scroll sideways to see more columns.</p></div>}
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
    const userId = (await supabase.auth.getUser()).data.user?.id ?? null
    const { data, error: saveError } = await supabase.from('guest_groups').update({
      guest_count: Number(guestCount),
      room_count: roomCount === '' ? null : Number(roomCount),
      assigned_room_numbers: roomNumbers.map(room => room.trim()).filter(Boolean),
      updated_by: userId,
    }).eq('workspace_id', workspaceId).eq('id', guest.id).select().single()
    setSaving(false)
    if (saveError) {
      setError('Could not update these lodging details. Check your access and try again.')
      return
    }
    onSaved(data as GuestGroup)
  }

  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !saving) onClose() }}><section className="guest-dialog lodging-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="lodging-editor-title"><header className="dialog-header"><div><span className="guest-eyebrow">{guest.family_name}</span><h2 id="lodging-editor-title">Update lodging</h2></div><button className="dialog-close" onClick={onClose} aria-label="Close" disabled={saving}><X size={20} /></button></header><form className="guest-form lodging-editor-form" onSubmit={save}>
    <label className="form-field">Number of guests<input type="number" inputMode="numeric" min="0" max="500" value={guestCount} onChange={event => setGuestCount(event.target.value)} required /></label>
    <label className="form-field">Total rooms<input type="number" inputMode="numeric" min="0" max="100" value={roomCount} onChange={event => setRoomCount(event.target.value)} placeholder="Not set" /></label>
    <div className="assigned-rooms-editor"><div className="assigned-rooms-heading">Allotted room numbers</div>{roomNumbers.length === 0 && <p className="room-assignment-hint">No room numbers allotted.</p>}{roomNumbers.map((room, index) => <div className="assigned-room-row" key={index}><label className="sr-only" htmlFor={`lodging-room-${guest.id}-${index}`}>Allotted room number {index + 1}</label><input id={`lodging-room-${guest.id}-${index}`} value={room} maxLength={30} onChange={event => setRoomNumbers(current => current.map((value, roomIndex) => roomIndex === index ? event.target.value : value))} placeholder={`Room number ${index + 1}`} /><button type="button" className="remove-room-button" onClick={() => setRoomNumbers(current => current.filter((_, roomIndex) => roomIndex !== index))} aria-label={`Remove room ${room || index + 1}`}><X size={17} /></button></div>)}<button type="button" className="add-room-button" onClick={() => setRoomNumbers(current => [...current, ''])}><Plus size={15} /> Add room number</button></div>
    {error && <p className="form-error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}{saving ? 'Saving…' : 'Save changes'}</button></div>
    </form></section></div>
}

function WorkspacePeopleDialog({ workspaceId, workspaceName, onClose }: {
  workspaceId: string
  workspaceName: string
  onClose: () => void
}) {
  const [members, setMembers] = useState<WorkspacePerson[]>([])
  const [membersLoading, setMembersLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

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
      roleIds.length ? supabase.from('roles').select('id, name').in('id', roleIds) : Promise.resolve({ data: [], error: null }),
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
      body: { workspaceId, email: email.trim() },
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
    setMessage(data?.status === 'added'
      ? 'This person already had an account. Admin access was added; they can sign in to open the planning space.'
      : data?.status === 'pending_confirmation'
        ? 'Admin access is ready and will work after this person confirms their existing account.'
        : 'Invitation sent. They can create their account from the email.')
    setSubmitting(false)
    await loadMembers()
  }

  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><section className="guest-dialog people-dialog" role="dialog" aria-modal="true" aria-labelledby="people-dialog-title"><header className="dialog-header"><div><span className="guest-eyebrow">PLANNING SPACE ACCESS</span><h2 id="people-dialog-title">People</h2><p className="people-workspace-name">{workspaceName}</p></div><button className="dialog-close" onClick={onClose} aria-label="Close"><X size={20} /></button></header><div className="people-dialog-body"><form className="people-invite-form" onSubmit={invitePerson}><label className="form-field">Email address<input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="person@example.com" maxLength={254} required /></label><div className="people-role-line"><span>Access level</span><strong>Admin</strong></div><p className="people-help">This adds Admin access to this planning space only. To add someone elsewhere, select that space and invite them separately. New users receive an invite email; existing accounts are added directly.</p>{error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-message" role="status">{message}</p>}<button className="primary-button" disabled={submitting}>{submitting ? <LoaderCircle className="spin" size={17} /> : <Mail size={16} />}{submitting ? 'Sending…' : 'Invite admin'}</button></form><div className="people-list-heading"><h3>People with access</h3><span>{members.length}</span></div>{membersLoading ? <div className="people-loading"><LoaderCircle className="spin" size={18} /> Loading people…</div> : error && members.length === 0 ? null : members.length === 0 ? <p className="people-empty">No one has access yet.</p> : <ul className="people-list">{members.map(person => <li key={person.id}><span className="people-avatar"><Users size={16} /></span><span className="people-identity"><strong>{person.display_name || person.email || 'Workspace member'}</strong>{person.display_name && person.email && <small>{person.email}</small>}</span><span className="people-role"><strong>{person.role_name}</strong><small>{person.email_confirmed_at ? 'Active' : 'Invite pending'}</small></span></li>)}</ul>}</div><footer className="dialog-actions people-dialog-actions"><button className="secondary-button" onClick={onClose}>Done</button></footer></section></div>
}

function GuestCard({ guest, onOpen, onEdit }: { guest: GuestGroup; onOpen: () => void; onEdit: () => void }) {
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
        <div className="guest-card-status"><span className={guest.invitation_sent ? 'state-done' : 'state-todo'}><Mail size={14} />Invite {guest.invitation_sent ? `sent${guest.invitation_sent_at ? ` · ${formatDate(guest.invitation_sent_at)}` : ''}` : 'not sent'}</span><span className={guest.invitation_call_made ? 'state-done' : 'state-todo'}><Check size={14} />Call {guest.invitation_call_made ? `made${guest.last_called_at ? ` · ${formatDate(guest.last_called_at)}` : ''}` : 'not made'}</span></div>
        {(stay || roomDetails) && <div className="guest-stay"><CalendarDays size={15} /><span>{stay || 'Stay dates not added'}</span>{roomDetails && <span className="room-count">{roomDetails}</span>}</div>}
      </button>
      <button className="guest-card-edit" onClick={onEdit}><Edit3 size={15} /><span>Edit</span></button>
    </article>
  )
}

function GuestSpreadsheet({ guests, onOpen, onEdit }: {
  guests: GuestGroup[]
  onOpen: (guest: GuestGroup) => void
  onEdit: (guest: GuestGroup) => void
}) {
  return (
    <div className="spreadsheet-panel">
      <div className="spreadsheet-scroll" role="region" aria-label="Guest spreadsheet" tabIndex={0}>
        <table className="guest-spreadsheet">
          <thead><tr><th className="sticky-family">Family</th><th>Guests</th><th>RSVP</th><th>Invitation sent</th><th>Last call</th><th>Check-in</th><th>Check-out</th><th>Number of rooms</th><th>Room numbers</th><th className="sheet-action-heading">Action</th></tr></thead>
          <tbody>{guests.map(guest => <tr key={guest.id}><th scope="row" className="sticky-family"><button className="sheet-family-button" onClick={() => onOpen(guest)}>{guest.family_name}<small>{guest.contact_name || guest.phone || 'View details'}</small></button></th><td>{guest.guest_count}</td><td><span className={`rsvp-pill ${guest.rsvp_status === 'pending' && !guest.invitation_sent ? 'rsvp-not-invited' : `rsvp-${guest.rsvp_status}`}`}>{rsvpLabel(guest)}</span></td><td>{guest.invitation_sent ? <span className="sheet-complete"><Check size={14} />{formatDate(guest.invitation_sent_at)}</span> : <span className="sheet-muted">Not sent</span>}</td><td>{guest.invitation_call_made ? <span className="sheet-complete"><Check size={14} />{formatDate(guest.last_called_at)}</span> : <span className="sheet-muted">Not called</span>}</td><td>{formatDate(guest.check_in_at) || '—'}</td><td>{formatDate(guest.check_out_at) || '—'}</td><td>{guest.room_count ?? '—'}</td><td>{guest.assigned_room_numbers.join(', ') || '—'}</td><td className="sheet-action"><button className="sheet-edit-button" onClick={() => onEdit(guest)}><Edit3 size={14} /> Edit</button></td></tr>)}</tbody>
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
  onSaved: (guest: GuestGroup) => void
}) {
  const [familyName, setFamilyName] = useState(guest?.family_name ?? '')
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
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    setSaving(true)
    setError('')
    const payload = {
      workspace_id: workspaceId,
      family_name: familyName.trim(),
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
          ? 'You don’t have permission to save this family. Ask your workspace admin for access.'
          : 'Couldn’t save this family. Check your connection and try again.')
      setSaving(false)
      return
    }
    onSaved(result.data as GuestGroup)
  }

  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><section className="guest-dialog editor-dialog" role="dialog" aria-modal="true" aria-labelledby="guest-editor-title"><header className="dialog-header"><div><span className="guest-eyebrow">GUEST DETAILS</span><h2 id="guest-editor-title">{guest ? 'Edit family' : 'Add a family'}</h2></div><button className="dialog-close" onClick={onClose} aria-label="Close"><X size={20} /></button></header><form className="guest-form" onSubmit={save}>
    <fieldset className="form-section"><legend>Family</legend><label className="form-field">Family name <span className="required-mark">*</span><input autoFocus value={familyName} onChange={event => setFamilyName(event.target.value)} placeholder="e.g. Patel family" maxLength={140} required /></label><div className="form-two-col"><label className="form-field">Main contact <span className="optional-label">Optional</span><input value={contactName} onChange={event => setContactName(event.target.value)} placeholder="Contact name" maxLength={120} /></label><label className="form-field">Phone number <span className="optional-label">Optional</span><input type="tel" autoComplete="tel" value={phone} onChange={event => setPhone(event.target.value)} placeholder="Phone number" maxLength={40} /></label></div><label className="form-field short-field">Number of guests<input type="number" inputMode="numeric" min="0" max="500" value={guestCount} onChange={event => setGuestCount(event.target.value)} required /><small className="field-hint">Start with your estimate. Update this number as replies come in.</small></label></fieldset>
    <fieldset className="form-section"><legend>Invitation and reply</legend><label className="check-row"><input type="checkbox" checked={invitationSent} onChange={event => setInvitationSent(event.target.checked)} /><span><strong>Invitation sent</strong><small>Mark this when their invitation has been sent.</small></span></label><div className="call-status-control"><label className="check-row"><input type="checkbox" checked={callMade} onChange={event => setCallMade(event.target.checked)} /><span><strong>Call made</strong><small>{lastCalledAt ? `Last called ${formatDate(lastCalledAt)}.` : 'Mark this after calling.'}</small></span></label>{guest && callMade && <button type="button" className="record-call-button" onClick={() => setLastCalledAt(new Date().toISOString())}>Record another call</button>}</div><label className="form-field rsvp-select-field">RSVP status<select value={rsvpStatus} onChange={event => setRsvpStatus(event.target.value as RsvpStatus)}><option value="pending">No reply yet</option><option value="confirmed">Confirmed</option><option value="maybe">Not sure yet</option><option value="declined">Declined</option></select></label></fieldset>
    <fieldset className="form-section"><legend>Stay details <span className="optional-label">Optional</span></legend><div className="form-two-col"><label className="form-field">Check-in date and time<input type="datetime-local" value={checkIn} onChange={event => setCheckIn(event.target.value)} /></label><label className="form-field">Check-out date and time<input type="datetime-local" value={checkOut} onChange={event => setCheckOut(event.target.value)} /></label></div><label className="form-field short-field">Number of rooms<input type="number" inputMode="numeric" min="0" max="100" value={roomCount} onChange={event => setRoomCount(event.target.value)} placeholder="Leave blank if not sure" /></label><div className="assigned-rooms-editor"><div className="assigned-rooms-heading">Room numbers assigned <span className="optional-label">Optional</span></div>{assignedRooms.length === 0 && <p className="room-assignment-hint">Add room numbers once the hotel assigns them.</p>}{assignedRooms.map((room, index) => <div className="assigned-room-row" key={index}><label className="sr-only" htmlFor={`assigned-room-${index}`}>Room number {index + 1}</label><input id={`assigned-room-${index}`} value={room} maxLength={30} onChange={event => setAssignedRooms(current => current.map((value, roomIndex) => roomIndex === index ? event.target.value : value))} placeholder={`Room ${index + 1} number`} /><button type="button" className="remove-room-button" onClick={() => setAssignedRooms(current => current.filter((_, roomIndex) => roomIndex !== index))} aria-label={`Remove room ${room || index + 1}`}><X size={17} /></button></div>)}<button type="button" className="add-room-button" onClick={() => setAssignedRooms(current => [...current, ''])}><Plus size={15} /> Add a room number</button></div></fieldset>
    <label className="form-field notes-field">Note <span className="optional-label">Optional</span><textarea value={notes} onChange={event => setNotes(event.target.value)} rows={2} maxLength={1000} placeholder="Anything helpful to remember" /></label>
    {error && <p className="form-error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}{guest ? 'Save changes' : 'Save family'}</button></div>
    </form></section></div>
}

function GuestDetails({ guest, onClose, onEdit }: { guest: GuestGroup; onClose: () => void; onEdit: () => void }) {
  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><section className="guest-dialog detail-dialog" role="dialog" aria-modal="true" aria-labelledby="guest-detail-title"><header className="dialog-header"><div><span className="guest-eyebrow">FAMILY DETAILS</span><h2 id="guest-detail-title">{guest.family_name}</h2></div><button className="dialog-close" onClick={onClose} aria-label="Close"><X size={20} /></button></header><div className="detail-body"><div className="detail-highlight"><Users size={18} /><strong>{guest.guest_count} {guest.guest_count === 1 ? 'guest' : 'guests'}</strong><span className={`rsvp-pill ${guest.rsvp_status === 'pending' && !guest.invitation_sent ? 'rsvp-not-invited' : `rsvp-${guest.rsvp_status}`}`}>{rsvpLabel(guest)}</span></div><dl className="detail-list"><DetailLine label="Main contact" value={guest.contact_name || 'Not added'} /><DetailLine label="Phone number" value={guest.phone || 'Not added'} /><DetailLine label="Invitation" value={guest.invitation_sent ? `Sent${guest.invitation_sent_at ? ` · ${formatDate(guest.invitation_sent_at)}` : ''}` : 'Not sent'} /><DetailLine label="Invitation call" value={guest.invitation_call_made ? `Made${guest.last_called_at ? ` · ${formatDate(guest.last_called_at)}` : ''}` : 'Not made'} /><DetailLine label="Check-in" value={formatDate(guest.check_in_at) || 'Not added'} /><DetailLine label="Check-out" value={formatDate(guest.check_out_at) || 'Not added'} /><DetailLine label="Number of rooms" value={guest.room_count === null ? 'Not added' : String(guest.room_count)} /><DetailLine label="Room numbers assigned" value={guest.assigned_room_numbers.join(', ') || 'Not assigned'} /><DetailLine label="Note" value={guest.notes || 'None'} /></dl></div><footer className="dialog-actions detail-actions"><button className="secondary-button" onClick={onClose}>Close</button><button className="primary-button" onClick={onEdit}><Edit3 size={16} /> Edit family</button></footer></section></div>
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return <div className="detail-line"><dt>{label}</dt><dd>{value}</dd></div>
}
