-- Rankflix V2 schema (PostgreSQL / Supabase)
-- Run this once against your Supabase / Postgres database, or let EF Core migrations manage it instead.

create extension if not exists pgcrypto;

drop table if exists rank_group_pending_member cascade;
drop table if exists rank_group_watch_status cascade;
drop table if exists rank_group_media cascade;
drop table if exists rank_group_member cascade;
drop table if exists rank_group cascade;
drop table if exists review cascade;
drop table if exists media cascade;
drop table if exists refresh_token cascade;
drop table if exists "user" cascade;

create table "user"
(
    id            serial primary key,
    username      varchar(100) not null unique,
    avatar_url    text,
    password_hash varchar(255) not null,
    -- Editable independently of login identity: friends occasionally switch Discord accounts
    -- and we don't want to lose their history, which is keyed off "user".id, not discord_id.
    discord_id    varchar(32),
    role          varchar(20) not null default 'member' check (role in ('admin', 'member')),
    -- User-chosen presence preference; "invisible" makes them appear offline to others
    -- regardless of connection state. Persisted so it's remembered across devices/logins.
    status        varchar(20) not null default 'online' check (status in ('online', 'invisible')),
    created_at    timestamptz  not null default now()
);

create table refresh_token
(
    value      uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    user_id    int         not null references "user" (id) on delete cascade
);

create index idx_refresh_token_user_id on refresh_token (user_id);

create table media
(
    tmdb_id    int primary key,
    title      varchar(200) not null,
    type       varchar(10) not null check (type in ('movie', 'tv')),
    poster_url text
);

create table rank_group
(
    id         serial primary key,
    name       varchar(50) not null,
    owner_id   int         not null references "user" (id),
    image_url  text
);

create table rank_group_member
(
    group_id int not null references rank_group (id) on delete cascade,
    user_id  int not null references "user" (id) on delete cascade,
    -- Groups can have multiple owners; an owner can grant/revoke ownership of other members.
    -- A group must always keep at least one owner (enforced in application code).
    is_owner boolean not null default false,
    primary key (group_id, user_id)
);

-- A media item assigned to a group. Also acts as the group's watchlist entry.
create table rank_group_media
(
    media_id              int         not null references media (tmdb_id),
    group_id              int         not null references rank_group (id) on delete cascade,
    added_at              timestamptz not null default now(),
    added_by              int         not null references "user" (id),
    -- Admin-editable voting window (in hours) counted from added_at. Defaults to 24 hours.
    voting_duration_hours int         not null default 24,
    -- Fallback average from a legacy Excel import when individual per-user ratings weren't
    -- captured (e.g. everyone watched but nobody scored it in the old bot).
    imported_average_rating double precision,
    primary key (media_id, group_id)
);

-- Marks which group members have watched a given media item, gating who is allowed to vote.
-- user_id is nullable + pending_discord_id is set instead when an Excel import brings in history
-- for a Discord id that doesn't have an account yet (see ExcelService / UserController backfill).
create table rank_group_watch_status
(
    id                 uuid primary key default gen_random_uuid(),
    media_id           int         not null,
    group_id           int         not null,
    user_id            int references "user" (id) on delete cascade,
    pending_discord_id varchar(32),
    watched_at         timestamptz not null default now(),
    foreign key (media_id, group_id) references rank_group_media (media_id, group_id) on delete cascade
);

create unique index idx_watch_status_user on rank_group_watch_status (media_id, group_id, user_id) where user_id is not null;
create unique index idx_watch_status_pending on rank_group_watch_status (media_id, group_id, pending_discord_id) where pending_discord_id is not null;

create table review
(
    id                 uuid primary key default gen_random_uuid(),
    rating             float       not null,
    comment            text,
    created_at         timestamptz not null default now(),
    media_id           int         not null,
    group_id           int         not null,
    user_id            int references "user" (id) on delete cascade,
    pending_discord_id varchar(32),
    foreign key (media_id, group_id) references rank_group_media (media_id, group_id) on delete cascade
);

create unique index idx_review_user on review (media_id, group_id, user_id) where user_id is not null;
create unique index idx_review_pending on review (media_id, group_id, pending_discord_id) where pending_discord_id is not null;

create index idx_review_media_group on review (media_id, group_id);

-- Display name (from the legacy spreadsheet's username row) for a Discord id imported into a group
-- that doesn't have a matching user account yet, so the UI can show "Nemo" instead of a raw id.
create table rank_group_pending_member
(
    group_id     int         not null references rank_group (id) on delete cascade,
    discord_id   varchar(32) not null,
    display_name varchar(100),
    primary key (group_id, discord_id)
);
