-- Add optional descriptions to tasks for installations with the task module already applied.
alter table public.workspace_tasks
  add column if not exists description text not null default '';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.workspace_tasks'::regclass
      and conname = 'workspace_tasks_description_length_check'
  ) then
    alter table public.workspace_tasks
      add constraint workspace_tasks_description_length_check
      check (length(description) <= 2000);
  end if;
end;
$$;
