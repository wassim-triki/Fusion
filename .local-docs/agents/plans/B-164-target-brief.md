# B-163 — What Fusion's Core HR should be (target brief)

Stage 2 of [B-164](B-164-tenant-experience-overhaul.md), 2026-10-30. Written from first principles and a study of established products. It sets the target; the [map](B-164-map.md) records what exists, and B-166 compares the two. The user picks scope on the **scope page** (`B-164-scope.html`), which carries the full feature list with depth ladders; this brief holds the reasoning behind it and doubles as material for the user's report (study of existing solutions → what Fusion takes, improves or adds).

## 1. Core HR in one sentence

**The company's living record of who works here, how the organisation is shaped, and how both change over time**, kept true by the people it concerns and trusted by every other module.

Seven jobs follow from that sentence. Every Core HR feature serves one of them; a feature that serves none is cut.

| # | Job | Today in Fusion (from the map) |
| --- | --- | --- |
| J1 | **Know who works here**: one record per person (identity, employment, job, manager, contact) | Strong model; record is thin and split across pages |
| J2 | **Know how the company is shaped**: units, reporting lines, jobs, places | Units and lines strong (dated); jobs and places are free text |
| J3 | **Keep it true over time**: joiners, movers, leavers, with dates and history | Strong (effective dating, scheduled changes, history) |
| J4 | **Let the right people see and do the right things**: access, privacy, self-service | Works, but two authority systems, a 34-key catalog, a separate access list |
| J5 | **Help people find each other**: directory, profiles, org chart | Org chart strong; no directory below HR |
| J6 | **Show the state of the workforce**: what changed, what needs doing, trends | Generic dashboard; nothing reaches Home |
| J7 | **Fit the company**: its identity, data, lists, roles and rules | Mostly fixed; company settings read-only |

## 2. Who it serves

Personas are compositions of capabilities, not fixed roles (see `architecture-durable-planning`): one person can be an employee, a manager and HR at once (Amira is all three).

- **People admin (HR)**: keeps the record true, runs joiners, movers and leavers, invites people, answers "how many / who / since when".
- **Company admin**: configures Fusion to the company (identity, data, roles, rules). Often the same person as HR in a mid-sized company.
- **Manager**: sees and acts for their team: who's joining, who's changing, who needs what.
- **Employee**: keeps their own details current, finds colleagues, understands where they sit.
- **Leader**: reads the state of the organisation (insights), rarely acts.

## 3. Study of existing solutions

What each well-known product is known for in Core HR, and what Fusion takes from it. Vendor claims are marked as such in the sources.

| Product | Known for | Fusion takes | Fusion does differently |
| --- | --- | --- | --- |
| **BambooHR** (SMB) | Friendly profiles with tabs; custom fields, tabs and tables (standard and historical); custom access levels; approval paths per division, department or location; logo and 40 colour schemes; onboarding packets; 40+ reports | The friendliness bar, profile tabs, custom fields and tables, approval paths, company logo and colour | Live brand preview and a branded front door, not a palette picker; one record shared with Performance |
| **HiBob (Bob)** (mid-market) | Modern, social feel (shoutouts, celebrations, new joiners on home); custom fields, tables and categories; permission groups scoped by people and fields; lifecycle table (joined, on leave, left) applied on effective dates; workforce planning with positions and openings | Celebrations and joiners on Home; field-level permission thinking; lifecycle states including "on leave"; open roles growing toward positions | Org chart with time travel (past replay and scheduled future), AI-built company import |
| **Personio** (European SMB) | Attributes (custom fields) with visibility; preset and custom roles, with rules that add people to roles by attribute; employee-data-change approval workflows; onboarding/offboarding templates; a setup widget that walks a new account through configuration | The setup guide as a short list of real actions; data-change approvals; joining and leaving checklists; rule-based role membership | Setup on Home with configuration visible from the first minute; trilingual including Arabic, right to left |
| **Rippling** (all-in-one) | The "employee graph" as one source of truth; supergroups (groups by attribute that update themselves, used in policies, permissions, approvals); custom and formula fields used in workflows and layouts; Workflow Studio; bulk import | One record that every module reads; groups by attribute as the long-term shape of roles and rules | Without the IT and finance sprawl: HR and performance only |
| **Workday** (enterprise) | Supervisory organisations; two staffing models (job management: hire into an org with a job profile; position management: seats that outlive their occupant); business processes for every change; effective dating everywhere | Effective dating as the backbone (already built); job profiles; the job-vs-position distinction as a ladder | Effective dating kept quiet: an "as of" power tool, not the default lens; none of the configuration weight |
| **Lattice** (performance-first, added an HRIS in 2023) | One record for people data and performance: "connect your people programs and your system of record" | The case for one record across Core HR and Performance (Fusion already has both) | Built as one product from the start, not an HRIS bolted onto performance |
| **ChartHop** (org planning) | Visual org chart; scenarios (job creation, backfill, promotions, budgets) that become the real structure when approved; "Ask ChartHop" drafts scenarios from plain language | Scenarios and drafting changes in words as the wow direction for the org chart | Grounded in Fusion's scheduled changes and dated history, without budgets |
| **Flatfile** (data import, adjacent) | AI column mapping, validation, preview before import | Mapping suggestions, validation and preview as table stakes | HR-aware: understands hierarchies, manager references and job titles, and shows the result as an org chart, not rows |

**What nobody does well, and Fusion can:** an HR product where Core HR and Performance are one record and one frame; a first run that's configured, imported and live in minutes with AI doing the tedious part; an org chart that moves through time; a fully localised experience in English, French and Arabic, right to left included, for the region.

## 4. Principles

1. **One person, one record, one page.** A person's page is the same everywhere; modules add sections to it, they don't build their own person pages. The same goes for a team.
2. **Speak people, not system.** No "tenant", "workforce", "establish", "records ready", "business code" on screen. One glossary for every module.
3. **Time is built in but quiet.** Dates, history and "as of" are always available and never in the way. The default view is today.
4. **Setup is a guide, not a console.** A new company lands on Home with a short list of real actions; configuration shows from the first minute (their name, logo, colour); the guide goes away when done.
5. **Every screen works empty, and for every role.** Empty screens show what will be there and the one next step. What a role can't use, it doesn't see; when a refusal is unavoidable, it has one voice.
6. **Core HR earns a place in everyone's day.** Joiners, leavers, changes, celebrations and tasks reach Home; Core HR isn't a back office nobody opens.
7. **Configurable without code, with a preview.** The company shapes its identity, data, lists, roles and rules; every change shows its effect before it's saved.
8. **AI where it removes work.** Importing a company, cleaning data, drafting changes. Never decoration, always reviewable before it writes.
9. **One design system, one layout grammar.** Records, workspaces, sheets and lists look and behave the same in every module. No surface invents its own look or voice (checkpoint 1: "every surface speaks its own language and has its own design").

## 5. The target journey

**Day one (company admin).** The invitation and activation page stay as they are (the map found them good). Activation asks one more thing: whether they also work there; if so, they're the first person in the company. They land on **Home**, where a setup guide shows five steps: *your company* (name, logo, colour, language, time zone, work week; Fusion recolours as they go), *your organisation* and *your people* (one import: drop the spreadsheets, AI proposes the organisation, the people, their managers and a clean job catalogue, shown as an org chart to correct), *invite your people*, and *start Performance*. Every Core HR page they open on the way is empty in a helpful way: it shows what will be there and the next step.

**Everyday (HR).** Home shows who's joining and leaving this week, changes waiting for them, joining checklists due, records missing information, celebrations. Core HR's front page is the state of the workforce: headcount over time, movements, open roles, data health, by unit or location. Changes happen in one sheet on the person or from the org chart, dated, with a reason, and approved when the company asks for it.

**Everyday (manager).** One Team page: the team's people with their jobs and what's coming (a joiner on Monday, an anniversary, a change taking effect), and their Performance status in the same place. A manager can propose a change for HR to approve.

**Everyday (employee).** Their own page, lively and current, which they keep up to date themselves where the company allows; a directory to find anyone; the org chart to see where everyone sits; celebrations and joiners on Home.

**Over time.** The org chart shows the company as it was, as it is and as it will be after scheduled changes. Configuration grows with the company: new fields, lists, roles that fill themselves by rule, approval paths.

## 6. Proposed scope

The scope page has every feature with its ladder (0 not built · 1 works, minimal · 2 what established products do · 3 showcase) and the agent's pick. In short:

**Heroes (rung 3 where it matters):**
1. **Make it yours**: company identity and branding with a live preview and a branded front door (3); your own fields and sections (2); your own lists, in three languages (2).
2. **Bring your company**: one AI import for organisation, people, managers and job catalogue, reviewed as a chart, correctable in plain language (3). Reworks the clunky import the user named.
3. **The organisation in time**: one Organization place with the people chart and the structure chart the user likes as views, unit pages, and one time slider through past and scheduled future (3).
4. **One person, one place**: one person page and one team page across Core HR and Performance, access on the person, Core HR events on Home (2).

**Clean at rung 2:** setup guide, directory for everyone, job catalogue with families and levels, open roles, joining and leaving checklists, approvals for changes, self-service with approval, people insights, roles with plain permission groups, one vocabulary and refusal voice.

**At rung 1:** locations as a list, "on leave" as a state, documents on a person, export.

**Not doing** (visible on the page, any of it can be pulled back): payroll, benefits, a time-off engine, time and attendance, compensation management, recruiting (stops at open roles), learning, engagement surveys, a company feed, expenses and devices, legal entities, a report builder, SSO/SCIM and a public API, a mobile app, e-signature, budgeted org scenarios.

## 6b. Scope as settled at checkpoint 2 (2026-10-30)

The user's answers on the [scope page](https://claude.ai/artifact/CTXpeSfmikCXD3KdjLt9o4) (db doc `scope/main`), with the agent's resolution where the user asked for a middle rung or a call. This section wins over §6 where they differ.

**Questions:** all five as recommended. Home with a setup guide; a directory for everyone with the fields the company chooses; colleague modules shown only when the company has them on; changes go through approval in the story; **Make it yours** shines first.

**Changed by the user:** C3 Your own lists 2 → 1. I2 Describe a change 0 → 2.

**Middle rungs and calls, resolved:**
- **F1 Setup guide (2)** and the product tour (B-090) are one guidance system: the setup guide on Home is the tour's administrator track, and each step opens the real screen where the tour's hints take over. B-167 builds the guide so that B-090 extends it rather than adding a second one.
- **F2 The administrator is a person (2):** each rung includes the ones before it.
- **C1 Branding (between 2 and 3):** logo and accent colour across Fusion, sign-in and emails, edited with a live preview of Home, sign-in and an email. Not the company's own web address (that goes with hosting and the landing page, B-111). Enough to prove the feature, no more.
- **C2 Your own fields (2, plus a gallery):** besides fields built from scratch, a gallery of ready-made fields and sections (emergency contact, skills, certifications, languages spoken, …) added in one click and editable after. Demo companies come with a set already on, so a demo never needs to invent fields on the spot.
- **C3 Your own lists (1):** company lists without translated values. A value already used is retired, never deleted: that's data integrity, not the rung-2 feature.
- **P5 On leave (between 1 and 2):** dates plus a type from the company's list (C3 already holds leave types), shown everywhere the person appears, Performance included. Performance doesn't pause tasks automatically.
- **D3 One team page (between 1 and 2):** one Team page plus a "Coming up" list for the next 30 days (joiners, anniversaries, leave, changes, 1:1s). No calendar grid.
- **D5 Export (widened):** one Export action in the shared table kit, so every list exports as filtered (CSV, Excel), only what the viewer may see. Reports export too. No scheduled exports.
- **L3 Approvals (2, least friction):** off by default per change type. When on, the proposer's draft is the request (no second form), the approver says yes in one click from Home or the notification, a no needs a reason, and HR's own changes apply straight away. Approvals and I2 share one flow: describe or draft → approval if required → applied on its date.
- **A2 One roles model (2, widened to the platform):** see "Platform roles" below.

**Pulled back from "Not doing"** (the user: not necessarily all, but each deserves its discussion):
- **R1 Reports (from N12), rung 2, improvement.** Standard reports (headcount, joiners and leavers, turnover, tenure, spread by unit, place and job, open roles) and your own (pick fields, custom ones included; filter; group; chart; save; share with roles). Every report runs as of any date or between two dates, which the effective-dated model makes cheap and most HRIS can't do. A report runs as the viewer and shows only what they may see. D2's insights are the standard reports on Core HR's front page, one engine. Questions in words go to the assistant (B-147).
- **S1 Single sign-on (from N13), rung 2, parity; joins the "Make it yours" hero.** Sign in with Microsoft or Google; a company connects its own Microsoft Entra ID or any OpenID Connect provider in Settings, tests it, and can require it for its email domain. Only invited people get in; nobody is created by sign-in. Shows on the hosted demo. Automatic provisioning (SCIM) and a public API stay out. Authentication work: `security-review` is mandatory.
  - **Demo with fake accounts** (the user's condition, 2026-10-30): yes. The demo company gets its own sign-in provider with made-up people: a free Microsoft Entra ID test tenant (via an Azure free account, which asks for a phone and a card for verification, or the Microsoft 365 Developer Program when it accepts the account) gives the familiar Microsoft sign-in page; an Okta Integrator Free Plan org works the same way. Their addresses are on the provider's domain (e.g. `…@carthagedemo.onmicrosoft.com`), so the demo company's people are invited with those addresses. Local development and tests use a small test provider we run ourselves, so nothing depends on an outside service. The user creates the outside account when hosting starts.
- **E1 E-signature (from N15):** moved to later by the user on 2026-10-30 (B-174). If built: rung 1 as a simple electronic signature on P3 documents (sign in Fusion, signed copy and signing record on the person, who hasn't signed yet).

**Recorded for later** (board, under B-169): P1 rung 3 (companies arrange the person page's sections), P4 rung 3 (AI data health), D1 rung 3 (weekly people digest by email), E1 e-signature.

**Everything else** as picked on the page.

**Platform roles** (the user's A2 note, checked in code 2026-10-30):
- Platform staff have one role, the operator (`PlatformAdmin`). Platform's newer design is sound and stays: it sees a tenant's administration health and can only start recovery when the tenant has no usable administrator. It never co-administers a tenant.
- But an older role list (`SharedKernel/Auth/PlatformRole.cs`) puts the operator next to four tenant roles (HRAdmin, OrgAdmin, Manager, Employee). Today those four are a copy derived from access profiles (`AccessProfileService` adds them to the sign-in token) for older checks: a few Identity endpoints (users, invitations, tenant context) and all of Learning's admin endpoints. That is a third way to say who can do what, besides access profiles and the administrator list.
- **Checked in code:** the operator can't act inside a company. The user-creation and invitation endpoints both require the caller's own membership in that company, with no operator bypass. Their "PlatformAdmin can … any tenant" comments are stale, and `UsersController.GetEffectiveTenantId` is unused.
- **One gap to verify (B-173):** the old invitation endpoint refuses employee, manager, HR-admin and operator invitations, but not "OrgAdmin". So an HR admin might be able to invite someone as a tenant administrator outside the administrator invitation flow (the one with its continuity lock and audit). The user-creation endpoint blocks that; the invitation endpoint may not.
- **Decision (user: "do whatever you think is best", 2026-10-30):** two layers that never mix. Platform staff keep one operator role, unchanged. Inside a company there is one roles model: roles from permission groups, administrator as a protected role, never fewer than two. The token-role copy retires from Identity and Core HR, and the old user and invitation endpoints go with it. Learning keeps receiving the copy for as long as Learning stays on (Q3), so it doesn't break.

## 7. Questions for the user (taste and demo calls, also on the page)

1. What a brand-new administrator sees first: Home with a setup guide (recommended), a full-screen wizard, or a sample company to explore first.
2. Whether every employee gets a people directory (recommended, with the fields the company chooses).
3. What happens to Learning, Recruitment, Onboarding and Interview in the tenant (recommended: shown only when the company has them on; demo tenants off; joining checklists replace Onboarding).
4. Whether changes go through approval in the story (recommended: a manager proposes a promotion, HR approves).
5. Which hero to make shine first.

## 8. Sources

- BambooHR, [100+ ways to customize BambooHR](https://www.bamboohr.com/resources/guides/100-ways-to-customize-bamboohr) (custom fields, tabs and tables, access levels, approval paths, logo and colour, job levels and pay bands, onboarding packets); [custom access levels](https://bamboohr.screenstepslive.com/m/53910/l/1975476-custom-access-levels-what-this-access-level-can-do).
- HiBob API docs: [categories and permissions](https://apidocs.hibob.com/docs/categories-and-permissions.md), [employee lifecycle](https://apidocs.hibob.com/reference/get_people-id-lifecycle); [workforce planning](https://www.hibob.com/product-briefs/workforce-planning/) and [its API](https://apidocs.hibob.com/docs/explore-workforce-planning); [mobile and home feed](https://www.hibob.com/product-briefs/mobile-app/).
- Personio support: [onboarding and offboarding workflows](https://support.personio.de/hc/en-us/articles/115002529589-Create-onboarding-and-offboarding-workflows), [setup experience and widget](https://support.personio.de/hc/en-us/articles/18777547672349-Overview-of-the-setup-experience-and-setup-widget), [access and approvals](https://support.personio.de/hc/en-us/articles/21501960338461-Implement-access-and-approvals), [employee data change approvals](https://support.personio.de/hc/en-us/articles/21453114449053-Set-up-employee-data-change-approval-workflows).
- Rippling, [platform tiers](https://rippling.com/rippling-platform-tiers) (employee graph, supergroups, custom fields, Workflow Studio).
- Workday Education, [staffing models](https://doc.workday.com/workday-education/en-us/course-manuals/hcm-core-for-administrators/staffing-models.html) (job vs position management).
- Lattice, [a new era in HRIS](https://lattice.com/blog/a-new-era-in-hris-redefining-the-employee-experience); [HCM Technology Report on the launch](https://www.hcmtechnologyreport.com/lattice-unveils-hris-to-connect-employee-programs-with-data/).
- ChartHop, [headcount planning](https://www.charthop.com/platform/headcount-planning), [scenarios](https://www.charthop.com/resources/blog/best-practices/scenarios-getting-started), [AI for headcount planning](https://www.charthop.com/resource/ai-headcount-planning).
- Flatfile, [mapping](https://flatfile.com/product/mapping/).
- First-run patterns: [HelpHero, SaaS onboarding](https://helphero.co/blog/saas-onboarding/), [SaaS UI onboarding examples](https://www.saasui.design/blog/saas-onboarding-ux-examples).
