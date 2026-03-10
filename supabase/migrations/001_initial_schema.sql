-- ============================================================
-- FOCUS DASHBOARD — SUPABASE SCHEMA
-- Run this in: Supabase Dashboard → SQL Editor → Run
-- ============================================================

-- ── EXTENSIONS ──────────────────────────────────────────────
create extension if not exists "uuid-ossp";
create extension if not exists pg_cron;        -- for scheduled notifications

-- ── PROFILES ────────────────────────────────────────────────
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  avatar_url  text,
  timezone    text default 'UTC',
  notify_email boolean default true,
  notify_time  time default '08:00',
  created_at  timestamptz default now()
);

-- auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── TASKS ────────────────────────────────────────────────────
create table public.tasks (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  text        text not null,
  tag         text default 'Work' check (tag in ('Work','Personal','Health','Urgent')),
  due         text,
  done        boolean default false,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index tasks_user_id_idx on public.tasks(user_id);
create index tasks_done_idx    on public.tasks(user_id, done);

-- ── NOTES ────────────────────────────────────────────────────
create table public.notes (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text default 'Untitled',
  body        text default '',
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index notes_user_id_idx on public.notes(user_id);

-- ── HABITS ───────────────────────────────────────────────────
create table public.habits (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  color       text default '#2a2722',
  created_at  timestamptz default now()
);

create table public.habit_logs (
  id          uuid primary key default uuid_generate_v4(),
  habit_id    uuid not null references public.habits(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  logged_date date not null default current_date,
  unique(habit_id, logged_date)
);

create index habit_logs_habit_id_idx on public.habit_logs(habit_id);
create index habit_logs_date_idx     on public.habit_logs(user_id, logged_date);

-- ── GOALS ────────────────────────────────────────────────────
create table public.goals (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null,
  description text,
  tag         text default 'Personal',
  progress    int  default 0 check (progress between 0 and 100),
  created_at  timestamptz default now()
);

create table public.goal_milestones (
  id          uuid primary key default uuid_generate_v4(),
  goal_id     uuid not null references public.goals(id) on delete cascade,
  text        text not null,
  done        boolean default false,
  position    int  default 0
);

create index goal_milestones_goal_id_idx on public.goal_milestones(goal_id);

-- auto-update goal progress when milestones change
create or replace function public.recalc_goal_progress()
returns trigger language plpgsql as $$
declare
  total_count int;
  done_count  int;
begin
  select count(*), count(*) filter (where done = true)
  into total_count, done_count
  from public.goal_milestones
  where goal_id = coalesce(new.goal_id, old.goal_id);

  update public.goals
  set progress = case when total_count = 0 then 0
                      else round((done_count::numeric / total_count) * 100)
                 end
  where id = coalesce(new.goal_id, old.goal_id);

  return coalesce(new, old);
end;
$$;

create trigger on_milestone_change
  after insert or update or delete on public.goal_milestones
  for each row execute function public.recalc_goal_progress();

-- ── CALENDAR EVENTS ──────────────────────────────────────────
create table public.calendar_events (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  event_date  date not null,
  event_time  time,
  duration    text,
  color       text default '#7aa4c9',
  created_at  timestamptz default now()
);

create index calendar_events_date_idx on public.calendar_events(user_id, event_date);

-- ── FOCUS SESSIONS ───────────────────────────────────────────
create table public.focus_sessions (
  id               uuid primary key default uuid_generate_v4(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  duration_minutes int  not null,
  phase            text default 'focus' check (phase in ('focus','break')),
  started_at       timestamptz default now()
);

create index focus_sessions_user_date_idx on public.focus_sessions(user_id, started_at);

-- ── PUSH SUBSCRIPTIONS (Web Push API) ────────────────────────
create table public.push_subscriptions (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth_key    text not null,
  created_at  timestamptz default now()
);

-- ── updated_at TRIGGER (tasks + notes) ───────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger tasks_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();
create trigger notes_updated_at before update on public.notes
  for each row execute function public.set_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- Every table is locked down: users only see their own rows.
-- ============================================================

alter table public.profiles          enable row level security;
alter table public.tasks             enable row level security;
alter table public.notes             enable row level security;
alter table public.habits            enable row level security;
alter table public.habit_logs        enable row level security;
alter table public.goals             enable row level security;
alter table public.goal_milestones   enable row level security;
alter table public.calendar_events   enable row level security;
alter table public.focus_sessions    enable row level security;
alter table public.push_subscriptions enable row level security;

-- profiles
create policy "Users manage own profile"
  on public.profiles for all using (auth.uid() = id);

-- tasks
create policy "Users manage own tasks"
  on public.tasks for all using (auth.uid() = user_id);

-- notes
create policy "Users manage own notes"
  on public.notes for all using (auth.uid() = user_id);

-- habits
create policy "Users manage own habits"
  on public.habits for all using (auth.uid() = user_id);

-- habit_logs
create policy "Users manage own habit logs"
  on public.habit_logs for all using (auth.uid() = user_id);

-- goals
create policy "Users manage own goals"
  on public.goals for all using (auth.uid() = user_id);

-- goal_milestones (access via goal ownership)
create policy "Users manage own milestones"
  on public.goal_milestones for all
  using (exists (
    select 1 from public.goals g
    where g.id = goal_milestones.goal_id and g.user_id = auth.uid()
  ));

-- calendar_events
create policy "Users manage own events"
  on public.calendar_events for all using (auth.uid() = user_id);

-- focus_sessions
create policy "Users manage own sessions"
  on public.focus_sessions for all using (auth.uid() = user_id);

-- push_subscriptions
create policy "Users manage own subscriptions"
  on public.push_subscriptions for all using (auth.uid() = user_id);

-- ============================================================
-- SEED DATA (optional demo rows — remove in production)
-- ============================================================
-- These won't run unless you replace <YOUR_USER_ID> with a real UUID.
-- Example:
-- insert into public.tasks (user_id, text, tag, due) values
--   ('<YOUR_USER_ID>', 'Review Q2 project brief', 'Work', 'today'),
--   ('<YOUR_USER_ID>', 'Morning run', 'Health', 'today');
