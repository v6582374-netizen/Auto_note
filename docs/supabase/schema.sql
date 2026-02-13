-- MuseMark Store-Ready V1 Supabase schema (US region project)
-- Run in Supabase SQL editor.

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  dedupe_key text not null,
  url text not null,
  canonical_url text,
  title text not null,
  domain text not null,
  favicon_url text,
  status text not null,
  category text,
  tags text[] not null default '{}',
  user_note text,
  ai_summary text,
  deleted_at timestamptz,
  save_count int not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (user_id, dedupe_key)
);

create index if not exists idx_bookmarks_user_updated on public.bookmarks(user_id, updated_at desc);
create index if not exists idx_bookmarks_user_status on public.bookmarks(user_id, status);

create table if not exists public.category_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  canonical text not null,
  aliases text[] not null default '{}',
  pinned boolean not null default false,
  color text,
  updated_at timestamptz not null,
  unique (user_id, canonical)
);

create table if not exists public.user_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null,
  unique (user_id)
);

alter table public.profiles enable row level security;
alter table public.bookmarks enable row level security;
alter table public.category_rules enable row level security;
alter table public.user_settings enable row level security;

create policy if not exists "profiles_owner" on public.profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy if not exists "bookmarks_owner" on public.bookmarks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy if not exists "category_rules_owner" on public.category_rules
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy if not exists "user_settings_owner" on public.user_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
