-- Kuadra: database schema for Supabase. Safe to run more than once.

create table if not exists public.kuadra_users (
  email text primary key,
  added_at timestamptz not null default now()
);

create table if not exists public.docs (
  coll text not null,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (coll, id)
);

-- Server-only values (Gmail refresh token). RLS on, no policies: only the service role reads it.
create table if not exists public.secrets (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.kuadra_users enable row level security;
alter table public.docs enable row level security;
alter table public.secrets enable row level security;

create or replace function public.is_kuadra_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.kuadra_users where lower(email) = lower(auth.jwt() ->> 'email'));
$$;

-- The first person who signs in becomes the owner; after that only listed emails get in.
create or replace function public.claim_owner() returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.jwt() ->> 'email' is null then return false; end if;
  if not exists (select 1 from public.kuadra_users) then
    insert into public.kuadra_users (email) values (lower(auth.jwt() ->> 'email'));
  end if;
  return public.is_kuadra_user();
end $$;

revoke all on function public.claim_owner() from public, anon;
grant execute on function public.claim_owner() to authenticated;
grant execute on function public.is_kuadra_user() to authenticated;

drop policy if exists docs_all on public.docs;
create policy docs_all on public.docs for all to authenticated
  using (public.is_kuadra_user()) with check (public.is_kuadra_user());

drop policy if exists users_all on public.kuadra_users;
create policy users_all on public.kuadra_users for all to authenticated
  using (public.is_kuadra_user()) with check (public.is_kuadra_user());

-- Live sync between devices
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;

-- Private bucket for receipts, photos and PDFs
insert into storage.buckets (id, name, public) values ('files', 'files', false)
on conflict (id) do nothing;

drop policy if exists kuadra_files on storage.objects;
create policy kuadra_files on storage.objects for all to authenticated
  using (bucket_id = 'files' and public.is_kuadra_user())
  with check (bucket_id = 'files' and public.is_kuadra_user());
