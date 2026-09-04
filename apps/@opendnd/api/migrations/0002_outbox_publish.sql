-- Let a publisher claim and mark the events of its own world.
--
-- Claiming uses `select ... for update`, which asks the row to satisfy the
-- update policy as well as the read one. With no update policy on the table
-- the locking select matched nothing at all, so the outbox looked permanently
-- empty rather than refusing anything: a publisher published nothing and said
-- it had published nothing.
set search_path = public;

create policy event_outbox_update on event_outbox for update
  using (world_id = current_world())
  with check (world_id = current_world());
