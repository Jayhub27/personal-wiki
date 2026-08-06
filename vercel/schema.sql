-- Aetherwiki — Vercel Postgres schema
-- Run this against your Vercel Postgres (or Neon) database, then start with:
--   STORAGE_ADAPTER=vercel   (plus your POSTGRES_URL / DATABASE_URL env var on Vercel)

create table if not exists articles (
  slug            text primary key,
  title           text not null,
  content         text not null default '',
  parent          text references articles (slug) on delete set null,
  reference       text,
  reference_label text,
  lead            text,
  tags            text not null default '',
  created_at      date not null default current_date,
  updated_at      date not null default current_date
);

create index if not exists articles_parent_idx on articles (parent);