# B-331 — Walkthrough route

A new company from its first minute, through the shell at http://localhost:3000 (mail at http://localhost:8025). The agent says the next step, the user drives, notes become Ready children of B-331 (product calls go to Needs discussion). Nothing is fixed mid-walk unless the user says so. The **Demo?** column is filled in with the user as we go.

Company: "Carthage Digital · Walkthrough 202611082348", Performance on. Cast (fictional): Amira Khelifi, the administrator; Mariam Gharbi, a manager (VP Product); Aicha Bouazizi, an employee on Mariam's team. Mariam and Aicha only get accounts when Amira invites them (part 4).

## 1. Amira accepts the invitation
| # | Who / where | Do | Should happen | Shows | Demo? |
|---|---|---|---|---|---|
| 1.1 | Amira · the link from her invitation email (Mailpit) | Open it | The invitation page in the company's frame, her name and company filled in | Invitation pages in the company's frame (B-205), branded email (B-204) | |
| 1.2 | same | Set a password (the usual local one) | Account active, signed in | Activation (B-188) | |
| 1.3 | same | Answer "Do you work here?" with yes | She becomes the company's first person, linked to her account | First person on day one (B-188) | |

## 2. Day one: Home and the setup guide
| # | Who / where | Do | Should happen | Shows | Demo? |
|---|---|---|---|---|---|
| 2.1 | Amira · Home | Look around | Setup guide: 5 steps (Your company, Your organization and your people, Invite your people, Choose who does what, Start Performance), progress bar, drop zone for spreadsheets | Home on day one (D-09, B-188), Home cards (B-247/B-248) | |
| 2.2 | Amira · Home → step 1 "Make it yours" (`/core/settings/brand`) | Logo, colour, languages | Brand applies across the frame; the guide ticks step 1 | Brand studio (B-176), branded sign-in (B-210) | |
| 2.3 | Amira · company card on Home | Check work week | Work-week chips | Authoritative work week (B-247, B-278) | |

## 3. Organization and people
| # | Who / where | Do | Should happen | Shows | Demo? |
|---|---|---|---|---|---|
| 3.1 | Amira · Home drop zone or step 2 "Bring them in" | Drop `carthage-organization.xlsx` + `carthage-workforce.xlsx` (in `.local-docs/agents/data/`) | One import reads both files, matches columns (AI assists), Upload → Match → Review | One import for both files (B-186), semantic matching | |
| 3.2 | Amira · import Review (`/core/import/{id}`) | Read the review, publish | ~40 units, ~100 people, reporting lines; Amira's own record matched (watch: she was made on day one, the file has her too) and the earlier-start offer | Review and publish (B-186, B-246) | |
| 3.3 | Amira · `/core/organization`, `/core/org-chart` | Browse units, jobs, places; open the org chart | Units with leads, open roles, org chart cards, expand/collapse | Organization in time (B-183), org chart (B-094), open roles (B-128), Places table (B-201) | |
| 3.4 | Amira · `/core/people`, a person page | Search, filter, open Mariam Gharbi, the manager | Directory; person page with band, glance row, tabs | People (B-182), person page (B-180, B-289/290), top bar search (B-211) | |
| 3.5 | Alternative by hand · `/core/people/add` | Add one person into an open role | The record before it exists, first day and team beside it | Add a person (B-239, B-312) | |

## 4. Invitations
| # | Who / where | Do | Should happen | Shows | Demo? |
|---|---|---|---|---|---|
| 4.1 | Amira · step 3 "Invite people" (`/core/people?invite=1`) | Invite Mariam Gharbi, the manager, and Aicha Bouazizi, the employee | Invitations sent, tracked on People; withdrawable | Workforce invitations (B-182, B-235) | |
| 4.2 | Mariam · her email in Mailpit (another browser profile or private window) | Accept, set password | Lands on her Home as a manager: her team, first-week card | Manager Home (B-248) | |
| 4.3 | Aicha · same | Accept, set password | Employee Home, her profile | Employee Home, `/core/profile` | |

## 5. Roles and administration
| # | Who / where | Do | Should happen | Shows | Demo? |
|---|---|---|---|---|---|
| 5.1 | Amira · step 4 "Choose roles" (`/core/settings/roles`) | Open HR / Manager roles; who holds them by rule; give someone HR | Areas and holders recomputed from Core HR; "their unit" reach | Roles (B-177), their unit (B-212), administrators (B-178) | |
| 5.2 | Amira · Settings (`/core/settings`) | Glance: employee fields, lists, approvals, checklists, sign-in, notifications | Each section works | Fields (B-181), lists/catalog (B-175), single sign-on (B-191) | |

## 6. Day to day
| # | Who / where | Do | Should happen | Shows | Demo? |
|---|---|---|---|---|---|
| 6.1 | Amira · a person's ⋯ → Make a change | Change Aicha's job or manager, dated | Change panel, effective date, approval if set | Change records + one panel (B-139, B-179) | |
| 6.2 | Mariam · her team | Request a change for Aicha | Goes to approval; Amira sees it | Change requests (B-179), team (B-185) | |
| 6.3 | Amira · a person's ⋯ → On leave | Put someone on leave | Shown wherever they appear; Mariam hears about it; ends into Job › History | On leave (B-229, B-315, B-316) | |
| 6.4 | Amira · `/core/changes` | Change history | Every change, role grants, brand saves; greyed with reason under View as | Change history (B-109, B-203, B-314, B-220) | |
| 6.5 | Amira · Person › Access › History | | Sign-ins and access changes | Access history (B-231) | |
| 6.6 | Amira · `/core/reports`, Core HR front page | Open a report, change the date, export | Dated snapshots, Replay, front page headcounts and Next 30 days | Reports (B-189), front page (B-190, D-30) | |
| 6.7 | Amira · joiner/leaver | End someone's employment | Leaving flows through to the org chart and reports | Joining and leaving (B-184) | |

## 7. Performance, from setup to reviews
| # | Who / where | Do | Should happen | Shows | Demo? |
|---|---|---|---|---|---|
| 7.1 | Amira · step 5 "Start a cycle" (`/performance/cycle/setup`) | Details → Population → Review → Launch | Guided cycle setup; population from Core HR | Cycle setup (slice 1) | |
| 7.2 | Amira · `/performance/goals` | Publish an organization objective | Draft → Published by the scope owner | Org objectives | |
| 7.3 | Aicha · `/performance/plan` | Draft her plan: goals, development goal, AI coach; put it forward | Plan draft, alignment to org objectives | My Plan, AI coach + alignment map (slice 2) | |
| 7.4 | Mariam · `/performance/team` → Aicha's plan | Approve it | Plan approved; Aicha sees progress rows | Reviewer plan, roster (slices 2, 6) | |
| 7.5 | Aicha · plan | Check in on progress | Check-in status | Check-ins (slice 2a) | |
| 7.6 | Mariam + Aicha · `/performance/one-on-ones`, `/performance/feedback` | Schedule a 1:1, give praise, request feedback | Series, agenda, feedback requests | Conversations (slice 3) | |
| 7.7 | Amira · `/performance/reviews/rounds/new` | Open a review round | Self, manager and peer reviews issued | Reviews (slice 4) | |
| 7.8 | Aicha, then Mariam · `/performance/reviews` | Self review, then manager review | Ratings, items as boxes | Reviews | |
| 7.9 | Amira · round → Calibration | Calibrate | Distribution, adjust, close | Calibration (slice 5) | |
| 7.10 | Amira / Mariam · Performance Overview, Team, Insights | Read | Phase-aware overview, team progress | Overview/team/insights (slice 6) | |

## Notes
The user's words as spoken, per step; the board items under B-331 are drawn from these. When mapping out changes, check the items against this text.

### 1.1 Amira's invitation email (2026-11-09) → B-332
> It's the brand of Fusion, literally, like something that could affect everything in terms of branding, like what I'm looking at right now, the template for the email, I mean, and for a bunch of other stuff I'm sure you could agree with. We should agree on a logo, we should agree on a bunch of things. So that whole discussion should be noted down. (Broad scope, could relate to the Fusion landing page.)

### 1.2 Invitation page → B-333, B-334, B-335, B-336
> I don't like very much the UI that we select from if we're working here or we're just setting it up. So I think that UI could be simplified to a more cleaner, more friendlier UI choice. And a more compact one at that.

> When I select no, I'm setting it up for them, we have no "your job title" field, which is okay, makes sense. The job title field appears only when I click yes, I work here. Well, for some reason, that little jitter when the job title appears, of course it will affect the flow of the UI and elements, but it also affects the left column where we display the title of the company and its logo. Those flows should be independent.

> I also think the left card or the left column of this whole page could be improved, especially the icon or the logo slash the title bit, especially that logo bit. I think the background looks empty and boring, maybe a stock image or better patterns will help here. I also don't like how plain "fusion" is but I guess that's related to the fusion brand thing maybe idk.

> There's slight problems with the right column too. In terms of the coloring, it's kind of weird, to be honest. That pitch black background with pitch black fields that sometimes change, sometimes not. The whole size of the page that they have to scroll through or just zoom out. It's not a big deal, but I think could be polished.

### 2 Home on day one, Brand → B-337 to B-347
> Now I'm routed into the root, `/`. Right off the bat, I can see that this page skeleton is not really relevant for its content, so that might be polished too. (B-337)

> The top bar of the application where we have the search, notification, etc. I think it would be a cool thing to add maybe the user avatar there with a menu. We can discuss whatever you think is relevant to that menu. Unless you think the answer is pretty intuitive, then yeah, you could build that right off the bat. Maybe and maybe not, the flow of the items on that top bar will change due to this effect, considering all things and all states of this top bar. (B-338)

> First thing I did was click on edit company, and again the skeleton here is not relevant whatsoever to the contents of the /brand thing. (B-339)

> Also felt a little confusing, not a big deal: when routed to the brand section, all of a sudden our sidebar is filled, and it's unclear that we routed inside Core HR. (B-340)

> Most importantly for visual things like the home and the preview part of the brand, the preview in general, I think it should be more curated to more visually pleasing views and not necessarily accurate to the current state of the company. If this company is empty and we display the preview, for example the home page, we shouldn't replicate its emptiness while the user changes its branding. We should give them even fake stuff, which is obviously fake. We're not trying to deceive anybody, but it will give them an idea how different components would look for this new branding. (B-341)

> We should lose all em dashes from everywhere. What triggered this is the browser tab title, which contained one, which is bad. You don't want that, or any giveaway of vibe-coded AI slop. (B-347)

> We should probably reuse the profile image editor for the company logo too, because I just set an image which needed some cropping, some movement, and I expected it, but it didn't show up, so the image was set as it was. (B-342)

> Now that I put my logo and changed some stuff, it's really not intuitive that I should go back to setting up the company. I'm just gonna click the return button on the browser, which is kind of awkward. I could click back to home, but my point is it's not intuitive; there's nothing calling me to continue my setup. That might be part of the onboarding or tour feature. (B-343)

> I don't like very much that this home by default from creation shows me that my company is checked, done. (B-344)

> The not obvious edit buttons, like "edit your company" and "edit", could use some polishing. A very minor thing. (B-345)

> At the choose files step: the two column design here feels awkward. The little almost-square column with a bunch of dead space under it at the right, with the logo and name, and then the big left column. Each one on its own looks okay, the left one especially looks good, but together as a page they look sloppy, so that needs figuring out. (B-346)

### 3.1 Before choosing files → B-348, B-349, B-350
> It could be clearer what the user needs to do before uploading something here. Do we require a minimum of things, at least for him to know how to prepare these files? Or do we not? And should this be included at base, or is it part of the onboarding / tour feature that's to come? (B-348)

> It's intuitive for me as a user to try "add the first unit", the by-hand method, or as a demoer, which I will mainly be, to showcase that possibility. The design, UI and feel of that manual approach altogether looks weak. I understand it's supposed to be secondary, but it still looks bad. I don't know if "add the first unit" is the right terminology, because technically we could add the whole company manually. (B-349)

> Isn't that routing us to the same page we'll eventually land on after the file approach? Then it would be redundant to showcase the manual approach here, especially since we're routed to a whole new page that we'd land on anyway. So my guess is to go through the files first and then land there. (Demo order: import first, by hand shown later on the filled pages.)

> What should I expect from these files? Are they going to showcase everything in terms of demoability? Not just curated to work with no realistic flow, because what would be the point. I'm guessing they trigger the AI and the realistic workflow an administrator would go through, while staying quick and streamlined for the demo. (B-350)

### 3.1 Reading, then What Fusion understood → B-351 to B-360
> It says it's reading two spreadsheets. The little loading bar is bad. That loading state in the home section needs to be polished. (B-351)

> Then it suddenly takes us to another page, the "What Fusion understood" page. Right off the bat, again, the skeleton needs to be polished to be more relevant to its content. (B-353)

> More importantly, this page is a little sloppy. It's not really clear what I should be doing and what I should be clicking and if I should click anything. It is all over the place a little bit. I'm looking at both files separately here, but it's not clear what the meaning is inside of these. We have buttons to click, and I don't know what each does. Is "unit code" going to map something, or is it already mapped? I have no clue. (B-355)

> The page header is also sloppy, showing both files there; could be either compacted or cleaned up. Maybe the page title could have more weight and convey the message we want to convey here. The buttons at the right of the header are all over the place. We have 4 things to look at: a disabled CTA "Show the changes", which I don't know what that even means; an "Add files" button, weird; "Start over" as plain text right there looks weird; and that "one question" too looks bad. My instinct is to display what matters and find a better way to show the other options, like maybe Start over is just an icon button with a start-over icon. Maybe you could find other solutions for the rest. (B-354)

> The sections themselves are sloppy as hell, so vibe coded, so AI slop. That little file icon with a file title is just bad. And it's not clear what I should be doing, even regardless of the section header. (B-352, B-356)

> This import has one question, related to job level, and that ugly exclamation icon wants me to do something about job level. The view is very limited for these sections, the data tables; no option to view more of the items I uploaded, just a 3-row section. (B-356)

> The question is unclear; it says different stuff all over the place. I think it's asking whether Grade is the job's level, but I had to really focus to understand that. Not intuitive. There's also that ugly two-option thing with "Yes, job level · Fusion's lean", which makes no sense for the user, and then "Leave it out". I chose yes. (B-357)

> There's a note at the bottom of the people section saying "3 people who have left". I have no clue what that means. (B-358)

> Now the "Show the changes" CTA is lit up and I can click it, and I still have no clue what it could mean. From the developer's POV I know it probably takes me to the org chart, but from a user's point of view, I have no clue. (B-359)

> The last section of this page is "Across the files", and again this looks straight out of a ChatGPT UI. It's horrendous, it's embarrassing, and the whole page does that. Functionally, yes, it's working, but it could only be called clean in quotes. It's straight out of AI slop concepts. It's not following anything I've said about BambooHR-like friendliness and cleanliness. (B-352, B-360)

### 3.2 Review → B-359, B-362 to B-368
> It didn't take me to the org chart. I thought it would, because there was a link in the "Across the files" section at the bottom which says org chart something. So it's another step of the importing process. (B-359)

> Again, same things, ugly all over. First thing I notice is how ugly the header is, especially that yellowish "X questions" beside the call to action, and the badges under the page title. And the page title itself is one of the files' CSV titles: "Carthage Departments.csv", and under it three badges, the two files from the other step and another badge saying "matched by work email". This doesn't make any sense, from a design, user experience and interface point of view. (B-362)

> The main content has two columns. On the right, a bunch of scattered cards: a whole card for "changes apply from", a date picker I guess; the check that says someone has two start dates, which is the HR admin we're logged in as. It keeps saying "Fusion's lean", as if that would make any sense to the user or to the demo audience. Feels like something I'd have to explain. Again, ugliest content, ugliest icons for these cards, the check, the exclamation. Functionally it might make sense, but the way we lay out and present this information is bad, ugly, basic, and it feels awkward. (B-363, B-368)

> On the left column, where we display the people, the section is titled with the department CSV. I have no clue what's going on here, but it says "New 99" in the section title. It shows each person with their department and date information, and everything says "Starts <date> · <name>'s team"; everything looks exactly the same no matter what the data means. I don't know if "starts" means in the future, or it doesn't care about future or past. Just spending a little time trying to understand this is confusing. (B-364)

> We loaded all 99 rows at once. My page is two miles long, and at the end there's another subsection, "Changed 1": the administrator's job changed, because when I created the account I put a random job to get in, and it changed here. I don't have a problem with that particular UI. It works. (B-365)

> Also a bug: choosing something that adds a new unit messes up the options. If I pick "add PGC" as a new unit, which is Fusion's lean, the card loads and shows the "add PGC new unit" option selected, but then also another, unselected option, "PGC · Fusion's lean · closest", which makes absolutely no sense. (B-366)

> The "Bring in 100 changes" CTA, whatever that means, is now lit up, so I can click it. (B-367)

### 3.3 Bringing in, then done → B-352, B-370
> The initial loading thing is good UI. Maybe the bubbles need to be a bit bigger, more interactive, more animation, more life in how they appear and float. The numbers could follow, a bit bigger, more centralized. The title is good, but there's an ugly line above it with the ugly checkmark thing, trying to convey metadata about the date and the files uploaded; the design choice is bad. The main section about the progress and the finished numbers is good. Could be polished, definitely could be more central to a wow factor.

> Once the loading finishes, two more sections appear. "Next, invite your people", showing my progress in the onboarding phase, I guess, and under it "Worth a look". Again generic AI-slop UI, "left out for things you decided instead of the files", which makes absolutely no sense. That whole section is bad.

> The background of the sections isn't consistent. I like the one used for the main section with the information and animations, but then the background slightly lightens up for some reason, in dark mode. In light mode it's the opposite, we want the other one even for the big section. I guess this is a general design flaw, not specific to this page. (B-370)

> As a user here I have nothing to do except view the little animation and see what's next. Two buttons, one looks more important, and that's it. I guess it's to showcase the finalization, but if we're going to dedicate it to that, why not maximize the visuals?

> (After the agent's proposal: the org chart lives on the done page as an interactive preview, the only call to action is Invite your people.) Yeah, exactly. But we'll discuss the details later. We're probably going to generate a bunch of artifacts for these brain dumps in general.

### 3.4 Organization → B-371, B-372, B-373, B-347
> At the org chart, as usual, a bad skeleton loading page. Getting past that, the header and the actions are not bad. But we allow adding a unit, import structure, export structure, manage unit types; switching to People, none of those actions exist anymore, even though in onboarding and importing we treat both the same way. We imported structure, we imported people, but now we don't provide the same actions, which is weird.

> Performance issue when I slide the Replay slider: Next.js is apparently loading something, and it shows after about 10 seconds. This absolutely needs to be optimized; the replay and timeline should be way smoother, real time, just like we agreed. The org chart needs to be optimized in navigation too. Navigating with drag and drop sometimes lags and sometimes acts weird. And maybe a subtle small grid-like background on the chart, just for feel.

> The default for an HR admin, or people who have nobody around or under them, should be the whole company view.

> The chart viewer should be taller, filling my view of the content area (not the sidebar).

> I moved somebody under someone else with drag and drop. It lagged a bit, but worked, and showed the Make a change component. The component looks clean. For the description, get rid of the example entirely and just leave "Describe it". In Reports to, the manager select is nice, but misaligned as a whole: the select's padding pushes the avatar and name in from the sides, so it doesn't align. (B-372)

> Saving the change shows the people before the change for a second, then updates to the new hierarchy, which looks awkward.

> The little badges at the bottom left of the chart are good, nice, functional. One polish: when selecting a population from these filters, the chart should respond with zoom and pan to focus on the selection.

> Structure weirdly defaults to a compacted version. For large companies that might be a good idea, but we don't want to display just 4 or 5. Decide what makes sense: a good amount without overwhelming. It does include the top levels, so maybe it's not too bad as is.

> The People chart's drag and drop could show the card moving in real time like Structure does, staying performant. And the other way around: Structure's compacting and expanding is jittery and awkward, reuse People's.

> Both chart headers (search and filters) should follow the same structure, search on the left. The search should be as specialized as the one in the application header; no expanding animation, one fixed good search for each. Maybe make them blend into each other, go from Structure to People and back seamlessly. In general we like the People chart better (the controls, the badges at the bottom left, the links), so rework Structure to reuse that system.

> The List view is straightforward. It should follow the same things: enable drag and drop and the necessary functionality, and reuse the org chart's header.

> I tried to rename the root entity, which you named randomly, and got "The permanent root cannot be moved, retyped, or inactivated." If renaming is a lot of headache, keep it that way. Doesn't matter.

> We use different systems for the details of entities: selecting a person shows a different design than a unit. Unify into one; the one I like most is the Make a change template. Migrate all of them to it, as part of reusing the People chart. (B-373)

> One common thing I keep seeing that's so AI-slop vibe-coded: "100 people · 42 units", "100 people · 2 divisions", wherever. It could be anything, and not only two, a bunch of things. I hate this UI. It's lazy, stale. There are many better ways to show information, if it's needed at all. (B-347)

> The Plan section: I understand it's for planning future changes in the chart. In this state it's bad and ugly: a wide empty block with a title and a two-word subtitle; the empty state is horrendous, embarrassing. I don't have a design in mind, but this is not it. After planning one move, it doesn't look bad. It's largely empty on the right side of the row. It's unintuitive that I can click it, except, since this is AI slop, we do everything in text: a subtitle on the right says "Open one to see on the org chart", where it could be conveyed through a clean UI. The row conveys the information, but the dead space is horrendous; it needs redesign and polish.

### 4.1 Getting to invitations, People, the Invite drawer → B-374, B-375, B-371, B-337
> From the org chart, it is unintuitive how I should get to inviting people. We are completely separated from the onboarding process. When you said invite these two people, I searched for Mariam in the chart, and my instinct was to select her and invite her if she's not invited. We don't have anything like that. So my only option is the browser's back button. From the user's POV I'll pretend I didn't stumble on the org chart, or click Back. I'm back at the import's done page and click "Invite your people". (B-371, B-337)

> I'm routed to /people?invite=1 with a drawer open by default. The drawer's header is horrendous: the same slop icon, default font title, looks bad.

> The rest of the drawer: "Who" is good, I can invite everyone, managers first, or choose. The radio choice UI is still bad; we can aim for cleaner, more pleasing designs. The custom "find a person" is good, it could be better as a select. We have a people select somewhere that displays a bunch of information; use it so we can select multiple and the selection is obvious. Now it only displays the name and avatar, and it's not even a select, it's a hard-placed element. It could very much be a combo box, cleanly designed.

> The "When" section is a wide row for a little two-tab switch. The dead space on the right gets filled with the date picker when I choose Later, but it's still not very good.

> The next section's title makes no sense, absolutely none. And the titles here look bad, they don't follow the formatting and font sizes. I don't know what "Invite joiners on their first day" means. Invite them to what? Aren't we doing the invites now? "Remind people after 3 days" makes sense, but I don't know what the reminder is. Another email? No clue.

> Then the email itself, shown as an example. This choice is nice, we do want to show how the invite will look. But the things around it are bad.

> Before inviting anyone I closed the drawer to look at the people. I guess that's what the user actually wants by default: not the mysterious drawer, but to see the people he just imported, assuming he didn't look at them in the org chart, or wants to see them in a new light. We should default to the cards view instead of the table.

> The table in itself is good. The search could be reused the same way I mentioned for the org chart. The filters are good; we've used them throughout the rework, they're clean and super good. One small UI bug: on hover their background changes, but the background's radius is independent of the border's radius. (B-375)

> The ugliest thing on this page is the tabs above the table. They have no business being there at all. The filters could do much of that work, if not all. Then even the card view can reuse the same filter and search as the table, with no need for those tabs: a clean reusable UI, even at the code level.

> In case the functionality stays the same after the UI is fixed: when nobody matches, the empty UI is bad. Selecting "Starting soon", nobody matches, and we get an awkwardly sized box with grey text in the middle, "Nobody is starting soon". Minor, but annoying, and inconsistent with the clean UI we're aiming for.

> As the user, I'm inclined to invite everyone. But we have to put the developer glasses on from time to time in this walkthrough to test things, so I'm with you in first inviting a few.

> I invited those two. As soon as the drawer auto-closes, I have nothing meaningful to see my changes taking place or not. If the people I just invited aren't luckily displayed on the first page, I have to scroll through the pages or search for them manually. The table sorting doesn't work for all of the columns, especially Sign-in, so I can't sort by the state of their sign-in. Here I can luckily see Aicha in the second row, "Invited today". (B-374)

### 4.2 Mariam accepts → B-333
> The accept invitation screen looks similar to the other one with some changes. This one's sizing matches my screen, so I don't have to scroll, and it would be nice not to exceed this in the other variations of the screen. We've noted a lot about this screen already. I created my password and activated the account, and I think we landed on her profile.

### 4.2 Mariam's profile → B-377, B-370, B-376, B-347
> The profile at a glance doesn't look bad. One thing with the app themes: in light mode our colours are all over the place. The background is too grey, a dark white. The background used for the profile's hero section in light mode may suit the application's body colour in light mode, then slightly different colours for the sections. Right now it's a bit of a clown show. That needs to be unified across the applications, at least in light mode, then the same for dark mode. (B-370)

> The right content of the page: About, Performance, Job and history. I don't know if there are others in other states, but focus on these. Their titles should be in the same serif font family; the content stays non-serif. Anything written by the users and not part of the application by default, like the About content, should be in quotes and in the Fusion serif.

> We need to handle empty states better. Right now they're usually bad and ugly. About is the least bad; Performance is plain boring. It just says words: no cycle, no review, no released results. Greyed-out text. It looks bad. (B-376)

> Job and history looks fine. Some generic icons, but at least some accent colour; fine overall. But I don't know what you meant by "the whole story". I guess it links to the Job tab. Don't do that. Straight to the point, no fluffy terminology. We're trying to convey information and fix ugly UI; confusing terminology is the last thing we want. (B-347)

> The left sidebar: direct reports is fine. The "+X more" should be interactive and load more people. The rest could be polished, less plain and boring: how we show the hire date, the generic email and place icons. Those look fine I guess; the sidebar is generally fine.

> The Job tab is a good one. But the Job section: either fit them all on one row or make a grid and vary the sizes. Go out of the comfort zone; right now we show three things, then wrap and show one, with dead space. Lay the information out more cleanly to fit. Employment and History look fine, leave them. Personal can pass as it is, beyond the general section notes. Same for Performance.

> The hero section of the profile is good. It conveys what it needs to. I like it.

> Uploading a picture: the modal that appears on the camera icon is good, nice, clean. My first image was refused: "choose an image up to 5 MB". Maybe allow 8 or 10 MB, a very minor thing. The little editor looks phenomenal. Saving works cleanly. We lost the ring the pictureless avatar had; include it with a photo too. Not sure about its colour; start with the accent, or lay a foundation for online/offline status, or status in general. That would be a good addition.

> In dark mode the change-picture button is see-through, unlike light mode. We like it as it is in light mode.

### 4.2 Mariam's Home → B-378
> I'm at Home as Mariam, and this page is one of the ugliest and most boring so far. I understand it's a fresh manager account, but this is horrendously empty. An empty "Needs you", boring cards all over, boring empty stuff all over. I'm embarrassed to showcase this. I don't know the direction I'm going to take it in, but in its current state it's unacceptable. Even filled with "Coming up" and "Needs you" items, it'll be generic slop, boring and bad. Not something I'm proud of showing. It needs to be rethought: why we'd use it, where people come here from, why we need it and what goes here. From there we see whether that information is worth changing, increasing or reformulating, and decide on a new UI or incorporating it into a new page or whatever.

### 5.1 Back at Amira's Home, then Roles → B-378, B-379, B-380
> Back at Home. I know I mentioned this, but with the rest of the walkthrough it keeps making sense. I already criticised this design, the layout especially: stranded cards, empty spaces. It all follows the same structure. Amira's Home might be more crowded with more content, but it's still Home, and for employees and managers it's even uglier, to a horrendous level. So clearly there is a foundational, fundamental problem here. (B-378)

> The clear call to action is step 4, "Choose who does what", with "Choose roles". I click it and land on Roles. Again, almost every surface has a wrong or buggy loading skeleton, at least on first load. (B-379)

> At first glance this page looks good enough. There's an empty giant cell at the top left, which should at least explain what the first row (the row names) and the first column are, instead of being empty. And maybe a legend somewhere could explain what the content means. At least this surface looks good enough. (B-380)

### 5.1 The Manager role → B-380, B-381
> This page functionally does what it's supposed to. Very good functionally, but design-wise it's lacking. Again a two-column design. Not bad by design, but the way we incorporate it is sometimes god-awful. The first section, "Who has it": functionally it makes sense, but the design choices are horrendous. A stranded select, "Anyone with a team". Also stranded, a huge empty space and then "+ Person", which makes sense functionally. These functions are good, but this UI doesn't make sense. It's so confusing. Then a horizontal line with one person, "1 of 1". The rule doesn't make any sense. "Show them"; we click, and "Hide them", for whatever reason.

> Then "What managers can do", which is fine, it's good. I especially like that the selects are built into the sentences. But why the empty space? Why is the whole right side of this card nothing? This is what I mean by fundamentally bad design choices. We make bad decisions for layouts, we rush things, then brute force and try to make the design work, which is fundamentally flawed.

> Another broad note: some pages have back buttons (this one has "back to Roles") and some don't, and we also have breadcrumbs in the top bar. We need to decide on one broad system that handles navigation, from breadcrumbs to back buttons, once and for all for the whole platform. (B-381)

> By default HR has 0, even Amira isn't there. So I'm choosing Amira and giving her HR. And Amira doesn't even have administrator privileges, so I don't know who does. (Data: Amira holds Administrators; the page doesn't make it visible. B-380)

> I gave Amira HR and it logged me out to the "You've been signed out" page, which looks nice, apart from what we discussed about that page template. It doesn't sign me out directly; there's some clunkiness. I tried to go back to Roles, but I got signed out. I saw the email: "you were given the HR role". Signing in as Amira again, I land where I left off, on Roles. (B-380)

> The Administrators page shows Amira with the option to add a second administrator. This page has good UI, especially the first section, Who. I like how clean Amira's card is, how clean the empty card for the second administrator is, how clear the call to action is. The rest is bad. History is history, logs are what they are, but is it really necessary as a whole card? This page is again two columns: all this is in the left column, and the right column is empty. Content spans roughly 70% of the screen for no apparent reason. Maybe adding another administrator fills the right column, so I added Mariam. Nothing changed in the right column, still empty. Now with two administrators there's a third card, the empty one to add another, and I don't like defaulting to a two-column grid where that empty card takes one cell and leaves dead space in the last one. (B-380)

> Mariam doesn't appear with the picture I assigned to her here, just the avatar. I guess the avatar is hard-coded regardless of whether there's a picture in some of these areas. Another thing to look out for. (B-382)

### 6.1 A dated change for Aicha → B-372
> It works. One note: it should be more intuitive what "Describe it" does, without more descriptions and more words in the field. Maybe hints that AI is used here. You used a subtle thing, which is good: when the changes are filled in, there's a little sparkle beside the field titles. That's good. But we need to let the user know what they're waiting for. I like the spinner on the description, it means something is happening, but we don't know what.

> This drawer is reused in the org chart, right? That's a good approach. One note: the repeated edit icons beside the fields. Use another icon; that one is bad and ugly.

> I don't know the exact workflow the AI uses to interpret descriptions, but it shouldn't rely on keywords, or on the user remembering the exact job titles, places, employment types, etc. It should be smarter: interpret what the user probably means. The user has the last word anyway, so it doesn't matter if the AI gets it wrong.

> "Leave without a manager" shouldn't be on a separate row by itself. It should probably sit on the same row as the section title "Reports to", at the far right.

> Making these changes, apparently I can't click the call to action unless I select the manager. Aicha has a manager, Mariam, but for some reason she isn't selected by default; I have to select her again. Oh, Reports to is already showing the manager. So what am I supposed to do here? Change the manager with the select? I don't understand what this Reports to is. It's the same drawer used for the org chart, but I'm confused about what this is.

> It's confusing. It definitely needs polishing and fixing. I can't keep Mariam as the manager; I have to choose another one. So I chose another one, and only then did the call to action light up and let me save. Then Aicha's row in People says "moves 9 November", which is nice. I can hear a notification sound in my open Aicha tab.

> Still as Amira, I opened Aicha's profile. I can see the change in "coming up" in the profile's content, which looks good. The change card doesn't show every change we chose, but it recorded the manager change. I have two things I can do: edit or cancel the change. Both buttons need to be rethought design-wise, cleaner and better. And it would be nice not to go to the date manually: click the change and be taken to that date automatically.

> I went to ⋯ and 9 November, which is today actually, but the change didn't show as in effect. Maybe at the end of the day it will. 10 November works.

> I tried to move it to a later date. Edit has the same problem: the call to action is greyed out and I can't tell what's wrong. I had to change the manager again for it to light up. Also, the edit UI changes slightly, I don't know why. It should be the same as creating, keep the AI integration, behave the same on top of everything editing-related. I scheduled it for 11 November, switched to 11 November in "see it on another date", and it works.

(Agent: the company has no "Senior QA Automation Engineer" job, so the drafted promotion had nothing to set; the button stayed grey with no reason.)

> I cancelled the change, but I can't remove Mariam as an administrator. There's a little description: "A company keeps at least two administrators. Add another first." We've literally established that a company needs at least 1. I should be able to run the company with 1 administrator. (B-380)

> I can't even assign roles to people unless they've accepted their invites. So for now it's only Aicha, because Mariam is already an administrator. And I don't think "add an administrator" deserves a whole drawer. It could be a modal or a pop-up, a more polished one. (B-380)

> In People, the table at least, we aren't displaying people's positions. That seems so weird. (B-374)

> I couldn't send an invitation from Sami's profile. I had to do it from the action menu in the table. I tried the cards, but the card opens Outlook. Sure, day to day it helps to find and email people. But the same icon for both seems weird. Change the invitation icon throughout the application to something that resembles less "we're going to email this person" and conveys more "inviting to the application". (B-374)

### 6.2 Mariam's Team → B-383, B-378
> Looking at this, we could very much merge My Team into Home, right? At a glance it looks better, and it could make more sense once we incorporate everything Home has to do into this surface. Maybe some things on Home don't need to be on My Team. My Home is definitely bad. My Team isn't perfect, it needs work, but at a glance it looks better; with some polish it would look even better. (B-378)

> I like the hero section. This design is what I like: that clear title, the clean UI with the cards. The clear call to action could be clearer: "Give praise" should be in the brand's theme colour. I like the tabs, but tabs like these, here and on the profile page, should each have an icon for the tab. That would be a lot better.

> Scrolling down, it degrades. "Coming up" looks cut off because it has almost no items. The left sidebar is lacking, basic and boring, in contrast with the hero. The hero looks great and clean; polish it a bit more, like I said, with hover effects on the team members I hover over.

> The team org chart looks fantastic. I'm assuming it will reuse the fixes we make to the main org chart.

> The Performance tab is bugged, or maybe it's because we haven't started Performance, but the message is misleading: an empty card saying "No one reports to you" and a button "Go to overview", which is dumb.

### 6.2 Mariam proposes → B-372
> On Aicha's page as Mariam: I can edit her About section. In the menu: give feedback, show in org chart, see it on another date, copy link, set leave, propose a change; the rest probably the same as when I first described the profile page. (Agent: a manager editing someone's About fits the Managers role check under B-380.)

> Weirdly, this change doesn't require the manager or Reports to section. I can just schedule it for 1 December. It doesn't say anything about approval. I can straight up schedule it. (Agent: every approval type is off by default in a new company.)

### 6.3 Approvals → B-384
> I'm on changes and approvals. A bunch of checkboxes or toggles, and it's not clear what does what or who does what. Place says "waits for approval" now that it's on. At the bottom, a card left alone like that, titled "Who approves", with Amira and Sami. So we have these accounts that approve everything in the organization. Is that so?

### 6.4 Mariam proposes again → B-372
> Now there's a new section, "Amira or another approves", with a note "Your company approves place changes". The note looks good. I don't know how it would look with multiple things to approve. I hope it doesn't spam them; I hope it stays compact. And I can't send for approval even though the call to action is lit up, because of an error: "Aicha Bouazizi already has a change on 1 December. A new change has to come after it."

### 6.4 Amira approves → B-385
> From Amira's POV the bell rings, the notification arrives, I click it and I'm routed to the Changes page, which as an empty state looks empty. The same problem with the tabs, which look ugly and bad; a minor thing in the grand scheme. I can decline or approve. I hit approve, and we're back to the empty Waiting state, a vibe-coded slab design. Answered now contains that exact request.

### 6.5 Change history → B-386, B-381
> Routing between Settings and the modules has a weird effect, flickering into loading states, that needs to be addressed. A better design is to unify the whole sidebar into one thing that has everything, from the modules to their contents to the settings, so that first it looks like we have a lot of content and features, and second I don't have to route myself multiple times when I want to do something in a different module. (B-381)

> The change history is good. Everything is tagged. But this is also one of the ugliest pages we have, in every respect. (B-386)

> Park a note in the to-be-discussed feature of the RAG system and the AI assistant. Look at the "Describe it" in Make a change: it should be like that. I should be able to talk to this assistant, describe what I want, and it does it automatically. We'll discuss the details later, but that's the general idea. (B-147)

### 6.6 Set leave → B-372
> Setting leave for Aicha as Amira: for the From and Until dates, what are those badges for? They have preset dates on them, so what are they for?

> I also don't like two separate date pickers and two separate sections to say one simple thing: from when to when. One date range picker would do; there are shared shadcn-based components for it, in libraries like ReUI. These things exist; we could optimize this. Then there's the "Also changes" section under it, a bunch of text. Nobody's going to read that. What is this even? If something needs to be said, say it. If not, don't.

> Saving it from Amira's POV adds one more item to "Coming up". Mariam's bell rang (I thought it was Aicha's tab): she gets a notification and it links to her Team page. On Aicha's profile there's a new item, Annual leave. And in the hero of Team there's a little visual bug with overflow: some text spills out of the cards. (B-383)

> As far as I can see in the org chart, Aicha isn't any different. I don't even know if she should be from a business POV, but she isn't. (Agent: her leave starts later; she shows as on leave from its first day.)

> As Mariam, I can't use Replay on the People chart, but on Structure I can. I don't know what this is. (B-371)

> Trying my best to move through the laggy Replay, Aicha's card doesn't change even after 16 November. (Agent: the chart reads leave for today only. B-371)

### 6.7 Reports → B-387
> I tried changing the dates. It isn't intuitive how to restore the default state, the ready-made report's dates and filters. I have no clear way to restore the default dates, so I guess I click Headcount again, or I refresh. Also, changing the From date shouldn't disable the selected To date. Start and end should be independent in their states. This date range selector is completely bugged.

> I don't see a Replay button (Agent: my mistake, Replay is on Core HR's front page, not in Reports). And Share isn't clear: it isn't sharing a link, it's sharing with a role, for some reason. (B-387)

> I'm not sure about the whole Share thing. It's either clear, intuitive and useful, or not. Also, the important call to action, Save, should be the one on the right. (B-387)

### 6.8 Core HR's front page → B-388
> I went to the overview, the home of Core HR, I guess. I don't know if this is intended, but the chart is doing something with the timeline even though I'm just moving my cursor over it.

> The page looks fine, honestly. The next 30 days might be a little empty, with a little dead space on the right especially. But it ain't bad. What's bad is again the bottom cards, scattered, with bad empty states: Records to complete and Open roles. The good old card use, empty space and empty states problem, again and again. (B-388, B-376)

### 7.1 Cycle setup, Details → B-389
> Now we're getting to the work I did before we touched the Core HR rework. This first page isn't bad at all. The setup details page is something I'm proud of. It's good. It has its issues: we haven't escaped the little subtitles and icons that look like AI slop, on Cycle details, Timeline and At a glance. That should be polished. But it isn't bad per se.

> This calendar works as intended, unlike the Reports one, the bugged one. I put in the information and click Next. For a second it flickers and loads the same page, then on its own it goes to the next step, Population. (B-389)

### 7.1 Population → B-389, B-390, B-382
> At a glance, the same problem as before: defaulting to the avatar even when there's a picture. Otherwise not too bad. It could use the polish we're doing, but I'll leave that as a big note for later, a Performance UI/UX polish, if we have the time and deem it worth it. A separate thing for now. For this walkthrough, it makes sense. "All active employees" is selected by default, 8 need attention, so 92 in. We can deal with that in the table: filter Needs attention, select all, and exclude all, right?

> Clicking someone shows a drawer: eligibility, with "Reviewer resolved" set to an X, and that a valid manager is required. (Agent: the 8 are Sami, rightly without a manager, plus Amira and the six who report to her in the file, whose lines the import dropped. B-391)

> A little visual bug on the avatar in the table's Reviewer column: it isn't the same as the Employee column's. Those two should match. Copy whatever the employee has over to the reviewer, keeping the content relevant. (B-389)

### 7.1 Review → B-389
> Confirming doesn't take us to Review automatically; we have to click Continue by hand. We're shown a recap of the data, and I can launch the cycle.

> Launched and confirmed. We land on /performance/cycle, the cycle page. I don't know what this page should be or look like, but for now it's abysmal. We're not going to discuss it now, but it's abysmal. (B-389, B-390)

> From where I stand, nothing tells me what to do. To keep this straightforward, and maybe it's mostly a UX flaw, I'll go to that exact route by hand. (B-389)

### 7.2 Organization direction → B-390
> I don't think we can save this. This UI and the front end of the Performance module is absolute garbage. At least since the moment we clicked confirm on that cycle, it's been nothing but embarrassing. But I'll push through to see at least if the functionality is there.

> There's also a Direction field, beside unit, target and baseline. It doesn't make sense, it's useless: the baseline and the target should determine the direction. (B-390)

### 7.3 Aicha's plan → B-390
> I created the objective, but something weird just happened. This isn't the UI for the objective cards or the drawer that I left before we got busy with the Core HR rework. What happened to the work I'd done? (Agent: B-228, commit 0ec99d99 on 8 November, replaced them with rows and a drawer; accepted from a Feedback screen.)

> The AI stuff works in general, but I don't know if I'd keep it working like that. It goes under the Performance pass later. I submitted the plan. Mariam, her manager, got two notifications: one three minutes ago that Aicha added a development goal, and one just now for the submitted plan. (B-390)

### 7.6 1:1s → B-390
> The suggestions didn't suggest any first agenda, so I added a random one and clicked Start 1:1s. (Agent: suggestions come from objectives at risk, open update requests and recent feedback; Aicha had none.)

> I don't really know what I'm doing inside the 1:1 page, then going straight to give praise on another page. But we're testing functionality. I selected Aicha and typed something, but I can't give praise: the button is greyed out. (Agent: praise must name a company value and the company has none. B-390)

> I added values and it worked. But listen. There's a difference between saying Performance needs a visual rework and saying there are actual core functionalities (not Core HR, core functions) that are misused, not implemented, or buggy. The former should be decoupled from the latter; they are not the same thing. We'll have a whole pass and generate artifacts and designs for Performance eventually, the way we did Core HR, from the ground up. (B-390 vs B-392)

> I love the icons inside this praise card. What are they, and why are they different from the other stuff? Or am I making this up? (Agent: Hugeicons; Performance uses them, Core HR and the shell use Lucide. B-393)

> Aicha found the praise and the 1:1s. Something to add to the across-the-application items: optimistic UI updates. (B-394)

### 7.9 Calibration → B-390
> I have no clue what this calibration thing is.

> I opened Aicha. I guess I have to change her rating, because I can just approve what's there, which is 5. There's a checkbox called "Discussed"; I ticked it and now I can save. But I still can't finalize. Don't tell me it's because I made Sami a facilitator and he has to do the same. (Agent: finalize waits for every manager review in the round, about 92 people, only Aicha's in; the reason is only in a tooltip. B-392)

> Finalized, released, Aicha acknowledged. The cycle is technically in Review now; it shows that. (Agent: the round stays open until closed separately. B-392)

### 6.9 Ending an employment → B-374
> In the People table, clicking a manager should take us to that manager's profile, instead of the whole row taking us to the person's.

> I went to a manager's profile with 3 people and clicked End employment. The drawer itself is fine, but the content is confusing. I guess it gives a shortcut to change all the managers at once, but it's not clear, and I see the same select 4 times, the ugly Last day section and the ugly "Add a note" clickable text that expands a note. It's bad, not awful, lower priority. The "Reports go to" select doesn't change the others. So I set one to a random person and the other three to a random person, and confirmed. (B-372)

### 3.5 Adding a person by hand → B-374
> Filling in the information, it's mostly good. The team section could borrow from the People org chart instead, but it's a minor, low-priority thing. An email went to the manager, and I guess a notification too, but I'm not signed in as them, so I don't know.

### 7.10 Performance Overview → B-390
> That Performance Overview is not reliable for now. I can't trust it. We'll have to rework the whole thing. We need a process like the one we used to rework all of Core HR, so everything stays in our context while we change surfaces and rework and redesign the interactions, and we don't end up with isolated reworks.
