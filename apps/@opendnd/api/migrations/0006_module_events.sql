-- Module events.
--
-- A module has events of its own: published from a world, enabled or
-- disabled in one, and a world's stack reordered. They ride the same outbox
-- as writes, so a subscriber hears that content arrived in a world the same
-- way it hears that a record changed.
set search_path = public;

alter table event_outbox drop constraint event_outbox_action_check;
alter table event_outbox add constraint event_outbox_action_check
  check (action in (
    'created', 'updated', 'deleted',
    'published', 'enabled', 'disabled', 'reordered'
  ));
