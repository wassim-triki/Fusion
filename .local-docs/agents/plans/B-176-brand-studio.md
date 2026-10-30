# B-176 — Brand studio (slice 2 of B-167)

Built 2026-10-30 to D-02, D-06, D-07, D-08 and brief §6b C1.

## Model calls

- **The brand lives in Identity**, on the tenant: Identity already owns the company name, its language, sign-in and every invitation email. `Tenant.BrandColor` (`#rrggbb` or null for Fusion's amber), `Tenant.LogoVersion`, and `TenantLogos` (one PNG per tenant, apart from the tenant row). Migration `AddCompanyBrand`.
- **One save** (`PUT /api/identity/brand`) carries name, colour, default language and the logo (keep, replace, remove). Nobody sees a change before it succeeds; a name another active company uses is refused.
- **Who edits**: the Company settings' existing rule, `settings.organization.manage` (or legacy `settings.manage`) at tenant scope, checked by Identity; the company is only the caller's own, from the token's membership claim.
- **Logo**: the browser turns any image (SVG, PNG, JPEG, WebP, GIF) into a square PNG (512 px, 256 if too heavy). Identity accepts only a PNG it checks itself (signature and header, ≤ 512 KB, 16–1024 px), so no SVG is ever stored or served. Served signed out at a versioned address, cached for good; emails carry it inside the message (cid), never as a remote image.
- **Colour**: one hex becomes the primary tokens per theme. White or near-black text on it, whichever reads better (the readable-text check shows the ratio); a deeper (light mode) or lighter (dark mode) ink for text in the colour; dark mode lifts a colour too dark to see. `--warning` stays Fusion's amber (D-08). Applied without a flash: a `fusion-brand` cookie (bare hex, checked server-side) feeds a stylesheet in each root layout; the sidebar keeps it current.
- **Colours offered** (D-07): up to three from the logo (slivers under 3% and greys ignored), Fusion's amber plus four Fusion colours, and any colour.
- **Default language** = the tenant's locale (en, fr, ar). People who chose their own keep it. Invitations are written in it.
- **Sign-in** wears a company when the link names it (`?company=<workspace>`) or the browser last used it; otherwise Fusion's own side. With no language chosen on the browser yet, it switches to the company's.
- **Invitations**: workforce, additional administrator and recovery invitations carry the company's name, logo, colour and "Sent by … with Fusion", in en, fr or ar (Arabic right to left, Gregorian dates). The first administrator's invitation stays Fusion's own.
- **Settings**: Company becomes **Brand** (the studio) and **Details** (workspace, industry, time zone, modules; read-only as before). `/core/settings/company` falls through to Brand.
- **Previews** draw the draft only inside their own frame: Home (a still copy of Home's frame in the draft language), sign-in (the real sign-in frame), the invitation email (rendered by Identity from the real template, addressed to the viewer).

## What to look at (In review)

1. Sign in as Amira Khelifi, the administrator of Carthage Digital Group: the sidebar shows the logo and the company, buttons are blue, "days late" stays amber.
2. Settings › Brand: pick a colour from the logo, any colour (a light one switches the text to dark), switch the default language to العربية and watch the three previews turn right to left; Discard; upload a logo of your own.
3. Sign out: the sign-in page keeps Carthage's side. Open `/auth/signin?company=carthage-digital-group` in a private window to see it in the company's language.
4. Invite an administrator, then open the email in Mailpit (http://localhost:8025).

## Follow-ups

B-203 (brand changes in Change history), B-204 (notification emails branded), B-205 (invitation and activation pages branded, with B-188), B-206 (a jsdom cookie test in `@repo/auth`).
