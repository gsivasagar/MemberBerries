# Smart Bookmark App (MemberBerries)

**Live demo:** https://member-berries.vercel.app/ (sign in with Google).

A real-time bookmark manager built with **Next.js 16**, **Supabase**, and **Tailwind CSS**. Authenticated users can save, categorize, and manage their bookmarks with a premium, dark-themed UI.

![MemberBerries Logo](/public/logo.svg)

## Features (v3.0)

- **Dark Sidebar Layout**: A modern, fixed sidebar navigation with a unified dark theme (`Slate 900`).
- **Real-time Updates**: Bookmarks sync instantly across devices using Supabase Realtime.
- **Enhanced Management**:
    -   **Categorization**: Organize bookmarks into custom categories with a toggleable input.
    -   **Search & Filter**: Instantly filter bookmarks by title, URL, or category.
    -   **Bulk Actions**: Select multiple bookmarks to delete in batches.
-   **Smart Previews**: Automatically fetches and displays link previews (Open Graph images/titles).
-   **User Profile**: specific Google profile picture displayed in the sidebar.
- **Secure Authentication**: Google OAuth sign-in via Supabase Auth.
- **Responsive Design**: Fully responsive grid layout optimized for all screen sizes.

## Tech Stack

- **Frontend**: Next.js 16 (App Router), React, Tailwind CSS
- **Backend**: Supabase (PostgreSQL, Auth, Realtime) and a Next.js route handler for link previews
- **Deployment**: Vercel
- **Tests**: Vitest (`npm test`), ESLint, TypeScript, GitHub Actions

## Setup

```bash
cp .env.example .env.local      # add your Supabase URL and anon key
npm install
npm run dev
```
Then run `supabase/policies.sql` once in the Supabase SQL editor (see Security).

## Security

- **Row Level Security is required.** The Supabase anon key is public by design, so data isolation comes from RLS, not from
  the client. `supabase/policies.sql` enables RLS and adds select/insert/update/delete policies limited to
  `auth.uid() = user_id`, and a check that only `http(s)` links are stored. Run it, then test with two accounts.
- **Link previews are fetched server-side, so the route is locked down** (`app/api/preview/route.ts`): sign-in required,
  per-user rate limit, `http`/`https` only on standard web ports, no embedded credentials, every address the host resolves
  to must be public (loopback, private, link-local and cloud-metadata ranges are refused), redirects are followed manually
  and re-checked at every hop, plus a time limit, a 1 MB read limit and content-type checks. Known residual risk: the address
  is checked just before the request, so DNS rebinding is not fully closed; pin the resolved address in the HTTP client if
  this route ever handles sensitive targets. The rate limiter keeps counters per server instance (best effort).
- Saved links are validated as `http(s)` in the form, when rendering, and in the database; other schemes are never opened.
- Favicons are requested from Google with only the host name, which still tells Google which sites you bookmark.

## Tests
`npm test` runs 92 tests for URL validation, the address guard (including decimal/hex/octal IP tricks and redirect
bypasses), the preview fetcher, rate limiting and the API route. `npm run lint`, `npm run typecheck` and `npm run build`
run in CI on every push.

## Challenges & Solutions

### 1. Vercel Deployment Updates
**Problem:** After deploying updates, the live site seemed stuck on an old version.
**Solution:** I realized I was visiting an *immutable deployment URL* (a snapshot of a specific commit) rather than the main *production domain*. I fixed this by ensuring I always accessed the main `.vercel.app` domain and updated my bookmark/redirects accordingly.

### 2. Real-time Synchronization
**Problem:** When a bookmark was added in one tab, it didn't appear in another tab without a manual refresh.
**Solution:** I implemented **Supabase Realtime** subscriptions using the `postgres_changes` channel. The app now listens for `INSERT`, `UPDATE`, and `DELETE` events on the `bookmarks` table and updates the local React state immediately, ensuring a seamless experience across devices.

### 3. Database Schema Evolution
**Problem:** Adding categories initially failed because the database table lacked the necessary column, and Supabase is a relational database requiring strict schema definitions.
**Solution:** I updated the Supabase database schema by running an SQL migration: `ALTER TABLE bookmarks ADD COLUMN category text;`. This allowed the new category feature to function correctly without data loss.

### 4. Implementing Dark Mode Sidebar (V3)
**Problem:** The user requested a complete UI overhaul to a "Dark Sidebar" layout, which required shifting from a top-navbar structure to a fixed-sidebar one and inverting the color scheme.
**Solution:** 
-   **Layout**: I refactored `DashboardShell` to use a fixed `aside` for navigation and a scrollable `main` area.
-   **Theming**: I updated `globals.css` with new dark theme variables and rigorously updated all Tailwind classes in `BookmarkManager`, `LoginPage`, and `DashboardShell` to use `bg-slate-900`, `text-white`, and `border-white/5` for a premium dark aesthetic.
-   **Tooling**: I consolidated the Search and Add functionalities into a new "Toolbar" component within the main content area to keep the sidebar clean for navigation.

### 5. Infinite Loops & Build Errors
**Problem:** During refactoring, I encountered infinite loops in the `useEffect` for fetching bookmarks and build errors due to missing imports (`FolderIcon`).
**Solution:** 
-   I optimized the `fetchBookmarks` dependency array to prevent unnecessary re-renders.
-   I ran a strict linting check, removing unused variables and ensuring all Heroicons were correctly imported before finalizing the build.

### 6. Next.js Image Optimization
**Problem:** The app crashed with a "hostname is not configured" error when trying to display the user's Google profile picture.
**Solution:** I updated `next.config.ts` to include `lh3.googleusercontent.com` in the `images.remotePatterns` allows list, enabling Next.js to safely optimize and serve these external images.

### 7. Edit Functionality Conflicts
**Problem:** Edited bookmarks would sometimes "revert" to their old values immediately after saving.
**Solution:** I diagnosed this as a race condition between the periodic polling (`setInterval`) and the local state update. I removed the polling mechanism entirely and relied on **Optimistic Updates** (updating UI immediately) combined with **Supabase Realtime** to keep the data fresh without conflicts.
