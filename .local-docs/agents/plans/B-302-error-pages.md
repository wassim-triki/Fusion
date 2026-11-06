# B-302 One family of error pages

Accepted drawing: [explorer](https://claude.ai/artifact/M9ZehcDte7bDjuAmdasep8), source `plans/B-302-error-pages.html` (the state data, words and SVG drawings are in its script; port them literally). User, 2026-11-06: chose direction B ("defintly B"), states accepted ("great") after "Part of a page" and "Signed out" were redone.

One slice, one commit, ends In review. Medium effort, high for step 2's endpoint. Colleague modules are not touched.

## What gets built

| State | Words (EN) | Next step |
| --- | --- | --- |
| No access (403) | You don't have access to this page / {Name} can give you access. Email {First} | Go to the module's Overview |
| Not found (404) | We can't find this page / The link may be old or mistyped. | Go to Overview; a search box that opens Ctrl K |
| No longer here (404 on a record) | This is no longer here / It may have been removed or closed since this link was sent. | Go to the list the link belongs to |
| Page failed (500) | This page didn't load / Try again. If it keeps happening, send this code to your administrator. | Try again, Go to Overview, reference code |
| Module down (502, 503) | {Module} isn't responding / We'll keep trying. | Try again, retries by itself with a countdown, open another module |
| Offline | You're offline / This page comes back when you reconnect. | Try again, checks by itself |
| Part of a page | {Thing} didn't load | Card with room: small drawing and Try again. Slim row: one line and a link |
| Signed out (401) | You've been signed out / Sign in again to go back to where you were. | The real sign-in page and email step, small door drawing |
| Link expired | This invitation has expired / Ask your administrator to send a new one. | Same layout as sign-in, Go to sign in |

No dashed box and no status codes. Lora title, one drawing, sidebar stays. Every text in EN, FR and AR; check Arabic in RTL once.

## Steps

1. **`PageState` in `@repo/ds/shell`** (`page-states.tsx`), with the six drawings as a small module using tokens (`currentColor`, primary ink for the accent) and one movement each. `PageRefusal` and `PageError` move onto it; a `size` of page, card or row decides the treatment. `PageEmpty` keeps today's look for ordinary empty states; only failures change. Delete `StateShell`'s dashed treatment for failures rather than keeping both.
2. **Who to ask.** A small Identity read of the caller's own company's active administrators (name and work email, at most three), for any signed-in member. Server-side: own tenant only, with cross-tenant and platform-admin negatives. This is an authorization change, so run `security-review` and an API journey. Fall back to "your administrator" with no email when the read fails. An administrator who is refused sees no "ask yourself" line.
3. **Replace the treatments.** Core `error.tsx` and `not-found.tsx`; shell `error.tsx` and `not-found.tsx` (stop showing the raw `error.message`); Performance `error.tsx`, `not-found.tsx` and `ContentUnavailable`; Platform `PlatformPageState`. Core `core-workspace-access-boundary`, Performance's boundary. About 36 `PageError` call sites: decide page, card or row per site; many in Settings are page-sized.
4. **Module down and offline.** `classifyApiError` already separates `upstream-unavailable` from `network`; today both show the same words. Split them, and refetch on a timer with a visible countdown.
5. **Signed out.** Today an expired session looks like a normal visit. Mark only a real expiry (the API client's failed refresh, never the user's own sign-out or a first visit) so `signin-page.tsx` shows the new title and drawing, and keep `callbackUrl`.
6. **Link expired.** `activate-invitation.tsx` and `recover-administrator-access`: the expired, used and invalid outcomes join the family on the sign-in layout.
7. **`DESIGN.md`**: §7 States gains one line allowing one small drawing on failure pages; empty states keep "no oversized illustrations".

## Things the drawing glosses over; settle them in the build

- **"The rest of Fusion still works"** was cut from the Module down words, because the page can't know it without checking. Only offer "open another module" for a module the company has on.
- **Reference code:** Next.js gives `error.digest` only for server errors. Show the code when it exists and leave it out otherwise, with wording that still reads right. Don't invent a code nothing can look up.
- **Search on Not found** opens the existing top bar search, not a second one.
- **No leaks:** never echo the address (it can hold a record ID), a record's name or the role that would open the page.
- **Left out:** a Request access button with approvals (board it), illustrations on empty states, colleague modules' error pages.

## Checks

- One Identity suite; touched tests in `@repo/ds`, `@repo/auth`, core, performance, platform, shell; a journey for step 2 with its negatives.
- Cold builds of shell, core, performance and platform, because `error.tsx` and `not-found.tsx` are route files. Frontend down, one at a time.
- Screens through the shell, dark, 1440×900, compared with the drawing: the refusal, not found, part of a page, signed out. Trigger failure states honestly (a wrong address, a stopped backend with `stack.ps1 -Down -Only`), never with hand-written data changes.
- `data/links-b302-sidebar.cjs`, for the user's question of whether sidebars ever offer a page that refuses. On 2026-11-06: 66 links opened, none refused; complete for Amira Khelifi, Rim Mahjoub, Mariam Gharbi and Omar Mansour. Killed for low memory during Leila Baccouche, after her Core HR links: run `node links-b302-sidebar.cjs leila` on `-Apps core,performance`; her Performance Feedback, 1:1s, Reviews and Settings are the gap. It checks for the refusal line and failed responses only. Also look at why Leila, an employee, is offered Settings under Administration (it opens her change history): the sidebar group may read wrong.
