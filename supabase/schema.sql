-- MiniRush global daily leaderboard.
--
-- Setup (once):
--   1. Create a free project at https://supabase.com
--   2. SQL Editor → paste this file → Run
--   3. Project Settings → API → copy "Project URL" and the "anon public" key
--   4. In the game repo, create .env.local with:
--        VITE_LB_URL=https://<your-project>.supabase.co
--        VITE_LB_KEY=<anon public key>
--   5. Restart `npm run dev` (Vite reloads env on boot)
--
-- One row per player per day; the client upserts only improvements.
-- NOTE: the anon key is public by design — an arcade board, not a bank.
-- Anyone technically can post a fake score; keep prizes off this table.

create table if not exists public.daily_scores (
  day        text        not null,
  player_id  text        not null,
  tag        text        not null default 'ACE',
  score      integer     not null,
  time_s     real        not null,
  place      integer     not null,
  laps       integer     not null,
  car        text        not null default '',
  created_at timestamptz not null default now(),
  primary key (day, player_id)
);

create index if not exists daily_scores_day_score
  on public.daily_scores (day, score desc, time_s asc);

alter table public.daily_scores enable row level security;

-- open arcade: anyone may read and write scores
create policy "read scores" on public.daily_scores
  for select using (true);
create policy "insert scores" on public.daily_scores
  for insert with check (true);
create policy "update scores" on public.daily_scores
  for update using (true) with check (true);
