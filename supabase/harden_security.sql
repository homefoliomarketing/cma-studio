-- ============================================================
-- SECURITY HARDENING — run ONCE in the Supabase SQL editor.
--
-- HOW TO RUN (one time, ~15 seconds):
--   1. Open your Supabase project dashboard.
--   2. Left sidebar -> SQL Editor -> "New query".
--   3. Paste this whole file and click "Run".
-- Safe to run more than once (idempotent). It does NOT touch any agent data —
-- it only tightens permissions and policies.
--
-- WHAT IT FIXES (see the security audit):
--   1. CRITICAL privilege escalation: before this, any signed-in agent could
--      flip their OWN profiles row to is_admin = true straight from the browser
--      (the anon key + their session is all that's needed), because the profile
--      UPDATE policy scoped rows but not COLUMNS. Becoming admin unlocked the
--      /api/admin/* endpoints (list/create/DELETE every agent, reset anyone's
--      password) and office-wide branding/preset writes. This locks is_admin
--      (and id / created_at) so ONLY the server-side service role can change it.
--   2. Guarantees the `must_reset` column exists (the app relies on it; it was
--      missing from the committed schema, so a rebuilt DB broke admin password
--      resets and the forced-first-login flow).
--   3. Makes org_settings INSERT/DELETE explicitly denied for clients.
-- ============================================================

-- ------------------------------------------------------------
-- 0) Make sure the column the app depends on actually exists.
--    (must_reset drives the "choose your own password on first login" flow.)
-- ------------------------------------------------------------
alter table public.profiles
  add column if not exists must_reset boolean not null default true;

-- ------------------------------------------------------------
-- 1) profiles: lock down WHICH COLUMNS an agent may write.
--    RLS already limits an agent to their OWN row; the gap was that, on that
--    row, they could set ANY column — including is_admin. Postgres RLS gates
--    rows, not columns, so we use column-level privileges (the canonical fix)
--    PLUS a trigger as defence-in-depth.
-- ------------------------------------------------------------

-- Remove the blanket UPDATE that Supabase grants by default, then hand back
-- UPDATE on ONLY the fields an agent is meant to edit about themselves.
-- (is_admin, id, created_at, updated_at are deliberately NOT in this list.)
revoke update on public.profiles from authenticated, anon;
grant  update (full_name, title, phone, email, headshot_url, must_reset)
  on public.profiles to authenticated;

-- Defence-in-depth: even if a future migration re-grants broad UPDATE, this
-- trigger forces is_admin / id / created_at back to their stored values for any
-- write coming through a PostgREST client role (authenticated / anon). The
-- server-side service role (used by service.py's admin API) and the table owner
-- (SQL editor) are unaffected, so admins can still be promoted intentionally.
create or replace function public.profiles_guard_protected_columns()
  returns trigger
  language plpgsql
  -- SECURITY INVOKER (default) so current_user reflects the real caller role.
  as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.is_admin   := old.is_admin;     -- agents can never change their admin flag
    new.id         := old.id;           -- never re-point a profile to another user
    new.created_at := old.created_at;   -- keep the audit timestamp honest
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard
  before update on public.profiles
  for each row execute function public.profiles_guard_protected_columns();

-- ------------------------------------------------------------
-- 2) org_settings: it is a single shared row. Reads = everyone; UPDATE = admins
--    only (already enforced by org_settings_write_admin). Make INSERT and DELETE
--    explicitly impossible for clients so no one can add a second row or remove
--    the singleton. (RLS already default-denies these; this is belt-and-braces.)
-- ------------------------------------------------------------
revoke insert, delete on public.org_settings from authenticated, anon;

-- ------------------------------------------------------------
-- 3) Sanity: confirm the protections are in place. After running, this returns
--    the agent-writable columns (should be exactly the 6 above) — nothing else,
--    and crucially NOT is_admin.
-- ------------------------------------------------------------
-- select grantee, privilege_type, column_name
--   from information_schema.column_privileges
--  where table_name = 'profiles' and grantee = 'authenticated'
--  order by column_name;

-- Done. No app reload needed; the next write from any agent is already governed
-- by the tightened rules.
