-- Row Level Security for the bookmarks table.
-- Without this, anyone who has the project URL and the (public) anon key can read, change and delete
-- every user's bookmarks.
--
-- How to run it (Supabase dashboard > SQL editor):
--   1. Run the read-only checks just below. Fix anything they flag.
--   2. Run the script (everything between BEGIN and COMMIT) once. It is one transaction, so it either
--      applies completely or not at all. It stops by itself if bookmarks.user_id is not a uuid.
--   3. Run the self-check at the bottom, then test with two accounts (see README, Security).
--
-- Read-only checks (run these first; they change nothing):
--   -- user_id must be uuid:
--   select data_type from information_schema.columns
--    where table_schema = 'public' and table_name = 'bookmarks' and column_name = 'user_id';
--   -- rows with no owner become invisible to everyone once RLS is on:
--   select count(*) filter (where user_id is null) as no_owner, count(*) as total from public.bookmarks;
--   -- live sync needs the table in the realtime publication (expect one row):
--   select tablename from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'bookmarks';

begin;

-- Stop before changing anything if user_id is not a uuid. auth.uid() returns a uuid, so the policies
-- below would fail on any other type, and by then RLS would already be on with no policy.
do $$
begin
    if (select data_type from information_schema.columns
         where table_schema = 'public' and table_name = 'bookmarks' and column_name = 'user_id')
       is distinct from 'uuid' then
        raise exception 'bookmarks.user_id is missing or is not a uuid. Nothing was changed; check the table first.';
    end if;
end
$$;

alter table public.bookmarks enable row level security;
alter table public.bookmarks force row level security;

-- New rows belong to the signed-in user by default.
alter table public.bookmarks alter column user_id set default auth.uid();

-- Every policy compares user_id, so index it.
create index if not exists bookmarks_user_id_idx on public.bookmarks (user_id);

drop policy if exists "bookmarks_select_own" on public.bookmarks;
drop policy if exists "bookmarks_insert_own" on public.bookmarks;
drop policy if exists "bookmarks_update_own" on public.bookmarks;
drop policy if exists "bookmarks_delete_own" on public.bookmarks;

-- (select auth.uid()) lets Postgres work the user id out once per query, not once per row.
create policy "bookmarks_select_own" on public.bookmarks
    for select to authenticated using ((select auth.uid()) = user_id);

create policy "bookmarks_insert_own" on public.bookmarks
    for insert to authenticated with check ((select auth.uid()) = user_id);

create policy "bookmarks_update_own" on public.bookmarks
    for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "bookmarks_delete_own" on public.bookmarks
    for delete to authenticated using ((select auth.uid()) = user_id);

-- Only http(s) links may be stored. NOT VALID checks new and changed rows without failing on old data;
-- clean up any old rows, then run:  alter table public.bookmarks validate constraint bookmarks_url_http;
alter table public.bookmarks drop constraint if exists bookmarks_url_http;
alter table public.bookmarks add constraint bookmarks_url_http check (url ~* '^https?://') not valid;

commit;

-- Realtime and RLS:
--   INSERT and UPDATE events respect the policies above, so a user only receives changes to their own rows.
--   DELETE events are different. They carry only the row's primary key and are not checked by RLS, so
--   other users can be told that an id was deleted (never what the bookmark contained), and the app's
--   `user_id=eq.<id>` filter may not match a DELETE at all. Test deleting in one tab and watching another.
--   If deletes do not sync, have the app re-fetch its list when it receives any DELETE event.
--
-- Updates and deletes of rows the user does not own change zero rows and return no error, so the app can
-- look as if they worked. Real users only touch their own rows, so this only shows up in manual tests.
--
-- Self-check after running (expect 4 policies, relrowsecurity = true, relforcerowsecurity = true):
--   select polname from pg_policy where polrelid = 'public.bookmarks'::regclass;
--   select relrowsecurity, relforcerowsecurity from pg_class where oid = 'public.bookmarks'::regclass;
