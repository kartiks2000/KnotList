import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, Check, Circle, ListChecks, LoaderCircle, MessageCircle, Plus, Send, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'

type TaskFilter = 'all' | 'incomplete' | 'completed'
type TaskAssignee = { user_id: string; display_name: string; email: string | null }
type TaskComment = { id: string; workspace_id: string; task_id: string; user_id: string; author_name: string; body: string; created_at: string }
type WorkspaceTask = {
  id: string
  workspace_id: string
  title: string
  assigned_to: string | null
  deadline: string | null
  is_completed: boolean
  created_at: string
  workspace_task_comments: TaskComment[]
}

function formatDeadline(value: string | null) {
  if (!value) return ''
  const [year, month, day] = value.split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(year, month - 1, day))
}

function formatCommentDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value))
}

export function TasksView({ workspaceId, canManage }: { workspaceId: string; canManage: boolean }) {
  const [tasks, setTasks] = useState<WorkspaceTask[]>([])
  const [assignees, setAssignees] = useState<TaskAssignee[]>([])
  const [currentUserId, setCurrentUserId] = useState('')
  const [currentUserEmail, setCurrentUserEmail] = useState('')
  const [filter, setFilter] = useState<TaskFilter>('all')
  const [assigneeFilter, setAssigneeFilter] = useState('all')
  const [title, setTitle] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [deadline, setDeadline] = useState('')
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busyTaskId, setBusyTaskId] = useState('')
  const [error, setError] = useState('')

  async function loadTasks() {
    if (!supabase) return
    setLoading(true)
    setError('')
    const [userResult, taskResult, assigneeResult] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from('workspace_tasks').select('id, workspace_id, title, assigned_to, deadline, is_completed, created_at').eq('workspace_id', workspaceId).order('created_at', { ascending: false }),
      supabase.rpc('get_workspace_task_assignees', { requested_workspace_id: workspaceId }),
    ])
    if (taskResult.error || assigneeResult.error) {
      setTasks([])
      setAssignees([])
      setError(taskResult.error?.message || assigneeResult.error?.message || 'Could not load tasks. Apply the tasks migration, then try again.')
      setLoading(false)
      return
    }

    const taskRows = (taskResult.data ?? []) as Omit<WorkspaceTask, 'workspace_task_comments'>[]
    const ids = taskRows.map(task => task.id)
    const commentResult = ids.length
      ? await supabase.from('workspace_task_comments').select('id, workspace_id, task_id, user_id, author_name, body, created_at').eq('workspace_id', workspaceId).in('task_id', ids).order('created_at', { ascending: true })
      : { data: [], error: null }
    if (commentResult.error) {
      setError(commentResult.error.message)
      setLoading(false)
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

  const visibleTasks = useMemo(() => tasks.filter(task => (filter === 'all' || (filter === 'completed' ? task.is_completed : !task.is_completed)) && (assigneeFilter === 'all' || task.assigned_to === assigneeFilter)), [tasks, filter, assigneeFilter])

  async function createTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !canManage || !title.trim() || !assignedTo) return
    setSaving(true)
    setError('')
    const { error: insertError } = await supabase.from('workspace_tasks').insert({
      workspace_id: workspaceId,
      title: title.trim(),
      assigned_to: assignedTo,
      deadline: deadline || null,
    })
    if (insertError) {
      setError('Could not add this task. Check your access and try again.')
      setSaving(false)
      return
    }
    setTitle('')
    setDeadline('')
    setSaving(false)
    await loadTasks()
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
  }

  async function deleteTask(task: WorkspaceTask) {
    if (!supabase || !canManage || busyTaskId) return
    if (!window.confirm(`Delete “${task.title}”? Its comments will also be deleted.`)) return
    setBusyTaskId(task.id)
    setError('')
    const { error: deleteError } = await supabase.from('workspace_tasks').delete().eq('workspace_id', workspaceId).eq('id', task.id)
    setBusyTaskId('')
    if (deleteError) {
      setError('Could not delete this task. Check your access and try again.')
      return
    }
    setTasks(current => current.filter(item => item.id !== task.id))
  }

  async function addComment(event: React.FormEvent<HTMLFormElement>, task: WorkspaceTask) {
    event.preventDefault()
    if (!supabase || !commentDrafts[task.id]?.trim() || busyTaskId) return
    setBusyTaskId(task.id)
    setError('')
    const { error: insertError } = await supabase.from('workspace_task_comments').insert({
      workspace_id: workspaceId,
      task_id: task.id,
      body: commentDrafts[task.id].trim(),
    })
    setBusyTaskId('')
    if (insertError) {
      setError('Could not add your comment. Please try again.')
      return
    }
    setCommentDrafts(current => ({ ...current, [task.id]: '' }))
    await loadTasks()
  }

  const assigneeLabel = (userId: string | null) => {
    if (!userId) return 'Unassigned'
    const person = assignees.find(assignee => assignee.user_id === userId)
    return person ? (person.display_name || person.email || 'Admin') : 'Former admin'
  }

  return <section className="tasks-page" aria-labelledby="tasks-title">
    <header className="tasks-heading"><div><span className="guest-eyebrow">YOUR PLANNING SPACE</span><h1 id="tasks-title">Tasks</h1><p>Keep the next steps in one simple list.</p></div></header>
    {canManage && <form className="task-create-form" onSubmit={event => void createTask(event)}>
      <label className="task-title-field"><span className="sr-only">Task</span><input value={title} onChange={event => setTitle(event.target.value)} maxLength={180} placeholder="What needs to get done?" required /></label>
      <label className="task-assignee-field"><span className="sr-only">Assign to an admin</span><select value={assignedTo} onChange={event => setAssignedTo(event.target.value)} required disabled={assignees.length === 0}><option value="">{assignees.length ? 'Assign to admin' : 'No admins available'}</option>{assignees.map(person => <option key={person.user_id} value={person.user_id}>{person.user_id === currentUserId ? `Me${currentUserEmail ? ` (${currentUserEmail})` : ''}` : person.display_name || person.email || 'Admin'}</option>)}</select></label>
      <label className="task-deadline-field"><span className="sr-only">Deadline (optional)</span><input type="date" value={deadline} onChange={event => setDeadline(event.target.value)} aria-label="Deadline (optional)" /></label>
      <button className="primary-button task-add-button" disabled={saving || !title.trim() || !assignedTo}>{saving ? <LoaderCircle className="spin" size={16} /> : <Plus size={17} />}<span>Add task</span></button>
    </form>}

    <div className="task-filter-row"><nav className="task-filters" aria-label="Filter tasks">{(['all', 'incomplete', 'completed'] as TaskFilter[]).map(value => <button key={value} className={`filter-chip ${filter === value ? 'filter-active' : ''}`} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === 'all' ? 'All' : value === 'incomplete' ? 'Incomplete' : 'Completed'}<span className="filter-count">{value === 'all' ? tasks.length : value === 'completed' ? tasks.filter(task => task.is_completed).length : tasks.filter(task => !task.is_completed).length}</span></button>)}</nav><label className="task-person-filter"><span>Person</span><select value={assigneeFilter} onChange={event => setAssigneeFilter(event.target.value)} aria-label="Filter tasks by person"><option value="all">Everyone</option>{assignees.map(person => <option key={person.user_id} value={person.user_id}>{person.user_id === currentUserId ? `My tasks${currentUserEmail ? ` (${currentUserEmail})` : ''}` : person.display_name || person.email || 'Admin'}</option>)}</select></label></div>

    {error && <div className="task-error" role="alert"><span>{error.includes('workspace_tasks') || error.includes('workspace_task_comments') || error.includes('get_workspace_task_assignees') ? 'The task setup has not been applied in Supabase yet.' : error}</span>{!loading && <button className="text-button" onClick={() => void loadTasks()}>Try again</button>}</div>}
    <div className="task-list" aria-live="polite">
      {loading ? <div className="guest-loading"><LoaderCircle className="spin" size={21} /> Loading tasks…</div>
        : visibleTasks.length === 0 ? <div className="task-empty"><ListChecks size={21} /><h2>{assigneeFilter !== 'all' ? 'No tasks for this person' : filter === 'completed' ? 'No completed tasks' : filter === 'incomplete' ? 'All caught up' : 'No tasks yet'}</h2><p>{canManage ? 'Add a task above when something needs doing.' : 'Tasks added to this planning space will show up here.'}</p></div>
          : visibleTasks.map(task => <article className={`task-card ${task.is_completed ? 'task-completed' : ''}`} key={task.id}>
            <div className="task-card-main">
              <button className="task-complete-button" aria-label={task.is_completed ? `Mark ${task.title} incomplete` : `Mark ${task.title} complete`} title={task.is_completed ? 'Mark incomplete' : 'Mark complete'} disabled={!canManage || busyTaskId === task.id} onClick={() => void toggleTask(task)}>{task.is_completed ? <Check size={15} /> : <Circle size={17} />}</button>
              <div className="task-info"><h2>{task.title}</h2><div className="task-meta"><span>{assigneeLabel(task.assigned_to)}</span>{task.deadline && <span><CalendarDays size={13} />Due {formatDeadline(task.deadline)}</span>}</div></div>
              {canManage && <button className="task-delete-button" aria-label={`Delete ${task.title}`} title="Delete task" disabled={busyTaskId === task.id} onClick={() => void deleteTask(task)}>{busyTaskId === task.id ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}</button>}
            </div>
            <details className="task-comments">
              <summary><MessageCircle size={15} /><span>Comments</span><span className="task-comment-count">{task.workspace_task_comments.length}</span></summary>
              <div className="task-comments-body">
                {task.workspace_task_comments.length > 0 ? <ul>{task.workspace_task_comments.map(comment => <li key={comment.id}><div><strong>{comment.author_name}</strong><time dateTime={comment.created_at}>{formatCommentDate(comment.created_at)}</time></div><p>{comment.body}</p></li>)}</ul> : <p className="task-no-comments">No comments yet.</p>}
                <form className="task-comment-form" onSubmit={event => void addComment(event, task)}><label className="sr-only" htmlFor={`task-comment-${task.id}`}>Add a status comment</label><input id={`task-comment-${task.id}`} value={commentDrafts[task.id] ?? ''} onChange={event => setCommentDrafts(current => ({ ...current, [task.id]: event.target.value }))} maxLength={1000} placeholder="Share a quick update…" required /><button className="task-comment-submit" disabled={busyTaskId === task.id || !commentDrafts[task.id]?.trim()} aria-label="Post comment" title="Post comment"><Send size={15} /></button></form>
              </div>
            </details>
          </article>)}
    </div>
  </section>
}
