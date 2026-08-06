-- Aetherwiki — Supabase schema
-- Run this in the Supabase SQL Editor once, then start the server with:
--   STORAGE_ADAPTER=supabase SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<anon-or-service-role> node server.js

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

-- row level security: open for this app (it owns its own auth).
-- If you add Supabase auth later, replace these with policies scoped to auth.uid().
alter table public.articles enable row level security;

drop policy if exists articles_select on public.articles;
create policy articles_select on public.articles for select using (true);

drop policy if exists articles_insert on public.articles;
create policy articles_insert on public.articles for insert with check (true);

drop policy if exists articles_update on public.articles;
create policy articles_update on public.articles for update using (true);

drop policy if exists articles_delete on public.articles;
create policy articles_delete on public.articles for delete using (true);
