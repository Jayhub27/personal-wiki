-- 0002_media — media index (blobs live in object storage)
create table if not exists media (
  name        text primary key,
  ext         text,
  kind        text,
  size        bigint not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists media_created_idx on media (created_at desc);
