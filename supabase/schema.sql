-- Aetherwiki — Supabase schema
-- Run this in the Supabase SQL Editor once, then start the server with:
--   STORAGE_ADAPTER=supabase SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service-role-key> node server.js
--
-- The server accesses Postgres with the service-role key, which bypasses RLS.
-- Keep that key on the server only (never in the browser). Anonymous/public keys
-- get no access because RLS is enabled with no policies.

create table if not exists public.articles (
  slug          text primary key,
  title         text not null,
  content       text not null default '',
  parent        text references public.articles (slug) on delete set null,
  reference     text,
  reference_label text,
  lead          text,
  tags          text[] not null default '{}',
  created_at    date not null default current_date,
  updated_at    date not null default current_date
);

-- indexes for linking + search
create index if not exists articles_parent_idx  on public.articles (parent);
create index if not exists articles_title_idx   on public.articles (lower(title));
create index if not exists articles_tags_idx    on public.articles using gin (tags);

-- Row Level Security: deny by default. No policies are created, so anon and
-- authenticated roles cannot read or write. The server uses the service-role
-- key, which bypasses RLS. If you later add Supabase Auth, add policies scoped
-- to auth.uid() instead of opening the table.
alter table public.articles enable row level security;
alter table public.articles force row level security;

drop policy if exists articles_select on public.articles;
drop policy if exists articles_insert on public.articles;
drop policy if exists articles_update on public.articles;
drop policy if exists articles_delete on public.articles;

-- Media index (blobs live in Supabase Storage bucket "media").
-- Create a PRIVATE bucket named "media" in Storage. The server uploads and
-- streams objects with the service-role key, so no public policies are needed.
create table if not exists public.media (
  name        text primary key,
  ext         text,
  kind        text,
  size        bigint not null default 0,
  created_at  timestamptz not null default now()
);

alter table public.media enable row level security;
alter table public.media force row level security;

drop policy if exists media_select on public.media;
drop policy if exists media_insert on public.media;
drop policy if exists media_update on public.media;
drop policy if exists media_delete on public.media;
