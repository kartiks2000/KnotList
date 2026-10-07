import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, Check, Circle, Edit3, ListChecks, LoaderCircle, MessageCircle, Plus, Send, Trash2, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { DropdownSelect } from './DropdownSelect'

type TaskFilter = 'all' | 'incomplete' | 'completed'
type TaskAssignee = { user_id: string; display_name: string; email: string | null }
type TaskComment = { id: string; workspace_id: string; task_id: string; user_id: string; author_name: string; body: string; created_at: string }
type WorkspaceTask = {
  id: string
  workspace_id: string
  title: string
  description: string
  assigned_to: string | null
  deadline: string | null
  is_completed: boolean
  created_at: string
  workspace_task_comments: TaskComment[]
}

type TaskCardActions = {
  toggle: (task: WorkspaceTask) => void
  edit: (task: WorkspaceTask) => void
  remove: (task: WorkspaceTask) => void
  comment: (task: WorkspaceTask, body: string) => void
  draft: (taskId: string, value: string) => void
}

const TaskCard = memo(function TaskCard({ task, canManage, busy, assignee, commentDraft, actions }: {
  task: WorkspaceTask
  canManage: boolean
  busy: boolean
  assignee: string
  commentDraft: string
  actions: TaskCardActions
}) {
  return <article className={`task-card ${task.is_completed ? 'task-completed' : ''}`}>
    <div className="task-card-main">
      <button className="task-complete-button" aria-label={task.is_completed ? `Mark ${task.title} incomplete` : `Mark ${task.title} complete`} title={task.is_completed ? 'Mark incomplete' : 'Mark complete'} disabled={!canManage || busy} onClick={() => actions.toggle(task)}>{task.is_completed ? <Check size={15} /> : <Circle size={17} />}</button>
      <div className="task-info"><h2>{task.title}</h2>{task.description && <p className="task-description">{task.description}</p>}<div className="task-meta"><span>{assignee}</span>{task.deadline && <span><CalendarDays size={13} />Due {formatDeadline(task.deadline)}</span>}</div></div>
      {canManage && <div className="task-card-actions"><button className="task-edit-button" aria-label={`Edit ${task.title}`} title="Edit task" disabled={busy} onClick={() => actions.edit(task)}><Edit3 size={15} /></button><button className="task-delete-button" aria-label={`Delete ${task.title}`} title="Delete task" disabled={busy} onClick={() => actions.remove(task)}>{busy ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}</button></div>}
    </div>
    <details className="task-comments">
      <summary><MessageCircle size={15} /><span>Comments</span><span className="task-comment-count">{task.workspace_task_comments.length}</span></summary>
      <div className="task-comments-body">
        {task.workspace_task_comments.length > 0 ? <ul>{task.workspace_task_comments.map(comment => <li key={comment.id}><div><strong>{comment.author_name}</strong><time dateTime={comment.created_at}>{formatCommentDate(comment.created_at)}</time></div><p>{comment.body}</p></li>)}</ul> : <p className="task-no-comments">No comments yet.</p>}
        <form className="task-comment-form" onSubmit={event => { event.preventDefault(); actions.comment(task, commentDraft) }}><label className="sr-only" htmlFor={`task-comment-${task.id}`}>Add a status comment</label><input id={`task-comment-${task.id}`} value={commentDraft} onChange={event => actions.draft(task.id, event.target.value)} maxLength={1000} placeholder="Share a quick update…" required /><button className="task-comment-submit" disabled={busy || !commentDraft.trim()} aria-label="Post comment" title="Post comment"><Send size={15} /></button></form>
      </div>
    </details>
  </article>
})

function formatDeadline(value: string | null) {
  if (!value) return ''
  const [year, month, day] = value.split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(year, month - 1, day))
}

function formatCommentDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value))
}

export const TasksView = memo(function TasksView({ workspaceId, canManage }: { workspaceId: string; canManage: boolean }) {
  const [tasks, setTasks] = useState<WorkspaceTask[]>([])
  const [assignees, setAssignees] = useState<TaskAssignee[]>([])
  const [currentUserId, setCurrentUserId] = useState('')
  const [currentUserEmail, setCurrentUserEmail] = useState('')
  const [filter, setFilter] = useState<TaskFilter>('all')
  const [assigneeFilter, setAssigneeFilter] = useState('all')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [deadline, setDeadline] = useState('')
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<WorkspaceTask | null>(null)
  const [busyTaskId, setBusyTaskId] = useState('')
  const [error, setError] = useState('')
  const taskActionsRef = useRef<TaskCardActions>({ toggle: () => {}, edit: () => {}, remove: () => {}, comment: () => {}, draft: () => {} })
  const loadSequenceRef = useRef(0)
  const lastFocusRefreshRef = useRef(0)

  async function loadTasks(quiet = false) {
    if (!supabase) return
    const requestSequence = ++loadSequenceRef.current
    if (!quiet) setLoading(true)
    setError('')
    const [userResult, taskResult, assigneeResult] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from('workspace_tasks').select('id, workspace_id, title, description, assigned_to, deadline, is_completed, created_at').eq('workspace_id', workspaceId).order('created_at', { ascending: false }),
      supabase.rpc('get_workspace_task_assignees', { requested_workspace_id: workspaceId }),
    ])
    if (requestSequence !== loadSequenceRef.current) return
    if (taskResult.error || assigneeResult.error) {
      if (!quiet) {
        setTasks([])
        setAssignees([])
      }
      setError(taskResult.error?.message || assigneeResult.error?.message || 'Could not load tasks. Apply the tasks migration, then try again.')
      if (!quiet) setLoading(false)
      return
    }

    const taskRows = (taskResult.data ?? []) as Omit<WorkspaceTask, 'workspace_task_comments'>[]
    const ids = taskRows.map(task => task.id)
    const commentResult = ids.length
      ? await supabase.from('workspace_task_comments').select('id, workspace_id, task_id, user_id, author_name, body, created_at').eq('workspace_id', workspaceId).in('task_id', ids).order('created_at', { ascending: true })
      : { data: [], error: null }
    if (requestSequence !== loadSequenceRef.current) return
    if (commentResult.error) {
      setError(commentResult.error.message)
      if (!quiet) setLoading(false)
      return
    }
    const comments = (commentResult.data ?? []) as TaskComment[]
    setTasks(taskRows.map(task => ({ ...task, workspace_task_comments: comments.filter(comment => comment.task_id === task.id) })))
    const nextAssignees = (assigneeResult.data ?? []) as TaskAssignee[]
    setAssignees(nextAssignees)
    const userId = userResult.data.user?.id ?? ''
    const userEmail = userResult.data.user?.email ?? ''
    setCurrentUserId(userId)
    setCurrentUserEmail(userEmail)
    setAssignedTo(current => nextAssignees.some(person => person.user_id === current) ? current : (nextAssignees.some(person => person.user_id === userId) ? userId : nextAssignees[0]?.user_id) || '')
    setLoading(false)
  }

  useEffect(() => {
    void loadTasks()
  }, [workspaceId])

  useEffect(() => {
    const refreshOnReturn = () => {
      if (document.visibilityState !== 'visible' || createDialogOpen || editingTask || saving || busyTaskId) return
      const now = Date.now()
      if (now - lastFocusRefreshRef.current < 1500) return
      lastFocusRefreshRef.current = now
      void loadTasks(true)
    }
    window.addEventListener('focus', refreshOnReturn)
    document.addEventListener('visibilitychange', refreshOnReturn)
    return () => {
      window.removeEventListener('focus', refreshOnReturn)
      document.removeEventListener('visibilitychange', refreshOnReturn)
    }
  }, [workspaceId, createDialogOpen, editingTask, saving, busyTaskId])

  function closeTaskDialog() {
    setCreateDialogOpen(false)
    setEditingTask(null)
    setTitle('')
    setDescription('')
    setDeadline('')
    setError('')
  }

  function openCreateDialog() {
    setEditingTask(null)
    setTitle('')
    setDescription('')
    setDeadline('')
    setError('')
    setCreateDialogOpen(true)
  }

  function openEditDialog(task: WorkspaceTask) {
    setCreateDialogOpen(false)
    setEditingTask(task)
    setTitle(task.title)
    setDescription(task.description ?? '')
    setAssignedTo(task.assigned_to ?? '')
    setDeadline(task.deadline ?? '')
    setError('')
  }

  const visibleTasks = useMemo(() => tasks.filter(task => (filter === 'all' || (filter === 'completed' ? task.is_completed : !task.is_completed)) && (assigneeFilter === 'all' || task.assigned_to === assigneeFilter)), [tasks, filter, assigneeFilter])

  async function saveTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const isEditing = editingTask !== null
    if (!supabase || !canManage || !title.trim() || (!isEditing && !assignedTo)) return
    setSaving(true)
    setError('')
    const payload = {
      title: title.trim(),
      description: description.trim(),
      assigned_to: assignedTo || null,
      deadline: deadline || null,
    }
    const result = isEditing
      ? await supabase.from('workspace_tasks').update(payload).eq('workspace_id', workspaceId).eq('id', editingTask.id).select('id').single()
      : await supabase.from('workspace_tasks').insert({
      workspace_id: workspaceId,
      ...payload,
    }).select('id').single()
    if (result.error) {
      setError(isEditing ? 'Could not save this task. Check your access and try again.' : 'Could not add this task. Check your access and try again.')
      setSaving(false)
      return
    }
    const savedTaskId = result.data.id
    closeTaskDialog()
    setSaving(false)
    if (!isEditing) {
      const { data: notificationEventId } = await supabase.rpc('get_workspace_task_notification_event_id', { requested_task_id: savedTaskId, requested_comment_id: null })
      if (notificationEventId) void supabase.functions.invoke('send-lodging-push', { body: { notificationEventId } })
    }
    await loadTasks(true)
  }

  async function toggleTask(task: WorkspaceTask) {
    if (!supabase || !canManage || busyTaskId) return
    setBusyTaskId(task.id)
    setError('')
    const { error: updateError } = await supabase.from('workspace_tasks').update({ is_completed: !task.is_completed }).eq('workspace_id', workspaceId).eq('id', task.id)
    setBusyTaskId('')
    if (updateError) {
      setError('Could not update the task. Check your access and try again.')
      return
    }
    setTasks(current => current.map(item => item.id === task.id ? { ...item, is_completed: !task.is_completed } : item))
    await loadTasks(true)
  }

  async function deleteTask(task: WorkspaceTask) {
    if (!supabase || !canManage || busyTaskId) return
    if (!window.confirm('Delete this task? Its comments will also be deleted.')) return
    setBusyTaskId(task.id)
    setError('')
    const { data: deletedTask, error: deleteError } = await supabase.from('workspace_tasks').delete().eq('workspace_id', workspaceId).eq('id', task.id).select('id').maybeSingle()
    setBusyTaskId('')
    if (deleteError) {
      setError('Could not delete this task. Check your access and try again.')
      return
    }
    if (!deletedTask) {
      setError('Supabase did not delete the task. Apply the workspace task deletion migration, then try again.')
      return
    }
    setTasks(current => current.filter(item => item.id !== task.id))
    await loadTasks(true)
  }

  async function addComment(task: WorkspaceTask, body: string) {
    if (!supabase || !body.trim() || busyTaskId) return
    setBusyTaskId(task.id)
    setError('')
    const { data: insertedComment, error: insertError } = await supabase.from('workspace_task_comments').insert({
      workspace_id: workspaceId,
      task_id: task.id,
      body: body.trim(),
    }).select('id').single()
    setBusyTaskId('')
    if (insertError) {
      setError('Could not add your comment. Please try again.')
      return
    }
    setCommentDrafts(current => ({ ...current, [task.id]: '' }))
    const { data: notificationEventId } = await supabase.rpc('get_workspace_task_notification_event_id', { requested_task_id: task.id, requested_comment_id: insertedComment.id })
    if (notificationEventId) void supabase.functions.invoke('send-lodging-push', { body: { notificationEventId } })
    await loadTasks(true)
  }

  const assigneeLabel = (userId: string | null) => {
    if (!userId) return 'Unassigned'
    const person = assignees.find(assignee => assignee.user_id === userId)
    return person ? (person.display_name || person.email || 'Admin') : 'Former admin'
  }
  const taskAssigneeOptions = [
    ...(editingTask ? [{ value: '', label: 'Unassigned' }] : []),
    ...(editingTask?.assigned_to && !assignees.some(person => person.user_id === editingTask.assigned_to)
      ? [{ value: editingTask.assigned_to, label: assigneeLabel(editingTask.assigned_to) }]
      : []),
    ...assignees.map(person => ({ value: person.user_id, label: person.user_id === currentUserId ? `Me${currentUserEmail ? ` (${currentUserEmail})` : ''}` : person.display_name || person.email || 'Admin' })),
  ]

  taskActionsRef.current = {
    toggle: task => { void toggleTask(task) },
    edit: task => openEditDialog(task),
    remove: task => { void deleteTask(task) },
    comment: (task, body) => { void addComment(task, body) },
    draft: (taskId, value) => setCommentDrafts(current => ({ ...current, [taskId]: value })),
  }
  const actions = useMemo<TaskCardActions>(() => ({
    toggle: task => taskActionsRef.current.toggle(task),
    edit: task => taskActionsRef.current.edit(task),
    remove: task => taskActionsRef.current.remove(task),
    comment: (task, body) => taskActionsRef.current.comment(task, body),
    draft: (taskId, value) => taskActionsRef.current.draft(taskId, value),
  }), [])

  return <section className="tasks-page" aria-labelledby="tasks-title">
    <header className="tasks-heading"><div><h1 id="tasks-title">Tasks</h1></div>{canManage && <button className="primary-button task-open-create" onClick={openCreateDialog}><Plus size={17} /><span>Add task</span></button>}</header>

    <div className="task-filter-row"><nav className="task-filters" aria-label="Filter tasks">{(['all', 'incomplete', 'completed'] as TaskFilter[]).map(value => <button key={value} className={`filter-chip ${filter === value ? 'filter-active' : ''}`} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === 'all' ? 'All' : value === 'incomplete' ? 'Incomplete' : 'Completed'}<span className="filter-count">{value === 'all' ? tasks.length : value === 'completed' ? tasks.filter(task => task.is_completed).length : tasks.filter(task => !task.is_completed).length}</span></button>)}</nav><label className="task-person-filter"><span>Person</span><DropdownSelect value={assigneeFilter} onChange={setAssigneeFilter} ariaLabel="Filter tasks by person" className="task-person-menu" options={[{ value: 'all', label: 'Everyone' }, ...assignees.map(person => ({ value: person.user_id, label: person.user_id === currentUserId ? `My tasks${currentUserEmail ? ` (${currentUserEmail})` : ''}` : person.display_name || person.email || 'Admin' }))]} /></label></div>

    {error && <div className="task-error" role="alert"><span>{error.includes('workspace_tasks') || error.includes('workspace_task_comments') || error.includes('get_workspace_task_assignees') ? 'The task setup has not been applied in Supabase yet.' : error}</span>{!loading && <button className="text-button" onClick={() => void loadTasks()}>Try again</button>}</div>}
    <div className="task-list" aria-live="polite">
      {loading ? <div className="guest-loading"><LoaderCircle className="spin" size={21} /> Loading tasks…</div>
        : visibleTasks.length === 0 ? <div className="task-empty"><ListChecks size={21} /><h2>{assigneeFilter !== 'all' ? 'No tasks for this person' : filter === 'completed' ? 'No completed tasks' : filter === 'incomplete' ? 'All caught up' : 'No tasks yet'}</h2><p>{canManage ? 'Add a task above when something needs doing.' : 'Tasks added to this planning space will show up here.'}</p></div>
          : visibleTasks.map(task => <TaskCard key={task.id} task={task} canManage={canManage} busy={busyTaskId === task.id} assignee={assigneeLabel(task.assigned_to)} commentDraft={commentDrafts[task.id] ?? ''} actions={actions} />)}
    </div>
    {(createDialogOpen || editingTask) && canManage && <div className="dialog-backdrop task-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !saving) closeTaskDialog() }}><section className="guest-dialog task-create-dialog" role="dialog" aria-modal="true" aria-labelledby="task-create-title"><header className="dialog-header"><div><span className="guest-eyebrow">YOUR PLANNING SPACE</span><h2 id="task-create-title">{editingTask ? 'Edit task' : 'Add task'}</h2></div><button className="dialog-close" type="button" onClick={closeTaskDialog} aria-label="Close" disabled={saving}><X size={19} /></button></header><form className="task-dialog-form guest-form" onSubmit={event => void saveTask(event)}><label className="form-field">Task title<input value={title} onChange={event => setTitle(event.target.value)} maxLength={180} placeholder="What needs to get done?" required autoFocus /></label><label className="form-field">Description <span className="optional-label">(optional)</span><textarea value={description} onChange={event => setDescription(event.target.value)} maxLength={2000} rows={4} placeholder="Add a few details or notes" /></label><div className="form-field"><span>Assign to</span><DropdownSelect value={assignedTo} onChange={setAssignedTo} ariaLabel="Assign task to" placeholder={assignees.length ? 'Choose an Admin' : 'No Admins available'} disabled={assignees.length === 0 && !editingTask} className="form-dropdown-select" options={taskAssigneeOptions} /></div><label className="form-field">Deadline <span className="optional-label">(optional)</span><input type="date" value={deadline} onChange={event => setDeadline(event.target.value)} /></label>{error && <p className="form-error" role="alert">{error}</p>}<footer className="dialog-actions"><button type="button" className="secondary-button" onClick={closeTaskDialog} disabled={saving}>Cancel</button><button className="primary-button" disabled={saving || !title.trim() || (!editingTask && !assignedTo)}>{saving ? <LoaderCircle className="spin" size={16} /> : editingTask ? <Check size={16} /> : <Plus size={16} />}{saving ? (editingTask ? 'Saving…' : 'Adding…') : editingTask ? 'Save changes' : 'Add task'}</button></footer></form></section></div>}
  </section>
})
