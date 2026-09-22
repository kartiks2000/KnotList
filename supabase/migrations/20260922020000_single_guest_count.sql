-- Keep one editable guest count per family. Existing expected counts are retained.
alter table public.guest_groups
  rename column expected_guests to guest_count;

alter table public.guest_groups
  rename constraint guest_groups_expected_guests_check to guest_groups_guest_count_check;

alter table public.guest_groups
  drop constraint guest_groups_guest_count_check;

alter table public.guest_groups
  add constraint guest_groups_guest_count_check check (guest_count between 0 and 500);

-- If a confirmed RSVP count already exists, keep it as the current number.
update public.guest_groups
set guest_count = coalesce(rsvp_guest_count, guest_count);

alter table public.guest_groups
  drop column rsvp_guest_count;
