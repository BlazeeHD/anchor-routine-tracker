-- ============================================================
-- ANCHOR — daily routine tracker
-- Run this whole file once in your Supabase project's
-- SQL Editor (Dashboard -> SQL Editor -> New query -> Run).
-- ============================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- 1. Routine templates (the recurring plan, e.g. "5:00 AM — Wake up")
-- ------------------------------------------------------------
create table if not exists public.routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  time time not null,
  title text not null,
  description text,
  duration_minutes int not null default 30,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 2. Daily logs (did the user do it on a given date?)
-- ------------------------------------------------------------
create table if not exists public.routine_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  routine_id uuid not null references public.routines(id) on delete cascade,
  log_date date not null,
  status text not null default 'pending' check (status in ('done', 'missed', 'pending')),
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (routine_id, log_date)
);

-- ------------------------------------------------------------
-- 3. Optional end-of-day feedback
-- ------------------------------------------------------------
create table if not exists public.daily_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  feedback_date date not null,
  feedback text,
  mood text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, feedback_date)
);

-- ------------------------------------------------------------
-- Keep updated_at fresh
-- ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_routine_logs_updated on public.routine_logs;
create trigger trg_routine_logs_updated
before update on public.routine_logs
for each row execute procedure public.set_updated_at();

drop trigger if exists trg_daily_feedback_updated on public.daily_feedback;
create trigger trg_daily_feedback_updated
before update on public.daily_feedback
for each row execute procedure public.set_updated_at();

-- ------------------------------------------------------------
-- Row Level Security — every user only ever sees their own rows
-- ------------------------------------------------------------
alter table public.routines enable row level security;
alter table public.routine_logs enable row level security;
alter table public.daily_feedback enable row level security;

create policy "routines: owner select" on public.routines
  for select using (auth.uid() = user_id);
create policy "routines: owner insert" on public.routines
  for insert with check (auth.uid() = user_id);
create policy "routines: owner update" on public.routines
  for update using (auth.uid() = user_id);
create policy "routines: owner delete" on public.routines
  for delete using (auth.uid() = user_id);

create policy "logs: owner select" on public.routine_logs
  for select using (auth.uid() = user_id);
create policy "logs: owner insert" on public.routine_logs
  for insert with check (auth.uid() = user_id);
create policy "logs: owner update" on public.routine_logs
  for update using (auth.uid() = user_id);
create policy "logs: owner delete" on public.routine_logs
  for delete using (auth.uid() = user_id);

create policy "feedback: owner select" on public.daily_feedback
  for select using (auth.uid() = user_id);
create policy "feedback: owner insert" on public.daily_feedback
  for insert with check (auth.uid() = user_id);
create policy "feedback: owner update" on public.daily_feedback
  for update using (auth.uid() = user_id);
create policy "feedback: owner delete" on public.daily_feedback
  for delete using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- Helpful indexes
-- ------------------------------------------------------------
create index if not exists idx_routines_user on public.routines(user_id);
create index if not exists idx_logs_user_date on public.routine_logs(user_id, log_date);
create index if not exists idx_feedback_user_date on public.daily_feedback(user_id, feedback_date);
