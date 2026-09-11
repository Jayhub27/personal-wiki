-- 0001_init — articles table
-- Generic Postgres schema (matches the `vercel` adapter, string tags).
-- Supabase projects can use supabase/schema.sql instead (array tags).
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
create index if not exists articles_title_idx on articles (lower(title));
