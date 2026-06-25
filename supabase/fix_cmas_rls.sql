-- ============================================================
-- FIX: "new row violates row-level security policy for table cmas"
-- (the Save button / Print-and-save failing to store a CMA)
--
-- HOW TO RUN (one time, ~15 seconds):
--   1. Open your Supabase project dashboard.
--   2. Left sidebar → SQL Editor → "New query".
--   3. Paste this whole file and click "Run".
-- It is safe to run more than once (idempotent). It resets the `cmas`
-- table's row-level security to the correct rule: every agent can read and
-- write ONLY their own CMAs (rows where user_id = their signed-in user id).
--
-- Why this is needed: the app writes each CMA with user_id = the signed-in
-- agent, which the policy below allows. If saving was being rejected, the
-- live table's policy had drifted from this definition (e.g. an INSERT policy
-- was missing) — this restores it cleanly.
-- ============================================================

-- 1) Ensure row-level security is enabled on the table.
alter table public.cmas enable row level security;

-- 2) Remove any old/partial policies that could be blocking inserts.
drop policy if exists "cmas_rw_own"     on public.cmas;
drop policy if exists "cmas_select_own" on public.cmas;
drop policy if exists "cmas_insert_own" on public.cmas;
drop policy if exists "cmas_update_own" on public.cmas;
drop policy if exists "cmas_delete_own" on public.cmas;

-- 3) Recreate explicit, per-command policies scoped to the signed-in agent.
create policy "cmas_select_own" on public.cmas
  for select to authenticated
  using (auth.uid() = user_id);

create policy "cmas_insert_own" on public.cmas
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy "cmas_update_own" on public.cmas
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "cmas_delete_own" on public.cmas
  for delete to authenticated
  using (auth.uid() = user_id);

-- 4) Ensure the authenticated role has table privileges (RLS still limits it
--    to the agent's own rows; this just allows the table to be touched at all).
grant select, insert, update, delete on public.cmas to authenticated;

-- Done. Reload the app and try Save again.
