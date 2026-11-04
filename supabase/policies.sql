-- Row Level Security for the bookmarks table. Run once in the Supabase SQL editor, then test with two accounts.
-- Without this, anyone who has the project URL and the (public) anon key can read every user's bookmarks.

alter table public.bookmarks enable row level security;
alter table public.bookmarks force row level security;

-- New rows belong to the signed-in user by default.
alter table public.bookmarks alter column user_id set default auth.uid();

drop policy if exists "bookmarks_select_own" on public.bookmarks;
drop policy if exists "bookmarks_insert_own" on public.bookmarks;
drop policy if exists "bookmarks_update_own" on public.bookmarks;
drop policy if exists "bookmarks_delete_own" on public.bookmarks;

create policy "bookmarks_select_own" on public.bookmarks
    for select to authenticated using (auth.uid() = user_id);

create policy "bookmarks_insert_own" on public.bookmarks
    for insert to authenticated with check (auth.uid() = user_id);

create policy "bookmarks_update_own" on public.bookmarks
    for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "bookmarks_delete_own" on public.bookmarks
    for delete to authenticated using (auth.uid() = user_id);

-- Only http(s) links may be stored. NOT VALID checks new and changed rows without failing on old data;
-- clean up any old rows, then run:  alter table public.bookmarks validate constraint bookmarks_url_http;
alter table public.bookmarks drop constraint if exists bookmarks_url_http;
alter table public.bookmarks add constraint bookmarks_url_http check (url ~* '^https?://') not valid;

-- Realtime respects RLS, so each user only receives their own change events.
-- Quick self-check (should return 4 policies and relrowsecurity = true):
--   select polname from pg_policy where polrelid = 'public.bookmarks'::regclass;
--   select relrowsecurity from pg_class where oid = 'public.bookmarks'::regclass;
