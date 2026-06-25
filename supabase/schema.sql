-- CMA cloud app — database schema (run in the Supabase SQL editor).
-- Model: the frontend talks to Supabase directly; row-level security (RLS)
-- enforces that each agent only sees their own CMAs. Company branding +
-- adjustment presets are shared office-wide. Per-agent identity lives in profiles.

-- ============================================================
-- profiles — one row per agent (1:1 with auth.users)
-- Holds the per-agent branding: name, title, phone, email, headshot.
-- ============================================================
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  full_name    text,
  title        text default 'Sales Representative',
  phone        text,
  email        text,
  headshot_url text,
  is_admin     boolean not null default false,   -- Bud = true; reserved for later admin features
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- ============================================================
-- cmas — one row per saved CMA, owned by the agent who made it.
-- The whole CMA object lives in `data` (jsonb), reusing the existing model.
-- ============================================================
create table if not exists public.cmas (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.cmas enable row level security;
-- Explicit per-command policies, each scoped to the signed-in agent. (Kept as
-- separate SELECT/INSERT/UPDATE/DELETE policies rather than one FOR ALL policy
-- so a missing command can't silently block writes — see fix_cmas_rls.sql.)
create policy "cmas_select_own" on public.cmas
  for select to authenticated using (auth.uid() = user_id);
create policy "cmas_insert_own" on public.cmas
  for insert to authenticated with check (auth.uid() = user_id);
create policy "cmas_update_own" on public.cmas
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "cmas_delete_own" on public.cmas
  for delete to authenticated using (auth.uid() = user_id);
grant select, insert, update, delete on public.cmas to authenticated;
create index if not exists cmas_user_id_idx on public.cmas(user_id);

-- ============================================================
-- org_settings — shared, office-wide (singleton row id=1):
-- adjustment presets + company branding (C21 colors, logo, name, tagline).
-- Everyone reads; only admins write.
-- ============================================================
create table if not exists public.org_settings (
  id               int primary key default 1,
  presets          jsonb not null default '{}'::jsonb,
  company_branding jsonb not null default '{}'::jsonb,
  updated_at       timestamptz not null default now(),
  constraint org_settings_singleton check (id = 1)
);
alter table public.org_settings enable row level security;
create policy "org_settings_read_all" on public.org_settings for select
  using (auth.role() = 'authenticated');
create policy "org_settings_write_admin" on public.org_settings for update
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));
insert into public.org_settings (id) values (1) on conflict (id) do nothing;

-- ============================================================
-- Auto-create a profile row whenever a new agent account is created.
-- ============================================================
create or replace function public.handle_new_user()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
    on conflict (id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- ============================================================
-- Keep updated_at fresh on edits.
-- ============================================================
create or replace function public.touch_updated_at()
  returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists cmas_touch on public.cmas;
create trigger cmas_touch before update on public.cmas
  for each row execute function public.touch_updated_at();
drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
