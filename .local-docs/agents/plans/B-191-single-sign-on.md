# B-191 — Single sign-on (rebuild slice 17)

**Status:** Draft 2026-11-05 from a low-effort pass; to be re-planned at xhigh in a fresh session before any build. Authority: brief S1 (`B-164-target-brief.md` §6b, rung 2), slice row 17 in `B-167-rebuild.md`, then `DESIGN.md`. No deployment exists or is needed: everything is built and proven on `localhost:3000` with a local test provider. Real Microsoft/Google apps are optional, added later as Windows user variables (below); a hosted demo later only adds its address to those registrations.

## Scope (S1, as accepted)

- **Sign in with Microsoft** and **Sign in with Google** on the sign-in page, for every company.
- **A company's own provider**: Settings › Sign-in connects its Microsoft Entra ID or any OpenID Connect provider, **tests it**, and can **require it for its email domain(s)**.
- **Only invited people get in**: a provider sign-in finds an existing account or completes that person's pending invitation; it never creates anyone.
- **A local test provider** for development and tests.
- Out: SCIM/automatic provisioning, SAML, a public API, sign-in for platform operators through a provider.

## Decisions (mine, per "decide yourself"; the user can overrule)

1. **Identity runs the provider exchange on the server, then issues Fusion's own tokens.** Authorization-code flow with PKCE, `state` + `nonce`, ID token validated (issuer, audience, signature from the provider's discovery/JWKS, expiry). After that the existing `IAuthSessionFactory.CreateAsync(user)` mints the usual access + refresh pair, so the gateway's authority gate, access revisions (B-279), refresh and view-as all work unchanged.
2. **Tokens never travel in a URL.** The callback stores a one-time, short-lived (60 s), single-use **handoff code** bound to the browser (a `SameSite=Lax`, httpOnly cookie set when the flow starts) and redirects to the shell; the shell exchanges the code for the token pair with a POST and stores it as today (localStorage; moving tokens to cookies stays out of scope, noted in B-293's log).
3. **Matching an account.** Only by the provider's **verified** email (`email_verified`; Microsoft: `email`/`preferred_username` of a work account in the expected directory). Then:
   - an **active account** with that email and an active membership → signed in;
   - **no account but a pending, unexpired invitation** for that email → the invitation is accepted through the existing acceptance services (workforce, administrator, tenant activation) with no password, then signed in;
   - otherwise → refused with one plain message ("No invitation for this address. Ask your company's HR."), audited, no account made.
   The first successful provider sign-in records a **link** (provider + issuer + subject) on the account; later sign-ins match on that link first, so an email change at the provider can't move the sign-in to someone else, and a different subject with the same email is refused.
4. **Which provider may vouch for which company.** Fusion-wide Microsoft and Google are allowed for any company **unless** the company requires its own provider for that domain. A company's own connection only signs in people whose membership is in that company, and (Entra) only from its directory `tid`; (Google Workspace) its `hd`.
5. **"Required for its domain".** The company lists its email domains; each must be **proved** by a successful test sign-in from an address in it (no DNS step at rung 2). When required, password sign-in and the Fusion-wide buttons are refused for those addresses, and invitations for them can only be accepted through the company's provider. **Fallback:** platform operators keep passwords (they never sign in through a tenant provider); a company can only turn "required" on after a test sign-in succeeded, and the administrator turning it on must have just signed in through it, so nobody locks the company out by mistake. Turning it off always works for an administrator signed in through the provider. Existing refresh tokens of people who now must use the provider are revoked when it's turned on.
6. **Secrets.** A company's client secret is encrypted with ASP.NET Data Protection (key ring persisted in Identity's database, purpose `sso.client-secret`), never returned by any API (only "set" / "not set"), never logged. Fusion-wide Microsoft/Google credentials come from configuration (`FUSION_SSO_MICROSOFT_CLIENT_ID/SECRET`, `FUSION_SSO_GOOGLE_CLIENT_ID/SECRET`); a button only shows when its provider is configured.
7. **Discovery.** Providers are configured by issuer URL; Identity reads `/.well-known/openid-configuration` and JWKS (cached, refreshed on key-miss). Only `https` issuers outside Development; no redirects to private addresses from discovery (SSRF guard on the issuer URL).
8. **Test provider.** A small OpenID Connect provider inside Identity, mapped **only in Development** (and the test host), at `/api/identity/dev-oidc/*`: discovery, JWKS, an authorize page that lists fictional people to pick (email, verified or not, subject), token endpoint. Both "Fusion-wide" and "company's own" flows can point at it. Never compiled into a production route (environment check + test).

## Pieces

**Identity (domain + API)**
- `SsoConnection` (tenant, kind: Entra | OIDC, display name, issuer, client id, encrypted secret, Entra `tid`, status Draft/Tested, tested at/by) and `SsoDomain` (connection, domain, proved at, required). One connection per company at rung 2.
- `ExternalLogin` link (user, provider key: `microsoft` | `google` | connection id, issuer, subject, linked at).
- `SsoFlow` (state, nonce, PKCE verifier, provider, purpose: sign-in | test | invitation credential, browser binding, expires) and `SsoHandoff` (code hash, user, purpose, expires, used).
- Endpoints: `GET /api/identity/sso/providers?email=` (which buttons to show for an address: Fusion-wide, the company's, or "your company requires …"), `GET /sso/start`, `GET /sso/callback`, `POST /sso/handoff`; settings under `/api/identity/tenant/sso` (read, save draft, test start, domains, require on/off) behind the administrators' Sign-in area permission.
- `POST /auth/login` refuses a required domain with a typed reason the sign-in page understands.
- Audit events for every sign-in, refusal, link, test, requirement change.

**Gateway**: route `/api/identity/sso/*` anonymous where needed (start, callback, providers, handoff); nothing else changes.

**Shell**: sign-in page asks for the email first when a company requires SSO (or shows buttons when configured); "Sign in with Microsoft/Google" buttons; `/auth/sso/complete` exchanges the handoff code; invitation pages (`activate-invitation`, `accept-administrator-invitation`, workforce invite) offer the provider instead of a password when allowed or required. EN/FR/AR, lean.

**Core › Settings › Sign-in**: a "Single sign-on" block above the invitation settings: connect (Entra or OIDC: issuer/tenant, client id, secret), the redirect address to copy, **Test** (opens the provider, comes back with who it saw), domains with proved state, **Require for these domains** switch with its consequence sentence; built in the accepted settings grammar (`SettingsPage`/`SettingsBlock`), judged at review.

## Proof

- **Tests (Identity)**: matching rules (verified email only; link wins; same email different subject refused; no invitation → refused, nothing created; pending invitation accepted once), tenant isolation (company A's connection can't sign in company B's people, can't read/change B's settings), required domain blocks password and Fusion-wide buttons, refresh tokens revoked on require, turn-on refused without a fresh test sign-in, state/nonce/PKCE replay and expiry, handoff single-use and browser-bound, secret never in any response, dev provider unreachable outside Development.
- **Journeys** through `localhost:3000` with the test provider (`data/journey-b191-sso.cjs`): an invited person accepts through the provider and signs in; an uninvited address is refused; administrator connects the company provider, tests, proves the domain, requires it; password sign-in for that domain refused; another company's administrator gets 404/403 on every SSO setting; the platform operator still signs in with a password.
- `security-review` skill on the finished diff (mandatory). Cold `build` of shell and core (new routes). One screen per new surface (sign-in with buttons, Settings › Sign-in SSO block), dark 1440×900.

## Order (one session)

1. Identity domain + migration + dev provider + flow/handoff endpoints, tests green.
2. Matching + invitation completion + required domains + settings API, authz/isolation tests.
3. Shell sign-in, completion route, invitation pages; Core settings block; i18n.
4. Journey, security-review, cold builds, screens → In review.

## Real providers (optional, any time; nothing blocks the build)

Microsoft Entra admin center → App registrations → new, redirect `http://localhost:3000/api/identity/sso/callback`, a client secret. Google Cloud console → OAuth client (Web), same redirect. Set the four `FUSION_SSO_*` Windows user variables; restart Identity with `stack.ps1 -Force -Only Identity`. A hosted demo later adds its own callback address to both.
