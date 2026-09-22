-- Rename the planning count and add zero or more assigned room numbers.
alter table public.guest_groups
  rename column expected_rooms to room_count;

alter table public.guest_groups
  rename constraint guest_groups_expected_rooms_check to guest_groups_room_count_check;

alter table public.guest_groups
  add column assigned_room_numbers text[] not null default '{}'::text[]
  check (
    cardinality(assigned_room_numbers) <= 100
    and array_position(assigned_room_numbers, null) is null
  );
