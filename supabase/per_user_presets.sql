-- ============================================================
-- Per-user adjustment presets  (run ONCE on the live project)
-- ============================================================
-- Each agent gets their own editable adjustment presets, stored on their profile
-- row. In the app these presets default to the shared office presets
-- (org_settings.presets) until the agent saves their own — so nobody is forced to
-- use one shared set of numbers anymore.
--
-- Apply in the Supabase SQL editor (or via the management API). Safe & additive;
-- to roll back: alter table public.profiles drop column presets;

-- 1) The column. Nullable — NULL means "this agent hasn't customised; use the
--    office defaults." (Matches the app's load-time merge: base <- org <- agent.)
alter table public.profiles add column if not exists presets jsonb;

-- 2) Let each agent write their OWN presets. Column-level UPDATE grant, to match
--    the existing lockdown on profiles (broad UPDATE is revoked; only listed
--    columns are grantable). RLS's profiles_update_own policy still scopes every
--    write to the agent's own row, and the profiles_guard trigger still pins
--    is_admin / id / created_at, so this grant cannot enable privilege escalation.
grant update (presets) on public.profiles to authenticated;
