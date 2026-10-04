-- Track guests who will receive a printed invitation card instead of a digital invite.
alter table public.guest_groups
  add column if not exists card_only boolean not null default false;
