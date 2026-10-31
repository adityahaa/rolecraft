-- Run once in a NEW Supabase project's SQL Editor. No existing data is modified.
create table public.profiles (user_id uuid primary key references auth.users on delete cascade, data jsonb not null check(octet_length(data::text)<=60000), updated_at timestamptz not null default now());
create table public.documents (id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users on delete cascade,label text not null check(length(label)<=100),resume text not null check(length(resume)<=30000),letter text not null check(length(letter)<=12000),provenance text not null check(provenance in ('AI-assisted','Manual','Example')),job_role text not null,job_company text not null,created_at timestamptz not null default now(),unique(id,user_id));
create table public.applications (id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users on delete cascade,company text not null check(length(company) between 1 and 150),role text not null check(length(role) between 1 and 150),job_url text not null default '' check(length(job_url)<=1500 and (job_url='' or job_url ~ '^https://')),status text not null default 'Saved' check(status in ('Saved','Applied','Interviewing','Offer','Closed')),follow_up date,notes text not null default '' check(length(notes)<=5000),document_id uuid,updated_at timestamptz not null default now(), foreign key(document_id,user_id) references public.documents(id,user_id));
create index applications_owner on public.applications(user_id);
create index documents_owner on public.documents(user_id);
alter table public.profiles enable row level security;
alter table public.documents enable row level security;
alter table public.applications enable row level security;
create policy own_profile on public.profiles for all to authenticated using ((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy own_documents on public.documents for all to authenticated using ((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy own_applications on public.applications for all to authenticated using ((select auth.uid())=user_id) with check((select auth.uid())=user_id);
-- Immutable versions: new saves INSERT; no document UPDATE privilege.
revoke all on public.profiles,public.documents,public.applications from anon;
grant select,insert,update,delete on public.profiles,public.applications to authenticated;
grant select,insert,delete on public.documents to authenticated;
revoke update on public.documents from authenticated;
create function public.bound_records() returns trigger language plpgsql set search_path=public as $$
declare n integer;begin
 perform pg_advisory_xact_lock(hashtextextended(new.user_id::text || tg_table_name,0));
 execute format('select count(*) from public.%I where user_id=$1',tg_table_name) into n using new.user_id;
 if n>=100 then raise exception 'Saved item limit reached';end if;return new;end;$$;
create trigger application_cap before insert on public.applications for each row execute function public.bound_records();
create trigger document_cap before insert on public.documents for each row execute function public.bound_records();
create table public.usage_events (id bigint generated always as identity primary key,subject text not null,kind text not null,created_at timestamptz not null default now());
create index usage_recent on public.usage_events(kind,created_at);
alter table public.usage_events enable row level security;
revoke all on public.usage_events from anon,authenticated;
-- Atomic across functions, instances, requests and accounts. Failed calls consume quota.
create function public.claim_usage(subject_key text,usage_kind text) returns boolean language plpgsql security definer set search_path=public as $$
declare per_user integer;overall integer;begin
 if usage_kind not in ('ai','extract','export') then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended('rolecraft-usage-'||usage_kind,0));
 delete from public.usage_events where created_at < now()-interval '2 days';
 if usage_kind='ai' then
  if exists(select 1 from public.usage_events where kind='ai' and created_at>now()-interval '60 seconds') then return false;end if;
  select count(*) into per_user from public.usage_events where kind='ai' and subject=subject_key and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
  select count(*) into overall from public.usage_events where kind='ai' and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
  if per_user>=3 or overall>=10 then return false;end if;
 else
  select count(*) into per_user from public.usage_events where kind=usage_kind and subject=subject_key and created_at>now()-interval '1 hour';
  select count(*) into overall from public.usage_events where kind=usage_kind and created_at>now()-interval '1 day';
  if per_user>=20 or overall>=200 then return false;end if;
 end if;
 insert into public.usage_events(subject,kind) values(subject_key,usage_kind);return true;end;$$;
revoke all on function public.claim_usage(text,text) from public,anon,authenticated;
grant execute on function public.claim_usage(text,text) to service_role;
create table public.job_cache (source text primary key,payload jsonb not null default '[]',fetched_at timestamptz,next_attempt timestamptz not null default now(),error text);
insert into public.job_cache(source) values('remotive');
alter table public.job_cache enable row level security;
revoke all on public.job_cache from anon,authenticated;
create function public.claim_job_refresh() returns boolean language plpgsql security definer set search_path=public as $$
declare claimed text;begin
 update public.job_cache set next_attempt=now()+interval '6 hours' where source='remotive' and next_attempt<=now() returning source into claimed;
 return claimed is not null;end;$$;
revoke all on function public.claim_job_refresh() from public,anon,authenticated;
grant execute on function public.claim_job_refresh() to service_role;
-- Delete documents only after unlinking applications; transaction avoids dangling versions.
create function public.delete_document(version_id uuid) returns void language plpgsql security invoker set search_path=public as $$begin
 update public.applications set document_id=null where user_id=auth.uid() and document_id=version_id;
 delete from public.documents where id=version_id and user_id=auth.uid();end;$$;
revoke all on function public.delete_document(uuid) from public,anon;
grant execute on function public.delete_document(uuid) to authenticated;
create function public.delete_my_data() returns void language plpgsql security invoker set search_path=public as $$begin
 delete from public.applications where user_id=auth.uid();
 delete from public.documents where user_id=auth.uid();
 delete from public.profiles where user_id=auth.uid();end;$$;
revoke all on function public.delete_my_data() from public,anon;
grant execute on function public.delete_my_data() to authenticated;
-- Explicit grants also support projects with automatic table exposure disabled.
grant all on public.profiles, public.documents, public.applications, public.job_cache, public.usage_events to service_role;
grant usage, select on sequence public.usage_events_id_seq to service_role;
