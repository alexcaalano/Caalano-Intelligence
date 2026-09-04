# Caalano360 — Changelog

Release history for the reporting dashboard. Each release is pinned to the exact
git commit that produced it, so any version can be redeployed or reverted to.

**How to revert to a release**
- Inspect a release without changing anything: `git checkout v3.5.0`
- Roll the live branch back to a release (redeploys it on Netlify):
  `git checkout claude/reporting-dashboard-multi-platform-ov1wlv`
  then `git revert --no-edit <bad-commit>..HEAD` (safe, keeps history)
  or `git reset --hard v3.5.0 && git push --force-with-lease` (hard rollback).
- Every release below carries the exact commit that produced it, so
  `git checkout <hash>` always works. Most also have a matching `vX.Y.Z` git tag.
- The live build's exact commit + time is always shown bottom-left in the app
  ("Last deployed …"), and the current version is shown next to it.

The version number also appears in the app sidebar. Newest first.

---

## v3.462.0 - 2026-09-04 · `47c6e4e` - Loading: "360 is connecting the dots"

Every wait in the app now comes through one loader. Nothing shows for the
first third of a second, so a read that lands from the cache never flashes a
spinner, and nothing is held on screen a moment longer than the data takes -
there are no artificial delays. A tab-level wait gets the branded sequence:
the three-node mark being joined, "360 is connecting the dots", and short
lines that rotate through what the read is doing for the open tab ("following
the leads", "checking key events", "spotting the leaks", "finding outliers",
"reading the ad account", "timing the first reply", and so on - a pool per
tab), with the original detail line kept as a caption (the Meta and Google
reads still report which months have loaded). Under it sits a skeleton of the
content's shape - KPI tiles, a chart, table rows - rather than a blank card.

Converted: Caalano360, Meta, Google, Analytics, Users, Forms, Location,
Appointments, Call Reporting, Timing (all three reads), Lost Reasons, Cohorts,
Clinic, Weekly Traffic Light and the agency scan. Inline waits (notes, terms,
calendars, pipeline stages) keep the compact spinner, also delayed-reveal.
Reduced-motion users get the same words with still marks.

---

## v3.461.0 - 2026-09-04 · `4a1d604` - Caalano360 Intelligence: banner, bottlenecks, channel outcomes, movers, indexing

The Caalano360 tab now reads as a hierarchy, every part of it within the
chosen pipeline and channel: **Performance snapshot** (the existing spend,
efficiency and pipeline tiles), **Key event reach** with the step from the
row before, its change against the previous period, and the lowest step
flagged as the **bottleneck** (the same rule the Revenue bottleneck panel
uses, so both point at the same stage), **Channel performance** (the channel
split, now with each channel's win rate indexed against the account's),
**Biggest movers** against the previous equal window (counts need 5, rates
10, before they are judged; headline figures keep their place), and
**Indexing insights**: pipelines, channels and the campaigns with the most
leads, each indexed against the account's own average for the period
(100 = the average) on win rate, result rate, reach of the first key event
and cost per lead.

A **360 Intelligence** banner sits at the top of every major client tab
(Caalano360, Meta, Google, Users, Forms, Location, Appointments, Call
Reporting, Timing, Lost Reasons): deterministic sentences read from the same
figures - the biggest leak, channel to outcomes, the top movers, an indexing
outlier (under-performer first), lost-reason concentration, decision pace,
and a thin-data caveat - ordered so the lines that speak to the open tab come
first. No AI, no delay, identical for everyone.

Nothing was removed: Pipeline performance, the Revenue bottleneck, Lost
reasons, Priority actions and the rest follow the new sections as before.
New `tests/intel_test.mjs` (41 checks) covers the reach and bottleneck rule,
channel outcomes, movers, indexing and the banner wording. Also fixes the
Lost Reasons test, which broke in v3.460.0 when its lifted code began using
the shared time-stats helper.

---

## v3.460.0 - 2026-09-04 · `c200562` - Pipeline is a first-class filter: one picker for the whole client workspace

Each tab used to carry its own pipeline picker and forget it on the next tab.
There is now one **Pipeline** picker at the end of the client tab row, carried
in the link (`?p=`), that every tab follows: Caalano360, Meta Ads, Google Ads,
Users, Forms, Location, Appointments, Call Reporting, Timing and Lost Reasons.
A tab's own picker still works and moves the same value.

On the Caalano360 tab everything recalculates within the chosen pipeline, in
the browser, from the same payload: opportunities, booked and shown (from the
pipeline's calendar key events), won, revenue, open pipeline, lost, result
rate, key event reach, pipeline performance, the channel split, the revenue
bottleneck, lost reasons with their people, and the time-to figures. Ad spend
is allocated to the pipeline by its share of each channel's leads - the rule
the channel split already used - and the tile says "allocated". Calendars and
lead sources are not pipeline-aware in the CRM feed and stay account-wide; a
note under the tab says so. Won deals now carry their pipeline so the revenue
drill narrows too.

New `tests/lens_test.mjs` covers the lens: totals, allocation, re-derived paid
costs, row cuts, close-by-channel, lost reasons, time-to, empty and legacy
payloads, and that the original payload is never mutated.

---

## v3.459.0 - 2026-09-04 · `832c241` - One campaign, one name: spelling variants fold together in Lost Reasons

Leads arrive stamped with whatever case and punctuation the link carried, so
the same campaign turned up in the Lost Reasons filters three times
(`Cd_12_page_view_a_adhd…`, `CD_12_Page_View_A_ADHD…`, `Cd_12_page_view_a_adhd As…`)
while the UTM aliases screen reported nothing to link - it already treated
those as the same name and hid them. The two now agree.

- **Lost Reasons** folds spelling variants of a campaign, ad set, creative or
  keyword into one name: a manual alias wins, otherwise the spelling most
  leads carry. Every filter, chip, table and scorecard uses the folded name.
- **Outcome tables** everywhere fold spelling variants even when a client has
  no aliases set (they only did so once an alias existed).
- **UTM aliases** lists what it folds automatically, per level, under an
  expandable "N spellings fold into current names automatically" line with
  the old spelling, its lead count and the current name it folds into - so
  "no unmatched UTMs" never hides a variant again. Real renames still need
  linking as before.

---

## v3.458.0 - 2026-09-04 · `0c1b9c1` - Settings: the section list no longer slides over the client name

Scrolling a long settings section (Key events with several pipelines) let the
section list ride up over the modal header, so "Nexia Health Care" and the
Summary item sat on top of each other. The header now paints above everything
that scrolls beneath it, and the section list scrolls inside its own box when it
is taller than the space under the header, so it stays put instead of sliding
up. The browser tooltip on each section, which repeated the hint already shown
under the label, is gone.

---

## v3.457.0 - 2026-09-03 · `72e8240` - Lost Reasons: scorecards follow the filters, filters take several values

The Opportunities scorecards on Lost Reasons (leads, open, won, lost, result
rate, time to won, time to lost) were the whole period regardless of what was
filtered below them. They now follow the filters: pick a campaign, a channel or
a stage and the tiles recompute for exactly those deals, with the header saying
what they are filtered to. Reason is a lost-only dimension, so it narrows the
lost count without touching open or won, and the header says so.

Every filter is now multi-select. Each picker opens a checklist with live counts
and a search box once it has more than ten options, several values can be ticked
(any of them matches), and each chosen value gets its own chip so one can be
removed without clearing the rest. Stage keeps its two readings - at the stage,
or the stage and everything after it - for every stage picked.

The Caalano Systems drill payload now carries one compact row per opportunity
(status, dimensions, stage position, days to decision, up to 6,000 per period)
so the cohort maths runs in the browser with no extra request. With no filter
the server's own uncapped figures still stand.

New `tests/lr_test.mjs` covers the row decoding, list matching, the two stage
readings across pipelines, and the cohort figures.

---

## v3.456.0 - 2026-09-03 · `47d1b0e` - Backups of everything that lives only in Blobs

The daily backup covered one store (settings). It now covers the eleven that
matter - configuration, users, terms acceptances, health / monthly / social /
clinic history, the audit trail, the reliability log, Meta verdicts, scan
state - one file per store under `backups/latest/` and `backups/daily/<day>/`.
The Caalano Systems OAuth token is never written to GitHub.

**`backup-export`** is a superadmin one-click download of the same, as a single
JSON file, with no GitHub token needed - so a backup can always be taken by hand
before anything risky. `?secrets=1` adds the token store for the copy that goes
in the password manager. The file names its format and date, lists what was
deliberately left out (the rebuildable caches), and every store carries its key
count and whether it was capped.

`BACKUP.md` in the repo says what lives where, how to take a backup, and how to
restore. Tested the collector against a fake store: every store present, JSON
and non-JSON values kept, pagination past the first page, the log capped and
flagged, secrets excluded unless asked.

Also: the daily job says plainly when it has been skipping for want of a token.

## v3.455.0 - 2026-09-03 · `3023d8a` - Views survive a reload

The browser's cache of loaded views lived in memory, so every reload and every
new tab started cold even when the server had the payload hot. It is now
mirrored to the browser's own database and restored on the next visit with its
original timestamp - a view you opened this morning paints at once and
revalidates behind, exactly like switching back to a tab you already had open.

Scoped to the signed-in person: entries are keyed by who wrote them and only
theirs come back; anyone else's are dropped; signing out empties the store. So
a shared machine cannot hand one person's clients to the next. Entries older
than six hours are pruned; error payloads are never kept.

Tested in a real browser database: nothing persists before sign-in, entries
round-trip with their timestamp, errors are skipped, a second user restores
nothing and the first user's rows are gone, stale rows are pruned, a component
already on screen is told when its data is restored, and sign-out clears it.

## v3.454.0 - 2026-09-03 · `58109eb` - One build per client open; bizloc cached; KPI table without history

**ccdrill reuses what health built.** Opening a client fires `health` and
`ccdrill` together, and each rebuilt the same blend from scratch - two
eight-second builds for one payload. `ccdrill` only needs health's per-channel
spend and paid leads (which do not depend on the won basis), so it now takes the
health payload the other request just cached, or the cached blend, and only
builds as a last resort.

**bizloc is cached** (it was the one per-client read with no cache and no
retry - 19 of the 21 outright failures in the log) and retried once on a 5xx.

**KPI targets: no history in the table.** The "Last 30d" column is gone. It
read each stage's current count rather than how many reached it, so "Client
Won 17" could sit under "Booked 8" and the cost-each figures were nonsense. The
budget field no longer suggests last month's spend either. Targets are targets.

Also: the Key events header row no longer overlaps on single-pipeline clients,
and deleting a saved scenario asks first - it is shared with the team.

## v3.453.0 - 2026-09-03 · `9665603` - Scenario builder: the funnel decides the win; margins and lifetime value

**The last stage is the win.** The separate "win rate of leads" is gone from
the scenario builder - it could disagree with the stages above it, and did.
Whatever reaches the final stage is what is won and priced, so the funnel and
the outcome cannot drift apart. A new scenario ends in a "Won" stage; opening a
client forecast as a scenario now appends one, with its step set so the seeded
funnel closes on the client's real win rate. Saved scenarios can be deleted.

**Advanced - margins and lifetime value.** Gross margin %, purchases per
customer (lifetime), and an optional typed lifetime value. With those, a second
row of headline tiles appears: gross profit, LTV, LTV:CAC, LTV-GP:CAC (lifetime
gross profit against acquisition cost - whether the business keeps anything),
net of ad spend (revenue − spend) and contribution (gross profit − spend). Every
tile says what it is made of on hover, because "margin" means different things
to different people. Twelve more arithmetic cases.

## v3.452.0 - 2026-09-03 · `4717878` - Forecaster: spend split per pipeline

For a client with several pipelines, the client forecast now starts from that
pipeline's **share** of the account's last-30-day spend - by its share of last
month's leads, the same split the KPI targets and the Channel split use -
rather than from the whole account's spend. The spend inputs say so ("this
pipeline's 62% share of the account"). Cost per lead stays account-level: a
Meta lead costs what it costs whichever pipeline it lands in. Single-pipeline
clients are unchanged. Four more arithmetic cases.

## v3.451.0 - 2026-09-03 · `5a8e959` - Settings: explanations move behind "?" bubbles

Every settings pane used to open with a paragraph or three explaining itself,
so a pane read as an essay with some inputs in it. Those explanations now sit
behind a small **?** - beside a heading, or as a "How this works" chip where a
paragraph used to be - and appear, formatted, on hover or keyboard focus. The
words are unchanged; they are just no longer in the way. Twenty-two of them,
across Timing, Key events, Campaign links, UTM aliases, Qualified lead, KPI
targets, Catchment, Clinic, Optimisation Log, Creative fatigue, Organic KPIs and
Daily performance.

The hover popups are keyboard-reachable now (they were mouse-only), which also
applies to the metric popups elsewhere in the app.

Forecaster: the non-paid segment of each bar is a darker grey, so it reads
against the empty track in light mode.

## v3.450.0 - 2026-09-03 · `baef6c4` - Funnel Forecaster

A new left-hand item under Weekly Traffic Light, for staff. What a month of
spend should turn into, stage by stage.

**Client forecast.** Pick a client and a pipeline. The model reads the client's
own numbers: cost per lead per channel from the last 30 days of paid spend and
paid-attributed CRM leads (the 90-day figure where the month is too thin), and
how far leads get - the share reaching each pipeline stage, and the win rate -
from the last 90 days, per channel where the channel has 15+ leads and blended
where it does not. Move the Meta and Google spend and the funnel re-forecasts:
each stage as a stacked bar (Meta / Google / non-paid), the forecast count, the
step conversion from the stage above, and what each one costs at that spend;
won and revenue at the bottom; a headline row of paid leads, CPL, won, CAC,
revenue and return on spend. Non-paid leads (organic, referral, direct) are a
flat baseline that does not move with spend, and can be switched off.

Beneath the funnel, a **spend-against-outcome** chart runs the budget from half
to double today's level with the same channel mix: paid leads, won and CAC at
each step, with today marked. It is the one picture that answers "is more
budget worth it".

**Diminishing returns** is an optional assumption, off by default: cost per lead
rises by a chosen amount (10-40%) for every +50% of spend above the last 30
days. Spending less never makes leads cheaper. Flagged as an assumption
wherever it appears.

Until the spend is touched, grey "vs" figures show what actually happened in
the last 30 days at that spend - a sanity check that the average reproduces
the recent past before it is trusted forward.

**Scenario builder.** The same model with every input typed: spend and cost
per lead per channel, a non-paid baseline, any number of stages each with its
conversion from the stage before (a show rate on a meeting, a quote rate, a
booking rate), win rate and average deal value. "Open as a scenario" from a
client forecast seeds every field from that client's real last 90 days.
Scenarios are saved and shared with the team.

Tested the arithmetic (19 cases: per-channel scaling, cumulative reach, step
conversion, cost per reach, CAC over paid wins only, diminishing returns above
and below baseline, the non-paid switch, empty channels, the step ↔ reach
round-trip, and a typed scenario end to end) and rendered the funnel in light,
dark and narrow.

Fixes in passing: Catchment (`geo`) settings were never accepted by the server's
write allow-list, so they lived in the browser only - they persist now.

## v3.449.0 - 2026-09-03 · `06e890a` - Client settings: Timing tab, business type, tidier Key events

**Timing** is a new entry under Account. Timezone, sales cycle, and work hours
move out of Summary into it, joined by a **Data maturity** read-out: for each
common date range, whether it is long enough (sales cycle + 20%) for its won
and revenue figures to be trusted, and by how many days it falls short if not.
Summary is now just name, description, linked accounts, logo and delete.

**Type of business** is a dropdown on Summary. Choosing *Clinic / allied
health* shows the Clinic tab here and in the client view; any other choice
hides it; "detect automatically" keeps the existing behaviour, where the server
probes for practice-management fields. Saved with the client's other settings
and shared with the team.

**Key events** reads as a table now rather than a wall of chips: one row per
calendar, ticked rows first, with the pipeline and stage links in fixed columns
so the eye runs straight down them. Unticked calendars are dimmed and marked
"not counted". The intro is a third of the length.

## v3.448.0 - 2026-09-03 · `d220147` - KPI targets: budget split per pipeline; key events marked

**One budget, shared out.** The monthly budget is now set once for the client -
it is what the client pays - and each pipeline receives its share by that
pipeline's share of last month's leads, the same allocation the Channel split
uses. The share is shown next to the pipeline picker with every pipeline's
percentage; a pipeline can be given its own figure instead, which sticks until
cleared. Changing the client budget re-derives every pipeline's targets, not
only the one on screen. The **Last 30d** cost-per-stage now uses the pipeline's
share of spend rather than the whole account's - previously a pipeline with one
lead read as "$10,582 each" because it was being charged for everything.

**Key events stand out.** Stages configured as key events are tinted and tagged
in the funnel-targets table, so the rows the rest of the app reports on are
the ones you see first.

## v3.447.0 - 2026-09-03 · `5ab5f50` - KPI targets driven by a monthly budget; grouped client settings

**KPI targets.** A **Monthly budget** field now sits at the top, and every
funnel target below is worked out from it. Each stage - Leads, then every
pipeline stage - has a **Target volume** and a **Target cost** column; type into
either and the other fills in: volume → cost = budget ÷ volume, cost → volume =
budget ÷ cost. The column you typed is remembered as the intent, so changing
the budget later re-derives the other side for every stage: a bigger budget
makes volume-set targets cheaper and buys more of cost-set ones. Derived values
are shown dashed and tinted so they are never mistaken for a decision. A **Last
30d** column shows what each stage actually reached and what each one cost at
last month's spend, so targets are set against reality. The efficiency targets
(CPL, cost per booked, CPA, booking rate, weekly spend, LTV) are unchanged and
grouped below; weekly spend now suggests budget ÷ 4.35.

**Client settings navigation.** The eleven tabs that wrapped across two lines
are now a grouped side navigation - Account, Tracking, Targets, Operations -
with a one-line hint under each entry. The nav stays put while a long pane
scrolls, ↑ / ↓ move through it, and the modal reopens on the tab you last used
for that client. Below 760px it collapses to a grouped select.

Tested the two derivation rules end to end (11 cases: budget arriving later,
retyping a derived side, clearing, zero, the Leads row) and rendered the nav
and table in light, dark and narrow.

## v3.446.0 - 2026-09-03 · `239e370` - Settings: Overview tab removed

The per-client **Overview** (brand profile) tab is gone from Settings. The editor
component is kept - the Creative Cockpit still reads any profile already filled
in - but the tab itself no longer sits first in the strip. The cockpit's tip that
pointed people to Settings → Overview now just says ideas are general until a
profile exists.

## v3.445.0 - 2026-09-03 · `4f16797` - Warmers that finish, and stale-while-revalidate

The reliability log for 30 Aug - 3 Sep held 379 slow builds in five days, median
8-13 seconds, and every one of them was a cache miss - a payload rebuilt on a
person's clock because nothing had built it beforehand. Three causes, all fixed.

**The warmers were being killed.** They ran inside SCHEDULED functions, which
have the same ~26s ceiling as any other; a pass over every client at three
builds of ~8s each was cut off after the second or third client, every ten
minutes, forever. The clients that sorted first were always warm and the rest
never were - Nexia sat fourth and was 36% of all slow builds. The work now runs
in `warm-background`, a background function with a 15-minute ceiling; the
scheduled functions only trigger it. It warms stalest-client-first and records
each client as it goes, so a cut-off run still moves the roster along.

**Nothing was served stale.** After the 10-minute fresh window the next open
paid the full rebuild. Now a copy up to six hours old is served at once and the
same background warmer rebuilds that exact request behind it. Refresh still
forces a live build. The warmer's own calls never take this path.

**Warm coverage was narrow.** Only the Meta / Google / Caalano360 tabs. The
slowest scopes in the log - health, ccdrill, users, agency - were never warmed.
They are now, for the default range (last 30 days, all channels, closed-won
basis), along with the three tabs as before.

The warmer no longer hand-builds cache keys: it replays the browser's exact
requests through the real handler under a warm token, so the key it writes is
by construction the key that is read. Tested: every planned URL produces the
same cache key as the app's own URL builders; the token is constant-time
compared and a signed-out or wrong-token request is still a 401 against the
real handler. Per-client Home rows (ovrow) stay on stale-while-revalidate only -
their key carries per-client settings the server cannot see.

Superadmins can kick a pass with `/.netlify/functions/meta-warm-now` (views) or
`opp-warm-now` (opportunity snapshots); both report the last completed pass.

## v3.444.0 - 2026-08-20 · `601bb81` - Drop "Paid vs all lead sources" from the monthly report

Removed the stacked source-mix bar and its "All Caalano Systems vs paid results"
table from the key-events slide. The slide now ends on the created-on funnel,
which is the cohort the rest of the page is built around.

Also removes what only that section used: the paid-campaign comparison, the
non-paid source bucketing (organic / referral / social / email / direct / CRM),
and the `aggOutcome` helper the two shared - about 90 lines.

The `srcOutcomes` field is deliberately left in the snapshot builder even though
nothing reads it now. It is collected data, not logic: keeping it costs a little
snapshot size, dropping it would quietly make this month un-restorable in a way
the archived months are not.

## v3.443.0 - 2026-08-20 · `5e63549` - Finish the scoping sweep, and fix what it broke

Auditing the rest of the file for the same pull-everything-then-filter pattern
turned up more of it, plus a regression v3.442.0 introduced.

**The regression, fixed.** Scoping changes what an unconnected account looks like.
Asking for every account and filtering left nothing; asking Windsor for one
account it does not hold is a hard error instead. Two clients are in exactly that
state - **book-a-midwife** and **rlm-telehealth**, whose Meta ad accounts were
never granted to the Windsor connection - and one Meta read has no `.catch`, so
their Meta tab would have thrown where it used to render empty. `windsorFetch`
now treats "account is not available" on a scoped call as an empty result, which
is what it was before and what is true, and records it separately from a real
failure. Tested against the three real error bodies, and against six genuine
failures that must still throw.

**More of the pattern, now scoped.** `hourlySpend` (hour-of-day spend, both ad
platforms) - missed the first time because its connector is a variable rather than
a literal, so a check that matched on the literal never saw it. The CRM rollup
endpoint. Google Analytics. And all of organic social: the Instagram and Facebook
Page reads in `buildSocial`, `socialPerDay` and `socialMonth`, the connection
probes and the Page field probe - roughly 40 calls, fixed at their three shared
helpers. Every connector was verified to accept account scoping first (facebook,
google_ads, gohighlevel, instagram, facebook_organic).

**The check is stricter.** It no longer only matches literal ad connectors; any
`windsorFetch` narrowed by an `acctEq` filter afterwards must scope, whatever the
connector. That rule caught the CRM rollup endpoint on its first run.

Sixteen reads stay unscoped on purpose and now say why on the line: the portfolio
row per client, trends, account discovery, the account-lister diagnostic, and the
public-Instagram tool where the account is somebody else's profile.

**Not a code problem, but worth knowing:** three clients' Instagram ids in the
`SOCIAL` map are not in the Windsor Instagram connection either - nexia-health,
healan-centre and simchat. Their organic social has no data to show and will keep
reading empty until those accounts are granted.

## v3.442.0 - 2026-08-20 · `1527323` - Scope every per-client ad read to its account

Follow-on from v3.441.0, which fixed the Overview's Meta spend. The same pattern
was everywhere: **53 more** Meta / Google reads pulled every ad account on the
agency key and filtered down to one client in JavaScript afterwards. Each one was
a timeout waiting to happen, and a timeout there reads as zero rather than as an
error. All of them now scope at the API - the Meta tab (9 reads, fired in
parallel), the Google tab (11), fatigue, anomalies, cohorts, weekly, geo, the
id→name maps, the custom-conversion probes, the creative and diagnostic endpoints.

Two latent correctness bugs fell out of it. The Meta timezone probe read
`rows[0]` from an unfiltered agency-wide pull, so it could report **another
client's** account timezone; and the creative-copy join matched on ad name across
every account at once, so two clients with an identically named ad could get each
other's copy. Both are scoped now, so neither can happen.

Eleven reads stay agency-wide because that is the point of them - the portfolio
row for every client, the trends pull, and account discovery. Each now says so on
the line.

Adds `scripts/check-windsor-scope.mjs` to `npm run check` and the build: a Meta or
Google read must either scope to an account or carry an `// agency-wide:` note
saying why it does not. Verified it catches an unscoped read, respects the
markers, ignores other connectors, and judges two calls on one line separately.
Also checked, with a real scope walk over the parsed file, that all 64 account
expressions resolve to a binding in scope - a typo there would throw inside a
`.catch(() => [])` and look exactly like the bug being fixed.

## v3.441.0 - 2026-08-20 · `76596c2` - Fix Meta spend reading $0.00 on the Overview

The Channel split, the paid scorecards and every cost-per figure derived from
them showed **$0.00 of Meta spend** for clients who were plainly spending. Google
was fine, which is what made it look like a Meta-specific data problem.

It was a timeout. The Overview's blend pulled Meta agency-wide - every ad account
on the Windsor key - and filtered down to the client in JavaScript afterwards.
That unscoped pull was measured at **over 60 seconds** against the 7.5s budget the
10s function limit allows, so it failed on every request. Google's equivalent pull
is small enough to fit, so it came through and Meta did not. Both are now scoped
to the client's own account at the API, which is what the filter was doing anyway;
the filter stays as a backstop. The same fix is applied to the Users tab's spend.

Second, and the reason it was silent: `buildBlend` has always recorded whether
each ad read returned - its own comment says an empty result "must never be
presented as a measured zero" - but the flag stopped there and never reached the
UI. It does now. A channel whose read failed shows **n/a** and a note saying so,
with its CAC blanked, instead of a confident $0.00 sitting next to 140 leads,
which reads as free leads rather than as a missing number.

Other per-client ad reads in the same file are still agency-wide. They have not
been touched here - the Meta and Google tabs work today - but they carry the same
risk and are worth the same sweep.

## v3.440.0 - 2026-08-20 · `81cdf33` - Paged tables on the Location tab

Every long list on the Location tab now shows ten at a time with page controls
underneath, instead of running to hundreds of rows or stopping at a hard cap.

- **Where the leads are** (districts, councils, states, remoteness) and **My
  zones** - previously every row, which for a national client was a table you
  scrolled past rather than read.
- **Key events by location** - was capped at the top 20 with no way to see the
  rest. The cap is gone; the bars stay scaled to the top place across the whole
  ranking, so page four does not look as busy as page one.
- **Every location** - was capped at 120 with a "+263 more" line you could not
  open. Now all of it is reachable.
- The **lead drill** that opens from a row or a map pin, which for a whole
  council could hold hundreds of leads.

Sorting still sorts the full list and then pages it, not the other way round, and
changing the sort, the filter or the grouping returns you to page one - staying
on page four of a brand new order is not what "sort by win rate" means. Page
numbers show the first, the last and a window around where you are; the strip is
anchored so the arrows stay under the cursor as you page through, and drops to
its own line on a narrow screen.

## v3.439.0 - 2026-08-20 · `d17706f` - Location insights show for every client

The Location tab's insights and area breakdown no longer wait on a Catchment
setup. Both read the postcode each lead already gave us and look it up against
the ABS geography, so "which district converts best" is answerable for a client
who has never opened Settings → Catchment. Previously the tab opened on **My
zones**, which for those clients was an empty panel and hid everything below it.

- The default grouping is now **District**. Remoteness, State and Council sit
  beside it as before.
- **My zones** is offered only when zones actually exist, and the view falls back
  to District if the last one is deleted while the tab is open.
- Catchment is unchanged and still does what it always did: it defines the zones,
  draws them on the map, and adds the "only the areas I target" cut.

Also extends `scripts/check-tdz.mjs` to read hook dependency arrays. A dep array
is evaluated on every render, right where it is written, so `useEffect(..., [x])`
placed above `const x = ...` throws - but the checker only inspected assignment
initialisers and skipped hook statements wholesale, so it could not see it. It
caught exactly that mistake in this change, and still reports nothing across the
rest of the file.

## v3.438.0 - 2026-08-20 · `PENDING` - Key events get a grouped header

Each key event on the Location tables is now one header spanning two columns -
**Qty** and **%** underneath it - instead of the event name over the count and a
bare "%" beside it. The name is read once rather than inferred from a percentage
sitting next to a number, and with six key events across the table that is the
difference between scanning it and decoding it.

Both sub-columns still sort independently, and the group header highlights when
either of its two is the active sort. The plain columns span both header rows so
nothing sits over an empty cell.

Verified in a browser at three widths in both themes: every group header sits
exactly over its own two sub-columns, every sub-column sits exactly over its own
body cells, and no header is clipped or pushes the table wide.

---

## v3.437.0 - 2026-08-20 · `PENDING` - Fix: every lead was counted twice in its own location

**"4 leads · lead detail for 2" was not a cap - it was double counting.** A
lead's postcode was added to its location, and then added AGAIN by the loop over
location-shaped answers, because a form's own "Postcode" question is itself
location-shaped. The lead tally doubled; the people list, which dedupes on
contact id, did not. So a place reported four leads and could only ever show two
of them, and every lead count on the Location tab - the table, the map dot sizes,
the scorecards - was inflated for any client whose form asks where someone lives.

Each place is now counted once per lead, matched case- and whitespace-insensitively
so "PARRAMATTA" and "parramatta" are one place rather than two. A genuinely
different second location still counts, so this is not over-correcting. On the
exact shape that caused it, the old path produced 8 leads for 4 people; it now
produces 4 and 4.

**Location insights.** A panel under the scorecards calling out where a place
behaves differently from everywhere else - "Inner West reaches Quote at 62%
against 28% everywhere else". It tests remoteness, state, district, council and
your own zones, across win rate, loss rate and every key event.

The statistics are the point of it. Each line compares a place against
**everywhere else** rather than the overall average, which contains the place and
drags the comparison toward no difference - exactly hiding the small areas worth
finding. A line only appears if the gap is at least 12 points, the group holds at
least 8 leads with at least 20 to compare against, and it survives a
two-proportion test **after correcting for how many comparisons were run** - test
enough places and something always looks significant. Findings that are the same
leads under two names (a council and a district covering the same postcodes) are
shown once, and "wins up" is not repeated as "losses down".

**The lead drill is a table.** One row per lead - name, postcode, **channel**,
status, stage, time in stage, value - sortable on every column, expanding to the
form answers and again to that contact's notes. The card layout wrapped raggedly
once a row spanned a whole council.

42 assertions on the insights, including that a council with 2 leads and a 100%
win rate produces no card at all, and that pure noise across 30+ comparisons
yields at most one finding rather than a page of them. 14 more on the counting
fix, demonstrating the old double-count rather than only asserting the new
behaviour.

---

## v3.436.0 - 2026-08-20 · `PENDING` - Sortable location tables, reach rates, channel split

**Every column sorts.** Click any header in either Location table - name, places,
leads, share, any key event, its reach rate, win rate - and click again to
reverse. Names sort A-Z first, numbers biggest-first, and a row with no value for
that column sorts **last** either way rather than claiming the top of a
descending sort.

**Each key event gets a reach rate beside it.** "Pool Specialist Booked Call: 1"
now reads "1 · 25%" against that row's 4 leads, so a small area with a high
conversion is visible next to a big one with a poor one instead of being buried
by volume.

**Booked and Won step aside when key events exist.** With key events configured
they were a worse version of the same thing, sitting in the two rightmost
columns. They now appear only as the fallback for a client with no key events
set. Win % stays either way.

**Channel split.** All channels / Meta / Google / everything else, on both
tables. It reads each location's own per-channel tally rather than filtering its
lead list - the lead records are capped at 60 per place, so a busy postcode would
otherwise report a channel mix drawn from its first 60 leads and quietly disagree
with its own lead count.

27 assertions on the sort alone, including that a missing value never sorts to
the top, that ties keep a stable order between renders, that the two directions
are exact reverses, that sorting never adds or loses a row, and that a reach rate
on a row with zero leads sorts last rather than dividing by zero.

---

## v3.435.0 - 2026-08-20 · `PENDING` - Key events per location, and the bug that was hiding them

Key event columns now sit in both Location tables - zones, and the district /
council / state / remoteness groupings - counting the leads in each row that
reached each of this client's configured events. They use the same evaluator as
the Forms and ranking views, so "reached 15 Minute Call" means the same thing
here as everywhere else rather than being a second definition of it.

**Building this turned up an existing bug.** The "key events by location" metric
in the ranking below the map has been there for a while and has been returning
**zero for every stage-type event**, silently, since the location lead records
were built without the three fields the key-event test reads: `stagePos` for
stage events, and `occurred` / `calendars` for calendar ones. A person record
missing `stagePos` reaches nothing, and nothing is a plausible-looking number.
Those fields are now carried, which fixes the existing ranking as well as
supplying the new columns.

That is the shape of bug worth having a test for, so the new suite leads with it:
the same lead with and without `stagePos`, asserting that the one without reaches
nothing - the exact silent failure. The other 21 assertions cover that stage
events are cumulative (reaching Quoted means having passed the 15 Minute Call),
that an event pinned to one pipeline does not count another pipeline's leads,
that won counts on status rather than stage, that calendar events read the
bookings rather than the stage, that an earlier event is never reached by fewer
leads than a later one, and that a renamed or deleted stage counts nobody rather
than everybody.

The columns are counted from the lead records behind each row, which are capped
per place, so on a very busy postcode they can read lower than the lead count
beside them - the caveat says so rather than letting the two figures quietly
disagree.

---

## v3.434.0 - 2026-08-20 · `PENDING` - Rural gets its own band, and every row opens its leads

**Metro / Regional / Rural / Remote.** Regional and rural were folded together;
they are now separate, because the ABS bands already draw that line: "inner
regional" is the regional-centre band (Ballarat, Cairns) and "outer regional" is
the country-town and farmland band everyone means by rural (Bathurst). Both are
substantial - neither is a hair-split of the other - and the exact ABS class stays
on each row's hover.

The Modified Monash Model was the obvious alternative, since it says "regional
centre" and "rural town" in so many words. It was rejected on the data: 551 of its
2,652 postcodes carry more than one value against zero ambiguity in the ABS bands,
and it measures town *size* rather than distance - it files Broken Hill as a
"large rural town" when it is one of the most remote places in the country.

**Every row in the table now opens its leads.** Zones, districts, councils,
states and remoteness bands all click through to the same drill a map dot opens:
each lead with its status, pipeline stage, time in stage and value, expanding to
its form answers, and expanding again to that contact's notes.

Opened from a whole council a drill can hold hundreds, so it gained two things: a
search across name, stage, pipeline and postcode, and a default sort by **longest
in stage first** - the leads stuck the longest are the reason anyone opens it.
Each lead now shows its own postcode beside the name, which matters once a row
spans more than one.

**The location scorecards use the full width.** They were on `auto-fill`, which
leaves empty grid tracks, so five tiles bunched at the left of a wide screen.

25 assertions, updated for the four-band split - including that all four bands
are populated, that regional and rural are both substantial rather than one band
split in two, and that the four cuts still partition the placeable leads exactly.

---

## v3.433.0 - 2026-08-20 · `PENDING` - Metro / regional / remote, state, and cut-then-drill

The Location tab now groups leads five ways - **My zones · Metro / regional ·
State · District · Council** - and all but the first need no zones configured at
all.

**Metro, regional and remote are the ABS Remoteness Areas**, not a guess from
population. That is the official measure of how far a place sits from services,
and it is already carried per postcode: 2,584 of them, every one single-valued.
Metro is "major cities"; regional folds inner and outer regional together; remote
folds remote and very remote. The exact ABS class stays on each row's hover, so a
regional figure can still say whether it is inner or outer.

**And you can cut before you group.** A "show everywhere / metro only / regional
only / remote only" control applies to whichever grouping is on screen - so
"regional only, by council" gives you the regional councils on their own instead
of buried under the metro ones, which is the dissect-then-zoom-in reading. The
caveat says how many leads the cut removed, and the share column is a share of
what is on screen after it, not of everything.

Sanity checks that hold in the data: Sydney and Melbourne CBD and Baulkham Hills
are metro, Bathurst is regional, Broken Hill is remote.

23 assertions on the banding and the cut, including that all three bands are
populated with a realistic share of the country, that the three cuts partition
the placeable leads exactly, that shares within a cut sum to 100%, and that a
lead whose postcode cannot be placed is counted rather than dropped.

---

## v3.432.0 - 2026-08-20 · `PENDING` - Leads per area, with or without zones

Two changes, and the second is the more useful one.

**Picking areas now creates a zone each.** Adding The Hills and Blacktown used to
pour both into one zone and report a single combined number, which is not why
anyone picks two councils. Each pick now becomes its own zone named after the
area, so the Location tab reports them separately. Picking the same area twice
tops up the existing zone rather than making a duplicate. There is a tickbox to
go back to the old behaviour when you genuinely want one combined zone, and
radius or hand-built zones are named by you as before.

**The Location tab groups leads three ways.** A control above the table:

- **My zones** - the zones you defined. Is the targeting working?
- **By district** / **By council** - every lead grouped by the area its postcode
  belongs to, *whether or not you target it*. Where are the leads actually
  coming from?

The second reading needs no zones at all, which is the point: a client with
nothing configured can still open the tab and see their leads broken down by
council, sorted busiest first. Areas you do target are marked in the table rather
than filtered away, so both questions are answered by one view - and there is a
tickbox to narrow to just yours when that is what you want.

It also reports the case that is easy to miss: **targeted areas that produced no
leads at all** are named under the table, since a zero row cannot appear in a
table built from leads that exist.

Leads whose postcode cannot be placed are counted in their own row rather than
quietly dropped, and the same caveat as the picker applies - a postcode is filed
under exactly one area, so an area sharing its postcodes with a neighbour reads
smaller than it is.

21 assertions on the grouping, including that every lead lands in exactly one row
or in "could not be placed", that filtering to targeted areas never invents or
loses a row, that a targeted area with no leads is reported rather than shown as
a zero, and that district and council really are different splits of the same
leads (they disagree for 2,106 of 2,655 postcodes).

---

## v3.431.0 - 2026-08-20 · `PENDING` - Zone shading stops competing with the lead dots

The zone colours were drawn from the categorical palette, which meant a blue zone
under blue "Booked" dots, an orange zone under amber "Leads", and a green zone
under green "Won". Three direct collisions.

Moving them to different hues would only have relocated the problem: the four
outcome colours plus the violet business pin already occupy blue, red, amber,
green and violet, and running the palette validator over those five shows the
space is not just full but already strained - the business pin and "Booked" sit
ΔE 9.2 apart in normal vision, under the 15 legibility floor. A sixth hue in
there is one more thing to disambiguate from the dot sitting on top of it.

So zones stop being a colour category at all. They are **context**, and the dots
are the data:

- **One slate for every zone** (`#4a5568` light, `#a9b5c3` dark), chosen by
  measurement rather than taste. It sits further from every outcome colour than
  those colours sit from each other - worst case ΔE 10.2 against "Lost" under
  protanopia, 21-38 against everything else - and reads as ground rather than as
  another series.
- **Zones name themselves on the map.** With colour no longer carrying identity,
  a label sits at each zone's centre, which beats matching a swatch to a key in
  any case.

A neutral ramp was tried first, so several zones could differ by lightness. The
validator rejected it: adjacent steps land at ΔE 5.9-10.9, below the floor at
which anyone can tell them apart. Grey cannot carry identity either - which is
what settled the label approach rather than a shade per zone.

Worth flagging separately: the outcome palette itself does not pass. "Won" and
"Lost" are ΔE 3.0 apart under deuteranopia, and the business pin and "Booked"
ΔE 9.2 in normal vision. That is pre-existing and untouched here, since those
colours are used across the whole app, but it is a real accessibility gap and
worth a pass of its own.

---

## v3.430.0 - 2026-08-20 · `PENDING` - Real postcode boundaries, and pick an area instead of typing postcodes

**The shading is now the actual postcode boundaries.** The faint discs are gone.
They were a stand-in for boundary data we did not hold, and they read as a smudge
rather than as the area actually selected. `scripts/build-geodata.mjs` now builds
`src/data/poashapes.json` from the ABS Postal Areas 2021 boundaries: 2,641
postcodes, simplified with a tolerance scaled to each polygon's own size, so a CBD
postcode a kilometre across keeps its shape while an outback one fifty kilometres
wide is not stored at a detail nobody will ever see. 34MB of source becomes 3.8MB,
0.93MB gzipped, loaded on demand and never in the main bundle.

Zones are drawn as filled, outlined shapes on both the Location map and the
Catchment settings map. Postcodes with no boundary - PO-box-only ranges, which
have no ground under them - fall back to a point and are counted in the caption
rather than quietly missing.

**Build a zone by picking an area.** State → Greater Sydney / Rest of NSW → a
searchable list, and one click adds every postcode in it. The capital-city
grouping is the real ABS structure listed explicitly, not a name match: Greater
Brisbane properly includes Ipswich, Logan and Moreton Bay and excludes the Gold
Coast, which "starts with Brisbane" would get wrong. 497 councils and 333
districts nationally.

**On which grouping to trust.** Postcodes do not nest inside council boundaries,
so every postcode-to-council mapping has to file a postcode that spans several
councils under just one - and the source gets a fair number wrong, filing Castle
Hill under Hornsby. Rather than ship that silently, both groupings are offered and
measured: ABS **districts** group the same postcodes about three times more
tightly (8.0km median spread around their own centre against 23.5km for councils),
so districts are the default and councils are one selector away. The picker says
plainly that an area is the postcodes that mostly sit in it, not an exact match,
and to check what was added and trim it on the map.

**Suburb names convert to postcodes.** Only postcodes have boundaries, so a zone
holding suburb names could only half-draw. Each zone now offers to convert them
and reports exactly what it swapped rather than doing it silently.

Also fixed while building this: PO-box and large-volume-receiver postcodes were
being offered as part of every area. They have no boundary and nobody lives in
them, and excluding them took drawable coverage from 84% to 99%.

82 assertions on the region data and boundaries, including that Greater Brisbane
excludes the Gold Coast, that coordinates are stored [lat,lng] rather than
GeoJSON's [lng,lat] (the wrong order puts every zone in the Indian Ocean), that
Sydney's CBD outline is drawn over Sydney, that districts really are the tighter
grouping, and that the known council mis-filing is what it is rather than wished
away.

Boundaries and area names: Australian Bureau of Statistics, ASGS Edition 3 (2021),
used under CC BY 4.0 and credited in the app.

---

## v3.429.0 - 2026-08-20 · `PENDING` - Service areas shaded on the lead map

The Location map showed where leads came from and, separately, a table saying how
many fell in each zone. The one thing it did not show was the zone itself, so
"are we getting leads where we are targeting" had to be reconstructed from a
table and a memory of which postcodes are in which zone.

Zones are now **shaded on the map**, one colour each, under the lead dots. A key
above the map names each zone with its postcode count and a toggle to turn the
shading off. Leads that landed outside every zone are now obvious at a glance
rather than a number in a row labelled "Outside every zone".

**On what the shading is, exactly.** We hold postcode *centroids*, not boundaries -
there is no polygon to fill. The tempting fix is a hull drawn around the zone's
postcodes, and it would be a lie: it claims every gap between them as covered,
including suburbs deliberately left out. So each postcode is drawn as its own
disc, and where they overlap they read as one area.

A fixed disc size would be wrong at both ends - an inner-city postcode is a
couple of kilometres across and an outback one can be fifty - so each disc is
sized by how far its nearest neighbouring postcode sits, which approximates the
ground that centroid actually stands for, then clamped so nothing disappears and
nothing shades a quarter of the state. In testing, remote postcodes draw several
times larger than inner-Sydney ones, which is the behaviour that makes the shape
honest.

The caption says all of this on the map, because a shaded area looks like a
border and this one is not.

22 assertions on the disc sizing, including that a disc is only ever drawn for a
postcode genuinely in the zone and at its own centroid, that adjacent metro
postcodes overlap into one area rather than reading as scattered dots, and that
an unresolvable place is skipped rather than guessed at. A browser test confirms
the lead dots render above the shading - the dots are the data, the shading is
the context, and that order must not invert.

---

## v3.428.0 - 2026-08-20 · `PENDING` - The map is the setting, in both catchment modes

The map was behind a button and only in one mode. It is now **shown by default in
both**, inline in the settings pane, because a radius or a list of four-digit
postcodes is close to unreadable as a number and obvious as a shape.

**Radius from one location** opens with the current origin already drawn - even
before a pin is set, the circle is shown at the business address or the typed
postcode, so you can see what you are moving away from and why it was not quite
right. Click anywhere to place the pin exactly, drag the edge handle or type the
kilometres, and the origin switches to that point.

**Service areas** shows the selected zone with **every place in it plotted as a
green dot**, named on hover. Typing a postcode into the zone puts a dot on the
map straight away, so a zone stops being a wall of numbers you cannot picture.
Clicking a dot removes that place - which is what makes a radius fill usable: draw
the circle to get the bulk, then trim the two or three suburbs it overreached
into. A zone selector switches the map between zones.

Places we hold no coordinates for still belong to the zone; they simply cannot be
drawn, and the panel says how many rather than quietly plotting one fewer.

Verified in a real browser against the real place database: 11 of 12 places plot
(the twelfth is deliberately unresolvable), every dot lands inside the map box,
clicking a dot reports back the right postcode, and there are no broken marker
images at three widths in both themes.

---

## v3.427.0 - 2026-08-20 · `PENDING` - Draw a service area on the map too

The map picker added in v3.426.0 only appeared under **Radius from one
location**, which is not where most of this work happens. **Service areas** now
has a **Draw on map** button on every zone, beside the existing Fill by radius.

It opens the same picker, but the circle does something different: instead of
becoming the catchment, it **fills the zone with every postcode inside it**. That
turns Fill by radius from a number typed blind into a shape you can see - and the
save button names the count before you commit, so a circle that would drag in 400
postcodes says so first.

Once added they are a plain list of postcodes you can edit by hand, exactly as
before. A lead is either in the zone or it is not, with none of the
edge-of-circle guesswork a live radius carries - the map is only a way of
choosing, not a rule that keeps applying.

Drawing is additive: hand-added places survive it, a second wider circle keeps
everything the first added, two separate circles union cleanly, and drawing the
same circle twice changes nothing. A circle covering empty country leaves the
zone exactly as it was rather than clearing it. 66 assertions cover that,
including that the count on the button always matches what actually gets added
and that every postcode added really is inside the circle.

---

## v3.426.0 - 2026-08-20 · `PENDING` - Drop a pin on a map to set the catchment

Catchment had two ways to say where people travel to: the CRM business address,
or a suburb/postcode typed in. Both resolve to a **postcode centroid**, and a
postcode is not a point - a city one is a couple of kilometres across, a rural
one can be fifty. The origin every distance is measured from could sit well away
from the actual front door.

There is now a third option: **a point dropped on a map**, with the same gesture
as radius targeting in Ads Manager or Google Ads. Click to drop the pin, drag it
to move, and drag the handle on the circle's edge to size the radius - or type
the kilometres exactly, since direct manipulation is good for finding the shape
and bad for hitting a round number.

The panel beside the map earns its place:

- **The pin names itself** from the nearest place we hold coordinates for, so a
  saved catchment reads "NORWEST, NSW" rather than a pair of decimals - and it
  says how far the pin is from that place, so a pin dropped in the middle of
  nowhere is honest about it rather than claiming a suburb it is nowhere near.
- **What the circle covers** - the postcode count and the nearest suburbs by
  name. It is the closest equivalent to the reach estimate the ad platforms show
  beside their radius control, and it makes a too-big or too-small radius obvious
  before it is saved.
- **Search** jumps the map to any suburb or postcode, so setting a catchment for
  a client in another state does not start with panning across the country.

When a pin is set, the lead map measures from that exact point - no place lookup,
no centroid in between - and the catchment ring is drawn where the pin is. Leads
are still positioned by postcode centroid, which the picker says plainly: the
circle is exact, each lead's position is only as precise as its postcode.

50 assertions cover the reverse lookup and the coverage counts against real
Australian coordinates - Sydney resolves in NSW, Melbourne in VIC, coverage never
shrinks as the radius grows, and the edge handle lands within 0.11km of the
requested radius at every latitude from Darwin to Hobart. A live browser test
drives the real Leaflet map and checks the circle, the pin and the handle all
render and respond.

Caught while testing: the draggable pin was the only `L.marker` in the codebase,
and Leaflet's default marker icon does not survive the bundler - it would have
rendered as a broken image. Every other map here uses `circleMarker` for that
reason, which cannot be dragged, so the pin is a CSS `divIcon` instead. The
browser test now asserts no broken images on the map.

---

## v3.425.0 - 2026-08-20 · `PENDING` - Scorecard above the Lost Reasons table

Seven tiles now sit above the Lost Reasons breakdown, so the losses have
something to be a share OF rather than arriving as a number on their own:

**Total opportunities · Open · Won · Lost · Result rate · Time to won · Time to lost**

Counts are the opportunities *created* in the period, whatever has happened to
them since - the same cohort the table below breaks down, which is why the lost
figure here matches it exactly.

**Result rate** is won plus lost over the whole cohort. It measures how much of
the period has been worked to a conclusion, not how well it went, and it is the
number that decides how much the rest is worth: at 49% decided, the win and loss
splits below are drawn from half the leads and the other half could still go
either way.

**Time to won and time to lost** are new, and they are the *median* days from the
lead arriving to it being marked - not the average. A handful of deals that sat
open for months pull an average far away from the typical case; in testing, two
such deals in a set of ten multiplied the mean sixfold while moving the median by
half a day. Each tile carries the middle-half spread, because a median of four
days reads very differently at 3-5 days than at 1-40, and the hover adds the mean,
the count, and how many deals had no usable pair of dates. Deals with a negative
gap or one beyond a year are excluded rather than allowed to set the figure, and
a tile built on fewer than eight deals is greyed rather than printed with the
same authority as the rest.

Comparing the two is the useful read: losses decided much faster than wins means
disqualification is working, while losses that take *longer* than wins means
effort is going into deals that were never going to close.

19 assertions cover the median, the quartiles, the rounding and the empty cases,
including the outlier behaviour that is the reason for using a median at all.

---

## v3.424.0 - 2026-08-20 · `PENDING` - Faster Call Reporting, and a checker for the crash that shipped

**Call Reporting loads much sooner.** It fetched the range one day at a time -
30 requests for a month, four at a time - and rendered nothing at all until the
last one landed. Three changes:

- **It paints as data arrives.** The first window now shows within about a
  second instead of a blank spinner until everything is in. A badge says how many
  days are still loading, so a half-loaded total is never mistaken for the final
  one.
- **Windows are five days, not one.** The one-day width was chosen to dodge a
  timeout that turned out to be a missing location id, so the guess is no longer
  load-bearing. A month is 6 requests instead of 30.
- **Completed windows are kept for the session.** Past days cannot change, so
  moving between Last 7 / Last 30 / a custom range reuses everything that
  overlaps instead of re-fetching it. Windows touching today are never cached.

The width is still not a guess we have to be right about: `buildUserCalls`
already reports when it ran out of time, and a window that comes back incomplete
is discarded (not merged, which would double-count), split into single days, and
every window still queued is narrowed with it - so the discovery costs one round
trip rather than one per window. That is then remembered for the session, so a
high-volume client starts narrow next time.

Modelled against realistic per-request latency: time to first data on screen
7.7s → 2.0s, time to complete 7.7s → 4.0s, requests 30 → 6. The worst case - a
client whose every window is too big - completes in 7.8s against the old 7.7s,
but still paints at 1.0s rather than at the end. 132 assertions cover the
windowing, including that windows tile a range exactly with no gap or overlap at
every width and across month and year boundaries.

**New build check: `scripts/check-undef.mjs`.** v3.423.1 shipped a crash where a
function was referenced but never added to the bundle - the third of exactly that
shape, after `paidOpen is not defined`. `check-toplevel` verifies nesting and
`check-tdz` verifies declaration order; nothing verified that a name being called
exists at all.

Two earlier attempts at this were line-based and both were deleted, one drowning
in false positives from prose inside JSX and one misattributing lines to the
wrong function. This one is a real scope analyser: it parses the file with
Babel's parser and resolves every reference against a proper scope chain -
hoisting, destructuring, closures, shadowing, catch params, class bodies, and
capitalised JSX tags as component references. Vite's `define` constants are read
out of `vite.config.js` rather than hardcoded, so the two cannot drift apart.

On the current 19,000-line file it reports zero false positives, and it catches
all three historical bugs when they are reintroduced - each of which builds
perfectly clean.

---

## v3.423.1 - 2026-08-20 · `PENDING` - Fix: Call Reporting crashed on the cadence maths

`callCadence is not defined` - the Call Reporting tab failed to render at all.
The cadence section was added in two pieces and only one of them landed: the UI
components went into the bundle, the function they call did not.

Neither existing checker catches this. `check-toplevel` verifies nesting and
`check-tdz` verifies declaration order, but nothing verifies that a name being
called exists at all. This is the third crash of exactly this shape, so the next
release adds the check rather than the note.

---

## v3.423.0 - 2026-08-20 · `PENDING` - Call cadence: how many attempts a lead is worth

New section on Call Reporting. For each day after a lead arrives, it shows how
many times they get called and what those calls are still returning - the
question being how many attempts are worth making before the return disappears.

Every row is measured on **the lead's own clock**: day 0 is their first 24 hours,
whenever they arrived, so a lead that came in at 11pm is not pushed into day 1 by
the calendar rolling over.

Two readings, switchable:

- **Per unbooked lead** - of the leads who reached that day still unbooked and got
  called, the share that booked. This is the drop-off curve; it says when to stop.
- **Per call** - of the attempts made that day, the share followed by a booking.
  This says what one more dial is worth.

Both count **attempts**, not connections, so the cost of chasing is visible. The
connect rate sits beside them, because a falling booking rate caused by people no
longer answering is a different problem from answered calls no longer converting.

Three things the numbers would otherwise get wrong:

- **A booking is credited to the last attempt that preceded it.** A lead called
  three times before booking credits one call, not three - otherwise the per-call
  rate counts the same booking once per dial and reads far higher than it is.
- **Leads too new to have finished a day are excluded from that day**, and the
  count is shown against it. Without that guard every later day sags toward zero
  purely because the window ended.
- **A lead booked on day 1 leaves the denominator from day 2 on.** They are no
  longer an open opportunity, so counting them as "called and didn't book" would
  understate every later day.

Booking time is when the appointment was created, not the slot it was booked
into: a Tuesday call that books an appointment for next month converted on
Tuesday. Days under 20 leads are dimmed, and the headline reports how far the
day-0 return holds rather than the largest single drop - which is almost always
day 0 to day 1 and tells nobody anything they can act on.

The calls ride the existing day-chunked call export, which already caches per
day, so the only new request is the small one: each lead's arrival and booking
time. 66 assertions cover the bucketing, the censoring, the attribution rule and
the headline.

Also fixed: `scope:usercalls` was never registered in the viewer permission map,
so a viewer granted the Call Reporting tab got a page of 403s. Both it and the
new cohort scope are now mapped to that tab, and `calls` and `lostreasons` were
missing from the viewer tab list entirely.

---

## v3.422.0 - 2026-08-20 · `PENDING` - Change log: real field names, and only completed entries

Two fixes, one shipped blind and one shipped wrong.

**The platform feeds now work.** v3.421.0 guessed at Windsor's field names because
the documentation was unreachable. The diagnostic panel it shipped with reported
exactly why both failed, and the field catalogue settled it:

- **Meta** uses `activity_*` fields, which live in their own Activities table and
  **cannot be queried alongside `account_id`** - Windsor rejects the combination
  outright. That single extra field was the whole failure. The account is now
  applied as an API-level `accounts` parameter instead.
- **Google** uses the `change_event_*` prefix. The unprefixed names were worse
  than an error: Windsor *accepted* them and returned 9,139 rows with every
  column null, which reads as "no changes" rather than "wrong field".

Because the Meta Activities table carries no account column to re-check the
scoping against, a tripwire runs on every response: account-level rows name the
account they belong to, and a correctly scoped response can only ever name one.
If two appear, nothing is shown at all rather than risk showing another client's
activity. Google needs no such trust - its resource names embed the customer id,
so every row is verified against the client's own account before it is shown.

**Only completed entries are shown.** The Optimisation Log rows were rendering as
"Meta · Optimisation" with nothing else on them - and worse, that "Optimisation"
was invented by the code where the sheet's own type cell was empty, describing a
change nobody had written down. A row now needs all four cells filled in: what
was changed, which campaign, the write-up, and the initials. Anything short of
that is counted and reported, never drawn.

The same principle now applies to the platform feeds, which are mostly machine
churn: billing charges, delivery notifications, review-status flips and Google's
asset bookkeeping are filtered out, and one decision applied to many objects
(pausing forty ads in a burst) collapses to a single line carrying a count
rather than forty. Everything filtered is counted in the header, so the feed
never quietly shrinks.

71 assertions cover the two APIs' real response shapes - captured from live
pulls, not imagined - the completeness rule, and the collapsing invariants.

---

## v3.421.0 - 2026-08-20 · `PENDING` - Change log: platform history beside the team's own notes

The Optimisation Log tab held one source - the client's Google Sheet, which is
the record of *why* something was changed. It said nothing about what was
actually done in the ad accounts, including changes made by automated rules or
by anyone outside the team.

The tab is now **Change Log**, with four views:

1. **All paid channels** - Meta, Google and the sheet merged into one timeline,
   newest first. This is the point of the whole thing: a step change in
   performance can be read against the change that preceded it, and a platform
   change with no matching log entry is a change nobody wrote up.
2. **Meta change history** - Meta's ad activity log, read live through Windsor.
3. **Google change history** - Google Ads' change history, likewise.
4. **Caalano Optimisation Log** - the existing sheet view, unchanged.

Platform rows carry the actor, the entity, which settings moved and the before →
after value where the platform reports one. Every view has search and a channel
filter, and rows are badged **Platform** or **Logged** so the record of what was
done never gets confused with the record of why.

Windsor flattens Google's `change_event` resource and Meta's activity log under
different field names, so each channel tries an ordered list of candidate field
sets and takes the first that returns dated rows. When none does, the tab says
so and - on request - shows exactly which field sets were tried and what the API
said about each, so a wiring problem is diagnosable from the screen instead of
looking identical to an account that simply had no changes.

The date range at the top of the page scopes the history, and the response is
cached for five minutes since change history moves slowly.

Also fixed: the Change Log tab was offered by the client workspace but never by
the viewer tab picker, so it could not be granted to a client at all. It is now
in both lists, behind the same permission check as every other tab (the backend
scope is mapped to the `optlog` grant, so a viewer reaches it only if that tab
is ticked for them in Settings).

---

## v3.420.0 - 2026-08-20 · `PENDING` - Pivot cells you can actually compare

The channel columns in the Lost Reasons pivot were raw counts, and a raw count
there answers almost nothing: 286 "could not contact" under Paid Social is large
mainly because Paid Social is large. Reading down a column told you which channel
is biggest; it did not tell you what is different about it.

Cells now have three readings, picked from a new **Cells show** control:

- **Deals** - the raw count, as before.
- **% of column** - the share of *that column's own* losses, so a column of 700
  and a column of 40 are read on the same scale. Each cell carries a light bar so
  a column can be scanned without reading every number.
- **vs all (pp)** - that share minus the same row's share of every loss in the
  period, in percentage points. Positive (red) means the column loses deals to
  that reason more often than the business does; negative (green) means less.

The divisor is never hidden: every column heading now prints its own total, and a
totals row closes the table. Columns holding fewer than 20 losses are dimmed,
because a couple of points there is one deal moving.

The comparison is honest by construction - weighted by column size, the cells
across a row cancel back to that row's overall share, so a positive figure is
real concentration rather than an artefact of the divisors. That invariant is
asserted in the pivot test suite (347 assertions) alongside the reconciliation
checks, and every cell's hover shows the count, both percentages and the
difference together, so the number on screen is always traceable to the deals
behind it.

---

## v3.419.1 - 2026-08-20 · `PENDING` - The hovered reason leads its own tooltip

Hovering a segment gave you `QUALIFIED · NOT RIGHT NOW` in small faint-grey
uppercase - the reason, which is the thing under the cursor, buried in a caption
alongside its group and set in the least readable style on the card.

The reason is now the headline: full-strength ink at 13px, with the segment's own
colour swatch beside it, so the mark being pointed at and the label being read are
visibly the same series rather than something to match up by memory. The group it
belongs to moves to a small line above, which is what that quiet style is for.

Applies to the reason-mix bars and the composition segments alike. Measured in
both themes: the title now sits at full text colour against the card, where it was
previously the same faint grey used for captions.

---

## v3.419.0 - 2026-08-20 · `PENDING` - A denominator for the arrival breakdowns

"Overnight had 139 lost, 13% of all losses" reads like a finding and is not one.
If overnight is also 13% of the leads, it is exactly average - the share tells you
where something happened, never whether it happened more than its fair share. The
number was missing its denominator.

On **Won · by arrival** and **Lost · by arrival**, the breakdowns now carry two
more columns: **Leads** - how many arrived in that bucket - and **% won / % lost**
within it. So overnight being 13% of losses is read against overnight being some
share of leads, and the two together say whether the hour is genuinely worse or
merely busier.

The account average is stated under the table and a bucket is highlighted only at
more than 20% either side of it, and only with at least twenty leads behind it - a
rate on a handful of leads is shown but never flagged.

The rate is losses over **leads that arrived**, which is the question as asked.
Leads still open sit in that denominator, so it reads as a floor rather than a
final figure; hovering a row gives the same rate over decided deals alone, which
is the stricter number.

Only the arrival-derived measures get this. Bookings and appointment slots do not,
because dividing bookings by the leads that arrived in the same hour is a ratio of
two different populations rather than a rate.

**Time in stage moved to the bottom of the Timing tab**, after Speed to Lead. It
was already collapsed by default; it is a diagnostic you go looking for, not
something to scroll past on the way to the timing work.

---

## v3.418.1 - 2026-08-20 · `PENDING` - Fix: "paidOpen is not defined"

The Paid performance block from v3.418.0 was inserted into `TimingView` instead of
`EnquiryTimesSection`. Its state lives in the latter, hence the error - but the
worse half is that `d` means different things in the two components. In
`EnquiryTimesSection` it is the enquiry-times payload the section needs; in
`TimingView` it is the Speed to Lead payload. Had the identifier resolved, the
section would have rendered against entirely the wrong data rather than failing
loudly. Moved to the component that owns both its state and its data.

**On the guard.** This is the third runtime break of this shape - code that
compiles cleanly and dies on render - and unlike the previous two it was not a
subtlety but a block landing in the wrong scope. I wrote a checker for it twice
and threw both away: the first flagged hundreds of false positives from JSX text,
the second misreported which function a line belonged to. Neither was trustworthy,
and a check people learn to ignore is worse than no check.

Doing it properly means real scope analysis over a parsed tree rather than a third
regex approximation, which is its own piece of work and not something to bolt on
while fixing a live break. The two checks that ARE sound - nested declarations and
declaration order - still run on every build.

---

## v3.418.0 - 2026-08-20 · `PENDING` - Paid performance by time of day

A new collapsible section under the timing grid, joining two feeds that had never
met: **ad spend broken down by hour**, and **CRM leads placed at the hour they
arrived**. Cost per lead and cost per won deal, by part of day or by hour, split
All paid / Meta / Google.

Cost per won deal costs a win against the hour its **lead** arrived, not the hour
it closed - a deal that took three months to close is still attributed to the hour
that bought it, which is the only way the number answers "was that hour worth
buying".

**Whether the cost columns can exist is not something to assume, so the code finds
out.** Meta can break spend down by hour of day and Google Ads has an hour
segment, but whether Windsor surfaces either for a given account is
account-and-connector dependent. The build tries the plausible field names for
each platform, keeps whichever actually returns hours, and reports what it found.

When no hourly breakdown comes back, the cost columns are **left out** and the
section says so, including which fields were tried. The alternative - dividing
daily spend evenly across twenty-four hours - would produce a cost per lead this
dashboard invented rather than one either platform reported, and it would be
lowest exactly where spend is thinnest, which is precisely backwards.

The lead and conversion columns are unaffected either way, and they carry most of
the decision on their own: an hour whose leads rarely convert is worth less
regardless of what it cost. So the section is useful before the join works and
better after.

Paid only, by definition - leads whose first touch carried a Meta or Google UTM.
Organic, direct and referred are excluded because there is no spend to divide by.
Rates are withheld below six decided deals in a row, and cost per lead is
highlighted at more than 25% from the paid average as a flag to look, not a
verdict.

Tested on the blend: both channels' leads and spend sum correctly per block, the
two channels partition the paid total exactly, an hour with no wins yields no
cost-per-won rather than infinity, hourly and block cuts agree on both totals, the
day-parts tile twenty-four hours exactly once, and with no spend available the
lead columns are unchanged and no cost is conjured from nothing.

---

## v3.417.1 - 2026-08-20 · `PENDING` - Label every hour on the grid

The hour axis was labelled every third column, which looked tidier and meant
counting columns to work out which hour a cell was - the one thing the grid exists
to tell you. All twenty-four are labelled now.

Midnight and noon are weighted slightly heavier so the halves of the day are
findable at a glance rather than being two more labels in a row of twenty-four.

Measured rather than eyeballed, since twenty-four labels in that space is exactly
where they would start colliding: at 1600px, 1360px and 1180px there are no
overlapping labels, nothing clipped, and the grid still does not scroll sideways.

---

## v3.417.0 - 2026-08-20 · `PENDING` - The timing screen becomes measure × granularity

Restructured around the two things being chosen, which were previously tangled
together: **what is being counted**, and **how the day is cut**.

**Eight measures.** Leads arrive · Booking made · Appointment slot · **Won by
arrival** · **Lost by arrival** · Marked won · Marked lost · Key event. The two
new ones are the point: leads that went on to be won or lost, placed at the hour
they **came in** - not the hour someone got round to marking them. That data was
already in the grid (each arrival cell carries the outcome of the leads in it) but
was only reachable inside the win-rate table, never as a view of its own.

The by-arrival and by-marked pairs sit side by side deliberately and are named for
their clock, because they answer opposite questions: arrival is about the lead,
marked is about when the team works.

**Four granularities, applying to whichever measure is selected.** Grid (day ×
hour), Hour of day, Part of day, Day of week. The grid shows where a measure
concentrates but makes a total hard to read - the eye cannot add twenty-four cells
across a row - so the marginals do the adding, with the count, the share, and the
busiest bucket called out. Rows outside the client's working hours are shaded on
the hourly cuts, where knowing which hours those are is the point.

Parts of the day are the seven blocks that already existed - Overnight, Early
morning, Morning, Early afternoon, Late afternoon, Evening, Late evening - and are
tested to tile all twenty-four hours exactly once.

**A window test and a plot for the arrival cohort.** Won / lost by arrival gets a
24-bar chart: bar height is the win rate for leads arriving in that hour, the row
beneath is how many leads that hour brings, and a dashed line marks the account
rate. Hours below the confidence floor are drawn hollow, because a solid 0% column
built on one lost deal is the most confident-looking lie the chart could tell.

Under it, a window you choose: **from** and **until**, wrapping past midnight, so
"noon to 3am" is one selection rather than a boundary problem. It compares that
window against every other hour with a two-proportion test - the right test here,
because comparing a group to the account average is comparing it to something that
already contains it, which drags everything towards no difference. The selected
hours are shaded in the chart above, so the verdict and the shape are read
together.

The pipeline filter applies to the three arrival-based measures and not to the
booking or status clocks, where no pipeline split exists - filtering those would
have shown unfiltered data under a filtered label.

Tested: every marginal counts each lead exactly once across all three cuts, the
blocks tile the day without gap or overlap, a lead won later stays at its arrival
cell, the midnight wrap partitions the day for every window tried, and the
two-proportion test refuses a thirty-point gap built on four deals while accepting
the same gap on forty.

---

## v3.416.0 - 2026-08-20 · `PENDING` - Say which clock each view is on

Two things on the same toggle row were using opposite clocks and both were called
"won" and "lost", which is a trap rather than a feature:

- **Won / lost by arrival** (Leads arrive → the third mode) groups leads by the
  hour they **came in** and scores them on what became of them. This is the
  cohort view - the one that answers whether a 2am lead is worth less than a 2pm
  one, and the one worth acting on, because arrival time is something media buying
  controls.
- **Marked won / Marked lost** (their own tabs) group deals by the hour they were
  **marked**. That is the closing clock, and it mostly describes when your team
  works.

Both are useful and they answer opposite questions, so the clock is now in the
name. The tabs read "Marked won" and "Marked lost" rather than "Deals won" and
"Deals lost", the mode reads "Won / lost by arrival" rather than "Win rate", the
heading above the table says arrived in bold, and each control's tooltip names its
clock and points at the other one.

No calculation changed. The arrival view was already anchored to the lead's
creation time and the marked views to the status-change time; only the labels were
ambiguous about which was which.

---

## v3.415.2 - 2026-08-20 · `PENDING` - Fix: "Cannot read properties of undefined (reading 'map')"

The dead-zone fix in v3.415.1 was correct and revealed a second fault behind it -
the first error was thrown early enough to hide the second.

Speed to Lead guarded its loading, error and empty states with `!scan`, on the
assumption that a scan only existed once someone pressed the button. Making the
scan automatic in v3.415.0 broke that assumption in one move: `scan` is now truthy
from the first render, which switched off **all three guards at once**, and the
body ran against an empty object while the sampled fetch was still in flight -
`d.buckets.map` on undefined.

The guards now key off whether there is a payload to draw, which is what they were
always actually asking. A scan result is adopted only when it carries one, so a
not-connected or errored scan response falls back to the sampled view instead of
replacing a working screen with a crash.

**The chain is now a function with a test.** It has failed at runtime twice while
compiling cleanly, so `speedViewState(st, scan)` was pulled out of the component
and tested against the payload shapes the two fetches actually return: a scan
running while the sample loads (the exact crash), scan responses of `{ghl:false}`,
`{connected:false}`, `{status:'err'}`, `{}` and `null`, a complete scan replacing
the sample, and the genuine loading, error and empty states. Plus the invariant
that matters more than any single case: across every combination, the one state
that renders the body always carries the arrays the body maps over.

The static checker added in v3.415.1 could not have caught this one - it is a
runtime shape problem, not a declaration-order problem. Different fault, different
guard.

---

## v3.415.1 - 2026-08-20 · `PENDING` - Fix: "Cannot access '$' before initialization"

A one-line ordering mistake in v3.415.0 took a whole view down behind the error
boundary. Setting up the automatic Speed to Lead scan, its cache key was written
above the value it reads:

    const scanKey = `${clientId}|${rangeQuery(range)}|${hq}`
    const hq = hoursQuery(hrs)

That is legal JavaScript and compiles without a word, because it is only wrong
when it runs. Unlike an effect or a hook callback - which execute after the
component body has finished, by which point every binding exists - this line is
evaluated during render, so it reads `hq` while it is still in the dead zone and
throws. Moved below its dependency.

**And a guard, because the build had nothing to say about it.** This is the second
failure of the same shape: legal code, clean build, view dead at runtime. The
first was a component defined inside another function, which produced
`scripts/check-toplevel.mjs`. This one produces `scripts/check-tdz.mjs`, which
walks each component body and reports any immediately-evaluated initialiser that
reads a `const` or `let` declared further down. Function bodies and hook callbacks
are skipped, since they genuinely run later; strings, comments, property accesses
and object keys are stripped first, or `c.prev` would be reported as a reference
to a local `prev`.

Verified the way a checker has to be: the real bug was put back, the checker
failed on it and the build still passed - then the fix was restored and the
checker went quiet. Both checks now run on `npm run build` and `npm run check`.

---

## v3.415.0 - 2026-08-20 · `PENDING` - Speed to Lead scans the whole cohort by default, and a pipeline selector

**Speed to Lead no longer defaults to a sample.** It read the sixty most recent
leads of a hundred and eighty and asked you to press a button for the rest, which
is a number nobody wants to reason about and a button nobody should have to find.

The sample was never the right answer - it exists because reading every lead's
conversations cannot fit inside one request. The chunked whole-range scan already
existed behind that button; it now starts on its own, and the sample is only what
fills the screen while it runs.

What makes that affordable is that a completed scan is stored per client and date
range, so the second visit returns it immediately at no cost. The frontend used to
send `reset=1` on every scan, which threw away a finished scan and paid for it
again - the automatic poll does not reset, and only the explicit **Re-scan**
button does. A completed scan of a range that includes today is rebuilt after six
hours, since that range keeps changing; a range wholly in the past cannot change
and is kept.

**A pipeline selector on the arrival grid.** A client running two pipelines is
running two businesses through one CRM, and "do late-night leads convert" can have
opposite answers in each - pooling them describes neither. The selector appears
only when a client has more than one, and covers the volume, booking-rate and
win-rate views.

The per-pipeline grid is not split by channel as well: that cross-product is
pipelines × channels × 168 cells for a question nobody has asked yet. So choosing
a pipeline hides the channel chips and says "all channels · this pipeline", rather
than leaving Meta lit above data it is not filtering - which would be a plain
lie rather than a limitation.

---

## v3.414.0 - 2026-08-20 · `PENDING` - Hour by hour, and the counts show even when the rate cannot

Two corrections to the win-rate view shipped an hour ago, both from the same
misjudgement: it was built to defend a rate, when the question was also about
seeing the raw counts.

**Hour by hour.** The previous view pooled midnight to 6am into one Overnight
band, which answers "do overnight leads convert worse" but not "is 1am
specifically bad" - the actual question. There are now three granularities: every
hour on its own row, the seven time-of-day bands, and day of week. Hourly rows
stay in clock order rather than being ranked by rate, because sorting twenty-four
hours by win rate scatters the night across the table and destroys the very
comparison the view exists for.

**Thin buckets show their counts instead of vanishing.** Anything under twelve
decided deals was dropped from the table entirely - so at exactly the odd hours
you would want to inspect, there was nothing at all. Every bucket that saw a lead
is now listed. Below the floor it shows leads, won, lost and open, and declines
only the rate and the verdict: "three leads at 2am, one won" is a fact worth
seeing, while "33% win rate at 2am" is not a fact.

**Won, Lost and Open are separate columns**, rather than a single Decided figure.
The question was how many are marked won and how many lost, and a combined
denominator answered a different one.

Tested on the hourly rollup: an hour aggregates across every day, an hour with no
leads is present at zero rather than missing, every lead lands in exactly one
hour, a still-open lead counts as open rather than as a loss, and the floor
correctly separates the hours that can carry a rate from the ones that cannot.

---

## v3.413.0 - 2026-08-20 · `PENDING` - Does the hour a lead arrives predict whether it converts?

A **Win rate** mode on the leads grid, beside Volume and Booking rate. Leads are
grouped by the hour they were captured and scored on what became of them, so this
asks whether arrival time predicts conversion - something media buying can act on
- rather than when the team happens to close deals, which is what the won/lost
views added in v3.412.0 show.

**The denominator is decided deals**, won plus lost. A deal still open has not
converted and has not failed to, and counting it as a failure would penalise
whichever hours happen to hold the most recent leads. The open count is stated so
you can see how much is still in flight.

**The honest part is the refusal to find a pattern.** The grid has 168 cells; a
client with two hundred leads averages barely one per cell, and a win rate on one
deal is 0% or 100%, which always looks like a finding. So the grid shows no rate
below six decided deals in a cell, and the actual reading happens underneath on
the margins - by time of day in seven bands, or by day of week - where the counts
can support a number.

Even there, "evenings convert at 37% against an account rate of 27%" is worth
nothing without knowing whether that gap survives the sample. Every row carries a
Wilson interval, drawn against a tick at the account rate, and a row is called
better or worse only when its whole interval clears that tick. On realistic data
most rows come back **no clear difference**, which is usually the true answer and
is the entire reason to build this rather than a bar chart that always crowns a
winner.

The interval is deliberately wider than a plain 95%. Testing seven buckets at 95%
each gives roughly a one-in-three chance that one looks remarkable by luck alone,
so the threshold is widened for the number of comparisons being made - with seven
bands that is about 2.7 sigma rather than 1.96. Buckets under twelve decided deals
are not ranked at all: a lopsided four-of-five would clear the interval on its own
and the floor, not the interval, is what stops it being shown.

Tested on the statistics rather than the layout: that one win from one deal is not
100%, that zero from five is not 0%, that intervals stay inside [0,1] where the
textbook approximation goes negative, that a bigger sample narrows the interval,
that the comparison correction only ever tightens the bar, that a dramatic small
bucket never reaches a verdict, and that every bucket reconciles - leads equals
won plus lost plus open.

---

## v3.412.0 - 2026-08-20 · `PENDING` - When deals are won, lost, and reach a key event

Three more views on the time-of-day grid, beside Leads arrive / Booking made /
Appointment slot.

**Deals won** and **Deals lost**, by the hour the deal was *marked*, not the hour
the lead arrived. Filtered on that clock too, so a deal that came in months ago
and closed this week counts in this week - which is the whole point of the view.
Worth reading with one eye open: this is largely a picture of when your team
works, and only tells you something about the customer where the customer is the
one deciding. The note under the grid says so.

**Key event** shows when deals entered the stage they are sitting in now, with a
picker when a client has several stage-based key events. The honest limit is
stated on the grid rather than left for someone to discover: Caalano Systems keeps
only the most recent stage move, so a deal that passed through a stage and moved
on leaves no record of when it did. This is the deals currently there, not
everyone who ever reached it. Deals with no stage-change date at all are left out
and counted, rather than dated from when the lead arrived - a different clock, and
using it would put the deal in the wrong hour rather than in no hour.

The backend sends these as flat 168-slot arrays (day × 24 + hour), one per stage,
which is a fraction of the payload a nested object per stage would be. The
frontend reshapes them into the same structure the lead grid uses, so the
business-hours split, the heat scale, the peak-hour and best-day figures and every
cell all work across the new views with no special case.

Which key events appear is read from the client's own settings and filtered to the
stages that actually have deals in them - a key event pinned to a stage nobody is
in has no clock to report. The backend still knows nothing about key events.

The channel and self/staff toggles are hidden on the new views, where they would
be meaningless: a won deal has no self-booked distinction.

Tested on the reshape, where a day/hour indexing error would silently rotate the
entire heatmap and look perfectly plausible - Monday 9am, Friday 5pm and the last
slot of Sunday all land where they should, no count is lost, and the weekday
mapping used for the business-hours split holds.

---

## v3.411.0 - 2026-08-20 · `PENDING` - Funnel order for funnel dimensions, and proper hover cards

**Stage and key event now read in funnel order, everywhere** - the filter list,
the charts and the pivot's rows and columns. Ordering a funnel by how many deals
died in each step puts the end above the start whenever more died late, which is
exactly backwards for the one dimension that has an inherent sequence. Reasons,
campaigns and the rest keep volume order, which is the useful reading when there
is no sequence to follow.

The hard part is that **two pipelines are two different funnels**, and there is no
single sequence across them. The first attempt took each stage's shallowest
position anywhere, and the test caught what that does: a stage sitting first in
the smaller pipeline outranked the dominant pipeline's genuine first stage, so the
list opened in the middle of the funnel. Stages are now grouped by pipeline and
ordered within it, pipelines ordered by how many deals they lost, and a stage name
that exists in several is placed under the one that actually contributed most of
its losses - so it appears once, where it carries its weight. With a pipeline
filter on, that pipeline's own sequence applies and nothing else does.

Which columns to show is still a volume question - the six biggest - but where
they sit is not, so they are put back in funnel order afterwards.

**The charts use the app's hover card instead of the browser's tooltip.** The
native one is unstyled, slow to appear and can only carry a single line, so a
stacked segment could say "meta · Follow up sent: 28 of 74 (38%)" and nothing
else. Each mark now shows the same card the key-event scorecards use: a title and
labelled rows - deals lost, share of that row, and the row's total. The anchor
carries the segment's own width, so the hit target is the segment rather than the
whole bar.

Channel values are labelled the way the rest of the app labels them, so a
client-facing chart reads "Meta" rather than "meta".

---

## v3.410.0 - 2026-08-20 · `PENDING` - Lost Reasons gets a visual layer, with the pivot underneath

The pivot answers any question you can phrase. It does not tell you which
question to ask. Above it now sits a read-at-a-glance layer, and the table stays
exactly as it was for working a specific question.

**Why deals are lost** - the reason mix, ranked, with count, share and value on
every row. One series, so no legend and no axis to read against: the numbers are
printed beside the bars.

**Two composition charts, side by side, each with its own dimension picker** -
channel and key event by default, switchable to pipeline, campaign, ad set,
creative, keyword, source or stage. Each row is normalised to 100%, because the
question is whether the reason MIX differs between rows, and a raw stacked bar
answers "which row is biggest" instead - Meta will always dwarf Google on volume
and tell you nothing. The absolute count sits at the end of each row, where it
informs without distorting the comparison. Clicking a row filters everything
below it, charts and table together.

**Key event reached** is a new dimension, in the charts and the pivot both: the
furthest of the client's configured key events a deal got to before dying, judged
inside its own pipeline. Deals that never reached one group under "Before first
key event" - which is where lead quality shows up, as against sales execution. It
is derived in the browser from the client's own key-event settings, so the
backend never needs to know what a key event is and every client gets their own.

**Worth a look** - where a reason concentrates rather than where it is merely
common. "Budget is 25% of losses" is background; "Budget is 25% of everything but
41% of Google" is a thing to do something about. A row must have at least eight
deals, the reason at least three, and the gap at least eight percentage points -
a reason that is three of four deals somewhere is noise, and reporting it as a
finding is worse than saying nothing.

**On the colour.** The app's existing chart palette fails validation - its amber
sits outside the lightness band and three of its eight are under 3:1 on the
surface - so this section uses a validated set rather than inheriting that, and
rather than repainting the whole app in a release about lost reasons. Seven hues
in fixed order, everything rarer folded into one neutral; an eighth hue would be
generated rather than chosen, and that is where categorical palettes stop being
distinguishable. Dark mode is its own steps, validated against the dark surface,
not a flip of the light ones.

A reason's colour is assigned by its rank across **every** lost deal in the
period, not the filtered subset - so filtering never repaints the reasons that
survive, and "the blue one" means the same thing after a click as before it. That
property is tested, along with the fold-to-neutral and the signal floors: fifteen
assertions.

Several light-mode hues sit under 3:1 against the panel, so every figure is
printed beside its bar and the same numbers exist in the table below. Colour is
never the only way to read this. Stacked segments are separated by a 2px gap in
the surface colour rather than a border, which would add width and stop each row
summing to 100%. Rendered and measured at three widths in both themes: no page
overflow, no clipped labels, and stacked rows summing to within 0.1px.

---

## v3.409.0 - 2026-08-20 · `PENDING` - Time in stage says which figures are measured and which are guesses

Time in stage needs the moment a deal entered its current stage. Where the CRM
has no `lastStageChangeAt` the code fell back to the creation date, silently, and
that fallback is right in one case and wrong in another:

- A deal still sitting in the **first** stage has never moved, so the day it was
  created *is* the day it entered that stage. Correct, and not worth mentioning.
- A deal in a **later** stage demonstrably moved, and we do not know when. Using
  the creation date then reports time-since-the-lead-arrived as time-in-this-
  stage. A deal that spent three months in earlier stages and landed here
  yesterday reads as ninety days, not one.

The error only ever runs one way: the fallback overstates and never understates.
So a stage full of undated deals looks like a bottleneck whether or not it is one,
which is precisely the conclusion this table exists to support.

All three cases were indistinguishable from a measured figure. They are now
counted separately. Where any deal in a stage is an upper bound the stage's count
carries a `~n` marker naming how many, and the note beneath the table gives the
total and the share: *"41 of 210 deals (20%) have no stage-change date recorded,
so their wait is measured from when the lead arrived instead."* Past 40% it says
outright to treat the table as indicative rather than measured. A client whose CRM
records stage moves properly sees none of this.

Timing was the reason to do it now: v3.406.1 opened this section to client
viewers, so an inflated figure had just stopped being an internal-only problem.

Tested on the cases that separate a sound fallback from an inflated one, including
that the buckets partition (every deal counted exactly once), that an unresolvable
stage is treated as first rather than accused of inflating, and that the fallback
can only overstate.

---

## v3.408.0 - 2026-08-20 · `PENDING` - Stop refetching what has not changed

Two sources of repeated CRM work, both on the path the reliability log complains
loudest about. `ovrow` alone is 134 of the 367 slow entries, and it fires one
invocation per client per period - forty for an agency overview - each doing this
work from scratch.

**Calendar configuration was refetched on every appointment build.** The calendar
list and the service catalog are configuration, not data: they change when
someone adds a calendar, which is rare. They were being pulled fresh on every
call, and `fetchAppointments` has eleven callers, several of which run in the same
invocation. Two near-static reads, dozens of times per page load, against exactly
the rate limit the 429s come from.

Now cached the same way pipelines already are - memory for ten minutes, Blobs for
an hour, then the wire. A cold read costs two CRM calls; every later call in the
same invocation costs none, and a fresh invocation reads Blobs rather than the
CRM.

A failed calendar read is never cached. Storing it would mean every booking count
downstream quietly reading zero for the next hour, which is the failure mode this
codebase keeps having to fix. Instead it returns null and an error for the caller
to surface, and where a good copy already exists it is served rather than blanking
the bookings - the same last-good behaviour pipelines have.

**Identical appointment builds now share one pass.** Those eleven callers all ask
for the same location and window and each paid for its own walk over every
calendar's events. Concurrent callers now share a single build, and a
just-completed one is reused for fifteen seconds so sequential callers in the same
invocation do not repeat it either. Measured: eleven concurrent callers go from
eleven builds to one.

The window is deliberately shorter than any result-cache TTL already in play, so
it cannot introduce staleness the system does not already tolerate. Different
locations and different date ranges never share - that would not be a speed win
but a correctness bug, with the previous period showing the current one's
bookings. Sharing is only safe because no caller mutates what it gets back; the
two places that look like they do are building their own maps. A failed read is
not cached, a thrown build does not wedge the key, and the memory map is bounded
so a long-lived warm Lambda cannot grow without limit.

---

## v3.407.0 - 2026-08-20 · `PENDING` - A retry budget that fits the function it runs inside

A synchronous Netlify function is killed at about 26 seconds. A single upstream
fetch was allowed 9 seconds and up to three attempts, so one slow dependency
could spend 27 seconds plus backoff - a retry budget larger than the invocation
containing it. The CRM path was worse still, adding cooldown waits of up to 6
seconds per attempt on top.

Past the second attempt the retry cannot help. There is no time left to return
anything with, so it only converts a slow request into a dead one. That is the
shape of the `speed` and `health` entries sitting at 23-26 seconds in the
reliability log, right against the ceiling.

Every upstream fetch in an invocation now shares one deadline, set once at the top
of the request at 22 seconds - leaving room to assemble and return whatever did
arrive. An attempt's timeout is clamped to what remains rather than being timed in
isolation, a new attempt is not started with under 3.5 seconds left, and backoff
and cooldown waits are clamped the same way: waiting out a cooldown there is no
time left to use is just a slower failure. Worst-case upstream spend goes from
27s+ to 22s, and the caller gets a real "couldn't load" inside the budget instead
of the whole function being killed.

**Deliberately fail-safe, because the obvious version of this is dangerous.** A
warm Lambda keeps module state between invocations, so a budget left over from a
previous request would otherwise expire every call instantly - far worse than the
problem being fixed. An expired or unset budget therefore never produces a zero
timeout: it floors at 2.5 seconds and only suppresses retries. Worst case the fix
stops helping; it cannot start failing requests on its own. The budget is also set
on every request rather than once, so a stale one is never inherited.

The scheduled warmer gets ten minutes instead of 22 seconds: it is a background
function whose entire job is the deep page an interactive request cannot afford.

Tested against the real helpers: a full budget passes the requested timeout
through untouched, a nearly-spent one clamps to what remains, an expired one still
yields a usable timeout and never zero, and an unset one behaves exactly as the
code did before this change.

---

## v3.406.1 - 2026-08-20 · `PENDING` - Client viewers can see the whole Timing tab

The Timing tab renders three sections and a client viewer could only load one of
them. Scope permissions deny by default, and the two sections built after that
map was written - **When enquiries arrive** and **Time in stage** - were never
registered in it. A viewer granted the Timing tab therefore got Speed to lead
working beside two panels that always returned 403.

Both are now mapped to the Timing tab, which is the permission check rather than
a bypass of it: `viewerAllowed` requires the viewer to hold that tab, so these
reach a client only if Timing is ticked for them in Settings - exactly the rule
Speed to lead already followed. A viewer without the tab still gets nothing.

Verified against the shipped map and predicate rather than a restatement of them:
a viewer with Timing reaches all three sections, a viewer without reaches none,
a viewer with no tabs recorded treats the two new scopes identically to Speed to
lead, deny-by-default still refuses unmapped and staff-only scopes, and a
Timing-only viewer still cannot reach the CRM drill.

---

## v3.406.0 - 2026-08-20 · `PENDING` - The 429s: a shared cooldown, a build election, and a correction

### Correction to v3.405.0

The reliability-log fix shipped in v3.405.0 did nothing. It was written around
conditional writes - `setJSON(key, value, { onlyIfMatch })` - and the Blobs client
this app is on (8.2.0) has no such thing: `setJSON` takes `{ metadata }`, ignores
anything else, always writes, and returns `void`. The retry loop therefore read
`undefined` as success, wrote unconditionally on the first attempt, and behaved
exactly like the code it replaced.

It passed its test because the test's mock implemented conditional writes. The
mock was more capable than the library. Both are rewritten below against a mock
that mirrors 8.2.0 exactly - `setJSON(key, data)` writes and returns nothing.

### The reliability log, properly this time

There is no compare-and-swap available, so contention cannot be arbitrated. It can
be removed. **Each entry is now its own blob**, keyed by timestamp: nothing is
read before writing, nothing is merged, and two writers cannot collide because
they are not writing to the same place. Measured against the 8.2.0-accurate mock:
one shared blob keeps 2 of 40 concurrent writers, one blob per entry keeps 40 of
40, and 80 of 80.

Sharding across twelve keys was tried first and rejected: it only reached 15 of
40, because each shard is still read-modify-write.

The viewer lists a day's keys, takes the newest by the timestamp in the key, and
fetches those in batches - more work on a page a superadmin opens occasionally,
none on the hot path. The old single-blob key is still read, so days logged before
this change stay visible.

Expect the next export to show MORE failures than the last one. That is the
instrument being fixed, not the app getting worse.

### The 429s

Five in the last window, mostly on the largest client, and the log shows the
shape: three scopes for one location erroring within ten seconds of each other.
Two causes, both fixed.

**The cooldown was per Lambda instance.** On a 429 the governor set a module-level
cooldown so "every other GHL call waits too" - but a client dashboard opens six
scopes as six separate invocations, each with its own fresh module and its own
cooldown of zero. The one that hit the wall backed off precisely the calls that
were not the problem. The cooldown now lives in Blobs, keyed by location, read
through a short in-memory TTL so a burst costs about one extra read per second per
instance. The module-level value is kept as the local fast path and still wins
when it is later.

**And the burst that earns the 429 is self-inflicted.** On a cold snapshot all six
invocations page the same location's opportunities at the same moment. Build
coalescing existed but was also per-instance. Now the first arrival claims the
right to page and the others wait for its copy.

With no compare-and-swap there is no true lock, so it is a leader election over
last-write-wins: every racer writes its own random id, waits for the writes to
settle, and reads back - exactly one finds its own id and leads. Across 40 trials
at 2, 6 and 12 racers it elected exactly one leader every time and never zero. A
missed election just means two invocations page instead of one, which is the old
behaviour for two of six rather than for all six; it cannot deadlock, because an
unreleased lock expires after 20 seconds and the next arrival takes over. Time
spent waiting is deducted from the paging budget rather than added to it, so
waiting politely cannot itself cause the timeout.

Simulated as the log describes it - six invocations, one location, cold cache,
against a CRM that rejects past a burst budget - the before case makes 90 CRM
calls, eats 72 rejections and fails three of the six scopes outright, which is
what the log shows. After: 6 calls, no rejections, one build and five waits.

---

## v3.405.0 - 2026-08-20 · `PENDING` - Three reliability fixes traced from the failure log, and a stage-match filter

Read against the 14-day reliability export (400 entries, 25-28 Aug): 367 slow,
24 errors, 8 browser-side 502s.

**18 of the 24 errors were one bug.** Every "This operation was aborted" landed
between 7.7s and 9.1s - the 9s upstream fetch timeout. Inside three separate
`Promise.all` blocks, the *prior-period* ad reads had been made resilient with
`.catch(() => [])` and the *current-period* ones sitting beside them had not. One
Windsor blip on the current period therefore rejected the whole block and took
its successful siblings down with it, including the CRM half of the payload that
had already returned. That is the shape of all nine `health` failures, three
`creatives` and six `anomalies`.

Now guarded - but an empty ad read must never be presented as a measured zero, so
each build carries a flag (`metaOk` / `googleOk` / `adReadOk`) saying the figures
are missing rather than low. This extends the pattern the agency alerts already
used, where a failed baseline read is tracked precisely so the UI cannot give a
confident all-clear it has no basis for.

**The reliability log was losing the failures it exists to record.** `diagLog`
read the day's blob, pushed an entry and wrote it back, with no conditional
write. Two overlapping invocations clobber each other - and overlapping
invocations are exactly what a fan-out is, which is exactly when things fail. The
log went quietest when it should have been loudest: simulated, an agency-wide
burst of 40 writers kept 2 of them.

Writes are now conditional on the etag just read, with exponential backoff and
jitter. Flat backoff is not enough - it just re-collides - and neither is a small
retry count: four flat attempts still lost two thirds of an 80-writer burst.
Eight attempts with proper backoff keep all 40 and 78 of 80, bounded to 800ms
because `diagLog` is awaited before the response. If an entry still cannot land it
is dropped rather than force-written, because the obvious fallback - one last
unconditional write - would clobber everyone else's entries to save this one,
which is the bug being fixed.

A first attempt at that fix called `sleep()`, which is defined in `ghl.mjs` and
never exported. `diagLog` wraps everything in a catch so diagnostics can never
break a request, so the ReferenceError would have been swallowed and logging
would have silently stopped altogether.

**Stage match.** The Stage lost at filter now has a companion dropdown: *at this
stage*, meaning the deals that were marked lost sitting in it, or *this stage or
later*, meaning every deal that reached it whatever stage it went on to die at.
Position is read inside each deal's own pipeline, so a stage name shared between
two pipelines at different depths is not treated as one position. The active
filter chip says which reading is in force, since the same stage name otherwise
describes two different populations.

Not fixed, and still occurring: the GoHighLevel 429s (5 in this window, mostly on
the largest client). The request governor caps concurrency and shares a cooldown
in module scope, which is per Lambda instance - opening a client dashboard fires
six scopes as six separate invocations, each independently entitled to its own
five concurrent CRM calls. That needs a shared cooldown, not a per-instance one.

---

## v3.404.0 - 2026-08-20 · `PENDING` - Stage in isolation or cumulative, and a tidier pivot

**Two readings of the stage cut.** "Lost at this stage" is where each deal
actually died: the rows are exclusive and add up to the total. "Lost at this
stage or later" counts every deal that got at least that far before dying, which
is the shape of the funnel rather than a partition of it - the rows overlap and
deliberately do not add up, and the note under the table says so rather than
leaving you to wonder why the column exceeds the header figure.

Position is read inside each deal's own pipeline. Two pipelines can carry the
same stage name at different points - "15 Minute Call" third in one and first in
another - so treating a shared name as a shared position would quietly mix them.
A pipeline that has no such stage at all is left out of that row rather than
folded in. Covered by a test built on exactly that case; a position-blind
implementation gives 3 where the correct answer is 5.

**Header collisions fixed.** The column headers carry live data - campaign and ad
set names - not fixed labels, and long ones ran into each other because nothing
clipped them. They now clamp to three lines with an ellipsis and the full value on
hover, in normal case rather than uppercase: shouting a machine-generated campaign
name makes it both wider and harder to read. Verified at four desktop widths: no
overlap and no sideways scroll.

**Controls moved into their own panel**, with the filters on top, the active-filter
chips beneath them, and the two pivot pickers below a rule. Choosing what the table
does is a different act from narrowing what goes into it, and nine dropdowns loose
above a table read as part of the table.

---

## v3.403.0 - 2026-08-20 · `PENDING` - Real campaign names, an ad set cut, and a baseline that survives filtering

**Platform ids become names.** The campaign column was showing rows like
`120213683170520253` and `22314183244` alongside properly named ones, because a
CRM UTM very often carries a platform id rather than a name - `utm_campaign` is
the worst offender. Those are now resolved through the Meta and Google id-to-name
maps the Forms scope already used. The lookup runs alongside the two existing
builds and hits Windsor rather than GoHighLevel, so it costs no extra latency and
nothing against the CRM rate limit; anything that does not resolve is left as it
was.

Resolving can collapse two entries onto one name - an id and its own name both
appearing in the list, or two ad ids sharing an ad group - so the dictionary is
rebuilt with duplicates merged and every deal re-pointed at the merged entry.
Without that you would get two identical-looking rows each holding half the
deals, which is worse than the ids were. Only a bare run of digits is ever
rewritten, so a real campaign name can never be replaced by an id collision.

**Ad set / ad group** joins the dimensions, read from `utm_medium` and resolved
the same way. Accounts that use `utm_medium` conventionally will see values like
"cpc" here instead, which the column tooltip says.

**A baseline that filters cannot move.** "Budget is 28% of Paid Social losses" is
not worth much on its own - it matters against Budget's share of every loss. With
any filter active, a **vs all** column appears showing the difference in
percentage points between a row's share of the filtered set and its share of all
lost deals. Positive means these filters concentrate it, which is the thing you
were looking for when you applied them.

Verified against a payload shaped exactly like the real one, covering the cases
that bite: an id whose name is already in the list, two ad ids sharing one ad
group, an id with no mapping, a non-numeric value that must be left alone, and
that resolving twice changes nothing. Value, contact and name columns survive the
re-indexing, and the merged rollups still total every lost deal.

---

## v3.402.0 - 2026-08-20 · `PENDING` - Lost Reasons becomes one filterable table

The tab could show one cut at a time: lost reasons by campaign, or by stage, or
by source. That answers "Paid Social lost 46" and "22 were lost at the 15 Minute
Call stage" but it cannot answer how many were both, because two totals cannot be
intersected. The question you actually want to ask is almost always a combination.

**One table, filters that stack.** Every dimension - reason, channel, source,
pipeline, stage lost at, campaign, creative, keyword - is now a filter, and any
number of them apply at once. Two more pickers choose what the table itself does:
which dimension runs down the side as rows, and which runs across the top as
columns. Hold Paid Social and the 15 Minute Call stage, put campaign down the side
and reason across the top, and the table tells you which campaign is producing
which kind of loss at that exact point in the funnel.

**Every filter's options are counted live** against the other filters, so a value
with nothing behind it is visibly zero before you pick it. Active filters are
restated as chips you can click to remove, because a row of dropdowns does not
make it obvious at a glance what is currently excluded.

**No refetch.** The backend now sends one row per lost deal rather than six
pre-computed rollups, dictionary encoded - the same campaign name repeats across
hundreds of rows, so the names are sent once and the rows carry indexes. Every
filter, group and cross-tab is then computed in the browser, so changing a filter
is instant and never hits the network. The channel filter, which used to re-pivot
the whole payload server-side, is now just another column.

Expanding a row lists the leads behind it as a table, with their form answers,
and joins back to the answer records by contact - the per-reason answer cap went
from 60 to 150 so a filtered group is far less likely to show blanks.

**A bug the tests caught.** Stack enough filters and a selected value can end up
with no rows at all - at which point it dropped out of its own dropdown, leaving
the control blank while the filter was still applied and nothing left to click to
undo it. A selected value now stays in its own list, showing zero. Found by an
invariant test over synthetic data (109 assertions: group counts sum to the
filtered total, columns plus Other reconcile on every row, each picker's counts
match the rows passing the other filters, rows and columns never collapse onto
the same dimension).

The eleven-column pivot was measured at every viewport from 1920px down; it fits
without sideways scroll on any desktop width.

---

## v3.401.0 - 2026-08-20 · `PENDING` - The lost-lead drill is a table

Opening a lost reason gave you a stack of cards, one per lead, each a paragraph
of labelled fields. That reads fine for one person and badly for thirty-three:
you cannot scan down a column, so noticing that most of them answered the same
way meant reading every card. Spotting that pattern is the entire reason for
opening the list.

It is a table now. Lead, stage when lost, source, value, and then the form
answers as columns.

**The answer columns are chosen, not fixed.** Form questions differ by client and
by form, so there is no column set that works for everyone. The three questions
that most of these particular leads answered become columns; a question only two
of thirty answered would be a mostly empty column, so it goes in the row detail
instead. Nothing is dropped - clicking a row still opens every answer, the full
source trail (opportunity source, channel, UTM source, UTM content) and that
contact's notes from Caalano Systems, loaded on demand as before.

The drill widens to 1180px for this view, since the answer columns are the point
of it, and the table holds its shape all the way down to a phone: fixed column
widths, long answers ellipsed with the full text on hover and in the row detail.
Measured from 1920px to 600px with no sideways scroll at any width.

---

## v3.400.0 - 2026-08-20 · `PENDING` - A Lost Reasons tab: why work does not close, cut six ways

Knowing 165 deals were lost and that 46 of them were "could not contact" is only
half an answer. The half that changes what you do is *where* those 46 came from.
A campaign whose losses are price is priced or targeted wrong; a campaign whose
losses are "could not contact" has a lead-quality or speed-to-lead problem. They
need opposite fixes, and the total on its own cannot tell them apart.

**New tab, six cuts.** Lost reasons by Pipeline, Stage lost at, Campaign,
Creative / ad, Keyword, and Source. Each is a matrix: the dimension down the
side, the six most common reasons across the top, everything rarer folded into
Other. Click any row for its full reason list; from there, click a reason for the
people behind it and what they typed on the form. A channel filter across the top
re-pivots the whole thing to Meta, Google or the rest.

**No new request.** The ccdrill scope was already resolving each deal's pipeline,
stage, campaign, creative, keyword and source while it counted lost reasons, and
throwing all six away. It now keeps the cut alongside the total. Same fetch, same
opportunity pass.

**The numbers reconcile.** Every deal carries exactly one lost reason, and a deal
missing a value for a dimension lands in a named "Not tagged" bucket rather than
being quietly dropped - so each of the six cuts adds up to the same lost total on
the scorecard. Where a dimension has more distinct values than the table shows,
the remainder is stated rather than left as an unexplained gap.

**Lost reasons on Caalano360 split by pipeline.** A two-pipeline client is really
two businesses sharing a CRM, and their reasons rarely look alike, so averaging
them describes neither. The picker appears only when there is more than one, and
scoping also narrows the people behind each reason - clicking "Budget" in one
pipeline no longer opens everyone ever lost on budget.

Deals are counted by the period they were created in, so a deal that arrived last
quarter and was lost this week is scored against the quarter it arrived. Reasons
come from the lost-reason list in Caalano Systems, which makes the size of the
"Unspecified" row a fair read on how consistently the team is setting one.

---

## v3.399.0 - 2026-08-20 · `PENDING` - Two pipelines side by side, and a pipeline filter on the map

**Revenue bottleneck.** A client with two pipelines got one funnel above the
other, each followed by its own open-by-stage list, so comparing them meant
scrolling past a screenful of one to reach the other - when the only reason to
show both is to read them against each other. Above 1280px they now sit side by
side, divided by a rule. Below that they stack exactly as before: half of a
narrow window is not enough for a funnel with four numeric columns. A third or
fourth pipeline wraps onto a second row.

**Lead locations.** A pipeline picker on the map, for the same reason - a
multi-pipeline client was looking at one map of two different businesses. No new
backend call: the forms feed already keeps per-location counts split by pipeline
(`byPipe`), and those four figures - leads, booked, won, lost - are exactly what
the map sizes and colours dots by. Choosing a pipeline re-derives the map from
those counts and filters the people behind each dot too, so clicking a dot lists
that pipeline's leads and nobody else's. Places with no leads in the chosen
pipeline drop off the map rather than plotting as an empty dot, and if the filter
empties the map entirely it says so instead of showing an empty frame. The picker
only appears when a client has more than one pipeline.

---

## v3.398.0 - 2026-08-20 · `PENDING` - Tables fit the screen instead of scrolling sideways

A sweep across every table in the app rather than another one-off fix. Four
causes, in order of how much damage each was doing:

1. **A global `table { min-width: 700px }`.** Every table in the app was
   forbidden from being narrower than 700px, including tables sitting in a 400px
   column whose content fitted comfortably. That is horizontal scroll invented
   out of nothing: a table can never need to be wider than its own content, so
   the floor could only ever hurt. Removed. This cannot make anything wider - a
   table whose content genuinely exceeds 700px was never affected by it.
2. **Header labels held their full single-line width.** "Speed to lead",
   "Calls / booked", "Rev / talk-hr", "Time to close" - each one set its column's
   width from the label, not the figures underneath. Headers now wrap onto a
   second line; data cells still never wrap, so no number breaks in half. This is
   the same treatment the rep leaderboard got last release, now applied to every
   table family.
3. **Long free-text cells could not wrap and so pushed.** Names, emails and
   campaign names are now allowed to wrap. Note that allowing a wrap is not
   forcing one - where there is room the text still sits on a single line, and
   the leaderboard keeps its ellipsis.
4. **Per-table width floors.** A handful of tables carry their own min-width so a
   nine-column table stays legible on a phone. Right on a phone, wrong on a
   desktop, where it forces a drag through space the window already has. Above
   the mobile breakpoint the floor is lifted; below it nothing changed.

Below 1360px, cell padding tightens from 10px to 6px a side before anything
resorts to scrolling - on an eleven-column table that is most of a column.

**Measured, not eyeballed.** Eleven of the widest tables in the app were rendered
against the real stylesheet at nine viewport widths and their wrappers measured
for overflow. Every one fits at 1280px and above, where the app is actually used.
The one exception below that is Terms acceptance at 1100px, an admin-only screen
that is 11px over with eight columns of free text. On phones, tables with nine or
more numeric columns still scroll, deliberately: the alternative is columns too
narrow to read.

---

## v3.397.0 - 2026-08-20 · `PENDING` - Why deals are lost, on the Caalano360 tab

The lost-reason breakdown only existed inside the monthly report, so answering
"why are we losing work" meant leaving the overview. It now sits on the
Caalano360 tab, directly above Revenue at Risk.

**Four tiles across the top**
- Deals lost, with the value attached to them.
- Deals won, with the revenue.
- Win rate - won divided by won plus lost, so it measures decided deals only
  and ignores everything still sitting open.
- Still open, with the value in play.

**The reason table** lists every recorded lost reason with the deal count, the
value written off, and each reason's share of all losses as a bar. Six show by
default; the rest sit behind a "show all" toggle. Where no reason was set on the
deal, the row is named as such rather than dropped, so the counts still add up
to the tile above.

No new backend call. The overall tab already pulls `scope=users`, which already
carries `lostReasons` per rep, and the existing aggregation already sums them
across the team - the data was arriving and being thrown away. Client viewers
who can see the overall tab can see this, on the same permission that already
governed the rep leaderboard next to it.

Deals are counted by the period they were created in, which is why the win rate
here can differ from a closed-in-period view: a deal that came in last quarter
and was lost this week is scored against the quarter it arrived.

---

## v3.396.1 - 2026-08-20 · `PENDING` - Rep leaderboard fits without scrolling

Fourteen columns that could not be seen without dragging sideways. Three things
were making it wide, and the third was the real one:

1. **`.appt-tbl` sets `white-space: nowrap` on every cell**, so each header held
   its full single-line width. "Cost / Won" and "Avg close" were among the widest
   columns in the table purely because of their labels. Headers now wrap to two
   lines; data cells keep nowrap so no figure breaks mid-number. That alone took
   14% off.
2. **Padding** tightened from 6px to 4px either side.
3. **A global `table { min-width: 700px }`** floor. Any table narrower than its
   content still refused to go below 700px, which no amount of column tuning can
   beat. The codebase already had the override pattern for it (`.cl-kv`,
   `.cl-fit`), and the leaderboard now uses it too.

With `table-layout: fixed` and column widths summing to exactly 100%, the table
is now the width of its container by construction, so it cannot scroll at any
screen size. Widths are proportioned to content - Revenue and the cost columns
get room, Won and Win% need little, the rep name absorbs the slack and ellipses
before any number does.

Verified at container widths from 520px to 1540px: no horizontal scroll at any
of them, all fourteen columns readable.

---

## v3.396.0 - 2026-08-20 · `PENDING` - Leads vs bookings vs slots, self-booked, and business hours

"When enquiries arrive" now separates **three clocks that were being conflated**,
and answers the three questions asked of it.

**Three views, because they are three different questions**
- **Leads arrive** - when the lead record was created. Split by channel.
- **Booking made** - when the appointment was booked.
- **Appointment slot** - the time it was booked *for*.

The last two are routinely mistaken for each other. Someone booking at 9pm for a
Tuesday 10am slot appears in a different cell of each grid, and only one of those
is a staffing signal.

**Self-booked vs booked by staff** on both appointment views. An appointment
created without a staff user attached came through a booking link; one with a
user attached was booked by your team. The header carries the totals: leads,
appointments booked, and how many of those were self-booked.

**Business hours, from that client's own Settings**
- A strip above the grid: how many landed **inside hours**, **after hours**, and
  on **non-working days**, with percentages.
- The grid itself frames them: non-working rows are dimmed rather than hidden,
  because a Sunday spike is exactly what you want to see, and dashed rules mark
  the open and close hours.
- Computed on the client from the hours setting, so it follows a change
  immediately and costs no extra request.

**The three questions**
1. *Best day for leads* - stated in the header line, alongside the busiest hour.
2. *What time slots do self-booked appointments land in* - Appointment slot view,
   Self-booked filter.
3. *Inside vs outside hours vs weekends* - the strip, on whichever view is open.

Verified: 15 assertions on the hours split, including the day-index shift (the
grid starts Monday, the hours setting uses Sunday-first), the 9am and 5pm
boundaries, that every cell falls in exactly one bucket, seven-day businesses,
and hours switched off.

---

## v3.395.0 - 2026-08-20 · `PENDING` - Movers: report the lost REASON, and colour the scope chips

**Lost reasons instead of lost status.** "Deals lost 15 → 34" is a fact you can
do nothing with. Which reason went up is one you can act on.

- When a single reason accounts for **half or more** of the rise, it becomes the
  mover: *Lost – Price 4 → 22*, with *"18 of the 19 extra losses · 34 lost in
  total (was 15)"* underneath. The bare status mover is suppressed so the same
  fact is not reported twice.
- When the rise is **spread** across reasons, the total is the honest story and
  the biggest contributor is named beside it: *"spread across reasons · biggest
  is Price (4 → 9)"*.
- A reason has to clear the same floors as anything else, so a jump from 0 to 2
  cannot hijack the headline.
- Reasons are carried on both bases, so this works under Closed and Created.
  Where reason data is unavailable it falls back to the total, as before.

`crmTrends` now resolves lost-reason ids to names, and the trends builder keeps a
small per-reason daily array. A location has a handful of reasons, so this is a
few short arrays rather than a new dimension.

**Coloured scope chips.** Meta, Google, Paid and CRM now carry the app's own
channel colours - the same blue and green used on the leaderboard and the health
alerts - so a row's source reads at a glance. Tinted rather than solid: a wall of
saturated chips would out-shout the numbers beside them. Light and dark checked.

---

## v3.394.2 - 2026-08-20 · `PENDING` - Fix: EnquiryTimesSection is not defined

The Timing tab threw **"EnquiryTimesSection is not defined"**. The component from
v3.394.0 was declared a few lines above where it was meant to go, but on the
wrong side of a closing brace: **inside another component's body**, after that
component's `return`.

That is legal JavaScript. A declaration after a `return` is unreachable but
valid, and the name is scoped to the enclosing function, so nothing complains at
build time. It fails only at runtime, only on the screen that renders it.

**Added a guard, because this shipped.** `scripts/check-toplevel.mjs` strips JSX
with esbuild and compares the function declarations the source puts at column 0
against the ones the parser puts at top level. Anything in the first list and not
the second is nested. It runs as part of `npm run build`, so a build now fails
rather than producing a bundle that breaks one screen.

Verified both ways: it passes the clean file (422 top-level declarations) and
fails a deliberately-nested copy, naming the file and line.

---

## v3.394.1 - 2026-08-20 · `PENDING` - Metric explanations: Super Admin only, full stop

v3.394.0 hid the methodology prose from client Viewers and put the rest behind a
global switch, so an Admin could still see it. That was not the intent.

- The prose now renders for a **Super Admin only**, and only while the switch in
  Settings &rarr; Appearance is on. Admins, staff and Viewers never see it at
  all, whatever the switch says.
- A new `SuperCtx` carries the role down to `Caveat`, which previously only knew
  whether the reader was a Viewer.
- Still removed from the tree rather than hidden with CSS, so for everyone else
  the text is not in the DOM to be found.
- The toggle's own copy says so, so it is clear that turning it on changes
  nothing on anyone else's screen.

Legacy single-password mode counts as owner, matching the `isSuper` rule used
everywhere else in the app.

---

## v3.394.0 - 2026-08-20 · `PENDING` - When enquiries arrive; collapsible sections; metric notes off by default

**When enquiries arrive** (Timing tab, above Time in stage). A weekday x hour
grid of lead creation times, split **All / Meta / Google / Non-paid**.

- Counted in the **business's own timezone**, which is the whole point: an
  enquiry at 8pm Sydney is 10am UTC, so counting in UTC smears the evening peak
  across the middle of the working day. Handles DST and half-hour zones.
- Two readings of the same grid. **Volume** shows where the enquiries are;
  **Booking rate** shows where they turn into something. They are often
  different hours, and that gap is the finding: an evening spike that books at a
  third of the daytime rate is a staffing answer, not a budget one.
- Rate cells below 5 enquiries are left blank rather than shown as a percentage,
  because one lead at 3am is not a 100% booking hour.

**Collapsible sections.** Time in stage is now collapsed by default; it is a
diagnostic you go looking for, and expanded it pushed the rest of the tab below
the fold. When enquiries arrive is collapsible too.

**Metric explanations are now off by default.** The 77 methodology paragraphs
that explain what each number counts are reference material, and having all of
them on made the product read like documentation rather than a dashboard. A
Super Admin turns them on globally in **Settings -> Appearance**. Client Viewers
never see them either way, as before.

---

## v3.393.0 - 2026-08-20 · `PENDING` - Key event drill: send the stage name, not the label

Clicking the **Qualified** tile opened an empty modal: "0 Meta-attributed people
&middot; No people found for this event in the selected range", while the tile
above it read 2.

**The cause.** The drill sent the event's *display label* as the stage to look
up, and `buildKeyPeople` matches a pipeline stage **by name**. For most key
events the label and the stage name are the same string, so it worked by
coincidence. Qualified is synthesised with a fixed label of "Qualified" and its
stage taken from Settings &rarr; Qualified lead, so it never matched.

**It was wider than Qualified.** Any key event given a custom label was broken
the same way. Rename "Strategy Session Booked" to "Discovery Call" in the label
field and its drill went empty too.

- `keyEventRows` now carries `ref` (the real stage name) onto the row it builds,
  which it had been dropping.
- The drill sends `ref` and falls back to the label, so nothing that worked
  before changes.
- Calendar events still prefer their linked stage, as they did.

**And it failed silently.** An unresolvable stage name produced an empty list,
which looks exactly like a stage nobody reached. `buildKeyPeople` now reports
`stageMissed`, and the modal says the stage no longer exists and where to
repoint it, rather than implying nobody qualified.

---

## v3.392.0 - 2026-08-20 · `PENDING` - Front door: new headline, a slogan, and the marks unboxed

- **Headline** is now *"The cheapest lead is rarely the best client."* It states
  the insight the product is built on rather than describing a journey, and it
  sets up the paragraph underneath instead of repeating it.
- **Slogan** replaces "Client Reporting": **Data that closes.** It reads two
  ways, both true here: data that closes deals, and data that closes the loop
  between what an ad cost and what it earned.
- **Private / invitation only** moved to the top right, balancing the brand mark
  and clearing the footer.
- **Marks unboxed.** The chips lost their pill background and border; the logos
  now sit on the panel with the platform name beside them, spaced further apart.
  Less furniture, and the marks themselves do the work.
- **Measure widened.** The headline runs to 19 characters a line and the
  paragraph to about 60, which is where prose reads fastest. Deliberately not
  the full panel width: a 100-character line is a wall, not a paragraph.

---

## v3.391.0 - 2026-08-20 · `PENDING` - Front door: real brand marks in the Syncs with row

Replaced the text chips with drawn brand marks: Meta Ads, Google Ads, Google
Analytics, TikTok Ads and Caalano Systems.

- Inline SVG, because the page must stay self-contained (its CSP allows no
  external origin and no remote image). Each mark is a named constant, so
  swapping in an official asset file later is a one-line replacement.
- **TikTok is now listed.** It is a supported connector on the data layer and an
  intended integration; the app does not pull from it yet.
- Instagram dropped back off. It was my addition rather than a request, and six
  chips wrapped the row onto a second line.

Google Ads was redrawn once: the first attempt crossed its two bars into an X
rather than the narrow lean the real mark makes.

**These are hand-drawn approximations, not the official files.** They read
correctly at 15px but they are not pixel-accurate, and both Meta and Google
publish assets with usage rules. Dropping the official SVGs into the constants
is the intended finish.

---

## v3.390.0 - 2026-08-20 · `PENDING` - Front door: tighter opening, and what it syncs with

- Cut the middle sentence from the opening paragraph. Three sentences became two
  and it lost nothing.
- Added a **Syncs with** row at the bottom right of the panel: Meta Ads, Google
  Ads, Google Analytics, Instagram, Caalano Systems.

**Checked against the code before listing anything.** The connectors actually
fetched are `facebook`, `google_ads`, the GA4 slugs, `facebook_organic` /
`instagram`, and `gohighlevel`. **TikTok was requested but is not listed**: there
is no TikTok fetch anywhere in the app, only string patterns that classify a
channel *name* containing "tiktok". On a page whose whole argument is that the
numbers are honest, an integration claim that isn't true is a bad first
impression. One line to add the moment it is wired up.

**Named in text, not redrawn as logos.** An approximated Google or Meta mark is a
distorted trademark, and both brands publish assets with usage rules that a
from-memory redraw would breach. Dropping in the official SVGs later is a
straight swap.

---

## v3.389.2 - 2026-08-20 · `PENDING` - Front door: lead with the actual proposition

The opening line described the market rather than the value: "built for service
businesses where work is won over weeks, not minutes" tells a reader who the
product is for, not why they should want it.

Replaced with the real gap the product closes:

> Ad platforms can tell you what a lead cost. They cannot tell you which leads
> became clients, because that happens in your CRM weeks later. Caalano360 joins
> the two, so you can back what brings in revenue and stop paying for what only
> brings in forms.

Names the problem, says why it exists, and states the outcome. The audience is
still implied by the six benefits underneath, which is where it belongs.

---

## v3.389.1 - 2026-08-20 · `PENDING` - Front door: sell the product, not the feature list

Rewrote the front door copy around what the product does for the business rather
than what it contains.

- Headline is now **"From lead to closed deal"**, positioned squarely at service
  businesses where work is won over weeks rather than in a single session.
- Six benefits in two columns, each led by the outcome and backed by the
  mechanism: which ad brought the *client* (not the lead), cost per the step you
  actually care about, where deals stall, revenue about to slip, where the good
  clients come from, and what a good lead answers at capture.
- No em dashes anywhere on the page.

Layout: two columns above 1240px, one below, hidden on mobile where the form is
the only thing that matters. Verified at 1440px and 400px with no horizontal
overflow; all 44 gate and flow assertions still green.

---

## v3.389.0 - 2026-08-20 · `PENDING` - A front door, not a login box

The edge page from v3.388.0 is now the product's front door: a two-panel layout
with what Caalano360 actually is on the left and the sign-in desk on the right,
stacking to one column under 900px.

This falls out of the gate rather than being bolted on. Once the compiled app is
withheld until there's a session, this page is the *only* public surface - so it
may as well say what the product is, instead of showing a bare form to someone
who was sent a link and has no idea what they're looking at.

- Still entirely self-contained: inline CSS, inline SVG, one nonce'd script, no
  bundle, no external font or image, nothing fetched from another origin.
- All four flows unchanged and still passing: sign in, accept an invite,
  first-admin bootstrap, request access.
- Fixed while building it: `.mark span` also matched the brand badge, which is a
  span - so `display:block` and the grey uppercase treatment won and the glyph
  fell out of its own tile.

**Not indexed, deliberately.** robots.txt disallows everything on this host and
the edge refuses crawler user-agents, so this page is for people who already
have a reason to be here. A page Google can see belongs on a separate public
site - see the domain note below.

**Only visible once `GATE_ASSETS=1`.** Until then the in-bundle login screen is
what people see. Verified at 1440px and 400px, no horizontal overflow, 44
assertions still green.

---

## v3.388.0 - 2026-08-20 · `PENDING` - Edge login page, so the app bundle can stop being public (flag off)

Security backlog item 1, built. **Shipped with the flag off — this deploy
changes nothing in production.**

**The problem it solves.** The login screen lives inside the compiled bundle, so
to show anyone a sign-in box we have to serve them the entire frontend first.
That is why `/assets/*` is public today. Minification is not protection.

**What's there now.** With `GATE_ASSETS=1` and no session, the edge refuses
`/assets/*` and returns a self-contained login page for any HTML request —
inline CSS, one nonce'd inline script, no bundle, no external origin. Anything
not asking for HTML gets a 404 rather than the page.

The page carries **every flow a signed-out person legitimately needs** and routes
between them itself, by calling the auth endpoints that are already always
reachable: sign in, accept an invite, first-admin bootstrap, request access. That
self-routing is the point — the obvious shortcut of letting `?invite=` through to
the bundle would have handed the whole app to anyone who appended it.

**Verified — 44 assertions.** With the flag off, every path behaves exactly as
before, assets included. With it on: the bundle is refused, while a valid
session, an expired one, a tampered signature, the `SITE_PASSWORD` break-glass,
legacy mode and the crawler block all still behave correctly. Driven in a real
browser under a real nonce CSP header, all four flows post the right payloads and
an expired invite dead-ends rather than falling through.

**Deliberately one file.** Netlify auto-discovers every top-level file in
`netlify/edge-functions/` as a function, so a shared helper with no default
export is a deploy-time question — and this is the one file that can lock
everybody out.

### What still needs a person

Turning it on cannot be done or verified from an agent session, which can't reach
the deployed domain. In a **preview deploy**, set `GATE_ASSETS=1` and walk:
sign in · an invite link in a clean browser profile · request access · a fresh
bootstrap · the GoHighLevel OAuth callback · the Meta webhook. Then production,
during a window when someone can unset the flag. Keep `SITE_PASSWORD` set
throughout as break-glass.

---

## v3.387.0 - 2026-08-20 · `PENDING` - Key events funnel: all pipelines, and cost per event that divides its own spend

**The funnel now shows every pipeline when the filter says "All".**
It used to quietly narrow to whichever pipeline spent the most, while the table
underneath showed all of them - so the two disagreed and nothing on screen said
why. The dropdown still narrows it by hand.

**The cost figures inside it were wrong, not just confusing.** On "All" the
numerator was whole-account spend and the denominator was one pipeline's counts,
so every cost-per-event read high. On a two-pipeline client spending $8,000 on
one and $2,000 on the other, cost per booking showed **$250 when the true
blended figure was $142.86** - overstated by 75%.

- Cost per event now always divides the spend that produced those events.
  All pipelines -> whole-account spend. One pipeline -> that pipeline's linked
  campaign spend, which was already being computed for the dropdown.
- Applies to both Meta and Google.
- Single-pipeline clients are unaffected.

**Also: the changelog's own rollback instructions now work.**
The file said "every release below is also a git tag" and listed 378 releases as
`PENDING` with no commit. The tags did exist - the working clone was shallow and
could not see them. Every entry is now stamped with the commit that produced it,
cross-checked against its tag (381 checked, 0 mismatches), and the 42 releases
that genuinely had no tag - the earliest 38 plus v3.89.0, v3.237.0, v3.380.0 and
v3.381.0, which slipped - have been tagged at their real commits.

---

## v3.386.0 - 2026-08-20 · `024e1e2` - Three more places a failed read reported itself as good news

A sweep of the ~350 caught failures across the backend, looking for the shape
behind the v3.385.1 bug: **a fetch fails, the empty result flows into a
user-facing number or an all-clear, and nothing anywhere says the read didn't
happen.** Most caught failures are fine - a lost-reason lookup or a user list
degrades a label, not a figure. Three did not.

**1. Account health gave an all-clear it had no data for** *(worst of the three)*
- The paused-account alerts fire on "$0 yesterday with an active prior week".
  If the daily-spend read failed it returned no rows, every account looked like
  it spent nothing all week, the `base > 1` guard suppressed every alert - and
  the panel reported **"all active · every Meta account spent yesterday"**.
- A failed read is now tracked per channel and the column says **"not checked -
  the daily spend read failed"** instead of giving an all-clear. A genuinely
  clean week still reads "all active".

**2. A failed CRM read was cached as real zeros** *(most damaging)*
- The trends builder tracked `metaOk` / `googleOk` - skipping the cache and
  auto-retrying on a partial pull - but had no equivalent for the CRM leg. A
  transient CRM failure zeroed every client that relies on the blended feed and
  then got **written to the 10-minute cache** and served to everyone as real.
- Now reports `crmOk`, which joins the cache gate and the frontend's retry.
  Scoped so it only counts as incomplete when a client actually relied on the
  fallback - a client whose direct API read succeeded never touches it, and a
  healthy result is still cached.

**3. Anomalies showed "all steady" above "Couldn't load."**
- A failed check returns a zeroed summary, which rendered a green "all steady"
  chip directly above the error message. It now reads "not checked".

**Checked and found already correct** - worth recording so the pattern is clear:
per-client CRM failures in the agency feed already drop the `crm` key entirely,
so the leaderboard shows "-" and a "N clients couldn't load CRM data" banner
with the reason per row. That is the model the three fixes above now follow.

**Noted, not changed:** `buildCalPerf`'s opportunity read degrades into the
existing "Unattributed" bucket on failure - honest, but it makes attribution
look worse than it is. Would need a flag on that response to distinguish
"genuinely unattributed" from "we couldn't check".

---

## v3.385.1 - 2026-08-20 · `a175915` - Movers: say the real reason a client has no close dates

The "N clients excluded" note added in v3.385.0 was wrong, and it hid a real
failure behind a made-up one.

**There is no per-client CRM app.** `isConnected()` is a single agency-wide
OAuth check, and every client with a location linked gets a direct API read.
So a client missing close dates is one of exactly two things:

- **No CRM location linked at all** - nothing to report and nothing to fix. The
  old note counted these as "excluded", which made a perfectly normal setup
  look broken.
- **A linked client whose read failed** - a timeout, a rate limit, an expired
  token. It falls back to the blended Windsor feed, which carries no
  status-change date. This is the one worth knowing about, and it was being
  hidden in the same count.

**Changes**
- The direct-read failure is no longer swallowed. `crmTrends` errors are caught
  per client and surfaced as `crmErr`, so a timed-out client is no longer
  indistinguishable from one that has no CRM.
- The trends feed reports `crmConnected`, so a dropped agency connection reads
  as one problem for everyone rather than fifteen separate ones.
- The panel now names the affected clients, shows the underlying error on
  hover, and says what to do ("usually a timeout - hit Refresh"). Clients with
  no CRM linked are not mentioned at all.

---

## v3.385.0 - 2026-08-20 · `8011507` - Movers: closed-in-period basis

The second half of the movers work. A **Closed / Created** toggle on the panel,
defaulting to Closed.

**Why it matters**
- On a created basis a deal counts against the window its *lead* arrived in. The
  newest window's cohort has not finished closing, so every recent window reads
  low for everything downstream of the lead. That is what put
  `Win rate 3.3% -> 0.0%` at the top of the live board in v3.384.0.
- On a closed basis a deal counts on the day it was actually won or lost. A
  rolling window then reads as throughput, and won / revenue / avg deal size /
  cost per won / ROAS work at **3 days**, not 14.

**What it cost: nothing extra**
- A deal won last week may have been created ten months ago, so the closed pass
  has to look far further back than 56 days. The per-location opportunity
  snapshot already reaches **430 days** and is warmed in the background, so
  widening the CRM window to 400 days widens a filter over cached memory rather
  than adding a fetch.
- `crmTrends` now carries `statusDate` (the won/lost date). The trends builder
  indexes each opportunity twice - once where its lead lands, once where its
  close lands - so a deal created 300 days ago and won yesterday is counted,
  which is exactly the deal created-basis reporting misses.

**Two deliberate limits, stated in the UI**
- **Win rate stays created-only.** Wins closed this week against leads created
  this week are two different cohorts; the ratio is throughput over intake, not
  a conversion rate. It disappears the moment you switch to Closed.
- **Closed needs the CRM app connected** for its status-change dates. The
  Windsor fallback has no reliable won-date, so those clients contribute no
  deal-level movers on this basis - and the panel says how many that is rather
  than quietly showing a shorter list. Their leads and bookings still count, and
  Created includes everyone.
- The funnel drill relabels its last row **"Won (closed in window)"** on this
  basis and withholds the "% of leads" figure, which would invite a false
  conversion read.

---

## v3.384.1 - 2026-08-20 · `a26c351` - Movers: compact cards, and a floor bug the live data exposed

**Layout** - the panel now uses the same compact auto-fill card grid as the
Daily Performance movers rather than full-width rows. A dozen small insights
read faster and the panel is about half the height. The one card that's open
spans the full width so the funnel inside it still has room, which also stops
it stretching every sibling in its row.

**A floor bug, visible in the live CRM lens**
- Nexia and Pool Haus were reporting `Win rate 3.3% -> 0.0%` and
  `deals won -100%` as the two biggest movers on the board. Neither had
  collapsed: on a created-date basis the most recent window's cohort simply
  hasn't closed yet.
- Win rate, booking rate, deals won and deals lost were flooring only on the
  *prior* window (and win rate only on leads, never on wins at all), so a
  current window of zero always passed and always scored near the top.
- All four now need real volume in **both** windows. A fall from 20 wins to 3
  still reports; a fall to 0 is unreadable on this basis and is held back
  rather than guessed at.

**Also**
- Cohort-dependent movers carry a small `cohort` chip so it's visible at a
  glance which ones are counted against the lead's creation window.
- This is the strongest argument yet for the closed-in-period basis, which is
  the next piece of work: on created basis, recent windows are biased downward
  for everything downstream of the lead, and no floor fixes that - it only
  stops the worst of it being reported as news.

---

## v3.384.0 - 2026-08-20 · `4458993` - Biggest movers on the agency overview

A second movers panel, on the Overview between Paid performance and Account
health, answering a wider question than the Trends one: **what changed most
across the whole book**, in paid *or* in the CRM.

**Controls**
- Window: 3 / 7 / 14 / 21 / 28 days, each against the prior equal window.
- Lens: **All / Paid / CRM**.

**Paid** - per client and per channel (Meta, Google, and both together):
cost per result, results, spend, cost per booking, cost per won, ROAS, and
**cost per key event** - which is where cost per booked / shown / consult lands
without hard-coding anyone's funnel, since it reads each client's own configured
key events.

**CRM** - leads, bookings, deals won, **deals lost**, **revenue**, **average
deal size**, booking rate, win rate, and a mover per configured key event.

**Ranking is by materiality, not percentage**
- A client going 1 -> 3 bookings is +200% and would bury one going 180 -> 140.
  Moves are scored by percentage weighted by the square root of the volume
  behind them, so they stay comparable across metrics and units.
- Hard floors on the *prior* window (>= $200 spend, >= 10 leads, >= 5 bookings,
  >= 3 wins) keep thin accounts out entirely rather than ranking them low.
- Each client is capped at its three biggest moves, so one account having a bad
  fortnight can't take all ten slots and hide the other fourteen clients.
- A rate and its count are folded into one when lead volume held steady -
  "bookings 180 -> 140" and "booking rate 26% -> 20%" are one fact, not two.
  The rate only surfaces when leads genuinely moved, which is when volume and
  quality have come apart.

**Every mover explains itself**
- A why-line decomposes the move: cost per booking into spend vs bookings,
  revenue into deal count vs average deal size.
- Clicking one opens the **funnel behind it** - leads -> that client's key
  events -> won, current vs prior, for the channel the mover is about. It costs
  no extra request; it is the data the mover was computed from. Paid movers on a
  single channel also keep the existing creative breakdown.
- A chip flags clients whose channel split is text-matched from the lead source
  rather than real UTMs, so a Meta cost-per-won never looks more precise than it
  is.

**Created-in-period basis, stated plainly**
- CRM figures are cohorted by when the **lead** was created, not when the deal
  closed. Over 3 days almost no cohort has had time to close, so won, revenue,
  average deal size and win rate are offered from 14 days up and the panel says
  why rather than showing noise. Closed-in-period is the follow-up.

**Backend**
- The trends feed now carries the prior window for every CRM figure, plus
  revenue and lost. The daily arrays already spanned 56 days, so this is a
  second sum over memory we held - no extra API calls, one cached request.
- Fixed alongside: key events are read from settings, which hydrate after the
  trends feed resolves. The panel now recomputes on settings load - without it
  every key-event metric silently never appeared.

---

## v3.383.1 - 2026-08-20 · `7e78031` - Catchment: read the CRM business address properly

Catchment reported "No business address is set in the CRM" for a client whose
Business Profile plainly had one filled in.

**The cause**
- Settings -> Business Profile writes the address to the location record on
  some accounts and to the nested `business` object on others, depending on
  how the account was provisioned. We only ever read the top level.
- Every address field now takes whichever of the two is populated, checked one
  field at a time, so a partially-filled record still yields what it has.
- Same merge applied to name, website, logo and timezone, which had the same
  blind spot.

**The message was wrong too**
- A failed read was swallowed and shown as "no address is set", which sends you
  into the CRM to fix something that was never broken. The three cases now read
  differently: no CRM location linked, the read failed (with the reason), or
  the address genuinely isn't set.

**Also**
- The business profile is cached for 10 minutes rather than for the life of the
  container, so correcting the address in the CRM shows up without a redeploy.
  A failed read is cached for 1 minute so a bad location isn't hammered.

---

## v3.383.0 - 2026-08-20 · `e59bac6` - Catchment: service areas

The other half of catchment, for a business that works **across areas** rather
than from one place - a builder covering several parts of Sydney.

**Zones are made of places, not circles**
- A zone is a named set of **postcodes and suburbs**, so a lead either is in it
  or isn't. No edge-of-circle guesswork, which is what a radius always carries.
- Add places by typing a postcode or suburb name. Anything that can't be
  resolved is **refused with near-matches offered**, rather than stored as a
  name that would silently match nothing later.
- **Fill by radius** seeds a zone with every postcode within N km of what's
  already in it - quick to author, then editable by hand. (10 km of Norwest
  2153 pulls in 45 postcodes.)
- **Per-pipeline scoping** on each zone, for a client whose offers cover
  different ground.

**Reporting**
- A zone table above the lead map: places matched, leads, booked, won, win rate.
- An explicit **"Outside every zone"** row - leads that fall outside your
  coverage are the interesting ones, so they're never quietly dropped.

**Overlaps are allowed, and said out loud**
- A place can sit in two zones. That's a real thing a business might want, so
  it isn't blocked - but a lead there is counted in **both**, which makes zone
  totals exceed the lead count. The editor flags which places overlap, and the
  map warns when the totals no longer add up, rather than leaving someone to
  discover it in front of a client.

Verified: zone membership, the radius fill, unzoned leads, per-zone win rates,
and the overlap case (two zones sharing a postcode → 165 zoned leads against 137
actual, correctly detected).

---

## v3.382.0 - 2026-08-20 · `af391ab` - Catchment: how far people travelled to get there

**Settings → (client) → Catchment.** Off by default, because "how far did they
travel" only means something for a business people come *to*. For work that
happens at the customer's address it says nothing, so nothing appears until it's
switched on for that client.

**Radius mode**
- Origin is the **CRM business address** (read from Business Settings) or a
  suburb / postcode you type. Both resolve locally against the 3,171 postcodes
  and 16,196 suburbs already shipped for the map - no geocoding service.
- On the lead map: a **pin for the business** and a dashed **radius ring**,
  styled unmistakably differently from the lead markers.
- Above the map: **median distance travelled**, the share of leads falling
  **outside** the radius (amber past 30%), and counts by band -
  ≤5 km / 5-15 km / 15-30 km / 30 km+.
- **Per-pipeline radius**, optional. Blank uses the default; set one where an
  offer genuinely has a different catchment - people drive further for a big job
  than a routine one.

**The median is lead-weighted**, not postcode-weighted. A postcode with 40 leads
has to pull the median harder than one with a single lead, or the number
describes your map rather than your patients.

**Verified against real coordinates:** clinic at Norwest 2153 - Castle Hill
reads 3.6 km, Parramatta 9.5 km, Sydney CBD 29.9 km, Melbourne 704 km. Bands,
inside/outside counts and the weighted median all check out.

Stated in the settings panel rather than buried: distance is measured between
postcode centroids, so it is sound across a few hundred leads and unreliable for
any single one - a city postcode is a couple of kilometres across, a rural one
can be fifty. Leads with no location, and anything outside Australia, are
counted separately rather than plotted wrong.

Service areas (named zones for a business working across areas rather than from
one) are stubbed in the mode picker and come next.

---

## v3.381.0 - 2026-08-20 · `f73c487` - Client settings tabs wrap; one duplicate API call removed

- The client-config modal's twelve tabs scrolled sideways, hiding everything
  past *Forms* behind a scrollbar. They **wrap onto a second row** instead - on a
  modal that wide there was no reason to scroll.
- Groundwork for catchment reporting: `locationProfile()` now also returns the
  **Business Settings address**, timezone and postcode.
- Found while doing it: `/locations/{id}` was being fetched **twice** - once by
  `locationProfile()` for the logo and again by `locationTimezone()` for the
  zone. They're one call now, so this adds the address and *removes* a request
  rather than adding one.

---

## v3.380.0 - 2026-08-20 · `8640d6c` - Leads and patients are different things, and the numbers now say so

**The definition, applied properly**
- A **lead** enquired. A **patient** booked an initial appointment and **showed
  to it** - attendance is the threshold, so a booking nobody kept doesn't count,
  and discovery / triage bookings were already excluded upstream.
- Every attributed contact was being counted as a patient. That overstated the
  count and, worse, **divided lifetime value by it** - which is why a campaign
  with two enquiries and nobody through the door read *"2 patients · $0.00 avg
  LTV"* instead of *"2 leads · no patients yet"*.
- Avg LTV is now per patient. On the demo that moves Meta from $475 to **$1,113**
  - the old figure was lifetime value spread across everyone who ever enquired,
  which described neither group.

**A new number that falls out of the split: lead → patient**
- The share of a source's enquiries that actually became a patient, traffic-lit,
  on both the channel and campaign tables. On the demo: Google converts 53% of
  enquiries, Meta 44% - the kind of gap that moves budget, and it was invisible
  while both were labelled the same thing.

**Click any channel or campaign row for the people behind it**
- Name, visits, lifetime spend, last appointment, practitioner - with anyone who
  hasn't attended tagged `lead`.
- The sample deliberately carries **both**: up to 50 patients by value plus up to
  30 leads. Capping by value alone meant a source with more patients than the cap
  never showed a single lead - which is exactly what you're looking at when you
  click a row asking why the conversion is low.

Caught while building: the drill's `useState` sat below `ClinicView`'s four
early returns, so it changed React's hook count between the loading and loaded
renders and blanked the tab. Second time this pattern has bitten in this file.

---

## v3.379.0 - 2026-08-20 · `94d39ce` - One-and-done by channel, and a demo that reflects its own roster

**Which channels bring patients who stay**
- The Acquisition table gains **One & done** - the share of a channel's patients
  who came once and never returned. Traffic-lit, because it is the sharpest read
  there is on whether a channel brings patients or just bookings.
- Correction to what was said when this was proposed: most of this split already
  existed (patients, avg LTV, PVA, $/visit, with-next), and `oneAndDonePct` was
  already being computed server-side - it simply wasn't rendered. The gap was one
  column, not a feature.

**The demo was declaring four practitioners' worth of hours across eight calendars**
- Utilisation read 10% in the demo, which made a working metric look broken on
  the thing used to show the product.
- The cause was real and worth understanding: the eight service calendars are
  **four practitioners with two service types each**, and every one of them
  declared a full 8-6 week. That claimed 400 hours of weekly capacity for four
  staff. This is exactly the double-counting the tab already warns about - the
  demo was demonstrating the flaw rather than the feature.
- Each discipline now gets one clinician's week split across their two
  calendars: a day of initial consults, three days of follow-ups. The demo now
  reads **42%** overall, 30-68% per calendar - a clinic with room to fill, which
  is a better story for a marketing dashboard than one already at capacity.

---

## v3.378.0 - 2026-08-20 · `429303c` - Clinic: who's drifting, whose patients come back, and where every number comes from

All three built from fields **already synced** - no new CRM columns.

**"Due back" - the first worklist where the patient hasn't gone yet**
- Every other list here is retrospective: win-back and reactivation tell you who
  already left. This one names who is *leaving*, while there's still something
  to do about it.
- Each patient is judged against **their own median gap between visits**, not a
  clinic-wide rule. Somebody who comes fortnightly and hasn't been in for six
  weeks is a different case from somebody who comes twice a year, and a single
  "90 days" threshold calls one of them wrong every time.
- They appear once they're half again past their usual gap (and at least a week
  past it), have nothing booked, and have **two prior gaps minimum** - so a new
  patient never lands on the list on the strength of one anecdote.
- Sorted worst-overdue first, with lifetime spend, so the call list is ordered
  by what's actually at stake. *(Demo: 29 patients, $16,820 of prior spend.)*

**Rebooking by practitioner**
- The clinic-wide rate says whether there's a problem; this says where it is.
  Each visit is credited to the calendar it sat on, traffic-lit against 85%.
- Splits **at the desk** from **chased later** per calendar - booking the next
  visit before the patient leaves is a front-desk habit and the single biggest
  lever on the top number.
- Calendars under 10 visits are excluded: below that a rate describes one
  patient's habits rather than a practitioner's.

**Every section says where its numbers come from**
- Three sources feed this tab and they behave completely differently - synced
  fields are overwritten every run (always "now"), the calendar keeps real
  per-booking history, and our nightly snapshots are the only thing that can
  show a trend. A number read as the wrong kind is a number misread.
- Each section now carries a colour-coded chip - **Practice-management sync /
  Calendar history / Our daily snapshots / CRM contact record** - that expands
  to explain the source and list the exact fields behind it.

---

## v3.377.0 - 2026-08-20 · `39b6db8` - Clinic tab moves to second

- On a clinic, **Clinic** now sits directly after **Caalano360** and before
  **Meta Ads**. For a practice it is the tab that answers "how is the business
  doing", so it belongs ahead of the channel tabs rather than at the end of them.
- Still self-detecting: it only appears where the practice-management sync has
  created its patient fields, so nothing changes for a non-clinic client.

---

## v3.376.0 - 2026-08-20 · `12ca0ea` - Clinic: capacity & recovery

Researched what [Allie](https://www.allieclinics.com/) reports on (Cliniko /
Halaxy / Nookal / Splose, the same PMS layer our clinics sync from) and closed
the three gaps that were cheap because the data was already loaded.

**Practitioner utilisation** - their lead metric, and we weren't computing it.
- Booked clinical minutes ÷ that calendar's **own declared opening hours**, over
  a rolling 28 days, per calendar. Per-calendar rather than clinic-wide on
  purpose: measuring a part-timer against the whole clinic's hours makes them
  look idle and hides a full practitioner already at capacity.
- Cancelled and missed appointments don't count as booked - the slot was open.
- Calendars that don't publish opening hours are listed but not scored, and are
  left out of the headline rather than silently guessed at.
- Traffic-lit against the 80% allied-health target.

**Cancellations that never got recovered** - the version with money attached.
- A cancellation only costs something if the patient never came back. Anything
  in the last fortnight is excluded from the judgement: they may simply not have
  rebooked yet, and counting those as lost overstates it every time.
- Priced at the clinic's own revenue-per-visit.

**Revenue per visit** - collected ÷ attended. Near-free, and it's the
denominator behind most of the "what is this costing us" figures on the tab.

**A limitation stated in the UI rather than left to bite:** capacity is counted
per calendar, so a practitioner running both an initial-consult and a follow-up
service calendar has their hours counted twice and the clinic-wide figure
understates them. The tab says so and tells you what to do about it.

Not chased, deliberately: episode-of-care completion and funding-mix (NDIS /
DVA / WorkCover / EPC) both need PMS fields we can't yet confirm sync through.

---

## v3.375.0 - 2026-08-20 · `6857bee` - Settings sections are deep-linkable

- Each Settings section now carries `?s=` in the URL, so a **refresh comes back
  to the same tab** instead of dropping you on Clients. Same for a shared link:
  `?v=settings&s=terms` opens straight on the terms document.
- Pushed rather than replaced, so **Back steps through the sections you
  visited**, and Back to a URL with no `?s=` returns to the default section
  rather than leaving the last one open.
- The section is validated against what that person can actually reach, so a
  link to a section they don't have falls back to their default instead of
  rendering an empty page. Verified: a deep link to `?s=logs` opens **Logs** for
  a Super Admin, **Clients** for an Admin, and **Your account** for a Viewer.
- `?s=` is dropped when you leave Settings, so it can't linger on an unrelated
  view.

Small fix underneath: `writeNavUrl` treated any falsy value as "delete this
param", so there was no way to say "leave it alone". `undefined` now means leave
it, which is what let `go('settings')` preserve `?s=` while every other
destination clears it.

---

## v3.374.0 - 2026-08-20 · `e49169a` - Terms page tidied, sign-in location gets its own column

**Settings → Terms of use**
- The **signed register** moves to the top - it's what you actually come to this
  page to look at. The document editor sits underneath it.
- The editor is **collapsed by default**; the header still shows the live
  version, effective date and wording digest, with **Edit the wording** to open
  it. *Preview the signing screen* stays available without expanding.
- One guard: if you have unpublished changes the editor won't collapse, and says
  so - a draft shouldn't be hideable by a stray click on the header.

**Sign-in location is its own column**
- It was a footnote under *Last active*, which buried it. Now **Sign-in
  location** sits between *Time (30d)* and *Status*, sortable like the rest,
  still Super-Admin only (verified: an Admin still sees 5 columns, not 7).
- Shows where their most recent session started, with `⚠` in amber when that
  place is one they've never signed in from before.
- A second line counts the distinct places they've been seen from, and the
  tooltip lists them: *"Signed in from: Lagos, Lagos, NG · Sydney, NSW, AU"*.
- Captured in `geoFromReq()` (`netlify/lib/auth.mjs`) and stamped onto a session
  when it **starts** - at sign-in, or after a 30-minute idle gap opens a new one.

---

## v3.373.0 - 2026-08-20 · `43fb68f` - Where people sign in from, and when it looks wrong

- Each session now records roughly where it started: city, region, country and
  IP. Netlify resolves this at the edge and passes it in `x-nf-geo`, so there is
  no lookup service, no third party and no added latency.
- Shown under **Last active** in Settings → Team & access (Super Admin only, like
  the rest of the activity data). The IP sits in the row tooltip.
- **The part that's actually useful:** a session from a place that person has
  never signed in from before is flagged in amber with a ⚠. A list of cities is
  noise; *"this one isn't like the others for this person"* is a signal. It needs
  at least three prior located sessions before it will call anything unusual, so
  a new account doesn't light up on its second sign-in.
- Degrades cleanly: no geo header → IP alone; malformed header → neither; neither
  → the column just shows time as before. Unit-tested across all four.

**Read it as a hint, not a fact.** IP geolocation is city-level at best, and a
VPN or a mobile network will move someone hundreds of kilometres. It answers
"does this look normal for them", never "where was this person".

**Worth doing yourself:** terms clause 5 currently discloses *"when you sign in,
when you are active, what you access"* - it doesn't mention location. You can add
that in Settings → Terms of use without a deploy. Leave the re-sign box unticked
and nobody is re-prompted.

---

## v3.372.0 - 2026-08-20 · `2b0e939` - Activity trail: where each person went, and for how long

**Settings → Logs → Activity trail** (Super Admin only). A per-person record of
which views, clients and tabs someone opened and how long they stayed:

> `26 Aug, 1:10 pm · Alex Serrano · Client workspace [Meta Ads] · Pool Haus · 4m`

- **Navigation only.** Views, client opens and workspace tabs - not within-page
  clicks. A click log is a firehose nobody reads and a privacy surface that is
  hard to justify; where someone went and for how long is what actually answers
  the questions people ask of an audit log.
- A location is recorded when it is **left**, so every entry carries a real
  duration. The last location of a visit is captured on tab-hide/close via a
  `keepalive` beacon, so a single-page visit isn't invisible.
- Bounces under a second are dropped, and any single stay is capped at 4 hours so
  a tab left open overnight doesn't register as a working day.
- The identity on each entry is resolved **server-side** from the session, not
  asserted by the caller - so it can't be forged by editing the request.
- Summary table (views, total time, accounts opened, last seen) with a
  click-through to filter the timeline to one person; 1d / 7d / 30d windows.
- Stored in its own `caalano-audit` blob store, day-partitioned with a per-day
  cap and a 90-day index - the same shape as the reliability log, kept separate
  so the two can't crowd each other out.
- Legally already covered: terms clause 5 discloses exactly this ("when you sign
  in, when you are active, what you access"), and everyone on v1.3 has signed it.

Caught while building: the audit hook sat after Dashboard's `if (!data) return`
guards, so it changed React's hook count between the loading and loaded renders
(error #310, a blank app). It is a small component now - mounting and unmounting
is legal where a varying hook count is not.

---

## v3.371.0 - 2026-08-20 · `4b94673` - An anonymous caller is no longer trusted

Auditing the login path turned up the opposite problem to the one being looked
for. The front door is solid - PBKDF2 at 150k iterations, `timingSafeEqual`,
escalating lockout, HMAC-signed HttpOnly cookies, instant revocation via the
session epoch, single-use invites, and no self-service password reset. What was
weak was what happened when a caller had **no session at all**.

`SITE_PASSWORD` (the break-glass shared password) passes the edge gate but
carries no identity, so `currentUser()` returns null downstream. Several
functions read null as *"the trusted owner on the legacy path"* and skipped
their checks.

**`settings` - read and write (the serious one)**
- GET fell through and returned the **entire unscoped settings blob**: every
  client's key events, KPI targets, campaign maps, brand profiles, and the list
  of which clients are Super-Admin-only.
- POST was worse. `if (me && me.role !== 'admin')` **passes when `me` is null**,
  so an anonymous caller could rewrite shared settings - including the
  Super-Admin-only `clients` section that adds, removes and relinks accounts.
- Both now refuse without a session. Viewer reads stay scoped; viewer writes
  stay refused.

**`windsor` - every client, no audit trail**
- `if (me) { ...all the access checks... }` meant a null caller skipped
  `canSeeClient`, the Super-Admin-only filter and the viewer scope map, reaching
  every client's data with `_actor` null - so nothing they did appeared in the
  reliability log against a name.
- Now refuses anonymous callers when `AUTH_SECRET` is set. The ten warmers and
  snapshot jobs are unaffected: they `import` their run functions from
  `windsor.mjs` in-process and never come through the HTTP handler.

**Endpoints that spend money or fetch outward**
- `insights` (Claude, agency view) → staff only. `chat` (Claude, per message) and
  `optlog` (outbound Google Sheets fetch) → any signed-in user. All three were
  reachable by anyone past the edge gate, which meant the shared password could
  burn `ANTHROPIC_API_KEY` indefinitely.

Two new helpers, `requireSession` and `requireStaff`, alongside the existing
`requireOpsAdmin` - all fail closed, all no-ops in legacy mode where the
shared-password gate is the only control by design.

**Still outstanding, and it needs a human:** check whether `SITE_PASSWORD` is
still set in Netlify, and who has it. It no longer reaches client data, but it
still opens the app, and unlike the login form it has **no rate limit at all**
(`edge-functions/auth.js:55` is a plain string compare). Once everyone has a real
account, delete it.

---

## v3.370.0 - 2026-08-20 · `6d3f39a` - Methodology prose is staff-only

- The "how this number is calculated" paragraphs under each card - blended MER,
  maturing cohorts, appointment-accurate booking logic, what counts as a lead -
  are the thinking behind the reporting rather than the reporting itself. They
  are now shown to staff and withheld from client Viewers.
- 64 of them, converted from `<p className="caveat">` to a `<Caveat>` component
  reading a `ViewerCtx`. It returns `null` for a viewer, so the text is **absent
  from the DOM** rather than hidden with CSS - hiding it would leave it one
  inspector click away, which defeats the point.
- The reports themselves are untouched: same cards, same numbers, same
  drill-downs. Verified on the Forms tab - staff see the explanation, a viewer
  sees the identical table without it.
- `alloc-note` (the role descriptions in the access editor) was left alone: it
  lives in Settings, which no Viewer can reach.

Noted at the time: this is a trade. Those paragraphs are also part of why the
reporting is worth paying for, and a determined client can still read the
strings in the JS bundle. It raises the effort, it doesn't close the door.

---

## v3.369.0 - 2026-08-20 · `24a3e69` - See what a client will see, before you invite them

**Preview an allocation before it goes out**
- The invite / edit-access modal gets **👁 Preview what they'll see**. It runs the
  draft allocation through `allowedTabsFE` - the same function the client
  workspace uses to build its tab strip - and shows, per account, exactly which
  tabs render and which are struck through.
- Sensitive tabs are called out by name when ticked: Timing (grades their own
  sales team's response times), Users (per-rep performance) and the Optimisation
  Log (our change log for the account).
- Now that the server-side leaks are shut, the realistic way a client sees
  something they shouldn't is a mis-ticked box - and there was previously no way
  to check one except by sending the invite.

**It found something on its first run**
- `allowedTabsFE` falls back to the first offered tab when *none* of the ticked
  tabs exist for that account (`keep.length ? keep : offered.slice(0, 1)`), so a
  viewer can be shown a tab that was never granted. With the new Users-only
  default, any client without a CRM connected lands on **Caalano360** instead.
- Not a cross-client leak - it's still their own account - but it is "they see a
  tab you didn't tick". The preview now flags it per account, in amber, with
  what to do about it. The fallback itself is left alone for now: removing it
  means an empty workspace, which is a separate call.

**`campmap` was going to viewers whole**
- `settings.mjs` passed it through unfiltered on the stated grounds that it was
  campaign-name-keyed and therefore not per-client. It is actually keyed by
  client id (`SETTINGS.campmap[clientId]`), and campaign names carry the brand -
  so every viewer received a list of every client's campaign names.
- Filtered with the same `pick()` as the other client-keyed sections. Verified: a
  viewer now gets only their own account's campaigns, and no other brand appears
  anywhere in the settings payload. `fatigue` stays global - it genuinely is.

---

## v3.368.0 - 2026-08-20 · `f7c2865` - No client is named in a public file any more

`/assets/*` is served without a session, deliberately, so the login screen can
load its own JavaScript. Two things were riding along in there.

**Our written notes on thirteen named clients**
- `CLIENT_PROFILE_SEEDS` sat in `src/App.jsx`, so it shipped in the app bundle:
  each client's ICP, offer, objections, compliance risks, and the gaps we had
  not confirmed (*"Confirm what Healan Centre offers"*). Readable by anyone who
  found the URL - no login required.
- Moved to `netlify/lib/profiles.mjs` and merged into the settings response
  server-side, staff only. A saved profile still overrides its seed, field by
  field. Viewers never receive the `profile` section at all, as before.

**The entire release history**
- `import('../CHANGELOG.md?raw')` built a **343KB** chunk under `/assets/`
  naming nine clients and describing how every metric is calculated.
- Now read by a Super-Admin-only function (`netlify/functions/changelog.mjs`),
  with `CHANGELOG.md` shipped via `included_files`. Admins, staff and viewers
  get 403; signed-out gets 401.
- Also drops ~344KB (125KB gzip) from the deploy.

**Result:** a case-sensitive scan of every file in `dist/assets` finds **no
client name at all**. Before this release it found fifteen across two chunks.

Caught while testing: the changelog function resolved its file paths at module
load using `process.cwd()`, which is not guaranteed to be the working directory
at invocation time. Resolved per call instead.

---

## v3.367.0 - 2026-08-20 · `bca7215` - Before inviting clients: the roster stops being public

**The roster and every client's spend were served to any logged-in user**
- `public/data/config.json` and `public/data/snapshot.json` were static files
  published with the site. The edge gate blocks `/data/*` only for people with
  **no session**, so any valid session - including a client Viewer - could fetch
  them whole. The UI filtered them; the files did not.
- Between them they carried: all 14 clients with names, Meta ad-account ids,
  Google Ads customer ids and GHL location ids; per-client spend, impressions,
  clicks and leads for the current *and* prior period ($48,804 and 2,453 leads
  in one file); industry descriptions; and **Caalano Digital's own pipeline**
  (won value $242,284). Five of the clients are competing ADHD/assessment
  practices.
- The app itself downloaded both into every client's browser, so reading them
  needed nothing more than the Network tab.

**Fixed at the source**
- `data/` moved out of `public/`, so **nothing is published under `/data` at
  all** - there is no URL left to bypass. Verified against the build output.
- New `netlify/functions/roster.mjs` serves both, filtered server-side by the
  same rules the windsor function already applies: a viewer or restricted staff
  member gets only their allocated clients, Super-Admin-only clients are dropped
  below superadmin, and a viewer never receives the agency pipeline or the
  Windsor account inventory. Unauthenticated requests are refused.
- The baked per-client fallback (`data/clients/<id>.json`) went the same way -
  it was fetchable by guessing another client's id, and is now behind the same
  `canSeeClient` check.
- Their own ad-account ids are kept: it's their account, and the tab set is
  built from it.

**New Viewers start with one tab**
- `tabs: null` meant "all fourteen", so anyone invited without a second thought
  received Timing (which grades the client's own sales team's response times),
  the per-rep Users breakdown and the Optimisation Log.
- New Viewers now default to `['users']` and are opened up deliberately from
  there.

---

## v3.366.0 - 2026-08-20 · `17963ad` - Who signed in and for how long is owner-only

**Activity data is Super-Admin only**
- **Last active** and **Time (30d)** in Settings → Team & access - when someone
  last signed in, their last session length, and their total time in the app
  over 30 days - are now visible only to a Super Admin.
- Stripped **on the server**, not just hidden in the UI: the `users` response
  nulls `lastSeen`, `lastLogin` and `sessions` for everyone except the caller,
  so the data never reaches an Admin's browser to begin with. The two columns
  come out of the table as well, so it reads as a deliberate omission rather
  than a row of empty dashes.
- You can always see your own activity - it's your own record.
- The role legend now says so plainly: *"only a Super Admin can manage Admins,
  or see when people last signed in and how long they spent."*
- Agency staff (**User**) and clients (**Viewer**) never had the Team & access
  tab at all, so nothing changes for them.

Admins manage who can see what; the owner sees the watching. The two are
different powers and were being granted together.

---

## v3.365.0 - 2026-08-20 · `ce9a44c` - Terms you can edit yourself, and terms v1.3

**Edit the terms in the app - Super Admin only**
- Settings gains a **Terms of use** section (Super Admin only) holding both the
  document and the signed register. The live wording is now stored server-side
  rather than only in the source, so changing a clause no longer needs a deploy.
- Edit the title, version, effective date, the notice box, the opening line,
  every section (add, remove, reorder) and the signing declaration. Paragraphs
  are edited as text - blank line between paragraphs, one bullet per line.
- **Preview the signing screen** renders the exact gate from the *unpublished
  draft*, with the accept button inert, so wording can be checked in place
  before anyone sees it.
- Publishing has an explicit **"ask everyone to sign this version"** switch,
  default off. Off means existing signatures stand and nobody is re-prompted;
  the confirmation message says which of the two actually happened.
- **Revert to built-in** restores the wording shipped with the code. Signatures
  already on file are untouched either way.
- Everything saved is rebuilt field by field with bounded strings and arrays -
  a malformed save can't produce a document the gate then fails to render, and
  the gate falls back to the built-in text if the store is unreachable.

**Terms v1.3 - client viewers, and a duty to report**
- Clause 2 now says plainly that the same agreement covers clients viewing their
  own reporting, not just agency staff.
- Clause 5 separates the two things people conflate: a client's own business
  data stays theirs and they may do as they like with it in their own business;
  the Platform that produces the reporting does not become theirs. *The numbers
  are yours; the instrument that produces them is not.*
- New clause 6: if you can see any account, client or screen that isn't yours,
  you must report it to alex@caalanodigital.com.au immediately, must not use,
  copy, export or share it, and must not go looking for more. Reporting in good
  faith is never held against you. This is repeated in the declaration above the
  signature.
- This adds a duty, so it is material: the minimum accepted version moves to
  **1.3** and everyone signs once more. Later versions won't re-prompt.

**"Terms of use" in the footer now answers the right question**
- It shows the terms **in force now** by default, with the date you signed. If
  you signed an earlier version, a notice names both and a toggle switches
  between the current wording and **the exact version you signed**.
- Reading back your own signed version needs no special role - it's your record.
  Reading anyone else's stays Super-Admin-only.

**The footer modal rendered behind the page**
- The sidebar is `position: sticky`, which makes it a stacking context, so a
  modal rendered in its footer was pinned underneath `<main>` and the page's
  sticky table headers painted straight through it. Overlays now portal to
  `<body>` and lock page scroll while open.

**Typography**
- `.cap` has no base rule in the stylesheet - it only renders small inside a
  parent that sizes it - so every new terms surface was showing labels and hints
  at full body size. Each now states its own sizing: field labels read as
  labels, explanatory sentences read as prose.

---

## v3.364.0 - 2026-08-20 · `fb92edc` - Terms v1.2: sign once, and a proper signed record

**One signature, then never again**
- Terms **v1.2** now says in the notice, in clause 9 and in the declaration that
  a signature covers Caalano360 *as it is today and every future version of it* -
  every release, module, tab, metric and integration we ship afterwards.
- The gate no longer fires on a version bump. Whether someone must sign is
  decided server-side against a new `TERMS_MIN_VERSION`, which is separate from
  `TERMS_VERSION`. Publishing new wording archives it and changes nothing for
  anyone already on file; only deliberately raising the minimum asks for a
  re-sign, and clause 10 now says exactly that.
- `TERMS_MIN_VERSION` is set to **1.2** for this release, so everyone signs the
  wording that carries forward - once. After that, ship as often as you like.

**Who signed, and what they actually signed**
- The signing screen now captures **first name, last name and phone** alongside
  the signature. Email is shown from the session and can't be edited. All three
  are required, and they're written to both the acceptance record and the user.
- The exact wording of each version is **archived** the first time someone
  accepts it, keyed by version + digest. Opening a record shows the agreement as
  it was worded on the day - not today's text next to an old signature.
- Clicking a row in the register opens the full record: their details as stated
  at signing, role, timestamp, version, wording digest, IP, device, their
  signature, and the complete agreement. Printable.

**The register is Super-Admin only**
- It holds names, phone numbers, IP addresses and signature images. `terms-log`,
  `terms-record` and `terms-doc` now return 403 to anyone below Super Admin, and
  the card is hidden from Admins in Settings → Team & access.

**The signature was nearly invisible**
- The pad drew in the theme's text colour on a transparent canvas, so a
  signature drawn in dark mode was a near-white stroke - and disappeared the
  moment it was viewed in light mode. The pad is now white paper with fixed dark
  ink, and every stored signature renders through a filter that forces it to
  solid ink, which fixes the ones already captured.

**Sidebar footer alignment**
- Settings, the user row, the build stamp and the legal note sat at four
  different left insets (12 / 14 / 12 / 0). They now share one, with a divider
  above the legal note, and the build stamp is two deliberate lines instead of
  one that wrapped mid-timestamp.

---

## v3.363.0 - 2026-08-20 · `abf4f40` - Preview the signing screen, and no way to be stuck on it

**Preview mode for the terms gate**
- The signed register (Settings → Users) gets a **Preview signing screen**
  button, and `?preview=terms` on any URL does the same thing. It renders the
  exact gate a new user sees - notice, full terms, scroll-to-end requirement,
  signature pad - with the accept button inert and a "Preview" tag in the
  header. Nothing is recorded and your own acceptance is untouched.
- Leaving the preview is a plain page load (`Close preview`), not a sign-out.
- This is how the gate gets demonstrated without bumping `TERMS_VERSION`, which
  would re-prompt everyone.

**The gate can no longer trap anyone**
- If `authApi('terms')` failed, the gate showed a spinner forever - a user who
  had done nothing wrong could not reach their dashboard. It now shows a plain
  error with a **Try again** button, and says explicitly that nothing was
  recorded and nothing is wrong with their account.

---

## v3.362.0 - 2026-08-20 · `d9e5753` - Terms of use: stronger, and a real decision to make (v1.1)
- The terms now open with a bordered **"Read this before proceeding"** notice stating plainly that this is a binding
  legal agreement between the individual and Caalano Digital, that acceptance is a **condition of using the Platform**,
  and that anyone who does not agree must **not proceed - sign out now and contact us**.
- The single-line acknowledgement is replaced by a formal **declaration**: read and understood in full with the
  opportunity to seek advice; signing personally as the named account holder with authority to do so; agreeing to be
  bound and undertaking to **remain in compliance for as long as access is held**, and after it ends where a term says
  so; understanding the record may be relied on as evidence; and understanding that the only alternative is to sign out.
- New clause 9, **"Your agreement is ongoing"** - acceptance is not a one-off click. Every sign-in reaffirms the terms,
  and anyone no longer willing or able to comply must stop using the Platform and say so.
- **Declining is now as visible as accepting.** The header button reads "I do not agree - sign out", there's a matching
  button beside Accept, and the accept button reads "I agree and sign".
- Version bumped to **1.1**, so everyone - including anyone who already signed v1.0 - is asked to read and sign the
  stronger wording on their next load. Their v1.0 acceptance is kept on record rather than replaced.

## v3.361.0 - 2026-08-20 · `affa1ea` - Terms of use, signed and recorded
- **Terms of Use** for Caalano360, covering ownership of the platform (interface, reports, metrics and how they're
  calculated, data models, integrations, code), a personal revocable right of access, and explicit restrictions: no
  copying, no reverse engineering, no rebuilding it elsewhere, no scraping, and no feeding its screens, outputs or code
  into third-party or AI systems for analysis, training or reproduction. Plus confidentiality, data ownership, accuracy
  and availability, breach, liability and governing law (NSW).
- **A gate, not a banner.** It sits between signing in and the dashboard, so acceptance is a real decision and there is a
  signed record before any client data is on screen. Accept stays disabled until the reader reaches the end.
- **A real signature** - drawn on a canvas with mouse, trackpad or finger, or typed as a fallback where neither is
  practical. Stored as an image against the account.
- **Signed register** in Team & access: who accepted, when, on which version, and their signature (click to enlarge),
  exportable to CSV. Anyone on an outdated version is flagged and re-prompted on their next load.
- Each acceptance stores the version **and a digest of the exact wording that was on screen**, so a signature can always
  be matched back to what was actually agreed even after the terms move on. Earlier acceptances are kept, not overwritten.
- A standing proprietary notice sits in the sidebar footer with a link to re-read the terms and see your own signature -
  people forget what they signed on day one, so the claim lives where they work rather than only in a document.
- Signature images are held in their own store with only a lightweight version marker on the user record, so the gate
  check stays free and no signature weighs down an ordinary user listing.

## v3.360.0 - 2026-08-20 · `fefa817` - Demo: drop the discovery call, and fix a funnel that couldn't happen
- The demo's pipeline card showed **Booked Initial Appointment (107) above Discovery Call Attended (57)** - a later step
  outranking an earlier one, which is impossible in a funnel. The tell was the show rate underneath it: only
  calendar-linked key events carry one. Both "Booked…" events had matched a **calendar by name**, so every follow-up
  booking on the service calendars was being counted as a first appointment.
- Demo data only - the reach calculation itself is sound, and builds cumulatively from the last stage backwards.
- **Discovery calls removed.** A physio books people straight in, so the pipeline is now
  **New Enquiry → Contacted → Appointment Booked → Appointment Attended → Treatment Plan Active**.
- Stage names are now deliberately chosen NOT to collide with any calendar name, which is what caused the double count.
- The first visit books onto a **{Discipline} Initial Consult** calendar and every later visit onto **{Discipline}
  Follow-up**, so first appointments and ongoing care are countable separately instead of piling onto one calendar - and
  the Calendars tab has eight real services to compare.
- Resulting funnel over 90 days: 338 enquiries → 303 contacted (90%) → 194 booked (57%) → 157 attended (46%) → 100 on a
  treatment plan (30%). Clinic side: PVA 6.7 (median 6), $157/visit, 96% show rate, 11% one-and-done.

## v3.359.0 - 2026-08-20 · `e1c65d2` - Demo account: Norwest Multi-Disciplinary
- A complete, self-consistent demo clinic - physio, chiro, psychology and OT - that loads instantly and needs no
  integrations behind it. Pipeline runs **New Enquiry → Contacted → Booked Discovery Call → Discovery Call Attended →
  Booked Initial Appointment → Initial Appointment Attended → Ongoing Care Plan**, with key events pre-seeded so the
  funnel is populated the first time anyone opens it.
- **The data is faked at the API boundary, not per view.** Rather than stubbing 55 scopes (every one a different shape,
  all of which would drift the moment a builder changed), the GoHighLevel and Windsor *responses* are generated and every
  real builder runs its genuine logic over them. Two consequences worth having: every tab agrees with every other because
  they're derived from one dataset by the same code that derives the real ones, and the demo can't rot - a change to a
  builder flows into it for free, with no second implementation to keep in step.
- Everything comes from a fixed seed, so the numbers are identical on every load and for every viewer. A demo that
  changes shape mid-pitch is worse than no demo.
- Ad spend is **derived from the CRM leads** at a believable cost per lead, so cost-per-key-event, ROAS and the
  Caalano360 blend reconcile instead of telling three different stories. ~90 days: 347 leads, 44 won, $69k revenue, 18.2%
  close rate, 13 days to won, ~$22k spend at a $56 blended CPL.
- Includes the Clinic tab end-to-end: 531 patients, PVA 7.1 (median 6), $150/visit, 94% show rate, 12% one-and-done, a
  populated retention curve, and a **Discovery Call calendar that auto-classifies as triage** while the four service
  calendars classify as clinical - so the demo exercises that logic rather than dodging it.
- Demo routing is keyed off a **per-request sentinel** rather than a module flag. A module flag would have served demo
  rows to real clients and, worse, short-circuited their real fetch; the sentinel is derived once per request from the
  client being asked for, so there's no shared state to race. Agency-wide pulls append demo rows instead of replacing,
  and every consumer maps rows to a client by account id, so a real client can neither see them nor lose its own data.

## v3.358.0 - 2026-08-20 · `6b44790` - Security: a password change now actually ends other sessions
- Found during a review of the auth layer. Login sessions are stateless signed tokens valid for **14 days**, and the
  signature covered only email, role, name and expiry - so changing a password rewrote the hash but **left every existing
  session working**. That's precisely backwards: changing your password is what people do when they think an account has
  been compromised, and until now it did nothing to the compromised session.
- Sessions now carry an **epoch** that is part of the signed payload. Bumping it on the user record invalidates every
  token issued before it, instantly, with no session store to maintain. Because the epoch is inside the HMAC, an attacker
  can't edit their own token to match a new one - that breaks the signature.
- **Changing your password now signs out every other device** and re-issues the current one, so the person making the
  change stays signed in while everyone else's session dies.
- New **"Sign out of all other devices"** on Your account, and **"Sign out everywhere"** on a person's Edit access panel
  for admins - the answer to a lost laptop or someone leaving, instead of waiting two weeks for tokens to expire. An
  Admin can't revoke a Super Admin, matching every other guard on that panel.
- Tokens minted before this existed carry no epoch and are treated as epoch 0, so nobody is signed out by the upgrade.
- Reviewed and found already sound, for the record: server-side per-client authorization (a viewer can't reach another
  client's data by crafting a request, and viewers are further limited to the scopes their allocated tabs use), admin-only
  settings writes with Super-Admin-only client linking, PBKDF2 150k with timing-safe comparison, HttpOnly/Secure/SameSite
  cookies, login lockout, no source maps published, and no secrets reachable from the client bundle.

## v3.357.0 - 2026-08-20 · `1b83ad2` - Refuse AI crawlers at the edge
- Known AI training / answer-engine crawlers (GPTBot, ClaudeBot, PerplexityBot, CCBot, Bytespider, Google-Extended,
  Amazonbot, Applebot-Extended and the rest) and generic scraping stacks (Scrapy, python-requests, curl, wget,
  Go-http-client, node-fetch) are now **refused with a 403 at the edge**, before even the app shell is served. That's what
  produces a "couldn't access this site" result instead of a page of scraped markup.
- `robots.txt` now names each of those agents individually. The blanket `Disallow: /` already covered them, but several
  operators only honour a rule that names them, and a named block is unambiguous if intent is ever disputed.
- The pattern is deliberately narrow rather than matching `/bot/i`, which would also catch Slackbot, Twitterbot and link
  previews. Verified against the real user-agent strings of 13 crawlers and 6 real browsers: every crawler blocked, every
  browser (and an empty user-agent) allowed.
- This is a **courtesy fence, not a security control** - a user-agent is self-declared, so anyone determined simply sends
  a browser's. It stops well-behaved bulk crawlers, which is most of them. The real boundary remains the session gate.
- Note: the on-demand ops endpoints (`*-now`) are behind this too, so they must be opened in a signed-in browser rather
  than curled.

## v3.356.0 - 2026-08-20 · `6fc12cd` - Forms: the expanded notes panel no longer scrolls sideways
- Expanding a lead in the Forms drill pushed its CRM notes off the right edge behind a horizontal scrollbar. The cause was
  subtle: the notes panel is a single full-width cell, which makes it the row's `:last-child` - and `.mini-tbl`
  right-aligns last cells, because they're normally numbers. So the entire note inherited **right alignment** and its
  pre-wrapped text ran off the right of a very wide table.
- Notes rows are now explicitly left-aligned, pinned to the viewport-left like the person row above them, and capped to
  the visible width - so a note reads normally and stays on screen no matter how wide the parent answer table gets.
- Verified in a browser at 1600 and 1280px: computed alignment, the note's right edge against the viewport, and that the
  text no longer overflows its own box.

## v3.355.0 - 2026-08-20 · `4a29be8` - Reliability log: who was on screen when it failed
- Every failure and slow build now records **which signed-in user** triggered it - name, email and role - shown in a new
  **Who** column and included in both the JSON and CSV exports.
- A **per-person summary** sits under the scope chips. One person dominating the list usually points at their session,
  client mix or filters rather than a system-wide fault, and that's invisible when every row looks the same.
- Entries with no user are labelled **system** rather than left blank - scheduled jobs, warmers and requests made before
  sign-in genuinely have no actor, and that's a meaningful distinction when reading the log.
- Name and role are stored on the entry rather than looked up later, so a log line still reads correctly after someone is
  renamed, has their role changed, or is removed from the team.

## v3.354.0 - 2026-08-20 · `59e088f` - Team & access: last active, and time spent in the app
- **Last login was already being recorded** on every sign-in - it just wasn't shown anywhere. Duration wasn't recorded at
  all: login sessions are stateless signed tokens, so nothing server-side knows when one starts or ends.
- Activity is now stamped as requests come through and stitched into sessions: consecutive activity inside a 30-minute
  idle window extends the current session, a longer gap starts a new one. A deliberate sign-in always opens a fresh
  session even if the previous one was still inside the window.
- Two new sortable columns on **Team & access**: **Last active** ("3 min ago", "yesterday") with that session's length
  underneath, and **Time (30d)** - total time in the app over the last 30 days. Hovering either gives exact timestamps
  and the session count.
- Writes are throttled to once per two minutes per person. Every authenticated request passes through the same hook, so
  an unthrottled stamp would put a blob write on every API call for no extra precision. Tracking is also **opt-in per
  call site**: the app's session check and data requests count, while ops/background guards don't - so a warmer running
  overnight never looks like someone using the product.
- Stamping is best-effort throughout: a failed write never costs anyone their request.

## v3.353.0 - 2026-08-20 · `2a6b7a2` - Pipeline stage names: cached for a day, now an hour (and live in Settings)
- Stage names were showing their **old** values after a rename in Caalano Systems. The cause was not the data source -
  pipelines already come straight from the GoHighLevel API - it was the cache in front of it: `caalano-pipecache` held
  them for **24 hours**, on the reasoning that pipelines rarely change. They rarely do; but when they do, a full day of
  wrong names is the worst possible time to be caching hard.
- Cross-invocation freshness cut from **24h to 1h**, keeping the 10-minute in-memory layer and the stale-on-error
  fallback (a transient 429 still can't blank the funnel).
- The **Settings key-events editor now pulls pipelines live**, bypassing both caches. That's the one screen where someone
  reads stage names immediately after changing them, so it should never show a cached copy.
- Stage **names and positions are now taken from the live pipeline list** and the blend feed's per-stage counts are
  merged onto them by stage id, rather than one source winning outright. A stage renamed, added or deleted in the CRM is
  reflected immediately, and its open-deal counts still ride along.

## v3.352.0 - 2026-08-20 · `8c480d2` - Clinic settings: calendar TYPE decides, not the name
- Where a clinic runs **Service Calendars**, that is the clinical layer - services are what a practitioner delivers - and
  the ordinary calendars are the discovery / intake layer in front of them. That's a structural fact, far more reliable
  than reading names, so it is now the default: **services are clinical, calendars are discovery**.
- The name-based guess is kept only for locations with **no** service calendars, where it's the only signal available.
  Switching to type everywhere would have erased every visit for a clinic that books real appointments on a plain
  round-robin calendar, so the rule adapts to the location instead of assuming one shape.
- The settings tab **states which rule is deciding** and why, so the defaults never look arbitrary, and the list is now
  grouped into **Service calendars** and **Calendars** with the buttons relabelled **Clinical service** /
  **Discovery / triage**. An explicit choice still beats both rules and survives a rename.
- The front end no longer re-derives the default from the name - it uses the server's, so the picker can't disagree with
  the numbers on the Clinic tab.

## v3.351.0 - 2026-08-20 · `7c36971` - Clinic settings: resolve template calendar names, show what's booked on each
- Checking a live location immediately found the hole in yesterday's name-based fallback: a template calendar ships as
  `{{custom_values.appointment_name}} with {{location.name}}` and the API returns it **verbatim**. Its bookings were all
  discovery calls, but the words that say so live in the custom value, not the name - so it read as clinical, and in the
  settings list it was unpickable.
- Calendar names now **resolve their merge tags** (custom values + location name, tolerating the spacing difference between how the
  field key and the name are written). The picker shows "Discovery Call with Kind Health Company", and the auto-guess
  classifies on the resolved name - which flips that calendar from clinical to triage without anyone touching it.
- Each calendar in the picker also shows **what is actually booked on it** - the most common booking title and how many
  bookings in the last 120 days. A name alone is often generic or a resolved template; the titles are what make the
  clinical / triage call obvious.
- When **no** calendar is clinical, the settings tab says so plainly and explains the consequence: patient counts, LTV and
  attendance still come from the practice-management sync, but the retention curve, rebooking split and visit cadence need
  clinical bookings in a calendar and stay empty until one exists. That is the expected shape for a clinic whose clinical
  diary lives entirely in Cliniko / Nookal and runs only sales calls through the CRM.

## v3.350.0 - 2026-08-20 · `cfa71ac` - Clinic settings: which calendars actually make someone a patient
- A discovery / triage call is a sales conversation, not a visit - but the diary sweep was counting it as one. That put a
  **phantom first visit at the head of the retention curve**, handed the clinic a **free "rebooking"** when the real first
  appointment followed it, and **dragged the visit-cadence average down**. All three now exclude triage bookings.
- New **Settings → Clinic** tab per CRM client: every calendar listed with a **Clinical / Triage** toggle. Explicit
  choices are stored per calendar and always win.
- Unset calendars fall back to a **name-based guess** (discovery, triage, screening, intro, qualification, enquiry, free
  15-min…), so it behaves sensibly before anyone configures it, and those rows are badged **auto** so a guess is never
  mistaken for a decision. Deliberately narrow: "Standard Consultation", "Dietitian Consult 45min" and "Initial
  Assessment" all stay clinical, where a naive match on "consult" or "initial" would have wrongly demoted real
  appointments.
- **Triage bookings still appear in the book** - they occupy real time, so excluding them would understate how busy the
  clinic is. The forward book now reads "N clinical appointments · +M triage", keeping occupancy honest while the patient
  metrics stay clean.
- The Clinic tab names which calendars were treated as triage, how many bookings that excluded, and whether it was set or
  guessed - so the setting is discoverable from the numbers it changes rather than buried in a menu.
- Applies to both the live tab and the overnight snapshot.

## v3.349.0 - 2026-08-20 · `4fe82e9` - Monthly report: creative + form funnels are clickable, form names fit
- **Creative performance key events are clickable again in the monthly deck.** The drill was already built - the deck's
  call site just never passed `clientId`, `range` or `channel`, so `canDrill` was false and every row rendered static. Now
  wired, so each key-event row opens the same people drill as the Meta view.
- **Form performance cells are clickable** - leads and every key-event count open the leads behind that step, with their
  status, pipeline · stage, source, campaign/creative, age and value, plus a Meta / Google / Other split in the header.
- The monthly snapshot deliberately stores form **counts only** (keeping every lead's record per form would bloat every
  frozen report), so the drill fetches the people on demand **for that report's own period** - which returns exactly the
  leads the cell counted. It re-applies the same key-event reach test the table used, so the list and the count can never
  disagree, and it's scoped per pipeline on multi-pipeline decks.
- **Form names no longer spill into the Leads column.** `.mr-name` is a flex column, and a flex item won't wrap its text
  without `min-width: 0` plus an explicit wrap rule - so the old 180px cap clipped the box while the text ran on
  underneath the next column. The form column now has real width and the name wraps inside it.
- Both fixes measured in a browser rather than by eye: the name element's right edge against the Leads column's left edge
  at 1920 and 1440px, with no table overflow at either.

## v3.348.0 - 2026-08-20 · `3f3cc56` - Clinic: tiles fit their column instead of scrolling
- The Operations tiles were clipping their own label column - "Unpaid balance (AR)" rendered as "ce (AR)" behind a
  horizontal scrollbar, and the same for Attendance and By practitioner. Every tile in a narrow grid track now fits
  without scrolling.
- Two causes, both fixed. `.appt-tbl` sets `white-space: nowrap` on every cell, which is right for the wide drill tables
  it was written for but wrong in a half- or third-width tile. More importantly there is a **global**
  `table { min-width: 700px }` - that floor is what actually forced the overflow, and no amount of wrapping or
  `table-layout` wins against it until it's overridden.
- Label/value tiles now wrap their label and pin the value column; tiles with a name plus numeric columns wrap the name
  and keep the numbers on one line. Numeric **headings** may wrap where the numbers themselves never do - "With next
  appt" over two lines costs a few pixels of height and saves the table from scrolling.
- Verified in a real browser rather than by eye: measured `scrollWidth` against `clientWidth` for every tile at 1920,
  1440 and 1180px, and checked no first-column cell is visually clipped. All fit at every width.

## v3.347.0 - 2026-08-20 · `f3cd2cd` - Clinic: benchmark against the rest of the cohort
- A **Benchmark** section on each Clinic tab: this clinic's PVA, show rate, next-booking rate, one-and-done, avg LTV and
  dollar-per-visit set against the **cohort median**, with a standing for each, plus a table of every clinic on the sync.
- Built entirely from the stored nightly snapshots, so comparing the whole Allied Health cohort costs **one blob read per
  clinic** rather than a multi-client rebuild - and it can't add load to the user path.
- **Medians, not means.** One large practice would otherwise set the bar every other clinic is judged against: across a
  sample cohort the mean PVA lands at 7.4 against a median of 4.1, above every typical clinic in the group.
- Clinics whose snapshot has gone quiet for 3+ days are marked **stale**, since frozen numbers are a sync problem rather
  than a performance one and shouldn't read as decline. A cohort of one renders nothing - there's nothing to compare to.
- Direction is measured per metric rather than assumed: being *below* the median on one-and-done is the win, being above
  it on PVA is.

## v3.346.0 - 2026-08-20 · `18bc95e` - Clinic: the forward book, busiest days, and a data-quality guard
- **Data-quality guard.** A synced field can exist on a location but be populated on only a fraction of patients, and a
  headline built on a thin field reads confidently wrong. Coverage is now measured per field, with a banner above the
  numbers when it's low. The sharp case is called out explicitly: if attendance is recorded on far fewer patients than
  appointment counts, PVA / show rate / one-and-done all read low and look like a retention collapse rather than a sync
  gap - the banner says which it is, with both percentages.
- **The book** - a new section covering the fortnight ahead: appointments booked, **booked hours**, **occupancy** and
  **empty days**, with a per-day chart. Booked hours come from each appointment's real start and end time, which only the
  calendars carry - the synced counters know how many appointments there were, never how long they ran.
- Occupancy is shown **only when the calendars actually declare opening hours**. Without a real denominator a percentage
  would be invented rather than measured, so it's withheld and the card says why. Capacity counts only the days the clinic
  opens, across the number of calendars that can take a booking at once.
- **Busiest days of the week**, averaged over the days the clinic actually opened rather than over all 90 - so a day it's
  closed doesn't drag its own average down. Cancelled and missed appointments are excluded, making it delivered load
  rather than what was booked.
- Fixed a pre-existing bug in the working-hours detector: it looked for `daysOfWeek` while the API returns
  `daysOfTheWeek`, so detection never fired and **every** location silently fell back to a Mon-Fri 9-5 assumption.
- The forward book decays, so a reused overnight copy now has elapsed days trimmed and its totals recomputed - a snapshot
  taken yesterday no longer lists yesterday as part of the fortnight ahead.

## v3.345.0 - 2026-08-20 · `aa93437` - Clinic: PVA and the averages that sit around it
- **PVA (Patient Visit Average)** - the number allied-health practices actually run on - is now a headline metric, defined
  as attended visits per patient *who has actually been seen*. Patients on file who never attended are excluded: including
  them drags the figure toward zero and makes it incomparable with what a practice-management system reports. The
  whole-list version is shown alongside it so the two can never be confused.
- **Median visits** sits next to it deliberately. A PVA of 4 built from "most come once, a few come thirty times" is a
  completely different clinic from one where everybody comes four times - the mean can't tell them apart and the median
  can. A **visit spread** histogram (1 / 2-3 / 4-6 / 7-11 / 12-23 / 24+) shows the shape directly, with the one-visit
  bucket in red.
- **Dollar per visit** - revenue per attended visit - is what separates a retention problem from a pricing one.
- Also added: **PVA excluding one-and-dones** (describes patients who engaged at all), **booked per patient** against
  attended per patient (the gap is cancellations and no-shows), and **visit cadence** - the average gap between
  consecutive visits, read from the diary, which no synced counter can give.
- PVA and dollar-per-visit are broken out **by practitioner** (who retains), **by acquisition channel** (whether paid
  patients stick as well as referrals), and **by cohort**. Both are recorded in the daily snapshot too, so they carry
  movement chips and a PVA line on the trend chart.

## v3.344.0 - 2026-08-20 · `71d1f85` - Clinic detection fixed, and the diary sweep sized for a real clinic
- **The Clinic tab was appearing for clients that aren't clinics.** Detection asked "does this location define *any* of the
  ~30 fields we read", and several of those - a satisfaction survey, marketing-consent boxes, "how did you hear about
  us" - are fields any client can have. Verified against a live non-clinic location carrying three of them from a March
  feedback form: it would have been handed a Clinic tab with nothing in it.
  Detection now requires **fields only a booking/practice system creates** - a patient id (conclusive on its own), or two
  independent practice-management fields. Confirmed against both real locations: the clinic matches on 21 core fields, the
  non-clinic on none.
- **The diary sweep is sized for real volume.** A practice running ~500 appointments a month across the 900-day lookback
  is ~16,000 events, and the events endpoint caps a response rather than paginating - so one request per calendar would
  have quietly returned a clipped answer. Each calendar is now walked in **time slices** (90-day on the user path, 60-day
  overnight) through a bounded worker pool, with any slice returning at the cap flagged, and the number of windows read
  reported when time runs out.
- **The expensive half now runs overnight.** The retention curve and rebooking split need a full walk of the diary, which
  doesn't fit in a page load. The daily snapshot computes them with a background budget (3 minutes rather than 7 seconds)
  and stores them; the tab reads that copy when it's under 36 hours old and skips the sweep entirely. If no fresh snapshot
  exists and the live read can't finish, the stored copy is used rather than a half-walked diary.
- Either way the tab **says where the numbers came from** and how old they are, so a snapshot figure is never mistaken for
  a live one.

## v3.343.0 - 2026-08-20 · `242f84d` - Service Calendars wired end-to-end, and a Calendars performance tab
- **Service Calendars now work as key events, not just appear in the list.** They arrive in two different shapes and the
  wiring handles both: some are ordinary calendars carrying `calendarType: service` (their bookings come back from the
  events endpoint like any other), while locations on the newer Services catalog keep a service menu whose bookings live
  on a **separate feed entirely**. Those are now fetched and bucketed under the *service's* id, so a key event linked to
  either kind resolves. A booking covering several services fans out per service and de-dupes by booking id - three
  services on one visit are three service outcomes, not three visits.
- **Status vocabulary broadened.** A CRM-native booking reports `showed`; a Service Calendar or an appointment synced from
  a practice-management system reports `arrived` / `attended` / `completed`, and marks a miss as `DNA` or `did not
  attend`. Matching only the CRM word was silently under-counting every synced clinical appointment. No-shows are now
  detected explicitly and no longer count as a visit that occurred. Existing CRM statuses behave exactly as before.
- The key-events picker tags each non-round-robin calendar with its type, so a Service Calendar is identifiable at a
  glance before you link it to a pipeline stage.
- **New Calendars tab** - every bookable thing in the location, calendars and Service Calendars alike, with booked,
  attended, no-show, cancelled and show rate, plus a per-calendar bar chart. Show rate is measured against bookings with a
  **known outcome**, so clinics that don't mark attendance aren't punished for it.
- **Filterable by acquisition source** - Meta / Google / Other tracked / Unattributed - from each patient's first-touch
  UTMs. Most bookings are unattributed today, and the tab says so with the exact percentage rather than folding them into
  organic. The view is built now so it fills in on its own once UTMs are captured on the booking journey, with no further
  change needed at that point.

## v3.342.0 - 2026-08-20 · `bb44d1f` - Clinic: lay the page out properly, and read the fields we were ignoring
- The tab had become one long column of equally-weighted cards. It's now banded into labelled sections - **Growth**,
  **Retention**, **Cohorts**, **Acquisition**, **Operations**, **Worklists** - so it reads as chapters rather than a wall.
- The headline scorecard is trimmed from nine tiles to **five**; the rest moved into the section they belong to. The three
  patient worklists (win-back, unpaid balances, reactivation) now share **one tabbed card** instead of stacking three long
  tables, and operations sits in a three-across row.
- Enumerated every field the sync actually creates and picked up the ones we were ignoring:
  - **Patient ID** - its presence marks a contact as a real patient record rather than a lead who never attended, and the
    header now reports how many contacts matched one.
  - **Last Updated via API** - the sync's own timestamp, so the tab shows when the practice-management system last wrote
    and warns when a clinic's sync has quietly stopped for 3+ days.
  - **Cancellation reasons** - why appointments fall over, as a ranked bar list.
  - **Appointment types** - what's actually being booked, with the avg LTV of patients on each.
- Also added lifetime value **by campaign** (the lifetime-ROAS view: set against campaign spend for cost per *patient*
  rather than cost per lead), and turned the "how patients heard about us" list into bars.
- Confirmed there is **no booking-created date** among the synced fields, so the at-the-desk rebooking split can't be
  recovered from contact data - it needs per-booking creation times, which only genuine CRM bookings carry.

## v3.341.0 - 2026-08-20 · `d2bf606` - Clinic: refuse to split rebooking on timestamps the sync fabricated
- Confirmed against a live location that when the practice-management sync writes appointments **into** the CRM, each
  booking's `dateAdded` is *the moment the sync ran*, not the moment the patient booked - a batch of appointments spread
  across a month all carried creation stamps inside the same minute, flagged `createdBy.source: third_party`.
- That silently invalidates the at-the-desk vs after-leaving split, which compares creation time against the visit day.
  Appointment **start** times are real, so everything resting on them - the retention curve, visit counts, whether a visit
  was followed by another booking - is unaffected.
- The sweep now **tests the timestamps before trusting them**. Two tells: a booking "created" after its appointment had
  already happened is impossible, and a bulk backfill stamps hundreds of events with the same minute. If either fires, the
  split is withheld rather than guessed, the card falls back to rebooked / never-rebooked (which needs only appointment
  dates), and it states plainly why - including what share of bookings were stamped after the appointment.
- Clinics that genuinely book through the CRM calendars still get the full split. A confidently wrong number is worse than
  an absent one, so this is deliberately conservative: it needs a 20-booking sample, under 15% created-after-start, and
  creation times spread across more than a quarter as many distinct minutes as there are bookings.

## v3.340.0 - 2026-08-20 · `8cde5e0` - Clinic: a patient cohort analysis, separate from the lead cohort
- The existing **Cohorts** tab is a *lead-acquisition* cohort: it buckets opportunities by the week the lead was created
  and tracks leads → booked → shown → won by channel. That's the right analysis for the ad-driven funnel and it stays as
  it is - but it can't describe a clinic's patient base. It only sees contacts that have a CRM opportunity (most patients
  don't), it ends at a one-off "won" value when a patient's worth accrues over years of repeat visits, and its 12-week
  window is far shorter than the horizon clinic retention plays out over. So the Clinic tab gets its own.
- **Age-normalised cohorts.** Cohorts are different ages, and raw LTV always flatters the older ones - a patient who first
  came two years ago has had two years to spend. Each cohort row now carries its **age in months**, **avg LTV per month of
  tenure** (the column to compare across rows), **still active** and **came back** shares.
- **Retention curve** - the cohort triangle, and the one view the synced fields can never produce: they hold a single
  cumulative LTV per patient with no per-period breakdown. The calendar history does carry real visit dates, so of the
  patients who first attended in month M we can show the share still attending in M+1, M+2 … out to M+12, shaded by
  retention. Months a cohort hasn't reached yet are hatched rather than shown as zero, so a young cohort's short row
  doesn't read as churn.
- Both are honest about their source: the curve needs appointments that reach a Caalano calendar, so clinics whose
  clinical diary lives only in the practice-management system will see the age-normalised table but not the curve.

## v3.339.0 - 2026-08-20 · `5f3b24b` - Clinic: daily snapshots, so period revenue and trend actually exist
- The practice-management sync **overwrites** each patient's stats on every run - lifetime spend, next appointment date,
  balances are all replaced with current values. That means the CRM only ever holds *today*: there is no history to read
  back, and a rolling field like `total spent this month` silently resets on the 1st. The Clinic tab now says so plainly
  (it's a point-in-time read, and the global date range doesn't apply to it), and we keep our own history instead.
- **Daily clinic snapshot** (`clinic-snapshot`, `@daily`, with an on-demand `clinic-snapshot-now` twin) records each
  clinic's aggregate into the `caalano-clinic` blob. Non-clinic locations are skipped by the cheap capability probe.
- **Real period figures.** Lifetime spend, appointment and attendance counters only ever accumulate, so the difference
  between two daily snapshots is a genuine period number - something the CRM can't produce on its own. A "Last N days"
  card now shows **revenue booked**, **collected**, **new patients**, **appointments attended vs booked**, **no-shows**
  and **AR movement**, measured against the nearest snapshot at least 30 days old (falling back to the oldest held, and
  reporting which date it compared against).
- **Movement chips** on the headline scorecards - lifetime value, avg LTV, next booking rate, one & done, show rate -
  coloured by whether the move is good, so falling no-shows and falling one-and-done read as wins.
- **Trend chart** from those snapshots: lifetime value against next booking rate, show rate and the one-and-done rate.
- Before any history accumulates the tab says so directly rather than showing empty comparisons, and the period card
  notes that a backdated entry lands in the window we noticed it, not the window it happened in.
- Rebooking timing is unaffected by any of this: it's read from the calendars, which keep real per-booking history.

## v3.338.0 - 2026-08-20 · `6755915` - Clinic: rebooking from the diary, retention economics, LTV by channel
- The Clinic tab now answers the questions that actually move clinic revenue, and it only appears where it applies.
- **Rebooking, read from the diary.** The synced practice-management fields carry lifetime *counters* but no timeline, so
  they can't say *when* a next appointment was made. We now sweep the location's calendars (every type, Service Calendars
  included) and compare each booking's creation time against the visit it follows. That splits every completed visit three
  ways: **left with the next one booked** (booked at reception, or a course booked up front), **booked again after
  leaving** (a chase), or **never rebooked** - shown as a stacked bar plus a **Next booking rate**. Day boundaries are
  evaluated in the clinic's own timezone, so a 9am Sydney visit rebooked that afternoon reads as the desk, not a chase.
- **Retention economics.** Patients who attended once and never returned are counted as **one & done**, and priced:
  `Revenue at risk` = that cohort × the LTV gap between a retained and a lapsed patient. It's an opportunity figure, not
  money already lost, and the caveat on the card says so. Plus a **retention funnel** - synced → attended → came back →
  next appointment booked - scaled so the drop-off reads at a glance.
- **Lifetime value by acquisition channel** (the ad-side join): each patient's first-touch attribution on their contact
  gives Meta / Google / referral / organic / direct, so clinic LTV can be read back against the spend that produced it -
  lifetime ROAS rather than cost per lead - with a campaign-level breakdown behind it. Patients created directly in the
  practice-management system carry no attribution and are excluded.
- **Cohort LTV chart** (patients + avg LTV by first-appointment month) above the existing table, and a **win-back list**
  of one-and-done patients; every worklist row still expands to that patient's CRM notes and shows their channel.
- **Service Calendars** now come through to the key-events picker: the calendar list merges the calendars endpoint (all
  types) with the newer services catalog, and tags each non-round-robin calendar with its type.
- **The Clinic tab is self-detecting.** It used to show for every CRM client; it now appears only where a
  practice-management sync has actually created its patient fields, decided by a cheap capability probe (one custom-field
  read, no contact paging).

## v3.337.0 - 2026-08-20 · `e8b1e5a` - Health Clinics module: per-client Clinic tab (appointments, LTV, retention, AR)
- New **Clinic** tab (clients with a GHL location) that reads practice-management data synced onto GHL contacts by the
  Universal Plugins integration - appointment/service-calendar stats, revenue and retention - and turns it into a clinic
  operations view. Backend `buildClinic()` pages every contact in the location, resolves the sync custom fields by their
  field key, and aggregates across the patient base.
- **Scorecard**: patients synced, total lifetime value, average LTV/patient, spend this month, unpaid AR, attendance
  (show / no-show rates), forward bookings (% with a next appointment), and NPS.
- **Cohort LTV** by first-appointment month (feeds the LTV-by-cohort view the brief asked for), **attendance** breakdown
  (arrived / cancelled / no-show), **retention & billing** summary, **how patients heard about us**, **by-practitioner**
  split, an **unpaid-balances** AR list and a **reactivation** list (lapsed patients with no upcoming appointment).
- Cached as its own `clinic` scope. Data is only as complete as the practice-management sync - clinics mid-sync will show
  a subset of patients until every contact is populated.

## v3.336.0 - 2026-08-20 · `a6dc97b` - Creative Cockpit: split the whole breakdown per pipeline (replaces the selector)
- Replaced the pipeline *selector* with a proper **per-pipeline split**. A creative belongs to a pipeline (via its
  campaign's Settings link / name match), so a multi-pipeline client's Creative Cockpit is now **one labelled section per
  pipeline** - each with only that pipeline's creatives, its own "What's working" persona/angle rollup, and its own key-event
  columns. No more duplicate / misaligned green columns, and the personas ranked in each section are the ones that actually
  ran in that pipeline.
- Each creative's green key-event fields are computed against *its* pipeline, so a creative in Pipeline A never shows counts
  under Pipeline B's events. Creatives whose campaign maps to no pipeline collect in an "Unattributed" section.
- Filters + the dimension toggle are shared across sections; each section's grid still sorts, tags and drags to pan on its
  own. Single-pipeline clients are unchanged (one flat section, no labels).

## v3.335.0 - 2026-08-20 · `77377b1` - Creative Cockpit: key-events pipeline selector for multi-pipeline clients
- Multi-pipeline clients now get a **Key events** pipeline selector on the Creative Cockpit. The green key-event columns
  otherwise show the *union* of every pipeline's events, which produces duplicate / misaligned columns (e.g. two
  "15 Minute Call" and two "Payment Collected" from two different pipelines).
- Pick a pipeline and the green columns (in both the "What's working" rollup and the creative grid) scope to just that
  pipeline's key events, so they line up and the counts resolve against that pipeline's stages. "All pipelines (combined)"
  keeps the previous side-by-side union. The selector only appears when a client actually has more than one pipeline.

## v3.334.0 - 2026-08-20 · `ec5e395` - Speed: health score reuses the warm blend (no second heavy build)
- The Caalano360 tab built the blend **twice** on every open - once for the tab and once inside the executive health score -
  and the second heavy build is what pushed the score past the 10s budget and produced "Couldn't load the executive health
  score". The health score now **reuses the warm blend** (the one the tab / warmer already built for that client + range) and
  only applies its own closed-basis overlay on top, so it builds cheaply instead of from scratch.
- It also reuses the blend's already-computed won-in-period figure instead of a fresh CRM pull on the closed-basis view.
- Falls back to a fresh build when no warm blend is available, so nothing breaks on an uncached range.

## v3.333.0 - 2026-08-20 · `60c826e` - Speed: warmer now covers Google Ads + the Caalano360 (blend) tab
- Extended the scheduled warmer (which already warmed Meta) to also pre-build each client's **Google Ads** and
  **Caalano360 blend** (the default tab) payloads for last-30-days into the result cache. Those two tabs now open as warm
  hits (<1s) instead of a cold GHL + Windsor fan-out - the same treatment the Meta tab already got.
- Meta stays warmed for last 7 + 30 days; Google + blend are warmed for last 30 days only, to keep the standing upstream
  load in check. Cadence and range coverage are easy to tune.

## v3.332.0 - 2026-08-20 · `caf6c48` - Speed: cache finalised ad ranges for longer + deeper opp snapshot (health-score fix)
- **Historical ad ranges cached much longer.** Once Meta/Google's attribution window has closed, a past range's numbers
  never change - so for the pure ad channels the cache now keeps a finalised range far longer than the live 10-minute
  window (1h once the range end is 2+ days old, 24h once it's 8+ days old). Opening any older period is now a near-instant
  hit. CRM-joined data (attribution / blend / every CRM scope) keeps the short TTL, since an old lead can still be marked won
  or move stage.
- **Fixed "Couldn't load the executive health score".** For high-volume clients the shared opportunity snapshot was paging
  with a tight 7-second deadline even in the background warmer, so it truncated shallow and the client's blend / health
  build fell back to slow live paging and timed out. The scheduled warmer (which has a long background budget, unlike the
  10s request path) now pages the snapshot to full depth, so those builds read the warm cache and complete in time.

## v3.331.0 - 2026-08-20 · `1bda8be` - Meta tab: progressive first paint on cold loads
- On a cold Meta load (a range the warmer doesn't cover, e.g. last 90 days / custom), if the full pull is slow the tab now
  paints a fast **core** payload first - campaigns, ad-sets, totals, daily chart and the Caalano360 key-event columns - so
  you're reading numbers in ~2s instead of staring at a spinner for 8s.
- The heavy creative + day-drill + prior-period queries continue in the background and swap in when ready; until then the
  creatives section shows a small "Loading creative-level detail…" spinner.
- It's a hedge: the core request only fires if the full pull hasn't returned within ~0.9s, so a warm-cache hit (the common
  7 / 30-day ranges) still returns the full payload first with no extra Windsor work. If the full pull ultimately fails, the
  core numbers stay on screen instead of an error card.

## v3.330.0 - 2026-08-20 · `10d8dd3` - Meta data: scheduled warmer so the Meta tab loads fast (fewer failures)
- Opening the Meta Ads tab fired 8 heavy Windsor queries in parallel every time you switched client or changed the date
  range - a cold pull that was slow and, when one of those calls was slow that minute, occasionally tipped past the 10s
  function budget and failed.
- Added a **scheduled Meta warmer** (`meta-warm`, every ~10 min - mirrors the CRM `opp-warm`) that pre-builds each Meta
  client's last-7-day and last-30-day payload into the result cache. Opening the tab on those common ranges is now a
  warm-cache hit (<1s) instead of a cold fan-out. The warmer computes its date ranges in Australia/Sydney time so its cache
  key matches exactly what the app requests.
- Made the server result cache ignore the per-attempt retry counter (`_a`), so a retried deep pull reuses the same cached
  entry (and the warmer's entry) instead of missing on it. Owner can force a warm via `/.netlify/functions/meta-warm-now`.
- Ranges other than 7 / 30 days still load live for now; a follow-up can add progressive first-paint for cold pulls.

## v3.329.0 - 2026-08-20 · `84d2af5` - Forms person drill: styled key-events popup + tidied columns
- The **Key Events** number now hovers into a proper styled popup (matching the rest of the app) instead of the plain
  browser tooltip - it lists each key event the person reached, and the calendars they booked (with showed / occurred).
- Moved the **Key Events** column to sit right after **Days in stage**, and **removed the Booked column** - the booked
  calendar detail now lives inside that Key Events popup. (Clients with no configured key events keep the Booked column.)

## v3.328.0 - 2026-08-20 · `dff504e` - Monthly report lost reasons: per-channel split (Meta / Google / Other)
- The "Lost reasons & pipeline status" tables now carry **Meta / Google / Other** columns, so each lost reason shows how
  many of those deals' leads came from each platform - the per-channel behaviour of why deals are lost.
- Made the lost-reason tables **full width** and removed the "This month's leads by status" pie chart (that same donut still
  lives on the Account summary slide); the won/lost/open counts stay as a one-line note under the tables.
- The lost-deal **popup** now shows a channel summary in its header - e.g. "Meta 41 · 72% · Google 14 · 25% · Other 2 · 3%"
  - so you can see each reason's platform split at a glance while reading the people behind it.

## v3.327.0 - 2026-08-20 · `67b8073` - Forms person drill: fits the screen (no horizontal scroll)
- The expanded people table under a form answer is now pinned to the left of the screen and capped to the visible width
  (the same trick the Users tab detail row uses), so the wide parent answer table no longer drags the person columns
  off-screen.
- The person table lays out fixed-width and every cell truncates to its column, so all columns (Name → Campaign / Ad Set /
  Creative / Key Events) fit without a horizontal scrollbar. Hover any clipped cell (stage, booked calendar, campaign, ad
  set, creative, name) to see its full value.

## v3.326.0 - 2026-08-20 · `80715a5` - Forms drill: resolve campaign/ad-set/creative ids to names via Windsor
- The Forms person drill's Campaign / Ad Set / Creative columns now show the real **names** even when the CRM's UTM carried
  a numeric platform **id**. The `forms` scope builds the same Windsor id→name maps the attribution channel uses (Meta +
  Google campaign / ad-set / ad-group / ad pairs) and rewrites each person's source.
- The id→name lookups hit Windsor (the ad platforms), NOT GoHighLevel, and run in parallel with the CRM build - so they add
  no latency and don't touch the CRM rate limit. Best-effort: anything that can't be matched keeps its raw value.

## v3.325.0 - 2026-08-20 · `57ab9b2` - Forms drill: where each lead came from + key events achieved
- When you expand a form answer to see the people, each person now shows **Campaign / Ad Set / Creative** they came from
  (their first-touch UTMs), next to the existing Channel column. Free - the opportunity already carries attribution, so no
  extra data pull.
- Added a **Key Events** column: a single number of how many of this client's configured key events that person has reached
  - hover the number to see exactly which ones (e.g. "Booked Discovery Call · Disc. Call - Qualified").
- Long campaign / ad-set / creative names are truncated to keep the row scannable; hover any of them for the full value.
- Note: campaign sometimes shows as the numeric campaign id (that's what the CRM's UTM carries); ad set and creative are
  usually names. Say the word and the next pass can resolve campaign ids to names.

## v3.324.0 - 2026-08-20 · `37a9517` - Reliability: ccdrill reads the warm snapshot (kills the biggest 429 source)
- `ccdrill` (the command-centre drill behind every clickable tile) was the single biggest source of GHL `429` errors in the
  logs. It pulls a 120-day opportunity window for name resolution, but for high-volume clients (e.g. Nexia) the shared
  opportunity snapshot truncates at its cap and reaches back less than 120 days - so that pull fell through to a live
  `/opportunities/search` page every time, and concurrent loads 429'd.
- Now `ccdrill` serves that wide window best-effort from the warm snapshot instead of paging live. Its in-period numbers
  (the from→to cohort) are unchanged - that window is recent and always fully covered; only very deep historical *name*
  lookups could be shallower, which is cosmetic.
- Also, `allOpportunities` now serves any window from a NON-truncated snapshot (one holding every opportunity) instead of
  making a live call that returns the same set - a free latency win for smaller clients, with identical numbers.

## v3.323.0 - 2026-08-20 · `4c3f3a2` - Reliability: per-client request governor to cut GHL 429s
- The reliability logs showed most hard errors are GoHighLevel `429 Too Many Requests` bursts - because opening a client
  dashboard fires several CRM scopes (attribution + blend + users + …) for the SAME client at once, and GHL rate-limits per
  location.
- Added a **per-client concurrency cap** on shared CRM requests: one client's scopes now queue behind each other (max 4 in
  flight), while different clients (the agency overview fan-out) still load in parallel. This is timing-only - it never
  changes what's fetched or the numbers returned.
- (Next, separately: the biggest single offender - `ccdrill` for high-volume clients - is a server-side snapshot-coverage
  gap; that fix touches the opportunity-cache sizing and will land on its own so it can be watched carefully.)

## v3.322.0 - 2026-08-20 · `f7cbfe9` - Creative Cockpit: sortable key-event columns, mouse-friendly scrolling, per-event rollup
- **Sort by any column, including key events.** Every green key-event column (Booked, Cost/Booked, Show Rate, Won, …) is
  now click-to-sort in the creative grid, alongside the existing Spend / Leads / Fatigue columns.
- **Easier horizontal scrolling with a mouse.** The wide green tables are now click-and-drag to pan (grab anywhere and
  drag sideways), with a chunkier, always-visible scrollbar that's easy to grab. A real click still expands a row / sorts a
  column - only an actual drag pans.
- **Cost per key event + count on "What's working".** The rollup table (by Awareness / Persona / Angle / Format /
  Destination) now shows, for each configured key event, the total count and the cost per event (spend ÷ count), grouped
  under the event name - so you can see which angle books the cheapest site visits / calls / jobs at a glance.

## v3.321.0 - 2026-08-20 · `1633edc` - Creative Cockpit: key events as columns in the tagging grid (not a separate table)
- Moved the key-event tracking **into the existing creative grid** as green Caalano360 columns, instead of the separate
  "Key events by creative" table. The full tagging grid is back in full - every creative is still click-to-expand for the
  awareness / persona / angle / destination / CTA / copy / notes editor, and all previously saved tags are untouched.
- Each creative row now shows its key events (booked / shown / stage reach / won, with cost-per-event and rates) as green
  columns to the right of Spend / Leads / Booked, joined to the ad by `utm_content` - matching the Meta Ads view.
- The green columns fill in a moment after the grid first paints (they come from the attribution build, an independent
  fetch), so tagging is available immediately and nothing blocks on the CRM funnel.

## v3.320.0 - 2026-08-20 · `397586d` - Creative Cockpit: selected client saved in the URL
- The client picked in the Creative Cockpit is now written to the URL (`?c=`), so a link like
  `…?v=cockpit&c=<client>` opens the Cockpit straight on that client and any Cockpit link you copy remembers the selection.
- Deep-linking a client no longer forces the client workspace when the URL asks for another view, so `?v=cockpit&c=` lands
  on the Cockpit (not the client dashboard).

## v3.319.0 - 2026-08-20 · `2a5199e` - Creative Cockpit: key-event tracking per creative
- Added a **"Key events by creative"** table to the Creative Cockpit (Creative Breakdown), showing the client's configured
  green Caalano360 key events (booked / shown / stage reach / won, with cost-per-event and rates) behind every creative,
  joined to each ad by `utm_content`.
- Reuses the exact sortable green-column table from the Meta Ads view and the Monthly Report, so the numbers and columns
  line up across every screen. Falls back to the legacy Booked / Shown / Won block when a client has no key events set.
- Pulls the funnel from the same attribution build the other tabs use, so the cockpit now gives a full outlook from ad
  spend all the way through to the CRM outcome.

## v3.318.0 - 2026-08-20 · `ac8ba0b` - Removed the AI creative strategy panel from Creative Cockpit
- Removed the "✨ AI creative strategy" card (the "Generate strategy" read) from the Creative Breakdown view.

## v3.317.0 - 2026-08-20 · `a5b33ad` - Call Reporting: rep drill-down, talk-minutes line, weekday labels + faster pull
- **Rep drill-down on the volume chart.** A rep dropdown above "Call volume by day" filters the chart to that rep's calls
  (defaults to All reps).
- **Talk-minutes line.** The chart is now a combo: outbound/inbound bars (left axis) plus a talk-minutes line (right axis),
  for the whole team or the selected rep.
- **Weekday on the axis.** Each day now reads "08-19 Tue" (date + day of week) on the axis and tooltip.
- **Faster pull.** Now that the export works (the fix was a missing `locationId`, not throughput), each day fetches at 250
  rows/page (most days finish in one request), day-chunk concurrency is up to 5, and past (immutable) days are cached again
  so repeat loads are instant. A cold wide range loads noticeably quicker.

## v3.316.0 - 2026-08-20 · `3129b21` - Call Reporting: bigger pages + longer per-day cutoff for complete day counts

## v3.315.0 - 2026-08-20 · `44ba10a` - Call Reporting FIXED: the export needs locationId in the query
- **Root cause found and fixed.** The `/conversations/messages/export` endpoint returns `400 CONVERSATIONS_LOCATION_ID_REQUIRED`
  unless `locationId` is passed as a query param - even though we authenticate with the location token (most other GHL reads
  don't need it). We weren't sending it, so every call export failed instantly and the `.catch` returned zero, which showed
  as "No dialer calls". Added `locationId` to the query in both export call sites (Call Reporting + the Speed-to-Lead bulk
  map). Call Reporting and full Speed-to-Lead now populate. (The earlier call-reporting changes - ISO dates, dropping the bad
  sortBy, day-batching, smaller pages - were real issues, but this missing param was the one pinning it at zero.)

## v3.314.0 - 2026-08-20 · `7fc0515` - Call Reporting: surface the export error in _diag (found the 400)

## v3.313.0 - 2026-08-20 · `f8094ce` - Call Reporting: 50-row pages + always-fresh chunks + diagnostics
- Dropped the call-export page to 50 rows (a 100-row page for a busy day can exceed the 9s per-request timeout, which the
  loop swallowed and returned 0 calls), reduced day-chunk concurrency to 2 (avoids the export contending with itself), and
  made the day chunks always bypass the server result cache so a stale empty can't mask real calls. Added a `_diag` block to
  the usercalls response (pages fetched, the export's reported total, the ISO bounds) so a single day URL reveals what's
  happening if it's still empty.

## v3.312.0 - 2026-08-20 · `5854aed` - Call Reporting now loads wide ranges by batching day-by-day
- **Call Reporting fetches the range one day at a time and merges the results**, with a "X/Y days" progress indicator. Each
  day is small enough to page fully inside one request (the export streams too slowly to pull a whole busy month at once),
  so a 30-day view of a high-volume dialer now shows **complete** calls / talk-minutes / per-rep scoreboard instead of a
  blank or partial result. Past days are immutable, so each day's result caches on the server - the first wide load is a bit
  slower (fetching in the background with the progress bar), and repeat loads are fast.
- Backend: `usercalls` accepts `callsonly=1` (skips the opportunities pull for speed) and each rep row now carries raw
  counts/seconds so the day chunks merge exactly and rates are re-derived. Speed-to-lead needs the whole range in one pull,
  so it's shown only on shorter windows (≤ a few days) with a note; the call totals are complete on any range.

## v3.311.0 - 2026-08-20 · `865a4b3` - Call Reporting: smaller pages so partial data always shows on heavy windows
- Dropped the call-export page size to 100 so the first page always returns inside the per-request timeout - a very
  high-volume window now shows its most recent calls (labelled "high volume") instead of a blank "No dialer calls". The
  GoHighLevel message export streams at only ~30-35 rows/sec, so a busy dialer's 30-day history (2,000+ calls) genuinely
  can't be fetched inside one ~10s function; full coverage on wide windows needs a background pre-compute (planned).

## v3.310.0 - 2026-08-20 · `7a265e8` - Call Reporting: page the export so heavy windows don't time out
- **The v3.309.0 fix (removing the broken `sortBy`) exposed a second problem:** at `limit: 1000` the export payload (recording
  URLs + full metadata per call) is so large a single page can't return inside the function's ~10s budget - so it timed out
  and still showed nothing. Now it pages in 200-row chunks under a wall-clock deadline, banking each page as it arrives, and
  the Speed-to-Lead bulk map does the same. Normal windows load fully; a very high-volume window that can't finish in time
  now shows the most recent calls in range (labelled "high volume — showing the most recent calls") instead of zero.

## v3.309.0 - 2026-08-20 · `8a35b55` - Fix: Call Reporting showed "No dialer calls" despite thousands of calls
- **Call Reporting (and Speed-to-Lead) were silently empty.** The message-export call passed `sortBy: 'createdAt'`, and for
  that sort value the GoHighLevel export returns HTTP 200 with **zero** messages instead of an error - so the whole call
  section read as "No dialer calls in this period" even when there were thousands (Nexia: 2,320 calls in the last 30 days).
  Removed the `sortBy`/`sortOrder` params (the export already returns newest-first), so calls, talk minutes, the per-rep
  scoreboard and speed-to-lead all populate again.

## v3.308.0 - 2026-08-19 · `ebd2086` - Fix: single custom-conversion primary still showed the id
- **Follow-up to v3.307.0.** A client with a SINGLE custom conversion as its primary (e.g. Feel Better Medical → B_Page_View)
  still showed "Offsite Conversion Custom <id>" because the single-field result path built its label straight from the field
  id, bypassing the name-resolved label. It now uses the resolved label, so single-primary clients read the real name too
  (multi-primary clients were already fixed).

## v3.307.0 - 2026-08-19 · `4cd8464` - Custom conversions labelled by their real name
- **Custom conversions now show their name (e.g. "B_Page_View") instead of "Offsite Conversion Custom 1339475751097032".**
  Windsor's Custom Conversion Definition table maps each conversion id to its name; the Meta tab / Monthly Report Results
  chips + the "primary = …" hover, and the Settings → Meta conversions list, all now read the real name. Falls back to the
  id form only if a name can't be resolved.

## v3.306.0 - 2026-08-19 · `d3b4fdb` - Time in stage → rolling 90 days; Daily Performance custom conversions now exact
- **Time in stage (Timing board) now only considers open deals created in the last 90 days**, and says so in the header and
  caveat. Previously it loaded every open deal ever (sampled to 3,000), so ancient/stale deals skewed the dwell times and
  the pull was heavier. The window is applied at the source (paging stops once it passes 90 days back), so it's lighter too.
- **Daily Performance custom-conversion Results are now exact per day.** The first pass (v3.304.0) spread a client's
  whole-window custom count across days by spend share, which under/over-counted short windows (e.g. Feel Better Medical's
  last-7-days showed 5 where Meta showed 7). Windsor serves custom conversions by **day + campaign**, so each day now takes
  its real count, matching Ads Manager for every rolling window (3/7/14/21/28-day). Matched by the single action-name each
  primary maps to, so no double counting.

## v3.305.0 - 2026-08-19 · `b9860f3` - "GoHighLevel / GHL" renamed to "Caalano Systems" in the UI
- **All user-facing mentions of GoHighLevel / GHL now read "Caalano Systems"** - the forms caveat, the Time-in-stage note,
  the Call-activity dialer label, the add-client "not connected" status, the auto-onboard copy, the social inbox note, and
  the "not connected" error. Internal code identifiers, the `gohighlevel` Windsor connector and the `GHL_*` environment
  variables are unchanged (renaming them would break integrations).

## v3.304.0 - 2026-08-19 · `1bec279` - Custom conversions now count in every Meta Results surface
- **Custom-conversion primaries now flow through to every Meta Results view**, not just the campaign table + account total:
  - **Ad-set & ad drill-downs** (Meta tab + Monthly Report): each campaign's custom count is allocated to its ad sets / ads
    by spend share (Windsor only breaks custom conversions to campaign), so drill-downs reflect it and campaign totals stay
    exact.
  - **6-month Results trend** (Meta slide): each month adds its custom-conversion count from the Custom Conversions table.
  - **Daily Performance** (rolling 3/7/14/21/28-day trends): each custom-primary client's custom conversions are fetched by
    campaign and spread across days by daily Meta-spend share, added to the daily Meta results.
  - All add-only and gated on the client having a custom-conversion primary; no other client's numbers change.
- Agency Overview and Weekly Traffic Light intentionally still show native Meta **leads** (a blended leads view, not a
  per-client-primary Results view), so they're unchanged.

## v3.303.0 - 2026-08-19 · `f33497a` - Caalano360 Channel split now breaks out per pipeline
- **Channel split splits per pipeline for multi-pipeline clients** - no more duplicated key-event columns (e.g. "15 Minute
  Call" / "Payment Collected" appearing twice). Each pipeline gets its own Meta/Google table with only that pipeline's key
  events, plus its per-channel leads/won/revenue/avg-deal (from the CRM's per-pipeline channel split). Each channel's spend
  is allocated to a pipeline by its share of that channel's leads (there's no native per-pipeline spend), and CAC follows.
  Single-pipeline clients keep the one account-wide table. Backend `buildCcDrill` now exposes `pipeContribution`.

## v3.302.0 - 2026-08-19 · `b4f798d` - Custom conversions now count in the headline Results (Meta tab, Monthly Report)
- **Custom-conversion primaries now count toward Results everywhere**, not just in Settings. The Meta tab's Results KPI,
  the campaign table, and the Monthly Report's Meta slide add each configured custom PRIMARY conversion's real count (from
  Windsor's Custom Conversions table) - per campaign and to the account total - on top of the standard results. Example
  (Nexia, Aug): `CD_12_Page_View_A` went from **0 → its A_event_pageview count**, and the account Results total now
  includes A_event_pageview instead of dropping it. Add-only and scoped to clients with a custom-conversion primary, so no
  other client's numbers change, and (because the insights value for a custom field is always 0) it can never double-count.
  *Re-refresh a Monthly Report snapshot to pick it up.* (Daily Performance uses a separate per-day builder and is the next
  step.)

## v3.301.0 - 2026-08-19 · `5ba9b62` - Custom conversions now count (Windsor Custom Conversions table); Logs load robustly; Creative Curator hidden
- **Custom Meta conversions now show their real count** (Settings → Meta conversions). They were always reading 0 because
  the app asked Windsor for per-id insights columns (`conversions_offsite_conversion_custom_<id>`) that Windsor doesn't
  expose - custom conversions live in Windsor's separate **Custom Conversions** table (`custom_conversion_action_name` +
  `custom_conversion_action_count`). Verified against Nexia: `A_event_pageview` = 77 for 23 Jul–19 Aug (matches Ads
  Manager), where the app previously showed 0. The detect + "Find + add by name" flows now read that table, so detected,
  saved and by-name custom conversions all show the correct count and cost/action. Custom-conversion ids are also no longer
  sent to Windsor as insights columns (they never resolved there). *(Note: the headline Results total on the Meta tab /
  Monthly Report still needs the same table wired in - that's the next step; the Settings screen is now correct.)*
- **Logs → Build versions no longer shows a blank "0 releases".** The changelog loads as its own lazy chunk; after a fresh
  deploy an older cached page points at the rotated chunk hash, which 404s. That failure was swallowed silently. It now
  shows a clear "couldn't load - hard-refresh" message with a Retry / reload, and a spinner while loading, instead of an
  empty history.
- **Creative Curator is hidden for now** (not good enough yet) - the Creative Cockpit shows just Creative Breakdown. Easily
  resurfaced later via a single flag.

## v3.300.0 - 2026-08-19 · `ee42c8f` - Caalano360 Key event reach split per pipeline; light mode is now the default
- **Caalano360 "Key event reach" cards now split per pipeline** (multi-pipeline clients), matching the Meta Ads view.
  Instead of one union row that repeated the same stage once per pipeline (e.g. "15 Minute Call" twice), each pipeline gets
  its own labelled row of key-event reach cards, each measured against that pipeline's own leads. Single-pipeline clients
  are unchanged.
- **Light mode is now the default theme** across the whole app. New sessions (no saved preference) open in light; the theme
  is applied before first paint so there's no flash of dark. Anyone who previously chose a theme keeps their choice, and the
  Light/Dark toggle in Settings still works.

## v3.299.0 - 2026-08-19 · `2fb3ec4` - Creative screen split by pipeline, sortable key-events-by-campaign, CAC on ROI by channel, Form performance split by pipeline
- **Form performance (monthly report) now splits per pipeline — no more duplicated columns.** For multi-pipeline clients
  the union view listed the same key event once per pipeline (e.g. "15 Minute Call" and "Payment Collected" twice). The
  slide now renders one table per pipeline, each under its own heading with only that pipeline's key-event columns and its
  forms/leads scoped to it. Single-pipeline clients keep the one table; older snapshots that only stored the union get their
  duplicate columns merged. (Re-freeze the snapshot to get the full per-pipeline split.)
- **Creative performance now splits by pipeline (multi-pipeline clients).** Every pipeline's creative cards come first
  (Cards for pipeline #1, then #2 …), then every pipeline's creative table underneath (Table #1, then #2 …), each under its
  own pipeline heading. Single-pipeline clients keep the flat cards-then-table layout. Each pipeline's card block pages
  independently; the sort chip and the table header sort apply across all of them.
- **Key events by campaign — columns are now clickable to sort.** On the Caalano360 "Key events by campaign" slide, click
  any column header (Campaign, Spend, Leads, or any green key-event / cost column) to reorder the campaigns by it. The
  top-16-by-spend selection is unchanged; the click only re-ranks what's shown.
- **CAC added to "ROI by channel".** The Caalano360 account-summary "ROI by channel (closed this month)" table now has a
  CAC column (ad spend ÷ deals won) for Meta and Google, next to ROAS.

## v3.298.0 - 2026-08-19 · `918783c` - Fix: purple report buttons went blank on hover
- **Fixed the Monthly Report toolbar / Publish buttons "going white" on hover.** The generic light hover applied to every
  `.mr-btn`, including the purple (primary / on) ones - so hovering Publish, Refresh snapshot, Reports or the PDF toggle
  swapped the fill to a light colour while the text stayed white, making the label vanish. Coloured buttons now darken the
  brand on hover instead, so they stay readable.

## v3.297.0 - 2026-08-19 · `8d150c9` - Location key events + Speed to Lead now covers the full list
- **Key events by location.** The Location tab has a new ranked panel: pick any outcome or **configured key event** from the
  dropdown and see which suburbs / postcodes fire it the most (click a place for its leads). The pipeline filter above
  scopes it, so multi-pipeline clients see it per pipeline.
- **Speed to Lead now reads the full list, not a sample.** Instead of sampling ~60 leads and fetching each one's
  conversation history, it reads every lead's first manual outbound (call or SMS) from the bulk message export - a few
  paged requests for the whole location - so the median, average, ≤5-min and contacted figures cover **every** lead in the
  range. (Falls back to the sampled scan if the export is unavailable.)

## v3.296.0 - 2026-08-19 · `60f3f72` - Bottleneck: open pipeline list split per pipeline
- **Each pipeline's funnel now has its own "open pipeline by stage" list directly underneath it** (multi-pipeline clients),
  so the live deals line up with the funnel they belong to instead of one merged list. Single-pipeline clients keep the one
  combined list.

## v3.295.0 - 2026-08-19 · `1104d47` - Caalano360: richer Channel split, funnel % of total, per-pipeline bottleneck
- **Revenue bottleneck funnel now shows % of total leads AND next-step conversion** on every stage, alongside the existing
  step %, with a header row - so you see both "share of all leads still here" and "conversion into the next step".
- **Multi-pipeline clients default to one funnel per pipeline** (instead of picking the biggest), so each pipeline's
  bottleneck reads clearly; the selector still lets you focus a single pipeline.
- **Channel split rebuilt and moved above the bottleneck.** It now shows, per paid channel: Spend, CRM Leads, each
  configured **key event** reached, **Won**, **Revenue**, **Close %**, **CAC** (spend ÷ won) and **Avg deal** - a full
  per-channel scoreboard instead of just spend + leads.
- **"Show rate by calendar" is clickable** - click a calendar to jump to the Appointments tab and see every appointment,
  filterable by user (who booked / who showed).
- Backend: the CRM drill now returns per-channel revenue + lead counts for the channel scoreboard.

## v3.294.0 - 2026-08-19 · `4351334` - Forms: readable answer viz, sortable, full-width charts + report match
- **Form tab charts use the full width.** The donut + "key events by form" share the top row and the "conversion" chart now
  spans the whole width underneath, so the busy multi-series bars are legible instead of squeezed into a third of the screen.
- **The per-answer breakdown is redesigned.** Expanding a question now shows a **🏆 Top answers by wins** scoreboard beside a
  **Key events by answer** chart (your configured key events per answer, not the generic Leads/Booked/Won) - so a wide,
  hard-to-read bar is replaced by two compact, quantifiable panels.
- **The answer table is sortable** - click any column header (Leads, Won, a key event, Revenue…) to rank by it.
- **Monthly report Form performance now matches the client view** - Leads → each configured key event (count + % of the
  form's leads) → Revenue → Avg deal, instead of the generic booked/shown/won columns. (Needs a fresh snapshot - hit
  **Refresh snapshot**; older reports keep the simple table.)

## v3.293.0 - 2026-08-19 · `99d73a6` - Leaderboard: status filter (open/won/lost), no side-scroll, tab reorder
- **The rep expansion now filters by status.** The Total pipeline / Open / Won / Lost cards are **clickable** - pick one and
  the by-stage panel below shows exactly those deals per stage: **Open** = where live deals are sitting, **Won** = the stage
  each win closed at, **Lost** = where lost/abandoned deals died (lost + abandoned combined). "All" shows open/won/lost side
  by side per stage. So you can finally see *where the most leads are lost, won, and still open*. Won and Lost drills open
  the same deal list, click-through to notes.
- **Won is now visually distinct** - its funnel row is green (an outcome, not a pipeline stage), no longer blending into the
  stage-reach bars.
- **No more horizontal scroll** on the leaderboard - cell spacing and type tightened so the full ~14-column table fits the
  screen, and the expanded rep panel no longer runs off the right edge.
- **Client-view tabs reordered**: Caalano360 · Meta Ads · Google Ads · Analytics · Cohorts · Users · Call Reporting · Forms
  · Location · Appointments · Timing · Optimisation Log.
- Backend: the Users scope now returns per-rep won/lost deal lists (with their stage) alongside the existing open list.

## v3.292.0 - 2026-08-19 · `ef38822` - Fix: rep funnel + "open pipeline by stage" going blank
- **Fixed: the rep leaderboard's funnel and "open pipeline by stage" (where each rep's open leads are sitting) were
  showing 0 / empty.** Opportunities are served from the warm snapshot so their counts (leads / won / lost / open) always
  loaded, but the pipeline definitions were fetched live on every load with no cache - so under the same GoHighLevel
  rate-limiting the snapshot exists to avoid, that call would 429 and fall back to an empty list, which silently zeroed
  every stage-reach number and dropped the open-deals-by-stage panel.
- Pipelines are now cached per client (in-memory + 24h cross-invocation) with a **stale fallback** - a transient 429 serves
  the last-good copy instead of blanking the funnel - and the scheduled warmer refreshes them alongside the opportunity
  snapshot, so interactive loads never depend on the live call.

## v3.291.0 - 2026-08-19 · `0d4004d` - Call Reporting tab + fix: dialer calls were always blank
- **Fixed: call activity was always empty.** The GoHighLevel message-export API validates its date filters as full ISO 8601
  datetimes (`YYYY-MM-DDTHH:mm:ss.sssZ`); we were sending bare `YYYY-MM-DD`, which the API accepts with HTTP 200 but
  silently matches **zero** calls. Now sends timezone-correct ISO day bounds - so the dialer's calls actually come through
  (e.g. Nexia has ~1,500 calls/month that were invisible).
- **New "Call Reporting" tab** on every CRM-connected client:
  - **Sub-account scorecards** - total calls, outbound vs inbound, time on the phone, connect rate, average call length,
    unique contacts reached, calls per active day, active reps, and missed inbound.
  - **Call volume by day** - a stacked outbound/inbound trend chart.
  - **Per-rep scoreboard** - ranked by outbound, with talk time, connect %, avg &amp; longest call, contacts dialed,
    speed-to-lead, ≤5-minute callback rate and missed inbound; ★ marks the top caller.
- Backend `buildUserCalls` now also returns sub-account totals, a daily series, inbound talk time, unique contacts and
  missed-inbound counts.

## v3.290.0 - 2026-08-19 · `f8c724a` - Monthly Report: shareable links, truer Meta metrics, page-view results, creative order
- **Shareable report links.** The Monthly Report (admin) and Monthly Reports (client) views now carry the selected client
  and report in the URL (`?c=&m=`), and there's a **🔗 Copy link** button. Send the link and it opens straight onto that
  client's report - deep-linkable, just like the rest of the app.
- **Meta campaign / ad-set columns rebuilt.** The campaign → ad-set drill table now shows **Link CTR**, **Conv. rate**
  (results ÷ link clicks) and **CPM** instead of Impressions / Reach / all-click CTR - truer signals for lead campaigns,
  and it removes the ad-set **Reach** column (Meta returns 0 there).
- **Page-view campaigns now show their own Results.** A campaign optimised to landing-page views (e.g. a "Page View"
  campaign) counts those views as its result + cost per result, instead of reading 0 against a lead primary.
- **Creative performance: cards first.** The creative cards now sit above the data table, with the table underneath.
- Note: the Meta results + green ad-set columns only refresh on **newly generated** snapshots - hit **Refresh snapshot**.

## v3.289.0 - 2026-08-19 · `6b0d64b` - Monthly Report: click a campaign to drill into ad sets / ad groups
- **"Key events by campaign" is now expandable.** Click any campaign row (▸) to break it into its **ad sets** (Meta) or
  **ad groups** (Google) - shown **by name, not ID** - each with the same green key-event columns (count reached, cost per
  each, Won revenue, ROAS), matched by **utm_medium**.
- Google's ad-group UTM (a numeric ID) is folded to the live ad-group name via the same mediumIdMap the Google view uses,
  so the drill reads in plain names.
- Ad sets / ad groups are sorted by spend and limited to the top 20 per campaign; only those with spend, leads or a matched
  key event are shown.
- Backend: the report snapshot now carries a lean per-ad-set/ad-group outcome list (top 80 by utm_medium) so this works
  offline from the frozen report.
- Note: this only appears on **newly generated** snapshots - hit **Refresh snapshot** on an existing month to pull it in.

## v3.288.0 - 2026-08-19 · `fb0974b` - Monthly Report: Form performance slide, reordered decks, clickable cohort wins, no side-scroll
- **New "Form performance" slide.** Added between Key events and User performance: every lead form this month with Leads →
  Booked → Book % → Shown → Won → Win % → Revenue, plus a totals row, so you can compare form friction vs lead quality.
  (Meta Lead Form vs Website form are labelled.)
- **Deck reorder.** "Key events by campaign" now sits **after** the Google ad-group performance slide and **before** User
  performance, so the campaign-level story flows straight into the per-user story.
- **"Won (cohort)" is now clickable**, just like "Closed this mo" - click the number to open the deals drill for that
  user's cohort wins (this month's leads that are already won, whenever they closed).
- **No horizontal scroll** on the User performance and Form performance tables: long headers and names now wrap to fit the
  slide instead of forcing a sideways scroll (figures stay on one line). The deal drill pop-up already wraps (v3.287).
- Note: the Form performance slide only appears on **newly generated** snapshots - hit **Refresh snapshot** on an existing
  month to pull it in.

## v3.287.0 - 2026-08-18 · `d6ecb18` - Monthly Report deal drill: no side-scroll, real names + sources
- **No more horizontal scrolling** in the deals drill (the "Deals won / lost" pop-up): the window is bigger and every
  cell wraps, so the long Pipeline · stage and campaign names fit instead of forcing a sideways scroll.
- **Google campaign / ad group shown by name, not ID.** The Campaign/creative column folds Google's numeric
  utm_campaign / utm_medium IDs to their live names via the same campIdMap / mediumIdMap the Caalano360 green columns
  use. (Meta already showed names.)
- **"Other" now shows the real source** - CRM UI, Organic, Referral, Direct, Email, Social - from the opportunity's own
  source / utm_source, instead of a generic "Other".
- Note: the new source / ad-group detail only appears on **newly generated** snapshots - hit **Refresh snapshot** on an
  existing month to pull it in.

## v3.286.0 - 2026-08-18 · `933f4d3` - Monthly Report generate no longer needs a few refreshes
- **"Generate snapshot" now retries each section** (Meta / Google / Overview / CRM attribution / trend / deals) before
  giving up, instead of silently baking a `null` section into the frozen report on a cold-cache first click. That's why
  it used to take a couple of refreshes to pull everything in.
- If a section still fails after retries, a **warning** names it ("Meta Ads didn't load…") so you know to refresh,
  rather than freezing an incomplete report without telling you.

## v3.285.0 - 2026-08-18 · `17ff9f5` - Location map: click a dot for the leads behind it
- **Click any postcode/suburb dot on the Location map** to open a breakdown of the leads that make it up. Each lead
  shows its **status, value, pipeline stage and how long it's sat in that stage**, and expands to reveal **what they
  answered on their first form submission** and their **Caalano Systems notes** (loaded on demand).
- Built as a vertical card list that **never scrolls sideways** on any screen (per the no-horizontal-scroll rule).
- Backend: the Forms feed now attaches the per-lead detail (funnel fields + form answers) to each location, deduped by
  contact and capped. It's live data - press **Refresh** if a just-opened dot shows no detail yet.

## v3.284.0 - 2026-08-18 · `d23e686` - PDF page breaks land on rows; fix Daily conversion-actions overlap
- **PDF: table rows no longer cut across a page break.** The break detector now (1) re-measures the slide's position
  *after* html2canvas renders (its async pass could shift scroll and throw the break points off by a bit), and
  (2) collects table-row / card edges unconditionally - the compressed 8px export rows were under the old height filter,
  so on a long table there were no row edges to snap to and it hard-cut mid-row. Long tables now break cleanly between
  rows on A4.
- **Daily Performance: fixed the conversion-actions glitch.** In a window tile's breakdown, clicking "conversion
  actions" expanded a wide table inside the narrow left column, overlapping the "Key events by source" panel. It now
  renders full-width **below** the two-column grid, where it has room.

## v3.283.0 - 2026-08-18 · `802f39a` - PDF export back to standard A4 (landscape)
- **PDF now exports as standard A4** (landscape), so it prints and shares like a normal document. Each slide is fit to
  the full page width (kept readable - not shrunk to cram a tall slide onto one page). A slide that fits sits on one page
  centred vertically; a taller slide (e.g. the big creative table) flows across as many A4 pages as it needs, with every
  page break snapped to a block-level edge (row / card / section) so nothing is sliced mid-content. Landscape chosen over
  portrait because the slides are wide - it keeps text larger. (Supersedes the dynamic per-slide page heights, which
  weren't a standard paper size.)

## v3.282.0 - 2026-08-18 · `c80be54` - PDF: one page per slide, sized to content; per-client download
- **Each PDF page is now sized to its slide** - fixed width, natural height, one page per slide. No shrinking, no
  content sliced mid-row/card, and **no trailing white space** (the page ends where the card ends). The cover's tall
  min-height is collapsed on export so it's no longer a near-empty title page. An unusually long slide (beyond the PDF
  page-size limit) still splits, but only at element edges. Replaces the fixed-A4 approach that shrank dense pages.
- **Client PDF download is now per-client** (was agency-wide). The toolbar toggle names the selected client
  (e.g. "A2Z PDF: Off") and controls only that client. Still **off by default** and enforced server-side, so a client
  gets the download button only for a client an admin has explicitly switched on.

## v3.281.0 - 2026-08-18 · `d6a2c1b` - Better PDF export + report list dates + client-download control
- **PDF export keeps full width and spills over pages.** Previously a dense page was shrunk to fit one page (tiny).
  Now every slide fills the full page width at its natural height, and when it's taller than a page it flows onto extra
  pages - with page breaks snapped to the nearest element edge so cards / charts / table rows aren't sliced in half.
  Applies to both the agency Monthly Report and the client-facing Reports download.
- **Reports list: added a "Published to client" date column** next to "Generated" (which is when the snapshot was last
  built / refreshed). So you can see, per month, when it was generated vs when the client actually got it.
- **Client PDF-download control.** A new agency-wide toggle (**Client PDF: On/Off** on the Monthly Report toolbar,
  admin/super-admin only) decides whether clients/viewers get a Download button on their published reports. **Off by
  default** - so a client can never download unless you switch it on, and it's enforced server-side (a viewer can't force
  it). Ties report downloads to your control, alongside the existing Monthly Reports access permission.

## v3.280.0 - 2026-08-18 · `77b74d2` - Enforce the Content-Security-Policy
- **CSP is now enforcing.** After a full app tour (Meta embeds, maps, drill-downs, PDF export) in report-only mode
  produced **zero** CSP violations, the header was switched from `Content-Security-Policy-Report-Only` to
  `Content-Security-Policy`. The dashboard now blocks any script/frame/connection outside the allow-list, closing off the
  main injected-content / XSS avenues. Instant rollback if ever needed: append `-Report-Only` back onto the header name.

## v3.279.0 - 2026-08-18 · `dcc3126` - Security hardening pass 2: login throttle + CSP (report-only)
- **Login brute-force throttle.** Failed logins are now counted per email; after 5 failures in 15 min the account is
  temporarily locked with an escalating cooldown (1 → 5 → 15 → 30 min), returning HTTP 429. A successful login clears the
  counter. Best-effort (fails open if the store is unavailable), so it can't lock legitimate users out during an outage.
- **Content-Security-Policy (report-only).** Added a CSP in **report-only** mode - it never blocks, it only logs
  violations to the browser console - scoped to what the app actually loads: self-hosted bundle (`script-src 'self'`),
  inline styles, `https:` images (ad thumbnails / map tiles / favicons), and Instagram embeds. Once we confirm no false
  positives in the console, this flips to an enforcing `Content-Security-Policy`.
- Verified (no change needed): the auth API gates every privileged action server-side - session check, then admin/role
  check, then per-action role hierarchy - so nothing relies on the client to hide buttons.

## v3.278.0 - 2026-08-18 · `5e48803` - Security hardening pass
- **Security headers** added site-wide (netlify.toml): `X-Frame-Options: SAMEORIGIN` (anti-clickjacking),
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Strict-Transport-Security`
  (2-yr HSTS), and a `Permissions-Policy` denying geolocation/camera/mic/payment/USB (the app uses none).
- **Owner-only ops endpoints locked down.** The on-demand `opp-warm-now`, `health-snapshot-now`, `social-snapshot-now`
  and `settings-backup-now` endpoints now require a **superadmin** session (new `requireOpsAdmin` guard). Previously any
  authenticated user - including a client/viewer - could trigger agency-wide work or the GitHub settings backup. (Legacy
  single-password mode is unchanged: still behind the shared-password gate.)
- **Dependency fix:** bumped the transitive DOMPurify to a patched version (moderate XSS advisory). Production audit is
  now clean; the only remaining advisories are dev-only build tooling that never ships.
- **`.gitignore`** now excludes `.env*` so local secrets can never be accidentally committed.
- No change to the core model, which was already sound: every function is behind the edge auth gate, `windsor` re-checks
  role + client access per request, passwords are PBKDF2-salted with timing-safe compare, sessions are HMAC-signed
  HttpOnly/Secure/SameSite cookies, no secrets are shipped to the browser, and the `client` param can only resolve to a
  known location (no SSRF).

## v3.277.0 - 2026-08-18 · `8a1238c` - Kill the /opportunities/search 429 storms (scheduled warmer)
- **Root cause from the reliability log:** nearly every failure was `GET /opportunities/search 429`. Many scopes
  (users, ccdrill, speed, appts, forms, health) each page that endpoint, and when they fire as concurrent cold
  serverless calls with no warm snapshot they all hit GHL at once and get rate-limited.
- **Scheduled opportunity-snapshot warmer.** A new `opp-warm` function runs every ~5 min and force-refreshes each CRM
  client's shared opportunity snapshot (Blobs cache, TTL raised 10→15 min). Interactive scopes now read that warm cache
  instead of each re-paging GHL, so the opp pulls happen once per client off the user path - not in bursts on every
  click. Run `/.netlify/functions/opp-warm-now` to warm on demand and watch the counts.
- **Prefetch made 429-safe.** The filter-channel prefetch (v3.276) now waits for the primary view to load (which warms
  the snapshot) and runs **serially**, so warming Paid/Non-paid/Google/Meta reads the snapshot and can never add to a
  429 burst.

## v3.276.0 - 2026-08-18 · `cf70c27` - Instant tab / filter switching (no reload)
- **Switching sub-tabs and filters no longer reloads.** Added a stale-while-revalidate cache that keeps parsed
  responses in memory across tab switches (React state was thrown away on unmount before). Re-opening a tab or flipping
  the All / Paid / Non-paid / Google / Meta filter you've already viewed is now **instant, with no spinner** - it shows
  the cached view immediately and quietly refreshes in the background.
- **Filter prefetch on client open.** When you open a client, the other four filter channels are warmed in the
  background (staggered, low-priority) so even the *first* click on a filter is instant. Deliberately scoped to filters
  only, throttled so it never competes with the active view or trips GHL rate limits.
- **Reliability:** the cache also keeps the last good view on screen through a transient refetch failure (on top of the
  existing 10-min server cache, 6-hour stale-on-error fallback, retry/backoff, GHL governor and opportunity snapshot),
  so momentary upstream hiccups no longer flash an error or a blank.
- The main tab pulls (Meta / Google / Analytics) seed from the same cache, so revisiting a tab in a session is instant too.

## v3.275.0 - 2026-08-18 · `08ee86b` - Date range + Won-basis in the URL too
- **The date range now lives in the URL**, finishing the deep-link set. It's smart about relative vs frozen: a **preset**
  ("Last 30 days", "This month"…) stays **relative** - the link carries `?r=last_30d`, so a shared link always means the
  recipient's own last 30 days. A **custom** range **freezes** to its exact dates (`?from=YYYY-MM-DD&to=YYYY-MM-DD`). The
  default (Last 30 days) is left out to keep plain links tidy.
- **Won basis** (Closed / Created) is carried as `?wb=created` when it's not the default, so a shared link reproduces the
  same view. On load a URL value wins over the saved preference; otherwise your saved choice still applies.
- Both restore correctly on refresh and through Back / Forward.

## v3.274.0 - 2026-08-18 · `b7a1416` - Deep-linkable URLs (refresh keeps your place)
- **Every screen now has its own URL.** The current section, open client and client sub-tab are mirrored into the query
  string (`?v=…&c=…&t=…`). So a **refresh keeps you exactly where you were** instead of dropping back to the default
  page, browser **Back/Forward** work, and you can **paste a link that opens the exact screen** (e.g. a client's Meta Ads
  tab). Deep links resolve as soon as the client list loads, with no flash of the empty state.
- **Security is unchanged - by design.** The URL is not an authorisation boundary: every data request is still checked
  server-side (role + client allocation), so a link to a client you can't access simply returns 403 and falls back to
  your home screen. Added a `strict-origin` referrer policy so the client id in the URL is never sent to external
  ad-thumbnail / embed hosts.
- Date range and Won-basis are **not** in the URL yet (deliberately deferred - relative ranges like "last 30 days" need a
  design decision on whether a shared link should stay relative or freeze to dates).

## v3.273.0 - 2026-08-18 · `e9f0844` - Sortable Team & access table
- **Team & access table is now sortable.** Click any column header (Name, Email, Role, Access, Status) to sort by it;
  click again to reverse. An arrow shows the active column and direction.
- **Defaults to Role in order of access** - Super Admin, then Admin, User, Viewer - so the most privileged people sit at
  the top. Access sorts by breadth (all-clients first), Status by active-first.

## v3.272.0 - 2026-08-18 · `05b5924` - Fix Command Centre scorecards reading 0 with unassigned opps
- **Scorecards now populate to match the drills.** The Caalano360 Command Centre tiles (Opportunities, Booked, Shown,
  Won, Revenue, Open pipeline, Lost) were summed **per assigned rep**, so a client whose opportunities have no owner
  showed **0** on the tiles even though the drill behind them listed all 35. The tiles now read from the same
  all-opportunity ccdrill feed the drills use, so tile and drill always agree - including unassigned opportunities.
- The **Lost reasons** panel was aligned to the same feed so its total matches the Lost tile.
- Per-rep figures (the Users tab, Team performance) are unchanged - those are *meant* to be per assigned rep.

## v3.271.0 - 2026-08-18 · `5fbb88b` - Opportunities drill: status-first + source pills; "Resulted" rename
- **Opportunities drill reworked.** Clicking the Opportunities tile now opens the full list of every opportunity in the
  period up front, instead of a channel-first "click a source" menu. Filter chips across the top switch between **All /
  Open / Won / Lost** (by status, not by channel), each with its own count, and every row carries a coloured **source
  pill** so you see where each deal came from inline. A per-source count callout (pill · count · value) sits above the
  list. Meta and Google keep their brand colours; every other source (Direct, CRM UI, Organic, Referral…) gets its own
  stable colour so they're each distinct.
- **Consistent source pills** added to the Won-deals and Open-pipeline drills too, replacing the plain channel text.
- **"Closed" renamed to "Resulted."** The close-rate metric is now **Result rate** and its bucket **resulted** (= won +
  lost), because "closed" reads as "won" - so "won ÷ resulted" is clearer. Applies to the Command Centre tile + drill and
  the Monthly Report Win-rate caption. The top **Won basis: Closed / Created** toggle is unchanged (there "Closed"
  genuinely means closed-won).

## v3.270.0 - 2026-08-18 · `a6ad530` - Australian dates + em dashes removed everywhere
- **Dates now DD/MM/YYYY everywhere.** Any date/time that previously rendered in the viewer's browser locale (which
  showed American MM/DD/YYYY for some clients) is now pinned to Australian formatting (`en-AU`) - across the client
  Monthly Reports view, drill-downs, notes, logs, and every internal panel.
- **Em dashes removed across all of Caalano360.** Every `—` in the app (client-facing and internal) is replaced with a
  plain hyphen - in prose/labels it reads as a separator, and empty-value "no data" markers now show `-`. Applied to
  the SPA, styles, the server-side report/label strings (Meta field labels, alert copy, contact-name fallbacks) and the
  seed snapshot. The GHL note author-prefix parser still recognises em-dash-separated authors in external CRM notes.

## v3.269.0 — 2026-08-18 · `0d79be1` — Monthly Reports: client drill-downs + prettier ranges
- **Client-facing drill-downs.** In the client's Monthly Reports view, every headline number in the deck is now
  clickable and opens the same drill-down modal as the agency view — the client can see the individual deals /
  records behind each figure, straight from the frozen published snapshot.
- **Prettified month labels.** The report month picker (client + agency) and the agency reports list now render
  multi-month reports as a proper range label (e.g. "Jun–Jul 2026") via a shared `snapLabel` helper, instead of a
  raw `YYYY-MM_YYYY-MM` key. Clicking a range row in the agency reports list restores both the from- and to-month.

## v3.268.0 — 2026-08-18 · `49ef7ad` — Monthly Reports: client access + publish barrier
- **New "Monthly Reports" permission** (Team & access → viewer): grant a client access to their **published** monthly
  reports for the clients they're allocated. Can be granted on its own (a reports-only client) or alongside dashboard
  tabs. Admins/agency users always have report access.
- **Publish barrier.** Generating/refreshing a report is internal. A new **Publish** button on the Monthly Report
  makes that frozen month visible to permitted clients; **Unpublish** hides it. Clients only ever see published,
  frozen snapshots — never live data, never drafts.
- **Edit safety:** re-generating a published month does **not** change what the client sees — the report is flagged
  "🟠 Published · edited since" and clients keep seeing the last published version until you hit **Push update** /
  Re-publish. Two copies are kept server-side (the working draft and the published copy).
- **Agency reports list:** a **☰ Reports** panel on the Monthly Report lists every generated month per client — when it
  was generated, and whether it's published — with per-row Publish / Unpublish / Push-update controls.
- **Client view:** a dedicated **Monthly Reports** screen for permitted clients — pick their client (if more than one),
  choose a published month, read the report on screen, download the PDF. No agency controls.

## v3.267.0 — 2026-08-18 · `08ac978` — Monthly Report: break "other sources" into named channels (colour-coded)
- On the **Paid vs all lead sources** chart, the non-paid grey "Other sources" block is now **split into named channels**
  — Organic search, Referral, Social (organic), Email, Direct, CRM / manual, and Untracked / other — each its **own
  colour**, stacked alongside the green Paid segment. **Hover any step to see the full split**, and a "Non-paid lead
  mix" line under the table lists the lead count per source.
- Measured, not guessed: each source bucket's per-key-event reach is computed with the **same green-column engine** as
  "Paid" (from the `utm_source` outcomes), then scaled to fill exactly the non-paid remainder so the stacked bar still
  reconciles to the funnel total. Kept the existing two-panel layout for consistency.
- Backend now carries `srcOutcomes` (per-source outcome entities, heavy detail stripped) in the report snapshot.
  **Regenerate the report (Refresh snapshot)** to populate it on already-frozen months; older snapshots fall back to
  the previous Paid-vs-Other bar.

## v3.266.0 — 2026-08-18 · `5879d23` — Monthly Report: fix Google key-events by campaign + time-to-close per channel
- **Fix:** on the Monthly Report's **Key events by campaign** slide, Google campaigns showed "—" for every key event
  even though the live Google Ads view matched them fine. Cause: Google's `utm_campaign` carries the numeric campaign
  **ID**, not the name, and the report wasn't given the **ID→name fold** (`campIdMap`) that the live views pass to the
  matcher — the frozen snapshot had trimmed it out. The report now captures `campIdMap` (and `mediumIdMap`) and passes
  it, so Google campaigns resolve to their name and their key-event columns populate. (Meta was unaffected — it matches
  by name.) **Regenerate the report (Refresh snapshot) to pick this up** on already-frozen months.
- **New:** the **ROI by channel** table (Account summary & ROI slide) now shows **Avg close** — average time-to-close
  (lead → won) **per channel** (Meta vs Google), alongside spend / won / revenue / ROAS. Backend computes it per channel
  on the same span basis as the overall figure.

## v3.265.0 — 2026-08-18 · `8dd88f9` — Funnels: a Won deal now counts as having reached every pipeline stage
- **Fix:** in the funnel key-event steps (Monthly Report cohort funnel, Meta/Google funnels, Command Centre, Daily
  Performance breakdown), a **won deal is now credited with reaching every pipeline stage**. Previously a deal marked
  **Won at an earlier stage** (e.g. "15 Minute Call") without the pipeline stage being dragged forward showed **0 at
  later stages** like "Payment Collected" — even though the deal was won. Now each stage step counts at least the number
  of won deals, so a won deal flows through to the end of the funnel.
- This matches how the Users-tab funnel already treated won deals, so the two views now agree. Reach stays cumulative
  and monotonic (won total is constant across stages), so the funnel can't invert.
- Note: this is a display/attribution rule in the report, not a change to your CRM. Advancing deals through the stages
  in GoHighLevel when you mark them won is still the cleanest source of truth — but the report no longer under-reports
  the final stages when that hasn't happened.

## v3.264.0 — 2026-08-17 · `dd7224a` — Users tab: instant filters (no reload on channel / pipeline / won-basis)
- The Users tab used to **refetch** every time you changed the **All/Paid/Non-Paid/Meta/Google** toggle, the **pipeline
  selector**, or the **Created/Closed won-basis** — a spinner each time. But those filters only change *which
  opportunities are counted*; the expensive GHL fetches (opportunities, appointments, pipelines, users, lost-reasons)
  are identical across every combo.
- So the server now **fetches once and returns every channel × pipeline combo in one response** (plus the won-in-period
  per-rep figures and channel-scoped ad spend). The front end switches channel, pipeline and won-basis **instantly,
  client-side, with no refetch** — and, importantly, without re-hammering GoHighLevel (which naive prefetching would).
- Each combo is produced by the **exact same aggregation** as before, so every number is unchanged; the won-basis
  toggle applies the same won-in-period overlay the server used to. Falls back to the old behaviour for any cached
  pre-deploy response. Also improves cache hit-rate (one cache entry per client+range instead of one per filter combo).

## v3.263.0 — 2026-08-17 · `8c64c62` — Shared per-location opportunity snapshot (cut GHL request volume ~10×)
- **The root-cause reliability fix.** Every CRM scope (users, blend, attribution, appts, speed, ccdrill, forms,
  updateextra, health…) used to page GoHighLevel's `/opportunities/search` **independently** — the same client's
  opportunity list fetched 6-15× per view — which is what blew GHL's rate limit and caused the 429 storms.
- Now one **wide per-location snapshot** (last ~430 days) is pulled once and shared: an in-memory copy dedupes calls
  within/near an invocation, and a Netlify Blobs copy (best-effort, ~10 min) dedupes across invocations. Every scope's
  opportunity query is served from that snapshot **when it provably covers the requested window**, collapsing the many
  per-scope pulls into a single cached read. This cuts total GHL opportunity requests dramatically — the actual fix for
  the 429 root cause (the v3.262 governor handles the residual bursts).
- **Conservative by design:** the snapshot is only trusted when the requested window starts at/after its oldest cached
  opportunity; a wider/older window, a `from`-less query, or any snapshot/Blobs failure falls back to a **direct page —
  identical to the previous behaviour**. Opportunity objects are read-only across the codebase (verified), so sharing
  them is safe. Worst case on a wrong-coverage call is an undercount, same failure mode as the existing paging cap.

## v3.262.0 — 2026-08-17 · `fafada3` — GHL request governor (kill the 429 storms)
- **The big reliability fix.** The 7-day failure log showed **93% of all errors were GoHighLevel `429 Too Many
  Requests`** — we were exceeding GHL's per-location rate limit (~100 req/10s) because every scope pages
  `/opportunities/search` independently and several fire at once (agency overview, a client dashboard opening many
  tabs). The old fixed-backoff retry made it worse.
- Added a **GHL request governor** around every GHL call: caps concurrent requests within an invocation (tames the
  fan-outs) and, on any 429, sets a short **shared cooldown** so every other in-flight/queued GHL call waits too —
  instead of all of them retrying into the same wall. Honours the `Retry-After` header and uses exponential backoff
  with jitter. This directly targets the dominant error class in the log.
- Next in the reliability plan (separate change): a **shared per-location opportunity snapshot cache** so scopes stop
  re-fetching the same opportunity list — the fix that cuts total GHL request volume across invocations.

## v3.261.0 — 2026-08-17 · `4f6e99e` — Reliability log export + opportunity-paging budget guard
- **New:** the Failure logs panel (Super-Admin → Logs) now has **Export JSON** and **CSV** buttons — download the
  current reliability log (with resolved client names) to share for diagnosis. JSON is best for analysis; CSV opens in
  Excel/Sheets.
- **Reliability fix (broad):** `allOpportunities` — the shared GoHighLevel opportunity pager behind most CRM-heavy
  scopes (won-in-period, blend, weekly, attribution, cohorts, appointments…) — could page dozens of sequential
  requests on a big account with a wide window and blow the ~10s function budget (surfacing as a 502 or a cached
  blank). It now has a **wall-clock budget guard** (~6.5s): it stops paging and returns what it has (an undercount,
  already flagged by callers) instead of killing the whole function. This lifts the single biggest timeout source
  identified in the failure-path audit.

## v3.260.0 — 2026-08-16 · `2d1029d` — Daily Performance: fix flaky Meta results + load indicator
- **Fix:** on Daily Performance, Meta results often loaded blank until you hit Refresh a few times. The trends pull runs
  a heavy 56-day, all-accounts Meta query near the function timeout; when it timed out, the empty result was returned
  **and cached** for 10 minutes, so it showed "0 Meta" until a fast pull happened to land.
- The server now tracks whether the Meta/Google pulls actually **succeeded** (vs. legitimately empty) and **does not
  cache a partial pull**, so a timeout no longer sticks. The client **auto-retries** (up to 4× with backoff) on a
  partial result instead of showing blank — no more manual Refresh.
- **New load indicator** on the tab: a spinner bar *"Loading Meta & Google results… retrying (n/4)"* while it works,
  flipping to a green *"All data loaded — Meta & Google in"* that tidies itself away once everything's in. If it still
  can't get a complete pull after retries, it shows what arrived with a clear "hit Refresh for the rest" note.

## v3.259.0 — 2026-08-16 · `a739d57` — Surface paused/dormant Meta & Google accounts in discovery
- **Fix attempt for the 18-vs-23 gap:** the account listing used a metric (`spend`) query, which only returns accounts
  that had **delivery in the window** — so a connected-but-paused ad account (zero spend/impressions) was dropped.
  (GA4 didn't hit this because `sessions` exists for any property with traffic — that's why it matched 10/10.)
- Discovery now **also runs a dimension-only query** (`account_id` + `account_name`, no metric) for each connector and
  **merges** it with the metric query — so accounts with no recent spend still list, while active ones keep their names
  and data. Both queries run in parallel per connector (wall-clock stays ~one query) and each fails independently, so a
  connector Windsor won't answer metric-less still shows via the metric query.
- If Windsor rejects the metric-less shape for a connector, the count is unchanged from before (paste the account ID to
  link it directly) — no regression.

## v3.258.0 — 2026-08-16 · `815ce37` — Fix GA4 connector discovery (wrong Windsor slug) + clearer account-count messaging
- **Fix:** the Analytics (GA4) connector always showed **0 accounts** with Windsor's error *"We don't have this
  connector yet!"*, even though the Windsor account has GA4 properties connected. The cause was the wrong connector
  **slug** in the Windsor API URL (`google_analytics_4`). Windsor's GA4 slug differs (and has changed across their API
  versions), so we now **probe a candidate list once and cache whichever slug Windsor accepts** (`googleanalytics4`
  first), and use it for all GA4 pulls (discovery, the Analytics tab, and the field probe). GA4 properties should now
  come through.
- If GA4 still errors, the empty-state message now says specifically to **add the GA4 data source in Windsor**
  (Data sources → add Google Analytics 4) rather than the generic "re-authorise".
- **Clarified Meta/Google counts:** the picker shows fewer accounts than Windsor's "connected" total because Windsor's
  data API only returns accounts with **activity in the last 12 months** — dormant or still-backfilling accounts don't
  appear here yet. The footer note now explains this and reminds you to paste the account ID to link one immediately.
- The discover response now includes the resolved `ga4Slug` for transparency.

## v3.257.0 — 2026-08-16 · `225a36b` — Call activity no longer gated behind the leaderboard
- **Fix:** the **Call activity** (and **Appointments by rep**) sections were only rendered once the rep **leaderboard**
  finished loading. On a heavy account (e.g. Nexia) that leaderboard pull — opportunities + pipelines + appointments +
  users + lost-reasons — can be slow or time out, and when it did, the whole Users tab showed a spinner or an error and
  the call stats never even mounted, despite the dialer being full of calls.
- Call activity and Appointments-by-rep now render on their **own independent fetches**, below whatever state the
  leaderboard is in — loading, error, empty or full. So the call stats show even when the leaderboard is still loading
  or couldn't load for the window. The leaderboard error message now says so, and points to trying a smaller range.

## v3.256.0 — 2026-08-16 · `dc36e0c` — App-wide "loading… / all data is in" indicator
- Added a single, app-wide status pill (bottom-right) that shows a spinner **whenever any data is still loading**
  anywhere in Caalano360 — deep views, attribution, Users, Timing, GA4, Forms, Location, Appointments, agency rollup —
  and then flashes **"All data is in"** for a couple of seconds once everything settles. The same reassurance the Meta
  and Google views already give with their two-stage load bar, now everywhere.
- Implemented globally by counting in-flight GET data pulls (a one-time fetch wrapper), so it covers every view without
  needing each one wired by hand. Fire-and-forget logging beacons are ignored, and a short settle delay prevents
  flicker between back-to-back requests (e.g. a view loading its data then its sub-sections).
- The existing detailed Meta/Google load bars are unchanged; this pill complements them across the rest of the app.

## v3.255.0 — 2026-08-16 · `8a8cdc8` — HOTFIX: Call activity vanished on large accounts (e.g. Nexia)
- **Fix:** on high-volume accounts the whole **Call activity** section could disappear. The speed-to-lead feature
  (v3.252.0) added an opportunities pull inside the calls scope; on a big account, viewed for an older window, that
  pull pages back through weeks of newer deals and blew the ~10s function budget — the timeout then blanked the entire
  section (the calls, talk minutes, connect rates — everything), even though the dialer data was all there.
- The opportunities pull is now **best-effort and concurrent**: the call export (the core stats) always ships, and
  speed-to-lead / ≤5 min % fill in only if the opps pull returns within a short grace window (otherwise they show "—"
  for that load and populate on a subsequent one). Call volume, talk minutes, connect rate, inbound, calls-per-outcome
  and Rev/talk-hr no longer depend on it.

## v3.254.0 — 2026-08-15 · `fe26b41` — Users tab: rank movement, talk-time efficiency, coverage flags, value win rate
- **Rank + movement arrows** on the leaderboard: a new **#** column ranks reps by wins and shows ▲/▼ movement vs the
  **previous equal-length period** (▲2 = up two spots, `new` = not ranked last period). Best-effort second fetch of the
  same scope for the prior window with the same pipeline/channel filters; arrows simply hide if it can't load.
- **Rev / talk-hr** column on Call activity: revenue won per hour of a rep's talk time — surfaces reps who win more
  from fewer dial-minutes.
- **Coverage flag**: a warning banner lists reps who have leads assigned in the range but **no logged outbound calls**
  in the dialer — a "who isn't calling their leads" catch.
- **Value win rate** card in each rep's expandable row: won value ÷ (won + lost value) — a size-weighted win rate, so a
  few big wins or losses aren't hidden by the count-based win %.

## v3.253.0 — 2026-08-15 · `360cd0a` — Users tab: response SLA + activity-to-outcome ratios
- **≤5 min %** column on the Call activity table: share of a rep's leads they called back within 5 minutes (the classic
  speed-to-lead SLA). Backend `scope=usercalls` computes it from the same per-lead gaps used for the median.
- **Calls / booked** and **Calls / won** columns: outbound calls per appointment booked and per deal won by each rep —
  activity-to-outcome efficiency. Joined in the front end from the leaderboard's booked/won so no extra fetch.
- Pipeline velocity per rep (avg days lead→won) was already the leaderboard's **Avg close** column, so no new work there.

## v3.252.0 — 2026-08-15 · `b4a4bd5` — Users tab: Speed-to-lead per rep + CAC per rep
- **Speed to lead** column added to the Call activity table: for each rep, the **median time from a lead coming in
  to that rep's first outbound call** to the contact. Shown in the most readable unit (minutes / hours / days) with a
  tooltip of the sample size. Backend `scope=usercalls` now also pulls opportunities for the range to establish each
  contact's lead-in time, tracks the first outbound call per contact, and computes each rep's median gap (0–90 day
  window, ignores negatives/outliers).
- **CAC** column added to the Users leaderboard: ad spend **allocated to each rep by their share of leads**, divided by
  their wins — a per-rep cost-to-acquire. Tooltip explains the allocation.
- Rounds out the Users-tab deep-dive: **lost reasons by rep**, **close rate & deals won**, and the **per-rep funnel**
  were already present in each rep's expandable row, so those metrics needed no new work.

## v3.251.0 — 2026-08-13 · `b411619` — Users tab: Appointments by rep (self vs rep booked + show rates)
- New **Appointments by rep** section on the Users tab: per rep — total **booked**, **self-booked** vs **rep-booked**,
  the **show rate for each** (self-booked vs rep-booked), and won. Answers "who's booking, and do self-booked or
  rep-booked appts show up more?".
- Backend: extended the appointments builder's per-user breakdown to split self vs staff booking within each rep
  (show rate per booking type). Renders on the Users tab even when the client doesn't assign opportunities to reps.

## v3.250.0 — 2026-08-13 · `8a10e8c` — Users tab: per-rep Call Activity (GHL dialer)
- New **Call activity** section on the Users tab: per rep, **outbound calls**, **talk minutes**, **connect rate**,
  **avg talk time**, and **inbound handled** — pulled from GoHighLevel's dialer for the selected range.
- Backend: new `scope=usercalls` (cached) aggregates the bulk **Call export** (`channel=Call`) by `userId` — efficient
  (paged for the whole location, not one request per contact). Reads `direction`, `status`, and `meta.call.duration`.
- First chunk of the User-review expansion. Next: appointments-booked / self-vs-user-booked show rates, lost reasons
  by rep, per-user speed-to-lead, CAC per rep (spend by lead share), and a per-rep funnel.

## v3.249.0 — 2026-08-13 · `6bc1f6d` — Timing tab: "Time in stage" (where deals are piling up)
- New **Time in stage** section at the top of the Timing tab. For every **open** deal it measures how long it's been
  sitting in its **current pipeline stage** (straight from the stage moves — no appointment/creation inference), then
  shows **avg / median / oldest days + deal count** per stage, per pipeline, with a dwell bar (green < 14d, amber < 30d,
  red beyond). Your configured **key-event stages are flagged**. This is the "where are deals getting stuck" view.
- Backend: new `scope=stagetiming` (cached) — pulls only **open** opportunities via GHL's status filter (no date
  window, since it's live pipeline state) and aggregates `now − lastStageChangeAt` per stage.
- Honest scope: this is the age of deals *currently* in each stage (where they pile up), not the completed time a deal
  spent in a stage it already left — GoHighLevel doesn't retain that history. Full stage-to-stage journey timing is the
  next phase (a background recorder that accumulates going forward).

## v3.248.0 — 2026-08-13 · `e8dd9bb` — Clearer "session expired" message on data tabs
- When a data pull fails because the **login session expired** (the error was "Not authenticated"), the tab now shows a
  clear **"Your session expired — sign in again"** message with a reload button, instead of the misleading "temporary
  timeout, try a shorter range." Reloading re-runs the auth check and lands on the login screen; no data is lost.

## v3.247.0 — 2026-08-13 · `609febc` — Location view: pipeline selector
- The **Location** view now has a **pipeline selector** (for multi-pipeline clients like FINR — Buyers Agent vs
  Mortgage Broker). Pick a pipeline to see the lead map, scorecards and location list for just that pipeline's leads.
- Backend: each form location now carries a per-pipeline split (`byPipe`), so the selector projects leads / booked /
  won / lost accurately per pipeline rather than lumping every pipeline together.

## v3.246.0 — 2026-08-13 · `9d99093` — Faster loads: de-dupe per-tab data fetches (part 3)
- **Clicking through a client's tabs no longer refetches the same data.** Several views each independently pulled the
  same `channel=blend`, `channel=attribution` and `scope=users` feed for the same client/range — up to 3× the round
  trips. A shared client-side de-dupe (`dedupeFetch`) now collapses identical in-flight/recent requests into one, so
  moving between the Caalano360, Users, CRM and scorecard views reuses the first pull instead of re-hitting the
  function. The refresh nonce still forces a fully live pull, and failures are never cached.

## v3.245.0 — 2026-08-13 · `8f2db2d` — Faster loads: cache the agency first-load call + trim the bundle (part 2)
- **Agency Overview is now cached.** The `scope=agency` whole-roster pull (Windsor + GoHighLevel fan-out across every
  client) fires on every first load and was **completely uncached** — the single biggest wall-clock cost on landing.
  Now cached like the per-client scopes (10-min fresh, 6-hour stale-on-error, Refresh still forces live). Only for
  unrestricted callers — restricted staff still rebuild their filtered view live, so no cross-account leak. `coverage`
  is cached the same way.
- **Main JS bundle down ~55%.** The 219 KB `CHANGELOG.md` markdown was inlined into the main bundle for every
  visitor even though only the Super-Admin Logs panel reads it — now loaded on demand. Combined with the vendor split
  in v3.244.0, the always-loaded app chunk drops from **424 KB → 192 KB gzip**; charts (115 KB) and React (45 KB) load
  in parallel and stay cached across deploys.

## v3.244.0 — 2026-08-13 · `e81ac99` — Faster loads: split vendor bundles (part 1 of perf pass)
- **Smaller, cacheable JS.** The whole app shipped as one ~1.5 MB chunk (424 KB gzip) that re-downloaded on every
  deploy. Split the stable vendor libs into their own chunks — **Recharts + d3** (115 KB gzip) and **React/React-DOM**
  (45 KB gzip) — so the app chunk drops to ~272 KB gzip, the three load in parallel on first paint, and a normal
  deploy only re-downloads the app chunk (the vendor chunks stay cached). jspdf / html2canvas / leaflet / the AU
  postcode map stay lazy-loaded (only pulled when the Monthly Report or Location map is opened).
- Backend data-path speedups (caching, duplicate-fetch removal, tighter timeouts) follow in the next part.

## v3.243.0 — 2026-08-13 · `8929f3a` — Landing Page Performance: green Caalano360 columns matched by URL
- The **Landing Page Performance** table now carries the full green Caalano360 outcome columns, matched by the CRM's
  **first-touch URL** (`attributions[].url`) to the Google landing-page report. This is a robust matching path that
  doesn't depend on ID mapping — GHL exposes the clean landing URL on every opportunity.
- Backend (`ghl.mjs`): `utmOf` now returns the first-touch `url`; `buildAttribution` adds a `byUrl` dimension
  (normalised: no protocol/www/query/hash/trailing slash) threaded through every outcome bump, exposed as `byUrl`.

## v3.242.0 — 2026-08-13 · `6ecb0ec` — Fix: ad-group attribution (byCreative) + connector discovery timeout
- **Ad-group Caalano360 columns now match.** Root cause: the attribution builder exposes the `utm_content` dimension
  as `byCreative`, but the Google view's ad-group matcher (and its diagnostic) read a non-existent `byContent`, so the
  ad-group IDs the CRM stores in `utm_content` were never used (0/10 matched). Confirmed against live GHL data that
  `utmContent` carries the Google ad-group ID (e.g. 181669933171); repointed the matcher to `byCreative`, which the
  Windsor `ad_group_id → name` map then resolves.
- **Connector discovery fix.** The 2-year discovery window (v3.241.0) timed out on Windsor's per-account aggregation,
  surfacing as "a connector is erroring" with 0 Meta / Google / GA4 accounts. Reverted to a 12-month window, which
  returns inside the function budget.

## v3.241.0 — 2026-08-13 · `4f8864f` — GA4 connector picker, wider account discovery, Google Ads polish
- **Settings connector editor**: Google Analytics 4 is now a proper **picker column** (like Meta / Google / CRM),
  populated from the accounts Windsor exposes on its GA4 connector — pick the property or paste its ID. This also
  surfaces the exact GA4 account ID Windsor uses, which is what the Analytics tab filters on (pasting the raw GA4
  property number may not match). The account status line now shows the GA4 count too.
- **Account discovery widened**: the connector picker now lists every account with activity in the **last 2 years**
  (was tied to the selected dashboard range, which hid accounts with no recent spend — why fewer showed than are
  connected). Accounts with no data at all in Windsor still need a manual ID paste.
- **GA4 resilience**: the Analytics headline + daily queries now fall back to a minimal field set if a richer GA4
  field name isn't recognised, so the tab renders core metrics instead of going blank.
- **Google Ads view polish** (from feedback): ads now default-name to **"<Ad group> - N"** (ranked by spend, so a
  single-ad group just reads as its name) — a label or typed name still overrides; keyword green columns **revert to
  the fuller text match** and only split by match type when a keyword genuinely runs in 2+ match types; **landing-page
  URLs show in full**; and **Search terms gained an Ad group column**.

## v3.240.0 — 2026-08-13 · `1a35f92` — Google Ads matching: ad-level on `utm_ad_id`, keywords split by match type
- **Ad-level green columns now match on `utm_ad_id`** (the ad ID the CRM stores in its own param) instead of
  `utm_content` (which is the ad-GROUP ID). The attribution backend now emits a `byAd` breakdown keyed by ad ID with
  full CRM outcomes (leads / booked / shown / won + calendar & stage key events), so the Ads table's Caalano360 columns
  populate per ad. Ad-group columns keep matching on `utm_content` (confirmed = ad-group ID).
- **Keyword outcomes now split by match type.** Previously "adhd" Exact and "adhd" Phrase showed the same bundled CRM
  result because they matched on keyword text alone. When the CRM carries `utm_matchtype`, outcomes are now keyed by
  keyword **text + match type** (new `byTermMatch` breakdown), so Exact and Phrase report separately; the Match-type
  table aggregates the same way. Falls back to text-only matching when the CRM has no match type.
- Backend (`ghl.mjs`): `utmOf` now reads `utm_ad_id` and `utm_matchtype`; `buildAttribution` threads the two new
  dimensions through every outcome bump (leads, booked, shown, cancelled, stages, per-calendar).

## v3.239.0 — 2026-08-13 · `4b22314` — New Google Analytics (GA4) tab
- New **Analytics** tab in the client workspace, shown whenever a client has a **GA4 property** linked. Add the property
  ID in Settings → the connector editor now has a "📊 Google Analytics 4" field alongside Meta / Google / Caalano Systems.
- The tab shows **Sessions, Engaged sessions, Engagement rate, Bounce rate, Key events, Event count, Page views, Users,
  New users, Avg. session duration** (with prev-period deltas), a **daily traffic** chart, **traffic by channel** and
  **by source/medium**, **landing-page performance**, **top events**, and a **device** split.
- **Caalano Systems enrichment**: a *Website-to-revenue funnel* joins GA4 traffic/engagement to CRM leads → won for the
  same window (with step-to-step conversion %), plus a *CRM outcomes by paid channel* table that enriches Meta & Google
  beyond ad-platform numbers — all inside the Analytics tab; the Meta and Google tabs are untouched.
- Backend: new `channel=ganalytics` Windsor scope (`buildGanalytics`) pulling GA4 via the `google_analytics_4` connector,
  scoped per client by property ID; every query is independently guarded with a diagnostic panel so a Windsor field-name
  mismatch degrades one section rather than the whole tab (a `?probe=1` endpoint reports the exact recognised fields).

## v3.238.1 — 2026-08-13 · `e3cefbc` — Hotfix: Google Ads views crashing (`matchCA is not defined`)
- Fixed a regression from v3.237.0 (the cascading-filter refactor) that renamed the `matchCA` drill-filter helper to
  `baseCA` but left one reference in the conversion-actions aggregation. That runs on every Google view render, so
  **all Google Ads views threw "Something went wrong loading this view"**. Repointed the reference to `baseCA`.

## v3.238.0 — 2026-08-13 · `9d5e670` — Google Ads view: ad-level (Ad ID) table with labels + friendly names
- New **Ads** table in the Google Ads view (below Ad groups), one row per `ad_id`, **scoped to the drilled-into
  campaign / ad group** so you can see exactly which ads belong to which ad group. Full metrics + Conv. rate + green
  Caalano360 columns (matched on `utm_content`, which usually carries the ad ID).
- Google Search RSAs have no creative name, so each ad is labelled by (in order): a **friendly name you set**, the
  **Google Ads label** pulled from the Windsor connector (if exposed), or the raw ad ID. Set a name inline with the
  ✎ button on any ad row — stored per client, syncs across devices, and overrides the label.
- Backend: `buildGoogle` now pulls ad-level rows and a guarded ad-labels query from Windsor (falls back silently if
  the connector doesn't expose labels); new `adnames` settings section persists the friendly-name overrides.

## v3.237.0 — 2026-08-13 · `93572d6` — Google Ads view: Conversion Rate, pagination, fully-dynamic drill-down, landing-page reorder
- **Conversion Rate (conv / clicks)** is now a standard column across **every** Google Ads table — campaigns, ad groups,
  keywords, match type, search terms and landing pages — sortable like the rest.
- **Landing Page Performance** moved down to sit just **above Day-by-day** (previously above Keywords), keeping the
  campaign → ad group → keyword drill sequence uninterrupted; it also gains the Conv. rate column.
- **Pagination**: Keywords and Search terms now render **20 rows at a time** with Prev / Next controls, resetting to
  page 1 whenever the filter changes.
- **Fully dynamic, cascading drill-down**: clicking any row — campaign, ad group, keyword, match type or search term —
  now filters every related table, and selections **stack** (campaign → ad group → keyword narrows progressively).
  Match-type rows are now clickable, and picking a lower level auto-selects its parents. Click a selected row again to
  clear it.
- **Ad-group attribution diagnostic**: a collapsible panel under the Ad groups table shows how many ad groups matched
  CRM outcomes and exactly what `utm_medium` / `utm_content` the CRM carries, so empty green columns are diagnosable
  (Google auto-tagging typically writes `cpc` to utm_medium and the ad-group / ad ID to utm_content). Ad-group ID→name
  resolution already spans both UTM dimensions plus the ad-id→ad-group fold from the prior release.

## v3.236.0 — 2026-08-13 · `2e135c5` — Won-basis toggle: Weekly board done (rollout complete)
- The **Weekly Traffic Light** board now honours the Won-basis toggle — the last surface. In **Closed** mode, each
  week's Won / Won Value is bucketed by the deal's **won-date** (a deal created months earlier counts in the week it
  was banked), fetching ~180 extra days of opportunities to catch earlier-created wins; leads / booked / shown stay
  created-basis. A basis chip sits on the Won Value tile.
- With this, the **Won basis toggle covers every surface**: Users, Agency Overview, Caalano360 / Executive, and Weekly.
  Added `opportunity_won_at` (last status-change date) to the direct-API opportunity adapter to power the closed-basis
  weekly bucketing.

## v3.235.0 — 2026-08-13 · `702f1b9` — Google ad-group ID/ad-ID auto-resolve (Meta left as-is by name)
- **Google Ads:** the ad-group green Caalano360 columns now resolve the CRM's numeric UTM to the live ad-group name —
  robustly, whether the client's Google template put the **ad-group ID** or the **ad ID** in `utm_content`. Added a
  separate Windsor query mapping `ad_id → its ad group` (Google has no ad-level table — responsive search ads have no
  names — so an ad-ID UTM folds up to its ad group). The resolution is applied across both `utm_medium` and
  `utm_content`, so it works no matter which param the template uses.
- **Meta left exactly as it was** — Meta ad sets / creatives match by **name** (already working), so the earlier
  attempt to ID-resolve them was reverted. Nothing about Meta matching changed.

## v3.234.0 — 2026-08-13 · `436467e` — Ad/creative + ad-set ID resolution for the Meta Caalano360 columns
- Applied the ad-group/ad id↔name maps to the **Meta** view: **ad sets** now resolve `adset_id`→name (utm_medium) and
  **creatives/ads** resolve `ad_id`→name (utm_content), so the green Caalano360 outcome columns populate on those tables
  the same way campaigns already do. This is the "Ad/Creative" link (Google has no distinct ad-level table — responsive
  search ads have no real names — so Meta creatives are where ad-level outcomes live).

## v3.233.0 — 2026-08-13 · `ab1d330` — Caalano360 green columns extend to ad groups, keywords + a new Match-type table
- Following the campaign ID→name auto-resolve, the attribution feed now also returns **ad-group** (`ad_group_id` /
  `adset_id`) and **ad** (`ad_id`) id↔name maps from Windsor.
- **Ad groups (Google):** now resolve the CRM's ad-group ID to its name — across both `utm_medium` and `utm_content`,
  since which UTM param carries the ad-group ID varies by the client's Google template — so the green Caalano360 outcome
  columns populate correctly (previously they matched the wrong dimension).
- **Keywords:** the keyword table now has the **green Caalano360 outcome columns** (matched on `utm_term`, the keyword
  text).
- **New Match-type table** (Broad / Phrase / Exact) with green columns. Match type isn't stored in the CRM, so CRM
  outcomes are **rolled up from each keyword's outcomes via its match type** — no extra UTM needed.
- Suggestions for what else we can match next: **ad/creative level** (utm_content → `ad_id`, map already fetched),
  and Google **network** (Search / Display / YouTube), **device**, or **location** dimensions if you want green columns
  on those too.

## v3.232.0 — 2026-08-13 · `7f83a96` — Won-basis toggle now covers Overview + Caalano360/Executive
- The **Won basis** toggle (Closed vs Created) now also drives the **Agency Overview** (headline Revenue + leaderboard,
  via the ovrow feed) and the **Caalano360 / Executive** tab (revenue + ROAS in the health score), in addition to Users.
  The toggle appears in the header on both the Overview and the client workspace. Backend overlays use `wonInPeriod`'s
  per-channel closed figures; leads / funnel / appointments stay created-basis; defaults stay `created` server-side so
  nothing flips unless the UI opts in.
- Still to come: the **Weekly Traffic Light** board (needs a won-by-week, by-won-date engine) and basis chips on the
  Executive cards.

## v3.231.0 — 2026-08-13 · `05d000e` — Auto-resolve Google/Meta campaign IDs → names for Caalano360 attribution
- Google (and Meta) UTMs usually carry the numeric **campaign ID** (e.g. `utm_campaign=24053934849`), not the name —
  so CRM outcomes keyed by that ID never matched the ad tables (keyed by name) and the **Caalano360 outcome columns
  came up empty**. Now the attribution feed pulls Windsor's **`campaign_id ↔ campaign name`** pairing and hands the UI a
  `{id → name}` map, which auto-folds those IDs into the live campaign name. No manual linking, and it self-updates as
  campaigns change.
- Applied to the Meta and Google Caalano360 outcome columns, and to the attribution diagnostics (a resolved ID no longer
  shows as "unmatched"). The manual **UTM-aliases** editor still wins on conflict, as the override for genuinely orphaned
  UTMs (e.g. a deleted campaign whose ID still has historical leads).

## v3.230.0 — 2026-08-13 · `837aca3` — Google Ads: Landing Page Performance (above Keywords)
- The **Google Ads** view now pulls **Landing Page Performance** — a new section above Keywords showing which
  destination **pages** the budget drove traffic to, with cost, impressions, CTR, clicks, conversions and cost/conv
  (sortable, each page links out). Source: Google's expanded landing-page report via Windsor
  (`expanded_landing_page_view_expanded_final_url`), confirmed live.
- Pages are aggregated by **origin + path** (the query string — UTMs, gclid, ad_id — is stripped), so all keyword/UTM
  variants of the same page collapse into one real landing-page row instead of dozens of near-identical URLs. It's its
  own Windsor query, so a failure can't blank the campaigns/keywords tables; the section is account-wide.

## v3.229.0 — 2026-08-13 · `4a39582` — Won-basis toggle (live on Users) + Google conversion-actions overlap fix
- **Won basis toggle** — a global `Won basis: ⟨Closed | Created⟩` control now appears in the header on the client
  workspace (default **Closed**, persisted). Only Won / revenue / win-rate flip; leads, funnel and appointments stay
  created-basis. A **basis chip** on the Won card shows which is active.
- **Live on the Users tab now:** each rep's Won / revenue / win-rate switches between banked-in-period (Closed) and
  won-from-this-period's-leads (Created). Backend overlays for Caalano360 (blend), the CRM board and the agency
  Overview are staged behind the same `wonBasis` param; their frontends (Executive, Overview headline via the ovrow
  feed, Weekly) are the next surfaces to light up — nothing flips until each opts in, so no other number changes.
- **Fix: Google conversion-actions overlap.** Expanding *conversion actions* in a window/tile breakdown made the wide
  table bleed over the Key-events panel (grid children default to `min-width:auto`). Columns can now shrink and the
  drill table scrolls within its own box instead of overlapping.

## v3.228.0 — 2026-08-13 · `3b3eaa3` — Won-basis toggle: backend foundation (Closed-in vs Created-in period)
- Groundwork for the upcoming **Won basis** toggle (Closed-in-period vs Created-in-period). Adds a backend overlay
  (`applyClosedBasis`) that swaps a CRM board's Won / revenue / avg-won-value / close-rate to the **closed-in-period**
  figures (won by their won-date, from `wonInPeriod`) while leaving leads, the funnel and appointments on their
  created-in-period basis.
- **Inert until the UI opts in:** the backend default stays `created`, so nothing changes yet — a screen only flips when
  it passes `wonBasis=closed`. This lets the toggle roll out one revenue surface at a time (Caalano360, Users, Overview)
  without disturbing anything else. Next: the header toggle + basis chip and wiring those surfaces.

## v3.227.0 — 2026-08-13 · `c1a06a4` — Agency Overview CRM moves to the direct GoHighLevel API
- The agency **Overview** rollup now reads each client's won revenue + won count **straight from the GoHighLevel API**
  instead of Windsor's GoHighLevel feed — the last GHL-through-Windsor dependency on any client-facing view. Its numbers
  now reconcile with the CRM tab and Caalano360, and don't lag on newly-connected accounts.
- Done safely: the per-client CRM is fanned out with a small concurrency pool and a **hard 7-second budget** running in
  parallel with the Windsor ad calls, so it can't push the function past its ~10s limit. Any account that's slow (or
  whose marketplace app isn't installed) is simply skipped — the same graceful "best-effort" degradation the old Windsor
  call gave. Output shape is unchanged; Meta/Google spend + the zero-spend alerts still come from Windsor.
- With this, **every client-facing view now reads GoHighLevel data from the direct API.** The only GHL-on-Windsor left is
  a dormant fallback in the Trends tab (already direct-primary via `crmTrends` whenever a client's CRM is connected).

## v3.226.0 — 2026-08-13 · `6d6ae6b` — Auto-onboard: API-readiness check (flags sub-accounts missing the marketplace app)
- Auto-onboard now **tests whether each sub-account's API is actually reachable** before offering it. The direct API
  needs the GoHighLevel marketplace app installed on a sub-account (that's what lets us mint its location token), so a
  location can be listed but not yet pullable.
- Each location is labelled **✓ API ready** or **⚠ app not installed**; not-installed ones are shown, greyed and
  unticked, with a note to install the app (or enable “install on all sub-accounts” in your GHL app) and Refresh. Only
  API-ready locations can be created, so Auto-onboard never makes a client it can’t pull.

## v3.225.0 — 2026-08-13 · `c187e1a` — Auto-onboard: one-click link every Caalano Systems location to its Meta & Google accounts
- New **✨ Auto-onboard** button in Settings → Clients (Super-Admin). It scans every Caalano Systems (GoHighLevel) agency
  location that isn't linked to a client yet, and **fuzzy-matches each one to its Meta & Google ad accounts by name**
  (e.g. "Quad Care" GHL ↔ "Quad Care" Meta), showing a confidence badge.
- Review the suggested links (tweak the Meta/Google dropdowns, rename, untick any you don't want) and **create them all
  in one pass** — the closest thing to "install the app on a sub-account and it just connects" with the accounts we can
  already see. A location with no confident ad-account match is created CRM-only (link ads later).
- Matches use a name normaliser that strips punctuation and legal filler (Pty/Ltd/etc.) so slightly different names
  still pair up. Ad accounts only appear once Windsor has synced them, so add the account to your Business Manager +
  Windsor first if it's missing, then hit Refresh.

## v3.224.0 — 2026-08-13 · `bcde228` — CRM data moves to the direct GoHighLevel API (blend / Executive / Client Update / Weekly)
- The **Caalano360 blend**, **Executive** health score, **Client Update** and the **Weekly Traffic Light** board now
  read their CRM opportunities, pipelines and user names **straight from the GoHighLevel API** instead of Windsor's
  GoHighLevel feed. This means:
  - **No sync lag** — a just-linked client (e.g. Quad Care) shows correct CRM numbers immediately, rather than waiting
    for Windsor to backfill the account.
  - **Numbers reconcile** — the blend's leads / booked / won now match the CRM tab (both count "created in the window"
    in the client's timezone). Previously the blend used Windsor's broader "opportunity in period" basis, so the two
    could disagree for the same client and range.
- Implemented via direct-API shape adapters (`ghlOpportunityRows` / `ghlPipelineRows` / `ghlUserRows`) that return the
  exact row shape the builders already consumed, so the aggregation logic is unchanged.
- Meta / Google spend still comes from Windsor. The two **agency-wide** views (the Overview rollup and the Client
  Trends tab) stay on Windsor for now — the Trends tab already uses the direct API as its primary source when a client's
  CRM is connected, and the Overview rollup needs the daily-snapshot path to fan out across every account within the
  function time limit (planned next).
- Note: Caalano360 / Executive / Weekly figures may shift slightly with this change — that shift is them becoming
  consistent with the CRM tab.

## v3.223.0 — 2026-08-13 · `6acd4e8` — Key events: pipeline stages load for just-linked clients; Settings client editor opens on Summary
- **Pipeline stages now load straight from GoHighLevel** in the Key-events editor, instead of only from Windsor. Windsor
  only returns a client's pipelines once it has synced opportunity data for the account, so a **just-linked client**
  (e.g. Quad Care) showed *"No Caalano Systems pipeline stages found"* even though the CRM was connected and calendars
  loaded. The editor now falls back to the direct GHL pipeline list, so stages appear the moment the client is linked.
- The **client editor in Settings** now opens on the **Summary** tab (linked accounts, timezone, sales cycle) again,
  and Summary is the first tab.

## v3.222.0 — 2026-08-13 · `0166101` — Speed + reliability: server result cache, stale-on-error, failure log, Super-Admin Logs
- **Server-side result cache (10-min, stale-while-error).** Heavy client-scoped views (Users, CRM, Meta, Google,
  appointments, cohorts, forms, weekly, health…) now cache their assembled payload in Netlify Blobs. Repeat loads —
  tab switches, reopening a client, teammates — return in **<1s** instead of rebuilding from Windsor/GoHighLevel each
  time. Access control runs **before** the cache is read, so a hit never leaks across accounts. The **Refresh** button
  still forces a fully live rebuild.
- **Stale-on-error fallback.** If a rebuild fails (upstream timeout / 5xx), the last good payload is served (marked
  cached) instead of the *"Couldn't load…"* error — the #1 source of visible failures.
- **Reliability failure log.** Every failure and every slow build (>6s, near the 10s function limit) is recorded to a
  rolling per-day log, including browser-side failures beaconed from the app. This is what lets us find and fix the
  weak spots and safely make individual views live (no cache) later.
- **Settings → Logs (Super-Admin only).** New panel with two tabs: **Build versions** (the full changelog / version
  history) and **Failure logs** (the reliability log, with per-scope failure counts and slow-build detection).
- **Frontend resilience.** A shared fetch layer adds one silent retry on transient 502/timeout, friendlier error copy,
  and an in-memory cache so a revisited view paints instantly then revalidates (live on the Users view first).
- **Trimmed CRM over-fetch.** The Users view no longer pages 120 extra days of opportunities it immediately discards —
  fewer sequential CRM calls, faster loads, far fewer timeouts.

## v3.221.0 — 2026-08-13 · `ea40652` — Users: "All users" stacked funnel + rep-filter tabs in the deal drill
- The **Users** leaderboard now has a pinned **All users** summary row at the top. Expand it to see the whole-team
  funnel where **every stage bar is coloured per rep** (stacked segments) so you can see, at a glance, who holds
  leads at each stage. A colour legend maps each segment to a rep.
- Clicking a stage in the All-users open-pipeline panel opens the deal drill with **rep tabs across the top** — click
  a rep to filter the live deals to just theirs (with per-rep counts), or "All" to see everyone.
- Fixed the **horizontal scroller** in the open-deals drill modal: the modal is now full-width
  (`min(1080px, 96vw)`) so the fixed-layout deal table fits without a horizontal scrollbar.

## v3.220.0 — 2026-08-12 · `28789ed` — Meta conversions: allow multiple primary conversions (summed headline)
- You can now tick **multiple primary conversions** per account (checkboxes instead of a single radio). The
  headline result + cost-per on the Meta tab, Monthly Report and Daily Performance becomes the **sum** of
  every primary ticked — for accounts that optimise to / report on more than one event (e.g. Nexia).
- Legacy single-primary configs are read as a one-item list automatically; the result engine
  (resultCount / readField / rowResult) and the trends builder sum an array of primary fields.

## v3.219.1 — 2026-08-12 · `b4666d1` — Meta detect: don't CDN-cache the detect/probe responses (fresh on load)
- The Meta conversion auto-detect + probe responses are no longer cached for 10 min, so changes appear as
  soon as the tab loads instead of being masked by a stale response.

## v3.219.0 — 2026-08-12 · `c226650` — Meta detect: surface the detected optimisation custom conversion by name
- The detector now reads the custom conversion's **event name from the ad set's pixel rule** (e.g.
  `B_page_view`) and its numeric id, and **lists it in the picker even at 0 count** — a rarely-firing custom
  conversion is still the account's true optimised "Results" event and should be selectable. It's now the
  **auto-suggested primary**, using the confirmed-valid `conversions_offsite_conversion_custom_<id>` field.
- Set it Primary and it flows to the Meta tab / Monthly Report / Daily Performance, counting the moment it fires.

## v3.218.1 — 2026-08-12 · `98bab44` — Meta detect: report which result fields Windsor accepts (native `results` probe)
- The auto-detect now records per-field whether Windsor **accepts** a field (valid) vs **rejects** it, and
  surfaces the accepted list in the diagnostic — so we can tell whether Meta's native `results`/`cost_per_result`
  metrics are available on the account (the clean per-campaign Results answer) or it's a Windsor data gap.
- Widened the numeric custom-conversion-ID field variants tried.

## v3.218.0 — 2026-08-12 · `e697702` — Meta custom-conversion detect: probe by ID + native Results, plus diagnostics
- Auto-detect now probes custom conversions **one field at a time** (a single unknown field name no longer
  silently drops a whole batch), tries the custom-conversion's **numeric ID** from the ad set's promoted
  object, and tries Meta's native **`results`** field — the widest net for surfacing a non-standard
  optimised event (e.g. `B_Page_View`).
- Settings → Meta conversions gains a **“Not seeing your custom conversion?”** disclosure showing the
  detected goal, ad-set event names, custom-conversion IDs, the raw promoted object, and how many field
  names were tried — so a genuinely non-standard field id can be identified and hard-mapped.

## v3.217.1 — 2026-08-12 · `7b40628` — Google conversion actions: star the primary conversions
- The Google conversion-actions breakdown now marks each **primary** conversion with a **⭐** — the ones
  with a non-zero Conversions count that make up the Results number. Un-starred rows are secondary actions
  (counted only in “All conv.”).

## v3.217.0 — 2026-08-12 · `a0300d6` — Window popup: Google conversion-actions drill + Meta-detect diagnostics
- The window breakdown popup's **Google** row (Ad spend → results) is now clickable and expands the Google
  **conversion actions** for that exact window (3/7/14/21/28 days), same as the 28-day source table.
- Settings → Meta conversions now shows **auto-detect diagnostics** when nothing is found: the detected
  optimisation goal, any event names read off the ad sets, and the Windsor field names tried — so a custom
  conversion whose field name differs can be identified and mapped without hitting a URL.

## v3.216.0 — 2026-08-12 · `05d0129` — Meta conversions: auto-detect the optimisation event (no typing)
- The Meta conversions tab now **auto-detects** the client's optimisation event: it reads the ad sets'
  optimisation goal + promoted object to learn which conversion the account optimises to (matching Ads
  Manager's Results column), probes every firing conversion, and surfaces a **“🎯 Auto-detected … · Use as
  primary”** banner. One click sets it.
- Probing is now **batched over a 30-day window with per-batch error isolation**, so a large account or an
  unknown field name can't time out the picker (fixes the “operation was aborted”).
- Widened the custom-conversion field-name variants tried, and the manual “add by name” remains as a fallback.

## v3.215.0 — 2026-08-12 · `621a256` — Custom Meta conversions: add-by-name + flow through results everywhere
- **Any custom Meta conversion can now be a client's result.** In Settings → Meta conversions, type a custom
  conversion by its Ads-Manager name (e.g. `B_Page_View`) and click **Find + add** — it probes the account,
  confirms it's firing (90-day count), and adds it to the picker so you can set it Primary. Works for any
  business's own custom pixel event, no code change per client.
- **The configured conversion now drives Results everywhere**: the Meta tab, Monthly Report, and — new —
  the **Daily Performance** results/cost-per-result and stacked bar. Previously Daily Performance only
  counted standard leads, so custom-conversion clients read wrong there.
- Backend: `buildMeta` pulls + counts the client's configured custom fields alongside the standard result
  set; `buildTrends` counts each client's configured primary conversion for its daily Meta results (with a
  safe fallback so a bad field can't blank everyone out); new `metaprobe` scope powers add-by-name.

## v3.214.0 — 2026-08-12 · `735d0a2` — Window breakdown: drill each key event to the exact people
- In the window breakdown popup, every key event in the **Key events by source** table is now clickable
  and opens the full people list behind it — the exact opportunities that reached that event in that window,
  scoped to the selected source (All / Paid / Non-paid / Meta / Google, via UTM attribution). Reuses the
  same people modal (status filter, per-contact notes) as the Caalano360 funnel.

## v3.213.1 — 2026-08-12 · `d8fa3e3` — Daily graph: make the Google stacked bar a distinct light blue
- Changed the Google segment of the stacked results bar (and its tooltip dot) from violet to a light sky
  blue so it's clearly distinguishable from Meta's indigo.

## v3.213.0 — 2026-08-12 · `e0ccaeb` — Daily graph: stacked Meta/Google bars + Google conversion-action drill
- **The 28-day daily graph now stacks Meta vs Google results** (two colours) in the Blended view for
  two-channel clients, so you can see at a glance which channel is driving the conversions. The hover card
  shows the Meta / Google split for each day. Single-channel and Meta/Google-only views keep the single bar.
- **Google conversion-action drill**: on a client tile, the “Google Ads” row in the *Source · last 28 days*
  table is now clickable — it expands to show every Google **conversion action** behind the Results number
  (primary conversions, all-conversions, and % of total), so you can see exactly what’s being counted.

## v3.212.1 — 2026-08-12 · `206d165` — Remove “Explain with AI” from Daily Performance movers
- Removed the “🤖 Explain with AI” button (and its output box) from the Biggest movers panel on the Daily
  Performance tab. The rules-based “what moved” reasons and per-mover creative breakdown remain.

## v3.212.0 — 2026-08-12 · `50ab99e` — Key-events source split now uses UTM attribution (not lead-source)
- The Key events by source breakdown now classifies each key event by the opportunity's **first-touch UTM
  attribution** (the same Meta / Google / non-paid model the rest of Caalano360 uses), pulled from the GHL
  direct API — so "Paid" key events genuinely match ad-attributed opportunities, giving true visibility on
  overall business vs paid key-event performance. The Windsor lead-source classification remains only as a
  fallback when the app isn't connected (the popup footnote says which is in use).
- No extra API calls — the direct-API opportunities already fetched for booked-call splits are reused.

## v3.211.0 — 2026-08-12 · `77f5eff` — Daily Performance: key-events breakdown split by lead source
- The window breakdown popup's **Key events** section now has an **All CRM / Paid / Non-paid / Meta / Google**
  toggle, so you can see which key events were attributed to each channel (Paid = Meta + Google, Non-paid =
  organic / referral / direct). Counts, % of leads and cost per event all re-scope to the chosen source
  (Non-paid shows no cost, since those leads carry no ad spend).
- The scorecards, graph and ad-source table are unchanged — the split is purely for the key-events view.
- Backend: `buildTrends` now classifies each CRM opportunity by its Caalano Systems lead source and tracks
  per-window stage reach + leads/won per channel.

## v3.210.0 — 2026-08-12 · `0bbe12e` — Settings: new “Daily performance” tab (per-client + per-pipeline visibility)
- **New Settings → Daily performance tab.** Toggle, per client, whether it appears on the Daily
  Performance tab — and, for clients running more than one pipeline, which pipeline tiles show. Everything
  is on by default; “Show all / Hide all” bulk buttons included. Saved to the server & shared across the team.
- The Daily Performance tab (and its Biggest-movers panel) now respect these toggles: hidden clients drop
  out entirely, hidden pipelines drop their tile.

## v3.209.0 — 2026-08-12 · `1e704c2` — Daily Performance: click a window tile for a full breakdown
- **Each window scorecard (Last 3 / 7 / 14 / 21 / 28 days) is now clickable** and opens a breakdown for
  that period:
  - **Ad spend → results split by Meta and Google**, with cost per result per channel + a total row.
  - **Every configured key event in that window** (Booked, Qualified, Won, …, resolved with the same
    engine as the Caalano360 funnel), each with its count, % of leads, and **cost per event** (total ad
    spend ÷ people who reached it).
- Scoped correctly per tile — a pipeline tile's breakdown shows that pipeline's key events; the account
  tile shows the whole client. Backend now sends per-window per-stage reach + CRM leads/won so the
  breakdown reuses the shared key-event resolver.

## v3.208.0 — 2026-08-12 · `2d082de` — Daily Performance: alphabetical tiles, per-pipeline movers, scroll-to-tile
- **Client tiles are now in alphabetical order** (multi-pipeline tiles group under their client, pipelines
  alphabetical with "Unlinked campaigns" last).
- **Biggest-movers insights are now per pipeline** for multi-pipeline clients — each mover names the exact
  pipeline it's about (e.g. "Nexia Health Care · ADHD - Leads & Sales Pipeline"), and the AI explanation
  is fed the pipeline-level labels too.
- **The mover jump button (↓) now scrolls straight to that client's tile** on the page (with a brief
  highlight) instead of opening the full client workspace — the tile's name still opens the workspace.

## v3.207.1 — 2026-08-12 · `be29aa9` — Fix: single-pipeline clients no longer split; campaign links now read correctly
- **Single-pipeline clients (e.g. Pool Haus) are no longer split** into a pipeline tile + a stray "Unlinked
  campaigns" tile — the per-pipeline layout now only applies when a client genuinely runs 2+ pipelines
  with activity.
- **Fixed campaign→pipeline resolution**: the saved campaign map is stored per client
  (`campmap[clientId][campaign]`), but the trends backend was reading it as a flat map, so every explicit
  link was missed and spend fell through to "Unlinked". It now reads the client-scoped map, so linked
  campaigns attribute to their pipeline as set in Settings → Campaign links.
- The "Unlinked campaigns" tile now only appears when unattributed spend is a **material slice (>5%)** of
  the client's 28-day spend, so a stray dollar doesn't spawn a whole tile.

## v3.207.0 — 2026-08-12 · `efc1631` — Daily Performance: multi-pipeline clients render as separate tiles
- **Multi-pipeline clients now show one full tile per pipeline** instead of a combined card with sub-tables
  at the bottom. e.g. Nexia becomes **“Nexia Health Care · ADHD - Leads & Sales Pipeline”** and
  **“Nexia Health Care · Allied Health - Lead & Sales Pipeline”**, each a complete card: CPL window
  scorecards, "what moved", the 28-day Spend/Results/Cost-per-Result graph (with the 🟠 key-events overlay),
  and its own Source · last 28 days grand total.
- Spend + ad-reported results in each tile are **split by the saved campaign→pipeline links** (auto-matched
  where unlinked); booked / won come from that pipeline's CRM. Any spend that can't be attributed to a
  pipeline appears as its own **“Unlinked campaigns”** tile so every dollar still reconciles.
- Removed the per-pipeline sub-tables added in v3.206 in favour of this cleaner, fully-visual layout.

## v3.206.0 — 2026-08-12 · `531da1a` — Monthly Report per-pipeline split + Daily Performance Phase 2 & 3
- **Monthly Report — key-event consolidation fixed.** Calendar-linked key events now merge cleanly with
  their pipeline stage even when the calendar carries a `[PIPE]` tag, so the "leads → key events" funnel
  no longer shows the same step twice (once as 📅 calendar, once as the plain stage). Hardened the shared
  `mergeCalKeyEvents` normaliser (tag-stripped matching) so every view benefits.
- **Monthly Report — two-pipeline clients now split by pipeline.** For clients running two pipelines
  (FINR = BA + Finance, Nexia = ADHD + Allied Health):
  - the **key-events funnel renders once per pipeline** (each scoped so its calendars merge correctly),
  - **User performance** is shown as a separate table per pipeline (leads, key-event reach, cohort win %,
    closed & revenue scoped to that pipeline),
  - **Lost reasons** are broken out per pipeline (each with its own reason table + deal drill-down).
- **Daily Performance — Phase 2: per-pipeline sub-tables.** Multi-pipeline clients now show a performance
  table per pipeline under the graph — spend **split by the saved campaign→pipeline links** (auto-matched
  where unlinked; anything unattributable is flagged as "Unassigned spend"), with CRM leads / booked / won
  by the pipeline each opp sits in, across the 3/7/14/21/28-day windows.
- **Daily Performance — Phase 3: key-events overlay on the 28-day graph.** Booked calls (and deals won)
  are now plotted by their fired date as markers on the daily graph, and the hover card shows that day's
  booked + won alongside spend / results / cost-per-result.

## v3.205.0 — 2026-08-11 · `87538b7` — Daily Performance: 28-day daily graph per client (Looker-style)
- **Each client now shows a 28-day daily graph** of ad Spend (line), Results (bars) and Cost per Result
  (line), plus a **Source table** (Google / Facebook cost, results, cost-per-result over 28 days) — a
  native version of the Looker daily view. Results are ad-reported (the campaign's optimisation event:
  Meta leads / Google conversions), matching Ads Manager.
- Respects the existing **Blended / Meta / Google** toggle, and sits below the CPL window scorecards.
- (Next: per-pipeline sub-tables for multi-pipeline clients, and a CRM key-events overlay on the graph.)

## v3.204.0 — 2026-08-11 · `d5f0024` — Movers: creative breakdown + Client Update loads faster
- **Biggest movers now drill to the creative/campaign level.** Click any mover to expand a live
  breakdown for that client + channel + window: which creatives are **fatiguing** (cost rising),
  **scaling / new**, **pulled back**, and the **best right now** — so you can see what actually drove
  the cost move, not just the channel-level number.
- **Client Update generates off the core client-view numbers by default.** It no longer waits on all
  nine supporting data pulls: the update is ready as soon as the consolidated figures (the same the
  client view uses) load, and the extra detail (creatives, forms, speed to lead, cohorts, etc.) merges
  in as it arrives instead of blocking. A slow or timing-out extra can't hold up the update.

## v3.203.0 — 2026-08-11 · `99c03d8` — Daily Performance biggest movers + exact per-channel CPL in updates
- **Daily Performance now surfaces the biggest movers.** A "Biggest movers" panel at the top ranks the
  largest cost-per-result changes across all clients for a chosen window (3/7/14/21/28 days), each with
  a rules-based reason decomposed from the spend vs results move (for example "spend rose 22% but leads
  only +6%"). An **"Explain with AI"** button adds a plausible per-mover hypothesis. Each client card
  also shows its own **"What moved · 7d"** callouts per channel.
- **Client Update now quotes the exact CPL per channel** (Meta CPL and Google cost per conversion),
  never a single merged figure, and the word "blended" is banned from client-facing copy.

## v3.202.0 — 2026-08-11 · `ef7da0d` — Organic Social: daily snapshots so data never disappears
- **New daily social snapshot** (`social-snapshot`, scheduled @daily; `social-snapshot-now` to run/seed
  on demand) captures each connected client's Instagram + Facebook-organic **daily metrics, follower
  count and audience demographics** into a `caalano-social` blob store. The first run per client
  backfills ~90 days of whatever the API still returns; later runs roll a 35-day window and upsert.
- **The Organic Social dashboard now auto-fills gaps from the store** — beyond the Meta/IG API's ~90-day
  insights window (where daily series, followers and demographics normally blank out), the saved history
  is merged into the live view and folded into the period totals, so long ranges keep working.

## v3.201.0 — 2026-08-11 · `73816dd` — Client Update matches the fortnightly house style
- **The Client Update email now follows Caalano's real fortnightly template:** warm one-line opener →
  overall spend/leads → Meta & Google breakdown → bookings / won / pipeline value → **Key insights**
  (naming creatives with a plain-English description inferred from the ad name) → **Actions** (with a
  realistic timeframe where relevant) → **Questions** → signed sign-off. Two real team emails are
  included in the prompt as voice/format anchors.
- **Emails now sign off with the logged-in user's name** (falls back to the Caalano Digital team).
- **The Client Update AI now also reads the client's brand profile** (Settings → Overview), alongside
  the free-text context, so the tone and framing fit the brand.

## v3.200.0 — 2026-08-11 · `fc30c64` — Creative Cockpit → two sub-tabs (Breakdown + Curator)
- **Creative Cockpit is now a two-tab page:** **Creative Breakdown** (the existing per-client creative
  performance + categorisation + AI strategy, renamed) and **Creative Curator** (the idea studio).
  The Curator moved in here from its own top-level menu item, so all creative work lives in one place.

## v3.199.0 — 2026-08-11 · `b7255ed` — Overview tab first + seeded starter brand profiles
- **Overview is now the first tab** in each client's Settings (and opens by default).
- **Starter brand profiles seeded for every client** from what we know: Pool Haus, Nexia Health,
  Finr Advisory, Psychology Hub, Book a Midwife and others get inferred industry, ICP, brand voice,
  angle and keyword themes pre-filled. Anything that must be a real claim (pricing, proof stats,
  guarantees, competitors, website) is left blank or marked `[confirm]` so nothing fabricated can end
  up in an ad. Editing a field overrides the seed and saves as normal.

## v3.198.0 — 2026-08-11 · `49b4c7c` — Client Brand Profile (Settings → Overview) feeding the Curator
- **New "Overview" tab on each client in Settings** — a structured **Client Brand Profile**: website,
  one-liner, industry, brand voice, ICP, offer & pricing, differentiators, objections, proof points,
  competitors, on-brand keywords, words to avoid, winning ad-copy angles, and free notes. Auto-saves,
  server-synced and shared with the team, with a completeness meter.
- **The Creative Curator's Client deep-dive now reads this profile** (plus the existing free-text
  context), so AI concepts are grounded in the brand's real voice, offer and customers. The Curator
  shows how much of the profile is filled and nudges you to complete it.

## v3.197.0 — 2026-08-11 · `10085e1` — New module: Creative Curator (v1)
- **New "Creative Curator" menu item** (under Creative Cockpit) to strategise new creatives. Pick any
  mix of **Format × Style × CTA × Audience × Angle** and generate ready-to-brief concepts:
  - **Instant** concepts from a researched library of **20 paid-social creative styles** (Before &
    After, Face-to-camera/UGC, Podcast clip, Testimonial, PAS, How-to, Listicle, Myth-bust, Founder
    story, Demo, Comparison, Proof montage, Objection handling, FAQ, Green-screen, Text hook, POV,
    Checklist, Offer, Stat) — each with a hook, a beat-by-beat structure and why it works.
  - **AI concepts** via a new `creative-curator` mode — bespoke ideas, in general **Research** mode or
    a **Client deep-dive** that uses the client's saved context.
  - **Save-to-board:** star concepts to a per-client (or Research) board, synced to the server like
    every other setting. A browsable style-library reference is built in.

## v3.196.0 — 2026-08-11 · `556ea2f` — Speed to Lead measured within business hours by default
- **Every client now measures Speed to Lead within business hours by default** (Mon–Fri 9am–5pm), so a
  lead that arrives at 11pm and gets a reply at 9am counts as a fast morning response, not a 10-hour
  one. The Settings → Working hours toggle is ticked by default; a client can still change the hours or
  switch it off (that choice is remembered). The Caalano360 speed summary now honours the same hours as
  the Timing tab.

## v3.195.0 — 2026-08-11 · `77adf90` — Self-healing data loads on date-range changes
- **The Meta / Google deep views now retry automatically** when a pull times out. The single-call
  path had no retry, so a transient timeout right after a date-range change showed the "couldn't load"
  card immediately — and the fix was to refresh again by hand. It now retries up to 3× with backoff
  (and aborts a hung request via a client-side timeout) before surfacing the error, showing
  "Taking longer than usual — retrying…" while it does. The Executive (health) view got the same
  treatment; the attribution/Caalano360 feed already retried.

## v3.194.0 — 2026-08-11 · `4b17513` — UTM aliases: hide anything that matches a live entity (names + IDs)
- **The unmatched list now hides any UTM that matches a live Meta or Google entity by name _or_ by ID.**
  A UTM that carries a raw campaign/ad-set/ad **ID** (e.g. `120242333973070146`) instead of the name is
  now recognised as a live campaign and dropped from the list — only genuinely orphaned UTMs remain.
- **More robust Meta name loading:** the Meta pull is split so campaign + ad-set names load on a light
  query even if the heavier ad-level pull is slow, so live Meta campaigns/ad sets reliably match and
  disappear from the list.

## v3.193.0 — 2026-08-11 · `a18132e` — UTM aliases: load Meta names + link by channel
- **Fixed: the UTM-alias linker now loads Meta campaign / ad-set / creative names**, not just Google.
  The "current names" pull was fetching Meta ad-level data over 90 days, which often timed out and was
  silently dropped — leaving only Google in the dropdown and, worse, making live **Meta** campaigns
  wrongly appear in the "unmatched" list. It now uses a lighter ~35-day "live" window (with a retry),
  so Meta loads reliably.
- **The link dropdown is now grouped by channel** (Meta / Google), so you can link a renamed Meta
  campaign to the right live Meta campaign instead of only seeing Google options.
- Net effect: only genuinely unmatched UTMs (that match no live Meta *or* Google entity) remain in the
  list, and each can be linked to the correct channel's current name.

## v3.192.0 — 2026-08-11 · `2908fc1` — Creative sort: dropdown + asc/desc toggle
- Replaced the long row of Creative-performance sort chips with a compact **dropdown** (grouped:
  Performance · Key event volume · Cheapest cost per event) plus an **↑/↓ direction toggle**. Picking
  a metric defaults to its natural direction (cost metrics low→high, everything else high→low); the
  arrow flips it either way.

## v3.191.0 — 2026-08-11 · `182bcec` — Click a creative's key events to see the people (+ appointment detail)
- **Every key-event row on a creative card is now clickable** — Leads, each stage, each booked
  calendar and Won open the list of the actual people behind that number, **scoped to that creative**
  (matched on the lead's utm_content). Same drill-down as the scorecards at the top: name, status
  (with lost reason), current stage, source, value, age, and click a person for their Caalano Systems
  notes. Includes the Open/Won/Lost/Abandoned/All status filter.
- **Calendar key events now show appointment detail in the pop-up** — a new "Appointment" column lists
  **which calendar** each person booked and whether the meeting **✅ Showed / ❌ No-show / ⏳ Upcoming /
  🚫 Cancelled**. This appears on any calendar-event drill (creative cards and the scorecards).
- **Column order tidied** on the creative key-events table: Key event · Count · Cost per · % leads ·
  Next · Show %.

## v3.190.0 — 2026-08-11 · `3fbe0e9` — Frozen key-event name column + "cheapest cost per event" sort
- **The Key Event name column now stays frozen** while the metric columns (Count → % leads → Next →
  Show % → Cost per) scroll sideways on the creative cards — so you always know which row you're
  reading.
- **New "Cheapest cost /" sort group** in Creative performance. Alongside the existing volume sorts,
  there's now a chip per key event that ranks creatives by the **cheapest cost per that event**
  (spend ÷ people who reached it, low→high) — e.g. cheapest cost per Quote, per Booked Discovery
  Call, per Site Visit. Creatives that never reached the event sort to the bottom.

## v3.189.0 — 2026-08-11 · `a19b04a` — Creative key-events header cue for the Cost-per column
- Added a small header cue on each creative card's key-events table — **"Cost per" = spend ÷ reached** —
  so the (already-present) Show % and Cost per columns are obviously there. Doubles as a fresh-bundle
  "tell": if you can see this cue, you're on the current deploy and the Cost-per column is rendering.

## v3.188.0 — 2026-08-11 · `d714df3` — Wider popups, no sideways scroll
- **All modal windows are now wider** (up to 1040px, 96vw) and no longer scroll horizontally as a
  whole — the window grows to fit instead.
- **The Settings modal is wider still** (up to 1240px) so its full tab strip (Versions → Campaign
  links → UTM aliases → KPI targets → Forms → Qualified lead → Optimisation Log → Diagnostics) and
  every tab's content fit without the sideways scroll that was clipping the first tabs.
- Genuinely wide data tables inside a popup still get their own contained scrollbar, so nothing is
  ever lost — only the whole-window horizontal scroll is gone.
- **Creative cards: the key-events table can no longer clip its right-hand columns.** The "Show %"
  and "Cost per" columns were being hidden by an `overflow: hidden` wrapper on narrower cards; the
  wrapper now lets them scroll into view instead, so the Cost-per-stage figure is always reachable.

## v3.187.0 — 2026-08-11 · `8bff795` — Creative cards: clearer "Cost per" stage column
- **The Caalano360 key-events table on each creative card now has a clearly-labelled "Cost per"
  column** — the creative's total ad spend ÷ the number of people who reached that stage (e.g.
  $2,652 ÷ 6 Site Visits Booked = $442 per site visit). This is the cost-efficiency read per key
  event, right beside the count and % of leads. (The figure was already computed under the old
  "Cost / stage" heading; this makes it explicit and matches the funnel language.)

## v3.186.0 — 2026-08-11 · `15883dd` — Status filter in the people drill + longer date-range presets
- **The people drill now has a status filter** (Open / Won / Lost / Abandoned / All) at the top of the
  modal. It **defaults to Open** so you land on the deals still in play; each chip shows its count and
  disables when empty. Opening a Won-only tile (or any group with no open deals) auto-selects All so the
  list is never blank. Abandoned is now distinguished from Lost.
- **New date-range presets:** Last 60 days, Last 90 days, Last 6 months, Last 12 months and Maximum
  (last 2 years) join the existing options in the period picker. The preset list scrolls if it runs long.
- **The per-pipeline scorecard tiles are now clickable too** (Meta & Google) — Leads, each key event,
  Won and Revenue open the same people list as the funnel steps.
- **The Leads row/tile is now clickable** — it opens the full lead cohort (channel-scoped), which
  wasn't drillable before.
- **Lost opportunities now show their lost reason** in the drill (under the red "Lost" chip).
- **The drill modal is wider (94vw, up to 1120px) and no longer scrolls sideways** — the current-stage
  column wraps instead, so every column (name, status, stage, source, value, age) is visible at once.

## v3.184.0 — 2026-08-10 · `8c4c1a8` — Click any key event to see the people behind it
- **Every step in the Key Events funnel (Meta & Google) is now clickable** and opens the list of the
  actual people that make up that number — channel-scoped, so a Meta key event shows only the
  Meta-attributed people. Each row shows the person's **name, status (won / open / lost), current
  pipeline stage, source + how they qualified for this event (booked / reached stage / won), deal
  value, and age**; click a row to expand their **Caalano Systems notes** (and contact email / phone).
- New backend `scope=keypeople` builder resolves the people for a pipeline-stage event, a won event, or
  a set of booked calendars linked to a stage — from a single on-demand opportunity pull (only fires
  when you click, so it adds no load to the main view). Viewer-safe.
- This is the fastest way to sanity-check a number (e.g. "why does the CRM show more Meta leads than
  Meta's pixel?") — you can now read the exact opportunities behind each step.

## v3.183.0 — 2026-08-10 · `6eead21` — Meta Ads Caalano360 metrics are Meta-attributed only (not blended)
- **Fixed: the Caalano360 metrics on the Meta Ads view were blending in other channels.** The aggregate
  Won / Revenue / Booked / Shown summed **every** utm_campaign's CRM outcomes — including Google and
  other-channel deals — so a client running both Meta and Google saw inflated Won / Revenue / ROAS on
  the Meta tab (e.g. "19 won / $1.55M" when only the Meta-attributed slice was much smaller). It now
  uses the **Meta channel totals** (`channels.meta`), the same source the Key Events funnel and the
  per-event tiles already use — so the whole Meta tab reconciles.
- This is also the true cause of the earlier "scorecard says 19 won, funnel says 4" mismatch: the
  scorecard was all-channels-blended (19) and the funnel was Meta-only (4). They now agree.
- Relabelled both headers from "blended CRM outcomes" to **"Meta-attributed / Google-attributed CRM
  outcomes"** (Google's aggregate was already channel-scoped correctly — only its label was wrong).

## v3.182.0 — 2026-08-10 · `a8cb16d` — Key Events funnel is mobile-friendly
- **The Key Events funnel no longer spills off the right edge on phones.** The 6-column table (Step /
  Reached / % leads / Next step / Show % / Cost per event) couldn't fit a phone width, so the Cost per
  event column was cut off. On screens ≤600px each step now reflows into a **self-labelled card**: the
  step name and the reached bar on top, then the metrics as chips (`% leads: 43%`, `Next step: 43%`,
  `Show %: 54%`, `Cost / event: $149.96`) that wrap — everything visible, nothing clipped. Tablet and
  desktop keep the table layout.

## v3.181.0 — 2026-08-10 · `070d447` — Large Meta windows (YTD) now load by chunking into months
- **Year-to-date and other large Meta windows now actually load.** A full year of campaign / ad-set /
  creative data can't finish inside the serverless time limit in one call, so the Meta Ads view now
  **splits a window over ~3 months into monthly pulls, fetches them 4 at a time (with one retry each),
  and merges the result** client-side. Each month loads well inside the budget, so the whole year
  assembles reliably instead of timing out. A progress line shows *"Loading This year Meta data…
  6/12 months"* while it runs.
- **Bonus: richer data on long ranges.** Because each chunk is a normal ≤1-month pull, the per-ad-per-day
  breakdown stays at **ad level** across the whole year (the old single big pull had to drop to
  campaign level), so the day-drill keeps its creative detail even for YTD.
- If a month or two still times out, the view loads the rest and shows a clear *"loaded N of M months —
  totals are undercounted, hit Refresh to retry"* note rather than failing outright. Period-over-period
  deltas are omitted on these long chunked windows (noted under the header).
- Google Ads keeps the single-call path for now — same chunking for Google is the next step.

## v3.180.0 — 2026-08-10 · `3c5cec2` — Account discovery shows connector status + errors
- **The Add-client "Refresh accounts" flow now shows whether Windsor is actually live.** The discover
  endpoint was already fully uncached (`no-store`) — every refresh re-queries Windsor directly — but a
  failing Windsor connector (e.g. expired auth) was silently swallowed and shown as "No accounts found".
  Now a connector error is surfaced: the Meta / Google column says *"⚠ Windsor connector error — may
  need re-authorising in Windsor"* with the reason, and a status line under the columns shows *● Live
  from Windsor · refreshed HH:MM · N Meta · N Google · N CRM accounts visible* (or flags the erroring
  connector). This makes it clear whether a missing account is a Windsor auth problem vs. still syncing.
- Reminder (unchanged): a just-connected account only appears once Windsor has ingested some data for
  it; until then, paste its account ID into the box under the column to link it immediately.

## v3.179.0 — 2026-08-10 · `c801996` — Hide stale / renamed key events everywhere
- **Configured key events that no longer match a current pipeline stage are now hidden** across every
  view — the creative key-event funnels, the green Caalano360 column groups (campaigns / ad sets /
  formats / creatives), and the per-pipeline scorecards. Previously a renamed or removed stage stayed
  in a client's key-event config and showed up as an empty **0 / 0.0%** row or column group at the end
  of the funnel (e.g. a duplicate "Booked Discovery Call" alongside its calendar, or an old
  "Disc. Call - Qualified" / "Arrived / Converted" stage).
- The fix lives in `resolveKeyEvents`, so it applies uniformly. Won events (they count on deal status,
  not a stage) and calendar events (their own booking data) are always kept; only pipeline-stage
  entries that don't resolve to a real, current stage are dropped, and only once the pipeline registry
  has loaded (nothing is hidden while data is still loading). Clean up the entries permanently any time
  in Settings → Key events; until then they just won't clutter the reports.

## v3.178.0 — 2026-08-10 · `6b46d73` — Bigger multi-line key-event scorecards on Meta & Google too
- The Meta and Google per-pipeline Caalano360 tiles now use the same **bigger multi-line scorecard** as
  the Caalano360 tab: the count (large, +vs-prev arrow) with **% of leads**, **cost per event**, and
  (calendar events) **show rate with shown / occurred** each on their own line with a vs-prev arrow —
  instead of the single cramped stat line. The per-calendar hover breakdown and ROAS (on Revenue) are
  preserved. Cost per event here still uses the real per-pipeline Meta / Google spend (not blended).
- The Meta / Google platform-metric tiles (Cost, Impressions, CPM, …) stay as the compact cards.

## v3.177.0 — 2026-08-10 · `c72fb48` — Caalano360: Meta-style key-event scorecards (all channels)
- **The Pipeline performance card now uses the Meta view's per-pipeline scorecard layout, but counting
  ALL channels** (not just Meta-attributed). Each pipeline shows a Meta/Google/Other contribution bar
  plus a row of key-event scorecards: Leads → each configured key event → Won → Revenue.
- **Bigger, multi-line scorecards** as requested — each tile stacks the detail on its own line:
  - the **count**, large, with a vs-previous-period arrow;
  - **% of leads** (with vs-prev arrow);
  - **blended cost per event** (with vs-prev arrow, cheaper = green);
  - for calendar events, **show rate** with *shown / occurred* (with vs-prev arrow).
- Comparisons come from a new **previous-period CRM pull**, so every line has an up/down vs the prior
  period. Cost per event is the active channel's ad spend **allocated across pipelines by lead share**
  (a blended CAC, since CRM outcomes aren't tied to one channel's spend) — noted under the card.
- The section follows the command-centre channel toggle, so All / Paid / Meta / Google re-scope every
  scorecard.

## v3.176.0 — 2026-08-10 · `e749003` — Fix "linked but empty" Meta accounts + styled key-event hover
- **Root-cause fix for a Meta account that's linked but shows no data.** The account-id match was
  exact-after-normalising, so a stored id like `1234` never matched Windsor's `act_1234` (or vice
  versa) — every row got filtered out and the Meta deep pull, agency spend rollups and weekly board
  all came back empty even though the account was correctly connected. Matching is now tolerant of
  Meta's `act_` prefix everywhere an ad account is filtered or rolled up. (This is almost certainly
  why IDO IDO's Meta tab was empty across every date range.)
- **The per-calendar key-event breakdown is now a styled hover card**, matching the rest of the app
  (header + per-row list) instead of a plain browser tooltip — on both the Meta/Google Caalano360
  tiles and the Key Events funnel. It lists each calendar's bookings (with shown/occurred) and any
  reached-the-stage count with no calendar booking.

## v3.175.0 — 2026-08-10 · `2d46d33` — Meta/Google tab only shows when connected + honest empty states
- **The Meta Ads tab now only appears when the client actually has a Meta account connected** (same as
  Google always has). Previously it was added for *every* client, so a CRM-only or Google-only client
  (e.g. IDO IDO) showed an empty Meta tab — which is where the confusing placeholder came from.
- **Removed the stale placeholder copy.** The old "not pulled yet — Nexia Health Care is built out as
  the first example, pulls via Reporting Ninja, ask me to build this client next" text (leftover from
  the very first build, and it named an unrelated client) is gone. The empty state now reads honestly:
  *"No Meta activity in this period — the account is connected but returned no campaigns or spend for
  this range; widen the range or check the account is still spending."*
- **A genuinely unlinked account** (backend returns "no Meta account") now shows a clear *"No Meta
  account connected for this client"* message with connect guidance, not a timeout-style error.

## v3.174.0 — 2026-08-10 · `fa4ed9c` — Caalano360: team performance, locations & timing summary
- **Team performance** card: per-rep leaderboard (leads → booked → won → win % → revenue → open value
  → avg close). Click a rep to expand their open deals and see where each one is held up — every deal
  drills into that contact's Caalano Systems **notes** ("why is this stuck?").
- **Lead locations** card: a map preview + top places, drawn from the leads' postcode / suburb answers.
  Only appears when leads actually carried a location; links out to the full Location tab.
- **Speed to lead** card: median + average human response time, % contacted under 5 minutes, and how
  many leads had no outreach — the headline timing signals, with a link to the full Timing tab.
- Together with the existing command centre, Pipeline performance, bottleneck funnel, lost reasons and
  revenue-at-risk, the Caalano360 tab now reads as a top-line summary of every client tab. (Team,
  locations and timing reuse the existing per-tab feeds — no new backend.)

## v3.173.0 — 2026-08-10 · `3d8582e` — Caalano360: Pipeline performance + channel contribution
- **New "Pipeline performance" card on the Caalano360 tab.** For each pipeline it shows the top-line
  outcomes (leads, won, revenue, open + open value, lost) and a **Meta vs Google vs Other** contribution
  bar for both leads and won — so you can see at a glance how much each channel drives each pipeline.
- **Key events per pipeline, split by channel.** Expand a pipeline to see each configured key event's
  reach with a Meta / Google / Other breakdown (first-touch attribution of the opportunities that
  reached that stage; won splits by the deal's own channel). Calendar-linked events read against their
  linked stage.
- Backend: `buildCcDrill` now computes a per-pipeline × per-channel breakdown (`pipeContribution`) and
  per-channel stage counts in the **same** single opportunity pass — no extra fetches, so it stays
  inside the function time budget. (This is the first slice of the broader Caalano360 "summary of every
  tab" — user performance, held-up deals, locations and a timing summary follow.)

## v3.172.0 — 2026-08-10 · `043a516` — Large-window Meta/Google pulls no longer hard-fail
- **Root cause fixed:** the Windsor fetch timeouts (22s / 16s for big windows) were set for a
  26s function budget that was never granted — the functions actually hard-stop at ~10s, so a
  large window (e.g. *This year*) was killed mid-pull and the browser got a raw 502. The Meta/Google
  tab then showed the misleading **"deep breakdown not pulled yet — build this client"** placeholder,
  as if the client had never been set up.
- **Every attempt now fits inside the function budget:** per-attempt timeout capped under the limit
  (8.5s / 8s / 7.5s by window size) with the retry dropped on larger windows. buildMeta/buildGoogle
  already fire their Windsor calls in parallel, so the wall-clock is ~one attempt. A window that's
  genuinely too big to return in time now aborts cleanly instead of hanging.
- **Partial-success on big windows:** the heaviest essential query (per-creative rows) degrades to an
  empty creative section on windows over ~90 days rather than failing the whole tab — the campaign /
  ad-set tables + totals still render.
- **Honest error state:** when a live pull really does fail, the Meta/Google tab now shows a clear
  *"couldn't load for this range — it's large and ran out of time, try a shorter range"* card with a
  **Retry** button, instead of the "never built" placeholder. The retry re-runs just that pull.

## v3.171.0 — 2026-08-10 · `ae40430` — Per-calendar breakdown on hover
- **Calendar key events now show their per-calendar split on hover.** When several calendars are
  linked to the same pipeline stage they merge into one key event (e.g. three reps' Discovery
  Calls → one "Discovery Call" number). Hovering that key event — in the Meta/Google Caalano360
  tiles and in the Key Events funnel — now lists each calendar and how many bookings it
  contributed to the total (plus shown/occurred where known), and notes any reached-the-stage
  count that came in without a calendar booking. A dotted underline marks the hoverable labels.

## v3.170.0 — 2026-08-10 · `d1dfe1e` — Meta/Google Caalano360 tile + calendar label tidy
- **Removed the standalone "Scheduled Appts" tile** from the per-pipeline Caalano360 metrics on the
  Meta and Google ad views. It was a blanket CRM booked-count that isn't a configured key event and
  duplicated the linked-calendar key event beside it. Only the key events you actually configure in
  Settings → Key events now appear (plus Leads / Won / Revenue).
- **Calendar-linked key events now read as their pipeline STAGE name.** The 📅 icon still marks a
  key event as calendar-linked, but the label shows the pipeline stage it's linked to (e.g. the
  stage name) instead of the calendar's own name — including when the calendar was deliberately
  `[PIPE]`-tagged. This makes the Key Events pipeline/funnel view consistent with the funnel stages.

## v3.169.0 — 2026-08-09 · `ffe2fdc` — Large-window (YTD) reliability + load status
- **Big windows no longer time out or truncate.** Three fixes to the Meta + CRM pulls:
  - **Window-aware fetch timeouts:** each Windsor call now gets more time for a larger window
    (up to ~22s for a year) instead of the small-window default that was aborting YTD pulls.
  - **Lighter Meta payload for long ranges:** the per-ad-per-day breakdown (the heaviest query —
    ~#ads × 365 rows for a year) drops to **campaign × day** for windows over ~4 months, cutting
    that payload 10–50×. The campaign daily chart and the day drill's campaign split still work;
    only the per-creative day drill is coarser over long ranges. The campaign / ad-set / creative
    tables and totals are unaffected and now load for YTD.
  - **CRM not truncated at 1500:** the GoHighLevel opportunity paging now scales its row + page
    budget to the window (up to ~5,000 for a year) so a busy client's YTD attribution isn't cut
    off — which is what left the green Caalano360 columns half-loaded.
- **New two-part load indicator on the Meta & Google views.** A bar at the top shows the ad
  platform data loaded → **Caalano360 (CRM) loading… → all data in**, so you can tell when the
  *whole* page is complete (not just the ad half). If the CRM side genuinely can't load for a huge
  window it says so with a clear message instead of leaving the columns silently blank. It tidies
  to a small "All data loaded ✓" once everything's in.
- Meta campaigns / ad sets are **not status-filtered**, so any campaign or ad set with spend in the
  window shows even if it's now paused — the slimmer, higher-budget pulls make sure they actually
  come back rather than being lost to truncation.
- **Action for you:** on Netlify (Pro), raise **Site configuration → Functions → Function timeout**
  toward **26s** so the largest pulls have the full runway; the code now uses it when available.

## v3.168.0 — 2026-08-09 · `530aab8` — Viewer access lock-down
- **Client (viewer) accounts are now confined to exactly what they're assigned — enforced
  server-side, not just hidden in the UI.** Previously a viewer was limited to their allocated
  *clients* (`canSeeClient`) but, for a client they could see, could reach any data scope or agency
  tool by crafting a direct API call — including tabs they weren't given, the creative cockpit,
  report generation and diagnostics. `windsor.mjs` now maps every scope/channel to the tab(s) that
  legitimately fetch it and **allows a viewer only the requests their assigned tabs use** (attribution
  loads on every client view; overall→blend/health/users/ccdrill; meta→meta+forms; google→google;
  cohorts/forms/location/appts/timing→their own scope; contact-notes drill allowed for any). Every
  other request (agency scopes, unassigned tabs) returns 403.
- **Scoped settings for viewers.** The shared settings blob GET returned every client's config
  (key events, KPI targets, campaign maps, and which clients are Super-Admin-restricted) to any
  signed-in user. A viewer now receives only their **own** clients' client-keyed sections and none
  of the agency/sensitive sections (restricted map, AI context, insights, optlog, competitors).
- Together with the earlier per-caller `private` caching and the Super-Admin-only-clients feature,
  a client can now only ever see the clients, views and configuration explicitly allocated to them.

## v3.167.0 — 2026-08-09 · `3ebb2de`
- **Add/Edit client: link an account by ID even before discovery lists it.** The Meta / Google /
  Caalano Systems pickers only showed accounts Windsor had synced data for (any account with
  activity in the last 12 months), so a just-connected Windsor account — which Windsor hasn't
  backfilled yet — never appeared, no matter how many times you hit Refresh accounts. Each column
  now has a **"paste an account ID"** box: enter the ID and it links immediately. A selected ID
  that isn't in the discovered list is also shown pinned at the top of its column (so an existing
  link whose account has gone quiet still shows as selected in Edit). Clarified the footnote:
  Windsor lists an account only once it has data for it; a new account can take a while to backfill.

## v3.166.0 — 2026-08-09 · `4387bb0`
- **Super-Admin-only clients.** You can now restrict a client so it's visible **only to Super
  Admins** — hidden from every other Admin, User and Viewer. Toggle it per client in Settings →
  Clients ("🔒 Super-Admin only" on each card; a lock badge marks restricted ones). Enforced
  **server-side** (windsor.mjs): a non-super caller is 403'd on a restricted client and it's stripped
  from every agency aggregate (overview, trends, leaderboard, coverage, logos, social), not just
  hidden in the UI. Legacy/basic (single-owner) mode sees everything. Stored as a new `restricted`
  settings section that syncs across the team like the rest.
- **Fix: creative-card / green-column / funnel key events were showing in config order, not pipeline
  order** (e.g. Lodged/Settled appearing before Booked Discovery Call). The stage-position map was
  built from the channel funnel pipelines, which are derived from opportunity activity and can omit
  low/no-activity stages — so `orderKeyEvents` couldn't place them and fell back to configuration
  order. It now builds the position map from the **full pipeline registry (`allPipelines`)**, so
  every key event orders by its real funnel position across the Meta view, Google view and Monthly
  Report. **Regenerate frozen monthly reports** to pick this up.

## v3.165.0 — 2026-08-09 · `6c305db`
- **Security: the GoHighLevel OAuth connect endpoint is now admin-only and CSRF-protected.** The
  `caalano-connect` function is excluded from the site gate (so the OAuth redirect is always
  reachable), which left it fully public — anyone could hit the callback and overwrite the stored
  agency GHL token, and `?status=1` leaked connection state. Now: **(1)** `?start=1`, the callback,
  `?status=1` and the connect page all require an **admin session** (multi-user mode) or the shared
  **Basic-Auth password** (legacy mode); **(2)** `?start=1` mints a **signed, 15-minute `state`**
  (HMAC-SHA256, round-tripped through GoHighLevel) that the callback must present and validate before
  any token exchange — so a forged or cross-site callback can't replace the agency credentials. The
  SameSite=Lax session cookie is sent on GoHighLevel's top-level redirect back, so a legitimate admin
  reconnect is unchanged.

## v3.164.0 — 2026-08-09 · `2bbd1df`
- **Fix: Meta "Results" auto-detection was silently disabled by a field-name typo.** The ad-set
  optimisation-goal field was requested and read as `adsset_optimization_goal` (double-s), but
  Windsor's real field is `adset_optimization_goal` (single-s, matching its sibling
  `adset_destination_type` / `adset_promoted_object`). Windsor ignores unknown field names, so the
  query returned nothing for it and every ad set's result type fell back to the client's default
  (usually Leads) — so "Results" and "Cost / result" across the Meta views were the fallback, not
  each ad set's actual optimised objective (purchases, landing-page views, etc.). Corrected all
  occurrences. Live Meta views pick this up on the next fetch; **regenerate any frozen monthly
  reports** built before this to refresh their Results figures. (No regression risk: the field was
  already returning nothing, so requesting the correct name can only improve or match the old
  behaviour.)

## v3.163.0 — 2026-08-09 · `e17dccc`
- **Monthly Report: wide Caalano360 green tables no longer clip when exported or printed.** The
  creatives table (and any `o360-tbl` with the union key-event columns) is fixed-width and, for a
  multi-pipeline client, can be wider than an A4-landscape page — so both the native **Print**
  (`window.print()`) and the **Download PDF** (html2canvas) paths were cutting off the rightmost
  green columns (often Won / Revenue). For export/print only, those tables now drop the fixed layout
  and fixed column widths, wrap their cells, and shrink to 8px so **every column fits the page**;
  their scroll containers are set to `overflow: visible` so nothing is clipped before capture. The
  two export buttons now produce the same complete output. On-screen behaviour is unchanged (the
  tables still scroll horizontally inside their card).

## v3.162.0 — 2026-08-09 · `e4bcf7d` — Backend resilience
- **Every connector call now has a timeout and retries transient failures.** A new shared
  `resilientFetch` (in `ghl.mjs`, used by `windsorFetch` and the GHL token/GET/POST helpers) bounds
  each outbound request with a ~9s timeout so a hung upstream can't stall the whole function, and
  retries 429 / 5xx / network-reset responses twice with a short backoff (honouring `Retry-After`
  on 429). Timeouts themselves aren't retried (they're already slow), and non-retryable 4xx pass
  straight through. Previously a single transient Windsor/GHL blip hard-failed the request.
- **One connector hiccup no longer blanks a whole view.** The core Meta and Google builds fired
  several parallel fetches with no per-fetch error handling, so any one failing rejected the entire
  response (502). Enrichment fetches — daily charts, previous-period deltas, day-drill breakdowns,
  Google keywords / search terms / conversion-action rows — now degrade to empty on failure, while
  the primary data (ads, account totals, campaigns, ad sets) still surfaces an honest error if it
  genuinely can't load rather than showing silently-empty numbers. (The blend / trends / snapshot
  builds already had this per-fetch tolerance and now also gain the timeout + retry.)

## v3.161.0 — 2026-08-09 · `86310e3`
- **Fix: unscoped key events no longer leak cross-pipeline totals into a per-pipeline view.** A
  key event configured as a bare stage name (or a Won/calendar with no pipeline link) carried no
  pipeline, so in a pipeline-scoped funnel, tile, green column, creative card or monthly-report
  column its reach resolved to the **summed count across every pipeline** — inflating rates (they
  could exceed 100%) and double-counting reach for multi-pipeline clients. `keyEventsForPipe` now
  **stamps the scoped pipeline onto unscoped events** when scoping to a specific pipeline, so their
  reach reads that pipeline's stage counts (`pipelineId::name`). Events already scoped to another
  pipeline are dropped; the "All pipelines" view is unchanged (bare events there still correctly
  read the cross-pipeline total). This flows through every scoped surface via the one shared helper
  (Meta/Google Key Events funnels + per-pipeline metric tiles, creative cards, Monthly Report
  per-campaign columns, Forms drill, Timing matrix).

## v3.160.0 — 2026-08-09 · `65ff91a`
- **Caalano360 tab: the Revenue bottleneck funnel gets a pipeline selector.** For multi-pipeline
  clients the funnel (in `ExecutiveDashboard` → `BottleneckPanel`) previously stacked every
  pipeline; it now shows **one pipeline at a time** with a dropdown that defaults to the **biggest
  pipeline by leads**, plus an **"All pipelines"** option that keeps the stacked view. Single-pipeline
  clients are unchanged. This matches the Meta / Google Key Events funnel pattern. (Note: this view
  doesn't carry per-pipeline ad spend, so the default is biggest-by-leads rather than biggest-by-spend
  — a faithful proxy.)
- **Removed ~975 lines of dead code.** The `Caalano360` component (its named tab actually renders
  `ExecutiveDashboard`) was never mounted; it and its exclusively-used helpers are deleted:
  `Caalano360`, `useWeeklyBlend`, `buildChatContext`, `ClientChat`, plus the orphaned `OverallTab`,
  `CrmTab`, `CrmLive`, `CrmGhl`, `keBreakTip`, and the now-unused `clientTotals` / `agencyTotals`
  (the latter carried a latent crash on UI-added clients). No behaviour change — everything removed
  was unreachable. Any future key-events / funnel edits now have exactly one live implementation.

## v3.159.0 — 2026-08-09 · `bdb7528` — Trust & correctness batch
- **Security (cross-client leak): authorised API responses are no longer shared-CDN cached when
  multi-user login is on.** `windsor.mjs` set `cache-control: public` on cached responses, but the
  per-caller access checks (`canSeeClient` / `restrictTo`) run *inside* the function — a shared-CDN
  cache hit skipped them and could replay one viewer's authorised payload to another. Cached
  responses are now `private` (browser-only) whenever `AUTH_SECRET` is set; `public` is kept only in
  single-user mode where every caller has identical access.
- **Show % / % leads tooltips now match the maths.** The creative-card key-events table said
  "shown ÷ booked" but rendered shown ÷ **occurred**; corrected to "shown ÷ occurred (appointments
  whose date has passed)". The "% leads" tooltip now says "÷ this creative's leads" (it was
  "÷ total leads").
- **Green rate columns are labelled honestly.** Book Rate / Win Rate / Conv % divide by the row's
  **ad-reported** leads/results, not CRM leads — the tooltips now say so ("÷ this row's ad-reported
  leads (not CRM leads)") so they're not mistaken for the CRM funnel's rates.
- **Monthly Report: "Paid leads" → "Paid results".** The figure sums Meta *results* + Google
  conversions (each campaign's optimised objective — not necessarily leads), so it's relabelled
  "Paid results" and "Blended CPL" → "Cost / result", with subs clarifying they're ad results, not
  CRM leads.
- **Revenue-basis note on Meta/Google Caalano360 metrics.** Those green Revenue/ROAS tiles use the
  lead-created basis; the subtitle now says so and points out the monthly report uses deal-won, so
  the two can be reconciled.
- **Fix: creative cards keyed by name.** `MRCreative` used positional keys, so the inline-play state
  could stick to the wrong creative after sorting/paging; now keyed by creative name.

## v3.158.0 — 2026-08-09 · `170a29e`
- **Monthly Report Creative Performance now has a data table too (like the Meta ads view).**
  Above the creative cards, the report now shows a **sortable green Caalano360 creatives table**
  (Creative · Type · Spend · Impr. · CTR · Freq · Results · Cost/res + a green column per key
  event) — the same `o360-tbl` used on the Meta client view. Click any header to sort. The table
  uses the union key-event columns so they line up across pipelines, while the cards below stay
  scoped to each creative's own campaign pipeline. The Meta client view keeps its own existing
  Creatives table (the report table is gated to the report only, so there's no duplicate).

## v3.157.0 — 2026-08-09 · `91b79de`
- **Meta client view: Creative performance now uses the Monthly Report card exactly.** The old
  "Visual previews" mini-cards are replaced with the **same rich creative cards as the Monthly
  Report** (`MRCreativeSection`) — a large 9:16 thumbnail with inline Instagram play, a header
  block with Spend / Impr / CTR / Freq / Results / Cost-per-result, the full **key-events table
  (Key event · Count · % leads · Next · Show % · Cost / stage)** with a Leads anchor row and a
  highlighted Won row, and a Revenue / Cost-per-won / ROAS cash strip. It keeps the **sort chips**
  (spend, CTR, leads, CPL, each key event, revenue, ROAS) and **10-per-page pagination**. Each
  card's key events are still scoped to the **pipeline of that creative's campaign**, and the
  pipeline is named on the card for multi-pipeline clients. The sortable "Creatives" data table
  above it is unchanged.

## v3.156.0 — 2026-08-09 · `e7fcd8b`
- **Key events now render in correct pipeline order, with calendars combined into their linked
  stage.** The ordering engine (`orderKeyEvents`) now anchors a pipeline-tagged calendar
  (`[FIN] Booked Discovery Call`) to its stage position by matching the **de-tagged label** when
  the stored stage link is stale/renamed — so calendars sit at their real funnel position
  instead of being dumped at the top. The merge engine (`mergeCalKeyEvents`) infers the linked
  stage the same way, so a tagged calendar **collapses into the matching pipeline stage** (one
  "Cost per Booked Discovery Call" row combining calendar bookings + stage reach) rather than
  showing twice; pipeline tags are preserved where two pipelines share a stage name. This flows
  through **every** key-events surface (Caalano360, Monthly Report funnels, Forms drill,
  Meta/Google funnels, creative cards).
- **Caalano360 Key events funnel: per-pipeline selector (highest ad-spend default).** For
  multi-pipeline clients the section now shows **one pipeline's funnel at a time** with a
  dropdown to switch — defaulting to the pipeline with the most ad spend, exactly like the
  Meta/Google Key Events funnels — instead of stacking every pipeline. Each pipeline's key
  events are re-resolved scoped to that pipeline (its own bare stages + its own calendars,
  combined and ordered) and scored against **its own** leads, with cost/event on that
  pipeline's attributed spend. Single-pipeline clients default straight to their one pipeline.
- **Caalano360 Full funnel pass-through: per-pipeline selector (highest ad-spend default).**
  The pipeline pass-through now carries the same dropdown, so a multi-pipeline client sees one
  pipeline's stage-by-stage funnel (defaulting to highest ad-spend) without changing the whole
  page's pipeline filter; cost/stage divides that pipeline's attributed spend.

## v3.155.0 — 2026-08-08 · `cb19403`
- **Cost efficiency in the per-pipeline Caalano360 metrics (Meta + Google).** Every tile now
  carries a **cost-per-unit with its own up/down chip** vs the previous period (green when it
  gets cheaper) — so "Scheduled Appts ▲26%" now reads "…$117/appt ▼12%", giving the volume
  change real efficiency context. The **Leads tile shows cost-per-lead**, appts show
  cost/appt, each key event shows cost/event, Won shows cost/won — each with its vs-prev
  chip. Needs the prior period's ad spend per pipeline (now computed from campaign-level prev).
- **Monthly Report:** the creative funnel's cost column is relabelled **"Cost / stage"** (it
  already computed the creative's ad-level spend ÷ each key event's count).

## v3.154.0 — 2026-08-08 · `dd0301f`
- **Creative cards only show their own campaign's key events.** Each creative card's Caalano360
  funnel is now scoped to the **pipeline of the campaign that creative ran in** — so a BA
  creative shows only the [BA] key events, not the [FIN] ones too (no more mixed lists or
  duplicate stage rows). The card header names that pipeline. Each key event still shows its
  **count · next-step conversion · cost per event**, and appointment-linked events show the
  **show rate (shown ÷ occurred)**.

## v3.153.0 — 2026-08-08 · `2437179`
- **Show rate on appointment-linked key-event tiles (shown ÷ occurred).** In the per-pipeline
  Caalano360 metrics (Meta + Google), any key event tied to a booked calendar now shows its
  **show rate beneath the count** — computed as **shown ÷ occurred** (appointments whose date
  has passed), not shown ÷ total booked, so upcoming bookings don't drag it down. Matches the
  funnel's Show % column.

## v3.152.0 — 2026-08-08 · `5531a1b`
- **Google Ads view gets the Meta treatment.** The improvements that make sense on the search
  side are now live in Google Ads: the **pipeline selector scopes the whole ad side** to its
  linked campaigns (cost / clicks / conversions / campaign / ad-group / keyword / search-term
  tables), a **"Google metrics" + per-pipeline "Caalano360 metrics"** split (Leads first,
  count · vs-previous · % of leads, cost-per-event/appt/won combined), and the **Key events ·
  Google funnel now has the per-pipeline dropdown** defaulting to the highest ad-spend pipeline.
  The styled green-cell popups already applied everywhere (shared component). Creative cards /
  10-per-page pagination don't apply to Google (no image/video creatives there).

## v3.151.0 — 2026-08-08 · `98f27c8`
- **Per-pipeline Caalano360 metrics: Leads first, % of leads, vs-previous, and combined
  cost tiles.** Each pipeline group now opens with a **Leads** tile, every tile shows its
  **▲/▼ change vs the previous period** (new prior-period attribution fetch) and its **% of
  that pipeline's leads** beneath the count, and the cost pairs are combined to save space —
  **Won** carries cost-per-won, **Revenue** carries ROAS, appts/key-events carry cost-per-event.
- **Styled hover popups for the green Caalano360 cells.** The Booked / Shown / Won cells in the
  campaign, ad-set and creative tables now show the same clean popup card as the rest of the
  app (header + per-calendar / pipeline-stage breakdown) instead of the plain grey browser
  tooltip. Already-styled popups were left untouched.

## v3.150.0 — 2026-08-08 · `15921b8`
- **Caalano360 metrics now break out by pipeline (business unit).** Each key event shows its
  **count** with the **cost per event** beneath it, alongside Scheduled Appts, Cost/Appt, Won,
  Cost/Won, Revenue and ROAS. For multi-pipeline clients these render as **one labelled group
  per pipeline by default** (highest ad-spend first), since two pipelines are typically two
  near-independent business units — each group divides that pipeline's own Meta spend by its
  own counts. Single-pipeline clients keep the one combined group.

## v3.149.0 — 2026-08-08 · `4984179`
- **Meta Ads creative cards go horizontal — media left, all stats right (monthly-report
  style).** Each card now puts the creative preview on the left and the full read-out on the
  right: spend/leads/CPL/CTR/CVR/hook plus the Caalano360 key-events funnel (Count · Next-step
  · Cost/event · Show %, with booked & shown appointments) and Revenue/Cost-per-won/ROAS.
  Cards are wider (1–2 per row) and stack back to vertical on narrow screens.

## v3.148.0 — 2026-08-08 · `0bf4482`
- **Key events · Meta funnel is now per-pipeline.** For multi-pipeline clients the funnel no
  longer mixes every pipeline's stages together (which produced duplicate rows and nonsense
  next-step %). A **pipeline dropdown** on the panel shows one pipeline at a time — defaulting
  to the **highest ad-spend** pipeline — and "% leads" now uses that pipeline's own Meta leads
  as the denominator. Pick "All pipelines" to see the combined view. When the top filter is
  set to a pipeline, the funnel follows it.
- **Meta Ads scorecards split into "Meta metrics" and "Caalano360 metrics".** The top KPIs are
  now two labelled, full-width rows that stretch to fill the screen (auto-fit). The Caalano360
  row adds the blended CRM metrics — Scheduled Appts, Cost/Appt, **cost per key-event stage**
  (per booked call, qualified, etc.), Won, Cost/Won, Revenue and ROAS — scoped to the funnel's
  pipeline.

## v3.147.0 — 2026-08-08 · `65ef5a8`
- **Meta Ads creative cards — richer Caalano360 funnel (like the Monthly Report).** Each
  visual-preview card's key-events funnel now shows **Count · Next-step conversion · Cost per
  event · Show %** per stage (Leads row carries CPL), and the cards are wider to fit it.
- **Meta Ads creatives paginated 10 per page.** The creatives **table and cards now share one
  sorted, paged list** (default sort **Spend**, click any header to re-sort) so they always
  show the same 10 — much easier to read than the old full table.
- **Forms track the pipeline filter.** With a pipeline selected, the "Performance by form"
  table now only shows forms whose ads belong to that pipeline's campaigns (it was showing
  every form regardless).
- **Styled "conversion actions" popup.** The campaigns / ad-sets **Results** cell now shows a
  formatted hover card — every conversion action (primary starred) with a **Total actions**
  line — instead of the plain grey browser tooltip.

## v3.146.0 — 2026-08-08 · `0e093f7`
- **Meta Ads: the pipeline selector now scopes the whole ad side, not just the green
  columns.** Picking a pipeline used to leave Cost / Impressions / Reach / the campaign,
  ad-set and creative tables and the daily trend at whole-account (the old "ad spend is
  unchanged" note). Now they all scope to that pipeline's **linked campaigns** — an explicit
  Settings campaign→pipeline link first, else a name match (the same matcher forms use) — so
  the ad numbers line up with the CRM funnel. Reach & frequency are summed across the scoped
  campaigns (a mild over-count vs a true de-duplicated account reach), and that's flagged in
  the note. If no campaigns resolve to the pipeline, a hint points to Settings → Campaign
  links. (Google Ads mirrors this next.)

## v3.145.0 — 2026-08-08 · `fdf46c4`
- **UTM aliases: clearer "leave as is" default + "Keep separate" for legit standalones.**
  Not every unmatched UTM is a rename — a paused-but-legit campaign shows as unmatched
  simply because it isn't in the live names list, and it should NOT be merged into another
  campaign. The dropdown now defaults to **"Not linked — leave as is"** (nothing is applied
  unless you approve or pick), the approve button shows the target it would link to, and a
  new **Keep separate** button marks a UTM as an intentional standalone — it's hidden from
  the unmatched list and its data stays under its own name, with an undo in a "kept separate"
  strip. Stored under a reserved `_keep` key so it never affects aggregation.

## v3.144.0 — 2026-08-08 · `0af4eee`
- **UTM-alias editor now matches on the ad number, with explicit approve.** The suggestion
  engine used to match on wording (`Single_Video`, `Free Training`), which mis-linked ads
  (e.g. `CDa_72…` → `CDa_62…`) and piled many old UTMs onto whichever current ad shared
  generic words. It now keys off the **ad-number code** (`CD_62` / `CDa_72` / `CDas_06`),
  shown as a badge on each row: a green **✓ #CODE** button = the numbers match (high
  confidence), an amber **✓ Approve** = a wording guess to verify first. Every option in the
  dropdown is prefixed with its code, and organic sources (`link_in_bio`, `linktree`, …) are
  filtered out of the ad-set/creative lists. Nothing links until you approve or pick.

## v3.143.0 — 2026-08-08 · `841825c`
- **Meta "Results" cell no longer truncates to "77…".** The campaigns / ad-sets tables are
  fixed-layout, so packing the count + conversion-action label + "+N" badge into one narrow
  column clipped it to an unreadable "77…". The cell now **stacks**: the count sits on top
  (never clipped) with the conversion-action label wrapping beneath it. The full
  all-conversion-actions breakdown on hover is unchanged.
- **UTM-alias editor fixed — it was showing every UTM, matched or not.** It scanned for
  current campaign / ad-set / ad names via the heavy `buildMeta` pull, which times out on
  large accounts (e.g. FINR) and returned no names — so with nothing to match against,
  *every* UTM looked "unmatched" and the link dropdowns were empty. Now it uses a new
  lightweight `scope=adnames` endpoint (name dimensions only) that loads reliably; when
  names genuinely can't load it shows a **warning + retry** instead of dumping everything;
  and non-ad-set traffic sources (`social`, `organic`, `manual`, `calendar`, …) are filtered
  out of the ad-set list so only real renamed-ad-set candidates appear.

## v3.142.0 — 2026-08-08 · `ed12cff`
- **Real business logos as client avatars, app-wide.** Each client's website and
  uploaded logo are now pulled from their Caalano Systems (GoHighLevel) location and shown
  as the avatar everywhere one appears — agency leaderboard, client switcher, client header,
  Settings cards + modal. Resolution cascade: **manual override → GHL uploaded logo →
  website favicon → coloured initials** (graceful fallback on any load error, so nothing
  ever breaks). Logos sync once and cache in shared Settings; a **Sync logos** button in
  Settings → Clients re-pulls on demand, and each client's Settings modal has a logo preview
  + optional **override URL** to force a specific image. New non-gated `logos` settings
  section + `scope=logos` backend endpoint (`locationProfile` reads website/logoUrl).

## v3.141.0 — 2026-08-08 · `4655a08`
- **Agency Overview headline now reconciles with the leaderboard.** The top "Revenue
  Generated" and "ROAS" KPIs used to pull from a *separate* agency feed (Windsor's bulk
  GHL blend) while the client leaderboard below pulled per-client attribution — two
  different won-revenue bases, so a single finance deal with a loan-sized value could push
  the headline millions above the sum of the rows. The headline now **sums the exact same
  per-client "all"-channel CRM revenue the leaderboard shows**, so the top total always
  equals the sum of the rows beneath it. Both share a single fetch (no extra load), and
  while CRM data streams in the KPI shows an `n/N clients loaded` progress line so a
  half-loaded total is never mistaken for the final figure.

## v3.140.0 — 2026-08-05 · `f078906`
- **UTM aliases — fix attribution after a rename.** When a campaign, ad set or creative is
  renamed, historical CRM leads keep the **old** UTM they were stamped with, so their
  results stop rolling into the new name. New **Settings → (client) → UTM aliases** tab
  scans the last 90 days for UTM values that have CRM leads but match no current ad name,
  **auto-suggests** the closest current name, and lets you confirm/override the link (per
  level: campaign / ad set / creative). Linked old + new UTMs then **aggregate under the
  current name everywhere** — Meta & Google green columns, the Caalano360 revenue-by-campaign,
  and the Monthly Report (applied live at view time, so it re-merges existing reports too;
  regenerate a snapshot if an old UTM had been truncated out of the frozen data).

## v3.139.0 — 2026-08-05 · `442c91a`
- **Qualified lead now behaves as a key event, at its pipeline position.** Setting a
  qualified stage (Settings → Qualified lead) injects a synthetic **“Qualified”** key event
  scoped to that pipeline, so it slots into the funnel at the stage's position and flows
  automatically into **everywhere key events render** — the Caalano360 funnel, the
  key-event reach cards, the revenue bottleneck, the **Meta/Google green columns**, and the
  **Monthly Report** — with its reached count, % of leads, next-step and cost per event. It
  only appears when a qualified stage is set (and is hidden if that stage is already one of
  your key events, to avoid a duplicate). Replaces the standalone Qualified KPI from the
  previous build. The Settings editor still edits only your real key events (the synthetic
  Qualified event never round-trips into storage).

## v3.138.0 — 2026-08-05 · `22a2ace`
- **Qualified lead — per-pipeline stage (Settings) + Caalano360 KPI.** New
  **Settings → (client) → Qualified lead** tab: pick the stage that marks a lead qualified
  for each pipeline (typically just after the discovery call). A lead is qualified once it
  **reaches that stage or beyond**, and any **won** deal always counts (won reaches every
  stage). The **Caalano360 command centre** now shows a **Qualified** KPI + qual-rate — but
  **only when a qualified stage is set** for the client; otherwise it stays hidden.
  (Meta/Google green columns and the Monthly Report get Qualified in the next update.)

## v3.137.0 — 2026-08-05 · `8e75870`
- **Booked appointments: Occurred added + Show rate fixed to occurred-only.** Booked
  appointments now expose **Occurred** (appointments whose date has passed) alongside
  Booked and Shown, and **Show rate = Shown ÷ Occurred** — so upcoming/future bookings no
  longer drag the show rate down. Applies to the Caalano360 green columns (new **Occurred**
  column per booked-calendar key event) and the Key Events funnel (Show % now over
  occurred, with a tooltip breaking down shown / occurred / booked). Backend now tracks
  occurred per calendar and per creative/campaign/ad-set. (Needs a fresh data pull /
  regenerated snapshot to populate on frozen reports.)

## v3.136.0 — 2026-08-05 · `60222d0`
- **Multi-pipeline funnels are now scored per pipeline, not against total leads.** For a
  multi-pipeline client viewing "All pipelines":
  - **Key event reach** cards divide each `[FIN]` / `[BA]` event by **its own pipeline's**
    leads (was dividing everything by the combined lead total).
  - **Revenue bottleneck** and the **Key events** funnel now render **one funnel per
    pipeline**, each with its own Leads anchor and step conversions — fixing the nonsense
    cross-pipeline percentages (e.g. 170% / 120%) that came from dividing one pipeline's
    step by another's. `keyEventRows` now tags each row with its pipeline to make this work.

## v3.135.2 — 2026-08-05 · `5ca2006`
- **Settings top tab bar scrolls within its frame on mobile.** The section pill (Clients /
  Team & access / Your account / Appearance / …) was overflowing and dragging the whole
  page sideways to reach the last tab; it now scrolls horizontally inside its own pill.

## v3.135.1 — 2026-08-05 · `2b448cb`
- **Settings modal — mobile optimised.** On phones the config modal now: scrolls the tab
  strip cleanly (no cut-off tabs), stacks the name/description inputs and Save full-width,
  and — the big one — **stacks each booked-calendar's pipeline/stage link selects under the
  calendar name** instead of the cramped wrap you saw. Campaign→pipeline linker rows,
  pipeline pickers and the Optimisation Log URL row also go full-width and stop overflowing.

## v3.135.0 — 2026-08-05 · `e2bc1dd`
- **Multi-pipeline key events no longer merge same-named stages.** The Key Events editor
  was storing a ticked pipeline stage as a bare name with no pipeline, so a stage that
  exists in two pipelines (e.g. FINR's "Booked Discovery Call") became one unscoped event
  whose reach was **summed across both pipelines**. Stages are now stored **scoped to their
  pipeline** for multi-pipeline clients, so each pipeline's stage is counted independently
  (the pipeline filter then shows only that pipeline's, and “All pipelines” shows each on
  its own). Existing bare entries are auto-migrated to scoped ones when the editor loads.

## v3.134.0 — 2026-08-05 · `d1e2327`
- **Meta Ads — richer creative cards + clearer Caalano360.**
  - Each creative card now shows the **full Caalano360 key-events funnel** (Leads → each
    configured key event with count + show rate → Revenue / Cost-per-won / ROAS), matching
    the Monthly Report — instead of the fixed Booked/Shown/Won block.
  - When a creative has **no CRM match on its UTM (utm_content)** the card now says so
    explicitly, so an empty green block reads as "not tagged", not "broken".
  - **Creative preview thumbnails**: added a placeholder tile when Meta returns no
    thumbnail (or it fails to load), and set crossorigin/no-referrer so more thumbnails
    load — cards are no longer blank.
  - Drilling into an **ad set / creative / form** now resets the creative pager to page 1
    so the filtered creatives are visible immediately.

## v3.133.1 — 2026-08-05 · `10946c2`
- **Optimisation Log — colour-coded author badges.** Each person's name badge now has its
  own colour so you can spot at a glance who made a change: **Uma = pink, Jye = amber,
  Alex = purple**.

## v3.133.0 — 2026-08-05 · `3b82b24`
- **Optimisation Log timeline — richer, only real optimisations.**
  - Entries that are **just a platform (Meta/Google) with no other detail are hidden** — a
    row needs a platform *plus* an optimisation type / campaign / note to plot.
  - **Meta vs Google** are now instantly distinguishable: a coloured platform badge (Meta
    blue, Google green), a matching timeline dot and a coloured left border on each card.
  - **Who made the change** is shown as a name badge, parsed from the note's leading
    initials — **U/Uma → Uma, J/JA → Jye, A/AS → Alex** — and that prefix is stripped from
    the note text so it reads cleanly.
  - Optimisation type is the card headline; campaign/ad set and the note render beneath.

## v3.132.1 — 2026-08-05 · `7182bd5`
- **Optimisation Log timeline polish.** Empty / dash (“-”) fields are now hidden in the
  timeline (an entry that's all dashes is skipped entirely), and dates are parsed as
  **DD/MM/YYYY** so e.g. 06/12/2026 reads as 6 Dec, not 12 Jun — fixing both the display and
  the newest-first ordering. The Table view still shows every column/row verbatim.

## v3.132.0 — 2026-08-05 · `4406889`
- **Optimisation Log sheets pre-filled per client.** Baked in the master client→sheet
  links so the Optimisation Log tab appears automatically for A2Z, Finr Advisory, Healan
  Centre, IDO IDO, Nexia Health Care, Owl PSA, Pool Haus, Swift Emergency, Simchat and The
  Psychology Hub — no manual setup. Any URL saved in Settings still overrides its default.
  (Feel Better Medical, Ratefinder and Total Smart Home Solutions had sheets but aren't
  clients in the dashboard, so they were skipped.)

## v3.131.0 — 2026-08-05 · `f411522`
- **New per-client “Optimisation Log” tab — live from Google Sheets.** Paste a client's
  change-log Google Sheet link in **Settings → (client) → Optimisation Log**, and a new
  **Optimisation Log** tab appears in that client's view showing the sheet **live** as a
  **timeline** (newest first) or a **table**, with search and a one-click refresh.
  - Reads the sheet server-side via a new `optlog` Netlify function (the browser can't
    fetch Google directly — CORS), so no data is copied or stored; it's always current.
  - The sheet must be shared **Anyone with the link → Viewer**. First row = column headers;
    a Date/When column (if present) drives the timeline ordering.
  - Settings pane has a **Test** button that previews the columns/row count before saving.

## v3.130.1 — 2026-08-05 · `99d32c6`
- **Key-event ordering fix.** Events we couldn't anchor to a pipeline stage position
  (e.g. a calendar not linked to a stage, or a stage that isn't in that pipeline) were
  dumped to the **end** of the funnel — which is why Booked Discovery Call / Strategy
  Session Booked sat after Lodged/Settled. They now inherit the previous event's position,
  so they keep the order they're configured in, next to their neighbours. Applies
  everywhere key events render (creative cards, campaign tables, funnels, live views).

## v3.130.0 — 2026-08-05 · `0d75666`
- **Creative cards now name the pipeline & scope key events to it.** Each creative shows a
  **🔗 pipeline pill** for the pipeline its campaign belongs to, and the key-event table
  lists **only that pipeline's key events** — not every pipeline's.
  - Campaign→pipeline resolution now falls back to a **name-token match** against the
    pipeline names when a campaign isn't explicitly linked in Settings (previously such
    campaigns fell back to the full union, which is why every pipeline's events showed).
    Explicit Settings links still take priority; “All” keeps the union.
  - Sort chips are **deduped by label** so a stage that exists in more than one pipeline
    (e.g. “Booked Discovery Call”) no longer appears twice.

## v3.129.0 — 2026-08-05 · `d60dcce`
- **Monthly Report — per-pipeline key events for multi-pipeline clients.** Each creative's
  and campaign's key events now follow the **pipeline attached to that campaign** (from the
  campaign→pipeline links in Settings), so a multi-pipeline client no longer sees an
  irrelevant pipeline's stages on an ad from another pipeline.
  - **Creative cards:** each card shows only its campaign's pipeline's key events (one grid;
    sort chips span the union of all key events).
  - **Key events by campaign slide:** campaigns are grouped into a table **per pipeline**,
    each with that pipeline's own green columns; unmapped campaigns (or “All”) fall back to
    the full union table. Single-pipeline clients are unchanged.
- **Client dashboard — conversion actions table:** moved the Primary/Secondary marker onto
  its own row inside the action cell (the extra column was overflowing the narrow card) and
  set the Conv. / Value columns to equal width.

## v3.128.1 — 2026-08-05 · `519abc5`
- **Creative cards — no more horizontal scroll.** The key-event table is now truly
  full-width (fixed layout, percentage columns, no min-width), cards are a touch wider so
  every column fits, and the two longest headers were shortened (“Next”, “Cost/ev.”) with
  the full meaning kept in tooltips.

## v3.128.0 — 2026-08-05 · `53ba155`
- **Monthly Report — Account summary: paid vs all lead sources.** Under the key-events
  funnel there's a new **“Paid vs all lead sources”** section:
  - A **stacked horizontal bar per key event** — the **paid-attributed** portion (green)
    sits inside the **total** (grey) for every step (Leads → … → Client Won), so you can
    see at a glance how much of each stage came from ad spend vs everything else.
  - A side **“All Caalano Systems vs paid results” table** with All sources / Paid / Paid %
    columns per key event.
  - “Paid” = CRM records carrying a Meta/Google campaign UTM, aggregated across every paid
    campaign and read through the same green-column engine (so paid ⊆ total at each step);
    “All sources” also includes organic, referral, direct and untracked. Needs a freshly
    generated snapshot (uses the frozen campaign outcomes).

## v3.127.0 — 2026-08-05 · `ffa803b`
- **Monthly Report — creative card readability + consistency fixes.**
  - **Creative cards restacked**: thumbnail + platform metrics on top, and the key-event
    table now spans the **full card width** below (it was being clipped in the narrow side
    panel, so the counts weren't visible). The table now shows **every key event with its
    Count, % of leads, next-step conversion, show % (calendar events) and cost per event**.
  - **Fixed funnel/table won discrepancy**: the Account-summary key-events funnel showed a
    different "Client Won" than the created-on KPI/donut (21 vs 20). Both now use the same
    deal-level created-on count.
  - **User performance & Lost reasons** are back on one slide but in **two separate bubble
    panels** so they still read as distinct sections.
  - Fixed a key-event column bug in the user table where calendar-linked events (e.g. Booked
    Appointment) always showed 0.
  - **Google conversion actions**: removed the redundant ★ next to the name (the green
    “Primary” pill already signals it) and aligned the Type / Category columns.
- **Client dashboard — Google conversion actions** now mark **Primary vs Secondary** with a
  green ★ and a Type pill, matching the report.

## v3.126.0 — 2026-08-05 · `ed0dc40`
- **Monthly Report — creative cards + campaign visuals.**
  - **Creative preview tiles are now 9:16** to match the actual (vertical) creative.
  - **Key events on each creative are a compact table** (Key event · Count · Show/conv %)
    instead of the big green bubbles. Calendar-linked events show the **show rate**
    (shown ÷ booked) plus the shown count; stage/won events show their conversion vs leads.
  - **Key events by campaign slide** now leads with **charts**: a horizontal bar of
    *Leads vs the headline key event* (Won if configured, else the last event) for the top
    campaigns, and a **donut of that event's share by campaign** — above the full green table.

## v3.125.0 — 2026-08-05 · `e47c8c5`
- **Monthly Report — refinements from review feedback.**
  - **Creative slide reverted to visual cards** (big thumbnail + preview + all stats),
    with a **sort control** (by any metric) and **pagination** (top 10 per page) —
    replaces the cramped table that wasn't scrollable in present mode.
  - **Google Ads:** conversion actions restored to the campaign-performance slide, with
    a **cost-vs-conversions daily chart** and an account-level conversion-actions table.
    Each action is tagged **Primary** / **Secondary** so it's clear which are attached to
    campaign performance.
  - **Account summary:** removed the leads/spend mini-trend chart (kept the status donut).
  - **Key-events funnel fixed:** it was double-resolving the configured key events, which
    silently dropped every bare pipeline-stage event (Appointment shown, Deposit taken,
    Client won) and left only Leads + the calendar-linked stage. The created-on cohort now
    passes through **all** configured key events, Won included.
  - **User performance & Lost reasons split into two clearly-labelled slides** instead of
    one crowded slide.
  - **Drill-down popups widen dynamically** to the column count (no more horizontal
    scrolling) and now show the **Ad / creative** a deal was attributed to (backend deals
    carry `ad` / `campaign` from the lead's UTM — regenerate a snapshot to backfill).

## v3.124.0 — 2026-07-31 · `723b86b`
- **Monthly Report — big restructure + fullscreen present.**
  - **⛶ Present** button fullscreens the whole report container for screen-sharing.
  - **Meta:** Campaign & ad set on **one slide** — click a campaign to drill into its
    ad sets (expanded inline in the PDF).
  - **Creative:** now a table of **every creative with spend**, with a thumbnail + play
    per row, and the **client's configured key events** (green columns: Leads → each
    key event with cost) instead of the fixed Booked/Shown/Won.
  - **Key events by campaign** moved to **right after the creative slide**.
  - **Google:** Campaign performance & **conversion actions combined** — click a
    campaign to see the conversion actions attributed to it, plus a cost-vs-conversions
    chart. Ad groups, keywords & search terms combined on one slide, with the
    **campaign / ad group each keyword & search term came from**.
  - **CRM:** User performance & **Lost reasons combined**, with a **lost-reasons donut**
    and a **leads-by-status (open / won / lost) donut**. Account summary & ROI filled
    out with the status donut, a **6-month leads/spend mini-trend** and a bigger
    key-events funnel.
  - **PDF export replicates the slides** — all drill-downs render expanded on paper.

## v3.123.0 — 2026-07-31 · `09e11a2`
- **Delete a client (Settings), not just deactivate.** The client Edit modal now has a
  **Delete client** action (Super Admin, with a confirm). Deleting removes the client
  from **every** list — dashboard, sidebar switcher, Settings and agency-wide
  aggregates — for the whole team, whether it's a UI-added client or a built-in one.
  Its per-client settings (key events, KPIs, notes) are kept so it can be restored. A
  new **Deleted** filter in Settings → Clients lists deleted clients with a **Restore**
  button. Backend drops deleted clients from the `CLIENTS` registry across all scopes.

## v3.122.0 — 2026-07-31 · `20a957a`
- **Outbound calls now count as manual contact (Speed to Lead + Contact rate).** A
  placed outbound **call / voicemail** is treated as human outreach even when the
  dialer didn't attribute a GoHighLevel user — so phone-first teams get credited for
  reaching out, instead of showing as "no manual message." Automated sources
  (workflow / campaign / bulk / RVM) are still excluded, and messages (SMS / email /
  DM) still require a human user as before. Copy updated to "first manual message or
  call." Applies to both the sampled view and the full-range scan.

## v3.121.1 — 2026-07-31 · `6667ee5`
- **Contact rate now follows the full scan.** Previously the Contact rate card stayed
  on the 60-lead sample even after "Scan the whole date range." The whole-range scan
  now computes the contact-rate breakdown (and Lead outcomes) across every lead it
  processes, and the card updates live with it — the label switches to "of N leads
  (full scan)". Both the scan and the initial sample share the same computation.

## v3.121.0 — 2026-07-31 · `e8d7783`
- **Timing tab — Contact rate section (manual messages + appointments booked).** New
  card on the Timing tab: **total contact rate** (% of sampled leads we made human
  contact with — a manual message *or* an appointment booked), broken out into
  **Manual messages**, **Appointments booked**, and the appointment split of
  **User-booked** (a staff member created the appointment) vs **Customer self-booked**
  (the lead booked via a calendar link). Every tile drills to the leads behind it
  (contact info, source, value). Backend now distinguishes self- vs staff-booked
  appointments per lead and separates the "messaged" signal from the appointment
  fallback. Same sample basis as Speed to Lead (full scan makes it exact).

## v3.120.0 — 2026-07-31 · `f6273e0`
- **Timing tab — Open / Won / Lost lead outcomes with drill-downs.** The Timing
  (Speed to Lead) tab now shows a **Lead outcomes** row for the whole cohort of leads
  created in the range: **Open** (count + pipeline value), **Won** (count + revenue)
  and **Lost** (count + value lost). Click any of the three to open a **popup listing
  the actual leads** — contact name, lead-created date, source, contact info (email /
  phone) and value; **Won shows the deal value**, **Lost shows the lost reason**.
  Backend `scope=speed` now returns the per-outcome deal lists (lost reasons resolved
  from GoHighLevel), computed across the full cohort independent of the speed sample.

## v3.119.0 — 2026-07-31 · `51046ec`
- **Organic Social — paid vs organic followers, IG/FB/Blended breakout, KPIs moved to
  Settings.**
  - **Paid vs organic new followers.** Backend probes Facebook's paid/non-paid
    fan-add fields (with a total-minus-paid fallback) and the KPIs & Trends view now
    shows how many new followers came **from ad campaigns vs organically** — a summary
    (with "% from ads"), a per-month stacked paid/organic bar chart and a "· paid"
    column in the table. Instagram has no paid/organic follower split in the API, so
    it's shown as total net growth with a note; the split is on the Facebook / Blended
    view.
  - **Instagram / Facebook / Blended toggle.** Every KPI tile, chart and the
    month-by-month table can now be viewed **per platform** or blended.
  - **KPI targets moved to Settings.** Monthly organic targets are now set in
    **Settings → Organic KPIs** (per client, shared with the team); the dashboard shows
    them read-only and scores the latest month against them on the Blended view.
  - Per-platform total-follower reconstruction so the Instagram and Facebook views each
    show their own audience size over time.

## v3.118.0 — 2026-07-31 · `afbb8ec`
- **Organic Social trend — total followers each month + organic-only stats.** The
  KPIs & Trends view now shows the **total follower count at each month-end** (and
  where it started), reconstructed from today's count back through the monthly net
  gains — added as a KPI tile, a trend line and a column in the month-by-month table.
  **All figures are now organic only:** Facebook stats use the organic-specific
  fields (`page_impressions_organic`, `page_impressions_organic_unique`,
  `page_video_views_organic`) so paid-boosted reach & impressions are never counted,
  with an "Organic only" badge and clearer labels. The trend window is now a true
  rolling window ending on the current month.

## v3.117.0 — 2026-07-31 · `f3b3e2e`
- **Organic Social — Monthly KPIs & rolling 6-month trend.** New **KPIs & Trends**
  tab in Organic Social. Set **monthly targets** per client (net new followers,
  reach, views, impressions, engagement, posts, engagement rate) — saved per client
  and shared with the team — and each is scored against the **latest complete month's
  actual** with a progress bar and MoM change. Below that, a **rolling trend** of the
  last 3/6/9/12 months as graphs (net followers, reach, views, engagement, FB
  impressions, posts) plus a **month-by-month table** of the high-level stats.
  Backed by a new `scope=socialtrend` that rolls each month's blended IG + FB organic
  totals; net-follower gain comes from daily follow/unfollow deltas so it's
  historically accurate even though absolute follower count is current-only.

## v3.116.1 — 2026-07-31 · `999c73f`
- **Keep the dashboard out of search engines.** Added a `robots.txt` that disallows
  all crawlers, a `noindex, nofollow` robots meta tag (plus a Googlebot-specific one)
  in the page head, and an `X-Robots-Tag: noindex, nofollow` response header on every
  route via Netlify — three layers so Google (and other engines) never index or rank
  this private client reporting tool.

## v3.116.0 — 2026-07-31 · `c96f921`
- **Monthly Report sizing fixes.** Removed the forced tall slide height and stopped
  short slides stretching to the tallest one, so each page sits at its natural size
  again — no more out-of-proportion pages or extra scrolling. Creative cards are now
  compact horizontal cards (portrait thumbnail + stats + CRM key events side by side,
  6 per slide); the full 9:16 view still opens on ▶ Play. **Removed the results tiles
  from the cover page** — it's now just the client, industry and month.

## v3.115.0 — 2026-07-31 · `80d701f`
- **Creative performance — CRM key events, bigger cards, 9:16 playback.** The Meta
  creative slide is now a grid of large vertical cards. Each shows the Meta metrics
  (spend, impressions, CTR, frequency, results, cost/result) **and** the Caalano360
  CRM key-event funnel for that exact creative — **Leads → Booked → Shown → Won**,
  with **Revenue, Cost / Won and ROAS** — attributed by the ad's UTM (utm_content),
  the same as the Meta Ads view. **▶ Play** opens a **9:16 portrait lightbox** with
  the Instagram post so the whole reel is visible; where no permalink exists it links
  out. (Regenerate a snapshot to populate key events + playback on existing reports.)
- **Key events by campaign (Caalano360 green columns).** New report slide bringing
  the full green key-event columns — **which campaigns drove the most booked / shown /
  won, with the cost per each** plus the Won-revenue block and ROAS — at campaign level
  across Meta + Google, matched to CRM outcomes by utm_campaign. Reads frozen
  per-campaign outcomes stored in the snapshot.
- **Account summary & ROI merged, moved after Lost reasons.** The old Account summary
  and Return on Investment slides (which repeated the same spend / paid revenue / ROAS
  / cost-per-won and revenue matrix) are now **one slide** — fuller KPI row, the revenue
  matrix once, the by-channel ROI table and the created-on key-event funnel — placed
  **after Lost reasons**. New CRM order: User performance → Lost reasons → Account
  summary & ROI → Key events by campaign.
- **Organic Social — 9:16 top-post thumbnails** so vertical reels show fully instead
  of being cropped square.
- **Organic Social dropdown only lists connected accounts** (a live Windsor probe, so
  removing a connector drops it from the list), with **Pool Haus pinned first**, then
  alphabetical.

## v3.114.0 — 2026-07-31 · `99afc07`
- **Monthly Report — page-by-page slide view (PowerPoint / Canva style).** The deck
  now opens in **Slides** mode: one section per page, with **‹ ›  arrows, a clickable
  chip strip** to jump to any section (Cover, Meta, Ad sets, Creative, Google,
  Keywords, CRM, ROI…), a **page counter**, and **keyboard navigation** (←/→,
  PageUp/Down, Home/End). A **Slides / Scroll** toggle in the toolbar switches back
  to the old continuous view any time. Print and PDF export are unchanged — both
  still lay out every section, one per page, regardless of which view you're in.

## v3.113.0 — 2026-07-31 · `d6194f9`
- **Add competitors from a dropdown, not manual typing.** The Competitors tab now
  adds a competitor by picking from a **dropdown of the connected public Instagram
  accounts** — the competitor name and handle are taken straight from the account's
  profile, and it's mapped and pulling metrics the moment you add it. No more typing
  a name and handle by hand. Accounts already added are hidden from the list. Backend
  `scope=socialaccounts` now also returns each account's **profile display name** and
  **handle** (falling back gracefully for connectors that don't expose them).

## v3.112.0 — 2026-07-31 · `715227d`
- **"You vs competitors" benchmark strip.** The Competitors tab now opens with a
  side-by-side table comparing the client's own Instagram against every mapped
  competitor on **followers, posts, engagement, avg engagement per post and
  estimated engagement rate**. The client's row is highlighted and pinned to the
  top; the group leader on each metric is flagged in green. Comparison uses
  **likes + comments only** so the client's private saves/shares don't unfairly
  inflate it against public competitor data. Pulls the client's own IG via
  `scope=social` and collects each competitor's numbers as their cards load.

## v3.111.0 — 2026-07-31 · `1e61bd2`
- **Full competitor Instagram dashboard — every public insight + post thumbnails.**
  Each mapped competitor now renders a performance-style card mirroring the client
  Organic Social tab: a 6-tile KPI row (**followers, posts, engagement, estimated
  engagement rate, avg likes+comments per post, totals**), **format mix + best day
  to post**, a **posting-cadence & engagement over-time** chart (posts/day bars vs
  engagement line), a **weekday cadence** chart (posts vs avg engagement per
  weekday), and a **full sortable grid of post thumbnails** (sort by engagement /
  likes / comments / newest) with per-post likes, comments and estimated ER, each
  linking out to Instagram. Backend `scope=competitor` now returns a zero-filled
  daily series, weekday distribution, per-post ER and averages, and up to 24 posts.
  Private-only metrics (reach, views, saves, shares, replies, link taps) are omitted
  rather than shown as zero, since Instagram only exposes those to the account owner.
  Competitor cards now stack full-width.

## v3.110.0 — 2026-07-31 · `07f7b00`
- **Fix competitor Instagram cards showing all zeros.** The `instagram_public`
  connector uses different field names to the owned `instagram` one, so the metric
  pull was silently returning nothing. Backend `scope=competitor` now reads the
  correct public fields — `profile_followers_count`, `profile_media_count`,
  `profile_username` (profile), and `media_timestamp` for post dates — and falls
  back to `media_url` when a post has no `media_thumbnail_url` (images/carousels).
  Format mix now labels by surface (REELS / FEED / STORY). Verified live against
  `jjpoolsbrisbane` (9,408 followers, 130 posts).

## v3.109.0 — 2026-07-29 · `1592a65`
- **Competitor Instagram insights (public).** Once a competitor is mapped to a
  Windsor public IG account, its card now pulls a live summary from public data —
  **followers, posts, engagement (likes+comments), estimated engagement rate, format
  mix** and its **top 3 posts** (thumbnail + engagement, linking out). Backend
  `scope=competitor` reads the public connector defensively (falls back through
  simpler field sets). Facebook deferred; IG-only for now. Engagement rate is
  estimated (avg likes+comments per post ÷ followers) since competitor reach is private.

## v3.108.0 — 2026-07-29 · `5f19dcf`
- **Competitors → map to Windsor public accounts.** The Competitors tab now lists
  every public Instagram / Facebook account your Windsor key can access (backend
  `scope=socialaccounts`, auto-detecting the public connector slug) and lets you
  map each competitor to its account via a dropdown, saved per client. If no public
  accounts are found it prompts for the connector name. Also added a generic
  `scope=windsorprobe&connector=<slug>` to inspect any connector's accounts/fields.
  Live competitor metrics render off these mappings next.

## v3.107.0 — 2026-07-29 · `fc122fd`
- **Fix "Caalano360 columns hidden: attribution request failed."** The GHL-backed
  attribution build is heavy and can transiently time out / cold-start / rate-limit;
  it now **auto-retries twice with backoff** before showing an error, which clears
  the common transient case without a manual Refresh. When it does fail, the message
  now shows the **real backend reason** (e.g. timeout, GHL 429) instead of a generic
  "network / HTTP error", so any persistent cause is diagnosable.

## v3.106.0 — 2026-07-29 · `ae7f206`
- **Organic Social → Competitors tab (assignment + structure).** A Performance /
  Competitors tab toggle. In Competitors you assign a client's competitors by public
  Instagram / Facebook handle (stored server-side, per client), with profile links
  and the benchmark layout ready. Live public metrics (follower growth, posting
  cadence & format mix, top posts, estimated engagement rate) and the paid-vs-organic
  follower split / "% of new followers from ads" wire up once Windsor's public
  connector + Meta ad fields are verified against live data (connector was offline).

## v3.105.0 — 2026-07-29 · `a6aecfb`
- **Inbound social DMs on the Organic Social dashboard.** Counts conversations
  started via Instagram / Facebook Messenger from the client's GoHighLevel inbox
  (channel = IG/FB, started in the period): tiles for total / IG / FB plus a
  per-day stacked bar. Backend `scope=socialdm` (with a `?probe=1` sample to verify
  the GHL channel fields against live data). Shows only when DMs are found.

## v3.104.0 — 2026-07-29 · `ac78ce3`
- **Organic Social — big expansion.**
  - **Blended "Overall" section** on top (when a client has both IG + FB): total audience
    (IG followers + FB likes), net new audience, total reach, engagement, blended
    engagement rate, posts — plus a combined posts/new-audience/engagement chart. Then
    Instagram, then Facebook.
  - **Three charts per platform:** reach & interactions; posting cadence + follower
    growth (posts bars vs new-followers line); and an engagement breakdown stacked bar
    (IG: likes/comments/saves/shares/replies · FB: reactions/comments/shares). Facebook
    now has the full chart set too.
  - **Inline reel/video playback** — hit ▶ on an IG video/reel to watch it in the card
    (falls back to the thumbnail if the URL won't play), plus an explicit "Open on
    Instagram/Facebook ↗" link on every post.
  - **PDF export** — Print and Download PDF buttons (portrait, multi-page) so the
    dashboard can be shared with the client.

## v3.103.0 — 2026-07-29 · `ec68349`
- **New "Organic Social Media" tab.** A full organic social dashboard per client
  (dropdown), for the selected date range, covering **Instagram** and **Facebook
  Page** organic:
  - KPIs — followers/page-likes, new followers, reach, views, engagement, engagement
    rate, profile link taps, likes/comments/saves/shares.
  - Reach & interactions trend (IG) and organic-vs-paid impressions (FB) charts.
  - **Top posts** grid with thumbnails, per-post metrics and engagement rate,
    sortable by engagement / reach / rate; each links to the live post.
  - **Audience** — IG follower breakdown by gender, age and top countries.
  - Backend `scope=social` (buildSocial) reads both Windsor organic connectors,
    each query kept within one table and best-effort so partial data still renders.
  - Live for the five clients with a connected organic profile (Pool Haus, Nexia,
    SWIFT, Healan, Simchat).

## v3.102.0 — 2026-07-29 · `8986b33`
- **Account summary now shows Deals Won on both bases as headline tiles** — "created"
  (this month's leads, created-on cohort) and "closed" (marked won this month), so
  the two are visible at a glance without reading the matrix.

## v3.101.0 — 2026-07-29 · `44845c3`
- **CAC (cost per paid won)** added to the revenue matrix — ad spend ÷ paid deals
  won, for both bases (status change vs created on), sitting under Paid ROAS so the
  two efficiency metrics read together.

## v3.100.0 — 2026-07-29 · `37278a3`
- **Multi-month reports.** The Monthly Report now has a From → To month picker — pick
  the same month for a single-month report, or a range (e.g. April → June) for a
  quarter. Everything (campaign/creative/Google/CRM, drills, lost reasons, revenue
  bases) recomputes over the range; the 6-month trend anchors on the end month.
  Snapshots are frozen per period (single month or range) independently.
- **Created-On ROAS vs Status-Change ROAS** added as a row in the revenue matrix, so
  you can compare cash-return-this-month against this-month's-leads return on the same
  ad spend (useful when a month has no paid status-change closes but its leads have).
- **All client pickers are now alphabetical** (sidebar switcher, Monthly Report, and
  the remaining client dropdowns). Performance leaderboards keep their ranked order.

## v3.99.0 — 2026-07-29 · `9dab11c`
- **Monthly Report fixes:** the Status-Change vs Created-On revenue matrix no longer
  runs off the card — it now uses a fixed layout with a hard width cap and wrapping
  headers, so both columns always fit.
- **Average time to close** (lead created → won) added: a KPI on the Account summary,
  a row in the revenue matrix (both bases), and a per-deal "Days to close" column in
  the won drill-downs.
- **Dates now display DD/MM/YYYY** throughout the drill-downs.

## v3.98.0 — 2026-07-29 · `199b76d`
- **Monthly Report — CRM section made consistent + interactive.** Resolves the
  mixed-basis nonsense (funnels/user rows that printed >100% conversions):
  - **The funnel is now one clean Created-On cohort** — this month's leads → each
    Key Event → won *from that cohort*, so conversions can't exceed 100%. Wins/revenue
    closed this month live in their own labelled block, not inside the funnel.
  - **Revenue is shown Status Change vs Created On** (each Total vs Paid, plus deals
    & avg) in a side-by-side matrix on the Account summary and ROI slides. Status
    change = cash banked this month (any lead date); Created on = this month's leads
    that are won.
  - **User performance** now ranks by revenue **closed this month** (cash), shows
    **all configured Key Events** as per-user columns (created-on cohort), and win
    rate is single-basis (cohort won ÷ cohort leads) — no more 100% artefacts.
  - **Drill-downs (click to sense-check live):** Won counts, per-user closed, revenue
    cells and lost reasons open the actual deals — contact, **lead-created date**,
    **won/lost date**, value, source, pipeline/stage, owner. Screen-only (not in PDF).
  - **New Lost Reasons slide** — deals lost this month by reason, click-through to the
    deals, with value lost and win rate.
  - Fixed 360 "Cost / won" to paid basis (was paid spend ÷ all-source wins), and
    labelled the two different "leads" (ad results vs CRM leads created).
  - Backend: new `monthlydeals` scope + `monthlyDeals()` returning won (both bases)
    and lost deal lists with names/dates/source/reason and paid split.

## v3.97.0 — 2026-07-29 · `f2350a7`
- **Monthly Report — trend now matches the headline.** The 6-month trend was pulling
  Meta with a `date` dimension, which splits windowed conversions per day and
  under-counted results (so the June point read $137/result while the headline read
  $101). It now computes each month with the identical per-ad-set rollup the headline
  uses (one fetch per month, no date dimension), so the latest point ties out exactly.
- **Sidebar & Settings polish.** Nav icons are now a single-colour monochrome set
  (they inherit the text colour) with more breathing room at the top and consistent
  spacing. Removed **Present mode** and the sidebar theme toggle; **Light/Dark now
  lives in Settings → Appearance**. The signed-in-user row is slimmed into a quiet,
  blended-in strip instead of a boxed card.

## v3.96.0 — 2026-07-29 · `f84815d`
- **Monthly Report fixes** from first review:
  - **Meta now counts optimised Results, not native leads.** The campaign slide's
    headline (and the 6-month trend) now sum each campaign's own objective result
    (Ads-Manager "Results" — e.g. website conversions + on-Facebook leads together),
    instead of native lead-form leads only, which under-counted website-conversion
    campaigns. The trend backend resolves per-ad-set optimisation per month.
  - **ROAS is now paid-only.** Every ROAS is measured on revenue from deals whose
    lead carried a Meta/Google UTM, not total business — so organic/referral closes
    no longer inflate it (Pool Haus June went from a misleading 42.7x to a true ~18x).
  - **Revenue is always shown as Total vs Paid.** Cover, Caalano360 summary and the
    ROI slide each call out total (all sources) alongside paid-attributed revenue.
    The ROI footnote spells out how much came from untracked sources.
  - **Fixed slides running off-screen.** Creative grid, keywords/search-terms columns,
    trend charts and KPI rows now use shrink-safe grid tracks (`minmax(0,1fr)` /
    auto-fit) so wide content scrolls inside its card instead of overflowing the page.
  - Note: the KPI/ROAS/revenue changes apply to existing snapshots on reload; hit
    **Refresh snapshot** to also rebuild the 6-month trend on the new results basis.

## v3.95.0 — 2026-07-29 · `ae6e95f`
- **New Monthly Report tab — a frozen, slide-based client report with PDF export.**
  Pick a client and a month; **Generate snapshot** freezes that month's numbers
  server-side (Netlify Blobs) so an exported/reopened report never shifts. Deck:
  cover → **Meta** campaign (with a 6-month Spend / Leads / CPL trend) → ad set →
  creative → **Google** campaign → conversion actions → ad group → keywords & search
  terms → **Caalano360** account summary (blended spend/CPL + key-event funnel &
  cost-per-stage) → **team** performance (top performer + per-user funnel) → **ROI**
  (spend vs revenue, ROAS, by channel). Google slides auto-hide with no Google
  account; spend/CPL always show (independent of Present mode).
  - **Won-date attribution:** wins & revenue are counted in the month a deal was
    marked *won* (status-change date, 400-day lookback) — a lead created in January
    but closed in March shows in **March**. Leads/booked/shown stay on lead-created
    date; each block is labelled so the two bases don't blur.
  - **Export:** crisp **Print → Save as PDF** (landscape, one slide per page, scoped
    so the existing Caalano360 export stays portrait) **and** a direct **Download PDF**
    (html2canvas-pro + jsPDF, code-split so it only loads on demand).
  - Backend: new `monthlysnap` (save/read/list), `monthlywon` (won-by-date) and
    `monthlytrend` (6-month Meta spend/leads/CPL) scopes on the windsor function.

## v3.94.0 — 2026-07-29 · `b0eddc4`
- **Sidebar client switcher (GoHighLevel-style).** Added a dropdown pill at the top
  of the sidebar showing the active client (avatar + name + industry subline) with a
  chevron. Clicking it opens a searchable list of **every** client; picking one jumps
  straight to that client's workspace (the Client View). Type to filter by name or
  industry, click-away / Esc to close, and the current client is ticked. Shows for
  admins on all views (placeholder "Select a client" until one is open) and for
  viewers who have more than one report assigned.

## v3.93.0 — 2026-07-28 · `eb9855c`
- **Command centre decluttered — fewer, calmer tiles.** Cut ~24 tiles down to ~17
  and dropped a whole group. Each rate now rides as a small line under its number
  instead of being its own box: Booked shows "68% booking rate", Shown "5% show
  rate", Won "3% conversion", Revenue "avg $67k · 35.9x ROAS". Open now + open
  value merged into one **Open pipeline** tile (count · value), Lost + lost value
  merged into one **Lost** tile. The Pipeline & revenue group is now a tidy two-row
  block — the funnel (Opportunities → Booked → Shown → Won) on top, the money
  (Revenue, Open, Lost, Close rate) below. Every tile stays clickable to its drill.

## v3.92.0 — 2026-07-28 · `2efe0fc`
- **Fixed the command-centre opportunity count mismatch.** The scorecard tiles
  were reading the health engine's lead count (a narrower, deduped basis) while
  the drills and funnel counted every opportunity — so "Opportunities" showed 42
  but the drill showed 74. All command-centre CRM tiles (Opportunities, Booked,
  Won, Revenue, Open, Lost) now read from the same per-opportunity feed the drills
  use, in both All and channel views, so the tile, the funnel's Leads anchor and
  the drill always agree (and paid filters correctly to the paid opportunity
  count). This also fixes the key-event reach / funnel steps reading over 100%.
  The now-inconsistent "vs prev" deltas were removed from those tiles (ad spend
  keeps its delta).
- **Calendar drills now show real names instead of "Lead".** buildCcDrill resolves
  a booked contact's name from the appointment event itself (and any opportunity
  in the wider window), so people who booked but had no in-period opportunity are
  no longer all labelled "Lead".

## v3.91.0 — 2026-07-28 · `427da30`
- **The Caalano360 channel filter now re-pivots the whole drill layer.** Selecting
  All / Paid / Non-paid / Google / Meta now filters the **Revenue bottleneck
  funnel**, **Open pipeline by stage**, **Lost reasons**, **Key event reach** and
  every tile drill (opportunities by source, revenue, close rate, bookings) to
  that channel's opportunities — not just the top scorecards. buildCcDrill takes a
  channel and filters the opportunity cohort (calendar bookings are scoped to the
  same channel's contacts). So filtering Pool Haus to **Paid** for the last 30
  days now correctly shows only paid opportunities everywhere — and reads **0**
  where there are none, instead of falling back to account-wide numbers.

## v3.90.0 — 2026-07-28 · `6503bfb`
- **Lost reasons drill now shows each lead's source + opens to their notes.** In
  the Caalano360 Lost reasons view, clicking a reason lists the people lost with
  their **source trail** — opportunity source, channel, UTM source and first-touch
  UTM content (whichever are available) — alongside their form answers. Click any
  lead to expand their **Caalano Systems notes** inline. buildCcDrill now attaches
  the source fields to each lost person.

## v3.89.0 — 2026-07-28 · `1239afe`
- **Open-by-stage deals now show the assigned rep and open to their notes.** Each
  open deal in the bottleneck's Open pipeline by stage list gains an **Assigned**
  column (who owns it), and clicking a lead expands to that contact's **Caalano
  Systems notes** — the same notes drill used on the Users tab. buildCcDrill now
  loads the user list and tags each open deal with its owner + contact id.

## v3.88.0 — 2026-07-28 · `6282c16`
- **Revenue bottleneck reworked into a hybrid drill.** The bottleneck card now
  splits cleanly into two: the **key-event funnel** and a separate **Show rate by
  calendar** card. Below the funnel is a new **Open pipeline by stage** list —
  every stage with deals still in play, clickable to reveal exactly who's sitting
  in it, each with their **lead source** (colour-dotted by channel), value and days
  in stage. Mirrors the per-rep Users drill, but for the whole account.
- **Paid channel view shows cost per stage + next-step conversion.** When the
  command centre is filtered to Paid / Meta / Google, the funnel adds a **Cost**
  column (that channel's spend ÷ everyone who reached the stage) and a **→ Next**
  column (the share who move on to the following step).
- **Key event reach as rates.** The Rates section now lists each of the client's
  selected key events as a percentage of all leads (e.g. Site Visit Booked = 28%
  of leads), with the raw count underneath.

## v3.87.0 — 2026-07-28 · `84c6811`
- **Command Centre — Booked tile now drills into bookings per calendar.** Clicking
  **Booked** in the Caalano360 command centre opens a per-calendar breakdown
  (booked · occurred · shown, with show rate per calendar), and clicking any
  calendar lists who booked in and whether they occurred / showed. Uses the same
  calendar drill already behind the booking-rate and show-rate tiles.

## v3.86.0 — 2026-07-28 · `811de44`
- **Command Centre channel filter now re-pivots every metric.** Previously only a
  few CRM tiles responded to All / Paid / Non-paid / Google / Meta. Now ad spend,
  cost per lead, cost per booked, cost per won, ROAS, booked, shown and all the
  rates (booking / show / conversion / close) all slice by the selected channel
  too. **Cost per won** reflects the channel's paid-attributed wons only (Meta →
  Meta spend ÷ Meta-attributed wons, etc.); non-paid shows no cost figures since
  there's no attributable spend.

## v3.85.0 — 2026-07-28 · `b119962`
- **Appointments — Resulted column on the "Booked ahead" table, clickable.** Each
  lead-time bucket now shows how many resulted, and clicking it drills into that
  bucket's appointments by status (Showed / No-show / Cancelled / Other) plus the
  reporting-gap groups — the same Resulted drill, scoped to the booked-ahead row.

## v3.84.0 — 2026-07-28 · `384abe7`
- **Command Centre — clickable drill-downs, accuracy fixes, channel filter, key-events funnel.**
  - Every metric tile is now clickable: Booking/Show rate → calendars → the people
    who booked; Revenue/Won → the won deals; Ad spend → platform split;
    Opportunities → by source (Paid Social / Paid Search / Organic / …) → the opps;
    Open value → open deals + stage + age; Close rate → per channel → won deals;
    Lost / Lost value → per reason → the people, their pipeline stage **and their
    form answers** (so a "location" loss shows what they typed). Lost-reason rows
    are clickable too.
  - **Accuracy fix:** Cost / lead and Cost / won now use **paid-attributed** spend
    ÷ paid leads / wons (relabelled "(paid)"), with the Meta vs Google split in the
    drill — instead of dividing by all CRM opportunities. These read higher and
    truer. (Still hidden in present mode.)
  - **Channel filter** (All / Paid / Non-paid / Google / Meta) at the top; CRM tiles
    re-pivot by channel, account-wide-only tiles are labelled as such.
  - **Revenue bottleneck** now uses the client's **Key Events** funnel with a
    separate **calendar Show-Rate** bar; falls back to Leads→Booked→Shown→Won when
    no key events are configured.
  - Backend: new `scope=ccdrill` (buildCcDrill) assembles the drill dataset in one
    load; a standalone form-answers helper joins lost contacts to their submissions.

## v3.83.0 — 2026-07-28 · `2c8d3b6`
- **Appointments — status breakdown + reporting-gap detection.** New status row:
  Booked · Occurred · Resulted · Shown · Show rate, where "Resulted" means the
  appointment's status has actually moved out of "confirmed" into an outcome. An
  amber warning flags "N occurred but not resulted — needs status updating" (the
  calls that happened but were never marked showed/no-show), plus the reverse odd
  case. Click **Resulted** to drill into who fell into each status (Showed /
  No-show / Cancelled / Other) and the two reporting-gap groups. Backend adds the
  normalised status, per-status tallies and a per-appointment people list to
  buildAppointmentInsights (additive — the client-update path is untouched).

## v3.82.0 — 2026-07-28 · `7865cdd`
- **Forms tab reworked around Key Events.** The top scorecards now span full width
  and show Forms · Leads · one tile per client Key Event · Revenue (instead of the
  generic Leads/Booked/Shown/Won). The Form performance table swaps its
  Booked/Shown/Won columns for one column per Key Event (count + % of the form's
  leads), and every column is sortable on header click. The charts are reworked to
  "Key events by form" and "Conversion to each key event", with a consistent
  palette. Clients with no key events configured fall back to the old Booked/Won
  view. (Backend: buildForms attaches a per-form people list, cap 120.)

## v3.81.0 — 2026-07-28 · `7706d21`
- **Command Centre — Lost reasons full width, no sideways scroll.** Moved the
  Lost reasons panel to its own full-width card (long reason names wrap) and added
  a Share column. Channel split is now its own card and hides in present mode.

## v3.80.0 — 2026-07-28 · `2514bea`
- **Present mode.** A sidebar toggle that hides agency-internal cost/spend/margin
  figures so the dashboard is safe to screen-share with a client. First pass hides
  the Command Centre's "Spend & efficiency" block; the mechanism (`.x-internal`
  elements shown only when present mode is off) is reusable to tag more internal
  figures across other views. Always starts off so it can't be left on by mistake.

## v3.79.0 — 2026-07-28 · `4f8485d`
- **Collapsible sidebar.** A « toggle collapses the left nav on desktop to give
  the main screen more room; a » button brings it back. The choice is remembered.
- **Users drill-down fits the panel.** The expanded rep detail no longer inherits
  the wide leaderboard's scroll-width and run off-screen — it's pinned to the
  left and clamped to the visible area (and adapts when the sidebar is collapsed).

## v3.78.0 — 2026-07-28 · `58a0fbb`
- **Caalano360 pared back to a clean command centre.** Removed the business-health
  gauge + pillar breakdown (and with it the "Build trend history" 504), the
  Forecast panel, and the AI executive summary. The command-centre metrics are
  now grouped into labelled sections (Spend & efficiency · Pipeline & revenue ·
  Rates). Priority actions are rebuilt to read straight from the CRM + spend data
  (cost-per-lead moves, low show/booking rates, deals lost + top reason, open
  pipeline to chase, no-wins-yet) instead of health pillars. "By pipeline" only
  shows when a client runs more than one pipeline.

## v3.77.0 — 2026-07-28 · `c9a308e`
- **Forms — answer drill-down + per-client Key Events funnel.** Click any form
  answer to expand the list of people who gave it: name, status (won/lost/open),
  the pipeline stage they're at, opportunity value, days in stage, booking detail
  (which calendars, and whether the call occurred/showed) and the channel that
  brought them in. Click a person to read their Caalano Systems notes inline.
  The answer table also carries the client's own **Key Events** as funnel columns
  (for Pool Haus: Booked Pool Specialist Call → Shown + Site Visit Booked → Site
  Visit Shown → Quote Sent → Won), driven by each client's configured key events
  so it adapts automatically. (Backend: buildForms attaches a per-answer people
  list, capped at 80; fetchAppointments additively carries per-contact calendar
  detail.)

## v3.76.0 — 2026-07-23 · `4ab38f6`
- **Caalano360 tab is now a CRM + spend command centre.** Replaced the old KPI
  strip with a full control centre that pivots the whole of Caalano Systems on
  the selected range: total ad spend, opportunities, cost per lead / booked /
  won, booked, won, revenue, average deal value, ROAS, open (count + value),
  lost (count + value), booking rate, show rate, conversion rate and close rate.
  Added a **Lost reasons** breakdown (reason, deals, value), a **Channel split**
  (Meta vs Google spend + leads), and a **By pipeline** table. The health gauge,
  forecast and AI summary stay on top as the glance; the other tabs remain for
  deeper dives. Removed "Qualified" from this view (scorecard and the bottleneck
  funnel). No backend change — the lost value/reasons come from the existing
  Users feed, aggregated client-side.

## v3.75.0 — 2026-07-23 · `6043312`
- **Client Update now reads the whole client profile.** The generator pulls in
  every tab's data, not just spend + pipeline: Location (where leads and the
  booked/won ones come from), Appointments (booking lead time, self vs
  staff-booked, show rate, downstream wins), Timing/speed-to-lead (typical
  response time and the book-rate gap between fast and slow follow-up), Cohorts
  (whether newer lead cohorts are converting better or worse), and Forms (which
  offer pulls the best-converting leads). It's fed as background so the AI has
  the full picture, but instructed to surface only the one or two most valuable
  insights (often as a smart client question), keeping the email tight.

## v3.74.0 — 2026-07-23 · `300b9d3`
- **Client Update — rewritten to sound human and drive replies.** The generator
  prompt was overhauled: a "trusted operator" voice (lead with the story, every
  number gets a "so what", have a point of view), the AI now interprets and
  recommends rather than just restating figures, and a hard ban-list of AI-tell
  phrases/words. The old "what we're doing next" is replaced by a consultative
  closing that asks the client 2-3 specific questions to earn a reply (e.g. are
  the cheap, well-booking leads turning into good conversations — and only then,
  as a joint decision, explore leaning in). Never assumes budget can be moved.
  Stops calling the client's customers "jobs". Feeds in stalled deals (open, no
  movement 30+ days, from the Users data) so it can ask informed questions about
  where deals are stuck.

## v3.73.0 — 2026-07-23 · `8d306a7`
- **Meta Insights — Opportunity score tab (live from the Graph API).** Meta's own
  0–100 account health score per client, with its top recommendations ranked by
  expected point lift (e.g. "Maximise qualified leads · +4 · 24% lower cost per
  quality lead"), each linking into Ads Manager. Backend `scope=opportunity`
  calls the Graph API with a stored System User token (`META_SYSTEM_TOKEN`, env
  var, read-only). Shows a clear setup banner until the token is configured.
  This is the first tab that pulls *from* Meta (the webhook pushes *to* us).

## v3.72.0 — 2026-07-23 · `f50d4e9`
- **Meta fatigue tab — show subscribed-but-quiet accounts.** Previously only
  accounts that had already sent a webhook event appeared, which made it look
  like the others weren't connected. Added an "Awaiting Meta's first event"
  panel listing the remaining Meta clients, so you can see the full picture:
  a card shows once Meta pushes an account's first event; everything else waits
  in the panel until then.

## v3.71.1 — 2026-07-23 · `a83f32b`
- **Webhook receiver panel is now collapsible** — it starts collapsed to a single
  status line (green dot + "events received" + count) and expands on click to
  show the recent-events table, so it stays out of the way.

## v3.71.0 — 2026-07-23 · `916665c`
- **Meta Insights — Ad recommendations tab.** New sub-tab that surfaces Meta's
  own `ad_recommendations` webhook events (already streaming in once the field is
  subscribed), grouped by client, newest first, with whatever detail the payload
  carried. Backend `scope=recommendations` reads them from the webhook store.

## v3.70.0 — 2026-07-23 · `2a5dc81`
- **Meta webhook — live connection status panel.** The "Creative fatigue · Meta"
  tab now shows a receiver-status card that lists every event Meta has sent
  (test or real), so you get instant confirmation the pipe works — even for test
  events whose placeholder account id doesn't map to a client. Backend
  `scope=webhookstatus` lists the stored events across all accounts.

## v3.69.1 — 2026-07-23 · `c395428`
- **Fix: Meta webhook was blocked by the site auth gate.** The `auth` edge
  function refuses any `/.netlify/functions/*` call without a login cookie, which
  also blocked Meta's server-side webhook verification (it has no cookie).
  Added `/.netlify/functions/meta-webhook` to the edge function's `excludedPath`
  so Meta can reach it. The endpoint still secures itself with the
  `X-Hub-Signature-256` HMAC check, so it's safe to leave un-gated.

## v3.69.0 — 2026-07-23 · `2a009ff`
- **Meta creative-fatigue webhook receiver.** New `meta-webhook` Netlify
  function that accepts Meta's official `creative_fatigue` push events: it
  answers Meta's verification handshake, verifies each POST's `X-Hub-Signature-256`
  against `META_APP_SECRET`, and stores each ad's latest verdict in Netlify Blobs.
  - *Read path* — `scope=fatiguewebhook` in windsor.mjs reads the stored verdicts
    for a client's Meta account and joins ad ids to names/thumbnails.
  - *UI* — the "Creative fatigue · Meta" sub-tab now renders real data: a clear
    "not receiving events yet" setup banner until connected, then per-account
    cards with Meta's Low/Med/High beside our proxy on the neighbouring tab.
  - *Docs* — `META-WEBHOOK-SETUP.md` walks through the Meta App, System User,
    webhook wiring, per-account subscription commands and App Review.
  - Requires two env vars (`META_VERIFY_TOKEN`, `META_APP_SECRET`) and a Meta App
    with App Review to cover all client accounts; the proxy tab covers everyone
    in the meantime.

## v3.68.0 — 2026-07-23 · `a041e27`
- **Creative fatigue — smarter scoring (fewer false flags).** Fatigue now
  requires genuine wear — rising frequency and/or a falling CTR — before a
  creative is flagged Watch/Fatiguing. A below-average quality ranking no longer
  triggers a flag on its own (it's a relevance signal, not fatigue); it can only
  *escalate* a creative that's already declining. The CTR-trend now needs a real
  baseline in both halves of the window, so low-spend creatives stop throwing
  bogus "▼100%" drops. Net effect: the Watch/Fatiguing counts drop to creatives
  that are actually tiring.
- **Meta Insights — two fatigue sub-tabs.** "Creative fatigue · proxy" (our live
  read, unchanged) and "Creative fatigue · Meta" — a placeholder for Meta's
  official webhook signal that explains what unlocks it (a Meta App with a System
  User token + App Review) and will show Meta's verdict beside the proxy once
  connected.

## v3.67.0 — 2026-07-23 · `1b71b57`
- **Meta Insights hub.** New left-nav "Meta Insights" tab that gathers
  everything Meta-derived into one place, sub-tabbed like the client workspace.
  The standalone "Meta Creative Fatigue" tab moved in here (Cockpit fatigue
  badges stay where they were).
  - *Delivery health* (new) — every active Meta client compared to the equal
    prior window: cost per lead, click-through rate, frequency and
    spend-vs-leads movement, plus delivery stalls and any ad spending with zero
    leads. Clients needing attention float to the top. Computed live from
    Windsor data — no Meta App required. (`scope=anomalies` in windsor.mjs.)
  - *Creative fatigue* — the agency-wide fatigue board, now a sub-tab.
  - *Benchmarks / Opportunity score / Ad Library* — placeholder sub-tabs that
    explain what unlocks them (a Meta App with a System User token), so the
    roadmap is visible in-product.
- **Creative Cockpit — fatigue is now its own sortable, filterable column.**
  Moved the fatigue signal out of the creative name into a dedicated column with
  a filter (Fatiguing / Watch / OK / No signal) and sortable by severity.

## v3.66.0 — 2026-07-23 · `8f35ef7`
- **Meta Creative Fatigue.** A new left-nav tab that scans every active Meta
  client for tiring creatives, plus inline fatigue badges in the Creative
  Cockpit. The signal is computed live from Meta delivery — **frequency**
  (impressions ÷ reach), **CTR decline** across the first vs second half of the
  window, and Meta's **quality ranking** — scored to **High 🔥** (refresh now),
  **Medium 👀** (watch) or ok, each with the reasons behind it.
  - *Agency tab* — one card per Meta client, clients with a live signal floated
    to the top, each listing its fatiguing creatives with thumbnails (hover to
    zoom), frequency, CTR trend arrow and quality ranking.
  - *Cockpit badges* — every creative row shows its fatigue chip; a "Fatiguing"
    scorecard tile summarises the client; the expanded row spells out the signal
    and suggests a fresh variation.
  - *Settings → Creative fatigue* — one shared set of thresholds (frequency,
    CTR-drop and a minimum-impressions noise filter) applied across all clients,
    saved to the shared settings blob.
  - Note: this is our on-platform *proxy* for fatigue. Meta's official
    `creative_fatigue` webhook is push-only and needs a Meta App with App Review;
    this reproduces the same signals from data we already pull.

## v3.65.0 — 2026-07-23 · `b95dcfe`
- **Client context / notes** on the Client Update page. A free-text field where
  you record background about a client (their business, tone to use, what they
  care about, current focus, sensitivities, offers, relationship notes). It's fed
  into the update as **background to guide tone and framing** — with a hard
  guardrail that it is never treated as a metric and can't override or invent
  numbers. Saved per client to the shared settings blob (so it lives in Settings)
  but editable right here on the comms screen.

## v3.64.0 — 2026-07-23 · `6d9bcaa`
- **Client Update — call out the channel split when two channels run.** When a
  client runs both Meta and Google in the period, the supporting dashboard now
  splits the headline into **Meta leads / Meta cost-per-lead** and **Google
  conversions / Google cost-per-conversion** as separate tiles (so each matches
  its own platform exactly), with a note that Google conversions aren't always
  the same as a form lead, plus the blended combined figure. The email's Quick
  Summary now explicitly breaks out the Meta vs Google split too. Single-channel
  clients are unchanged (one combined leads/cost-per-lead view).

## v3.63.1 — 2026-07-23 · `818062b`
- **Fix: ad thumbnail preview was being clipped** by the table's scroll
  container. The hover preview now renders as a fixed overlay positioned from the
  thumbnail, so it sits over the top of everything (and flips below the thumbnail
  when there isn't room above).

## v3.63.0 — 2026-07-23 · `1cf9223`
- **Supporting dashboard — drill-down + thumbnails + booking attribution.**
  - **Click a campaign or ad set** to expand the ads inside it, each with a
    thumbnail; **hover a thumbnail** to see a larger preview. Top creatives now
    show thumbnails too.
  - **"Which ads drove the N booked calls"** section: traces the bookings back
    through the lead UTMs. Where a `utm_content` matches a live ad (by name or
    creative ID) it's named; unmatched values are shown as-is, which reveals when
    tracking uses ad IDs or a different naming scheme — the reason some ads read
    0 booked. If the booked leads carried no UTM at all, it says so plainly (a
    tracking gap to fix), rather than silently showing zeros.
- **Client Update email reordered high-level → drill-down:** Quick Summary →
  Attendance & Wins → **Segments** → **Pipelines** → **Top Performing Ads** (most
  granular, last). Segments now include **booked calls** where the figure is
  available.

## v3.62.0 — 2026-07-23 · `c4ec54a`
- **"The numbers behind this update" dashboard** on the Client Update page.
  Loads with the selected client + date range and shows every figure the update
  is built from, so you can see how it all connects:
  - **Scorecards** on the standard basis: ad spend, ad-reported leads (Meta +
    Google, matches Ads Manager), cost per lead, booked calls, cost per booked,
    won, revenue, plus the appointment breakdown (attended / no-show / upcoming /
    reporting gap).
  - **Pipeline view** per pipeline: a funnel of where open deals are sitting, in
    stage order, with leads / booked / won / revenue.
  - **Meta Ads** consolidated tables: Campaign → Ad set (segment) → Creative, with
    spend, leads, cost per lead, booked and cost per booked (bookings blended in
    by UTM).
  - **Google Ads** tables (Campaign → Ad group) where the client runs Google.
  - **User performance**, **lost reasons**, and the sampled **non-booker notes**.
  - The page now loads all data once; Generate reuses it (faster, and the message
    and its evidence always match).

## v3.61.2 — 2026-07-23 · `667985b`
- **Fix: Client Update lead count + cost per lead now reconcile with Ads
  Manager.** The headline "leads" was using the CRM opportunity count (every
  source) but dividing it against Meta-only spend, so cost per lead came out low
  (e.g. 85 leads / $46 instead of Meta's 66 / $59). The update now uses the
  **ad-reported lead count** (Meta + Google, matching Ads Manager) for the
  headline leads and cost per lead, with the vs-previous delta on the same basis,
  and reports the CRM opportunity total separately and clearly labelled.
- **Fix: email is now plain text for clean copy-paste** — no Markdown asterisks
  or hash headings; section titles are plain lines and lists use simple hyphens.

## v3.61.1 — 2026-07-23 · `ab95ad1`
- **Fix: Client Update sometimes returned the old saved copy instead of a new
  one.** The generator asked Claude for a JSON object, but the multi-line email
  body produced literal newlines that broke `JSON.parse`, so generation failed
  silently and the UI fell back to the last saved update. Switched to a robust
  marker-based output format (`###SUBJECT/EMAIL/WHATSAPP###`), raised the token
  budget so the two-version output can't truncate, and made a failed regenerate
  say so clearly instead of looking like the same response.

## v3.61.0 — 2026-07-23 · `d8a83dd`
- **Client Update — depth pass from feedback.** New `scope=updateextra` +
  `buildUpdateExtra` feed the generator much richer, honest context:
  - **Attendance honesty:** a low "attended" is now explained properly — how many
    calls are **still upcoming** (can't have shown yet), how many were **no-shows**,
    and a **reporting-gap flag** when deals were advanced past the show stage in the
    pipeline but the appointment was never marked attended (team moved the deal,
    didn't tick the calendar). No-show stages are treated as genuine no-shows.
  - **No wins in context:** pulls the average lead-to-close time; if the period's
    leads are more recent than the typical close time, it states that no wins yet
    is expected, not a concern.
  - **Lost-reason trends** for the period are surfaced and called out.
  - **Non-booker cause detection:** for a poor lead-to-booking rate, it samples the
    notes on leads who didn't book and adds one tactful, themes-only observation
    (no names, no quotes).
  - **Richer Top Performing Ads** (leads, cost per lead, booked, cost per booked);
    the separate ad-set list is gone, replaced by a **Segments** section grouped by
    named audience (Health Professionals, Borrowing Capacity, Buyers Advocacy).
  - **Email restructured** with a "Quick Summary" heading; **pipeline stages now in
    funnel order**; comparisons name what they're vs; **no clichés/idioms**
    ("punching above its weight" etc. banned); date range referenced casually.
  - Booked calls confirmed as **Caalano Systems bookings attributed by UTM** (not
    Meta's schedule metric). Still strictly grounded in computed data.

## v3.60.0 — 2026-07-23 · `d831c98`
- **Client Update — per-pipeline + ad-set segmentation.**
  - **Per-pipeline commentary:** for clients with more than one pipeline (e.g.
    Finr's Buyers Advocacy + Finance), the email now gives a dedicated section
    per pipeline; the WhatsApp mentions each briefly. Where a pipeline has **no
    wins**, it reports how many leads/bookings came through and **where the open
    deals have got to** (naming the stages deals are sitting at), rather than
    glossing over it.
  - **Ad-set segments:** identifies sub-campaigns automatically from ad-set names
    (e.g. "Health Professionals" vs "Borrowing Capacity") and gives a per-segment
    insight on leads/bookings. Backend now returns ad-set `segments` (spend +
    leads + booked + won via `utm_medium`) and per-pipeline funnels + open-by-stage.
  - **Casual date range:** the period is referenced naturally ("over the last
    month") rather than as raw dates, so it doesn't read as AI-generated.
  - Still strictly grounded: only computed figures are used, nothing invented.

## v3.59.0 — 2026-07-23 · `70be54b`
- **Client Update generator (new left-nav module).** Pick a client + date range,
  add their first name, and generate a client-ready account update in two
  formats side by side: a **casual WhatsApp** message and a **formal, structured
  email** (with subject line), each with copy buttons. The last update is saved
  per client.
  - Pulls the client's **computed** results for the period — spend (Meta/Google
    split), leads, booked calls, shows, deals won, revenue, cost per lead /
    booked call / won, open pipeline, run-rate forecast, and the **best-performing
    ads** (by leads + booked calls).
  - Invites the client to reply with feedback on lead quality, how the business
    is tracking, and any wins.
  - Australian spelling, no em dashes, addressed by first name, from Caalano
    Digital. **Only uses computed data** — the AI is instructed never to invent,
    estimate or add any figure, claim or insight not in the payload. Staff only.

## v3.58.0 — 2026-07-22 · `6e644a5`
- **Creative Cockpit headline metric → cost per booked call** (replaces cost per
  qualified lead). "Booked" is now the concrete, per-pipeline definition used
  across the platform: a lead counts as booked if it has a calendar booking in
  period, OR its opportunity reached that pipeline's booked-call stage, OR it was
  won — read from the pipeline each lead actually landed in (no reliance on the
  campaign→pipeline link). The grid, scorecards, "what's working" rollup and AI
  strategy all now rank on cost per booked call. (Qualified-lead was ambiguous
  across clients with no consistent stage; booked is unambiguous.)

## v3.57.1 — 2026-07-22 · `f6daf20`
- **Creative Cockpit polish + fixes:**
  - Client selector is now a **dropdown** at the top (matching Weekly Traffic
    Light) instead of a chip row.
  - **Fixed horizontal overflow** — the creative grid now scrolls inside its own
    box instead of pushing the whole page off-screen; long creative names
    truncate with a hover tooltip. (Added global `.tbl-scroll` containment.)
  - **One row per creative** — creatives that run across several ad sets are
    aggregated by name (spend/leads total correctly; no duplicate rows).
  - No-link (on-Facebook) ads default their destination to **"Meta Lead Form"**.
  - Note: isolating performance by individual lead-form type needs Windsor's
    separate `facebook_leads` (lead-level) connector — the Meta insights feed
    we use carries lead counts but no form identifier. Tracked as a follow-up.

## v3.57.0 — 2026-07-22 · `9bb9cb7`
- **Creative Cockpit auto-fill (Windsor fields confirmed).** Verified the Meta
  connector's creative fields and wired auto-detection: **CTA button**
  (`call_to_action_type`), **ad copy** (`body`), **headline** (`title`) and
  **destination** (classified from `link_url` → Meta lead form / Schedule page /
  Caalano Systems landing / Landing page). These pre-fill each creative (marked
  "auto"); a manual edit overrides. The ad-preview link now uses Meta's
  shareable preview URL. So the grid, filters and "what's working" rollups work
  before any manual tagging.
- Removed the sidebar footer line ("Live data via the Meta and Google API …").
- Note: Windsor's Meta feed exposes **no direct video-file URL**, so automated
  video transcription still needs a Meta Graph API path (via `creative_id`) or
  Instagram media URL plus a speech-to-text provider — tracked as a follow-up.

## v3.56.0 — 2026-07-22 · `084a321`
- **Creative Cockpit — AI layer.** Two AI helpers (existing Anthropic
  integration, server-side key):
  - **Suggest tags** per creative: Claude reads the ad's copy / CTA / format and
    proposes awareness stage, persona and angle (reusing the client's existing
    labels), dropped into the editor for you to confirm or override.
  - **AI creative strategy**: a briefing over the whole tagged + performance set
    — what's working by angle / persona / format, what to cut, and concrete new
    concepts to test. All figures are computed here; Claude only interprets them.

## v3.55.0 — 2026-07-22 · `98a184e`
- **Creative Cockpit (new left-nav hub).** Every Meta creative for a client in
  one grid, joined to the real lead funnel behind each ad (leads → qualified →
  booked → won, matched by `utm_content`), so creatives can be ranked by cost
  per qualified / booked / won.
  - **Fillable categorisation columns per creative** — awareness stage (Unaware →
    Most-aware), persona, angle, destination, CTA button, ad copy, notes. Format
    (image/video) is auto-detected. Values **save to the client** and any new
    persona / angle / destination is **remembered in a reusable dropdown** for
    next time (native combo: pick a saved value or type a new one).
  - **"What's working" analysis** — roll every creative up by awareness / persona
    / angle / format / destination and rank each by cost per qualified lead, to
    see which parts of the funnel and which angles perform.
  - Filters (awareness/persona/angle/format/destination/search), sortable
    performance columns, thumbnail preview, and a link to view each ad on
    Instagram. Placed as a top-level "Creative Cockpit" menu item (pick a client,
    then drill in); staff only.
  - Backend: `scope=creatives` (Meta ads + per-creative CRM funnel via a new
    `buildCreativePerf`) and a `scope=creativefields` probe to confirm which
    creative fields (CTA, copy, destination link, video URL) Windsor exposes.

## v3.54.1 — 2026-07-22 · `a680a12`
- **Location map colours retuned:** Leads = yellow, Booked = blue, Won = green,
  Lost = red (legend and markers updated to match).

## v3.54.0 — 2026-07-22 · `6617497`
- **Location map — new colour scheme with Lost.** Open leads are now **blue**
  (was red) and **lost** leads are **red**, alongside amber = booked and green =
  won. Added a **Lost** filter to the map's Show toggle and a Lost count to the
  legend, location scorecards, popups and the ranked list. Lost is now tracked
  per location in the forms feed (backend). Marker colour = furthest milestone
  reached (won > booked > lost > open lead). Applies to both the Location tab
  and the per-form location map.

## v3.53.0 — 2026-07-22 · `d7537b6`
- **New Location tab.** A dedicated, full-height interactive map (same Leaflet /
  OpenStreetMap base as the Forms map, with suburb names and zoom/pan) showing
  where every lead is located, aggregated across all of the client's forms.
  Markers are coloured by outcome — **red = lead, amber = booked, green = won** —
  and sized by lead volume; a Show filter isolates Leads / Booked / Won. Above
  the map: scorecards (locations, leads mapped, booked, won) and a ranked list
  of every location with its lead/booked/won counts. Reuses the existing forms
  feed (which already carries per-answer location + outcomes), so no new backend
  call. Shows a clear empty state when no form in the period captured a location
  field. Available to viewers via the per-tab allocation control.

## v3.52.0 — 2026-07-22 · `3633548`
- **Revenue bottleneck analysis** added to the Caalano 360 executive tab: the
  whole-account funnel (Leads → Qualified → Booked → Shown → Won) with the step
  conversion rate at each stage, flagging the single biggest drop-off as the
  bottleneck — where a small improvement moves the most revenue.
- **Simplified the executive tab.** Removed the collapsible "Full Caalano 360
  breakdown" (the old blended campaigns/pipelines/per-rep view) so the tab is
  just the executive dashboard. The detailed paid/CRM breakdowns remain on the
  Meta Ads, Google Ads, Users and Cohorts tabs.

## v3.51.2 — 2026-07-22 · `13d43e2`
- **Executive KPI scorecard now spans the full width.** The seven headline tiles
  (ad spend, leads, qualified, cost/lead, booked, won, revenue) stretch evenly
  across the row instead of clustering on the left, stepping down to 4 then 2
  columns on narrower screens.

## v3.51.1 — 2026-07-22 · `cd9c908`
- **Open-deals drill table now fits the modal — no horizontal scroll.** The
  Users open-pipeline drill-down (and the executive Revenue-at-risk table) used
  to overflow sideways because long emails/phone numbers wouldn't wrap, clipping
  the Opportunity column. Switched those tables to a fixed layout with wrapping
  so every column is visible without scrolling, on desktop and mobile.

## v3.51.0 — 2026-07-22 · `7e28f4d`
- **Caalano 360 Executive Dashboard.** The Caalano 360 tab now leads with an
  executive layer; the previous blended breakdown moves into a collapsible
  "Full Caalano 360 breakdown" beneath it (nothing removed).
  - **Business Health Score (0–100)** across four pillars — Marketing, Sales,
    Operations, Revenue — each a small set of real metrics scored against the
    previous equal-length period. Every pillar expands to show its working
    (each metric's actual vs reference and the 0–100 it contributed). Weights
    default to 25/25/25/25 and are configurable server-side (`health` settings
    section). **No AI touches the maths** — it's all plain, explainable calc.
  - **Scalable "qualified lead" definition** that needs zero per-client setup: a
    lead is qualified once a human advances it past the pipeline's entry stage,
    OR it was won, OR it has a booked appointment, OR a deal value was set —
    works on any GoHighLevel pipeline regardless of stage naming. Optional
    per-client stage override is plumbed. Surfaced per-rep in the Users data and
    in the executive funnel/KPIs.
  - **KPI scorecard** (spend, leads, qualified, cost/lead, booked, won, revenue)
    with vs-previous deltas, **run-rate forecast** (projected revenue/leads/won
    vs last period), **Revenue-at-risk** (aged open deals ranked by value, each
    expanding to the contact's notes for "why stuck"), and a **rules-based
    Priority Actions** list (weakest pillar, rising CPL, falling volume/revenue,
    pacing behind — all derived deterministically, no AI).
  - **AI executive summary** (opt-in button) via the existing Anthropic
    integration: Claude receives the already-computed health payload and only
    narrates it into a board-level briefing — it never recomputes a figure, and
    is reminded that unanswered CRM messages don't imply an ignored lead.
  - **Daily health snapshots** (`health-snapshot` scheduled function → new
    `caalano-health` blob) build a real score trend from launch forward on a
    fixed trailing-30-day window; an on-demand `scope=healthbackfill` seeds
    weekly history per client. The header sparkline shows the trend as it fills.

## v3.50.0 — 2026-07-22 · `b35f977`
- **Mobile responsiveness pass across the whole app.** Audited every screen at
  phone widths and hardened the gaps:
  - Segmented filter toggles (All/Paid/Meta/… etc.) now **scroll** instead of
    overflowing their pill on narrow screens.
  - Wide card grids that used a 340–360px minimum (Settings client cards, form
    charts) drop to a **single column** on phones instead of overflowing.
  - Newer components tuned for small screens: the **Users** value cards,
    per-rep funnel (label/step columns tighten), invite fields go full-width,
    and modal footers stack; scorecard / KPI / stat grids step down to 2 → 1
    columns as the screen narrows.
  - Added a mobile-only horizontal-overflow safety net (wide tables, the map and
    charts keep their own scroll containers). Verified the Agency Overview and
    login render cleanly with no sideways scroll at phone width.

## v3.49.0 — 2026-07-21 · `19575fe`
- **Meta results: fix lead-form counts, name the exact optimisation, and show
  all actions on hover.**
  - **Instant Form lead campaigns now count correctly** (were showing 0). Lead-
    gen results use the native Instant-Form + on-Facebook lead count, not the
    website-pixel lead field.
  - **The result-type label now names the specific Meta optimisation** — e.g.
    *Instant form leads*, *Website leads*, *Website schedule*, *Messaging
    conversations* — using the ad set's optimisation goal + destination, matching
    how Ads Manager describes it (instead of a generic "LEAD").
  - **Hover the Results cell** to see **every** conversion action the campaign
    accrued (Instant form leads, Website leads, Messaging conversations, Schedule,
    …) with counts — while the headline number stays the **primary** optimisation
    result. A small "+N" marks how many other actions it also drove.

## v3.48.0 — 2026-07-21 · `8faacfa`
- **Deal notes now render as clean text.** GHL note bodies are HTML; they're now
  converted to readable text (lists → bullets, block tags → line breaks, entities
  decoded) instead of showing raw `<p style=…>` markup.
- **Location map/list merges postcode + suburb duplicates.** Where a postcode and
  its suburb name refer to the same place (e.g. **2110** and **Hunters Hill**),
  they're now combined into a single entry — labelled **"Hunters Hill (2110)"** —
  with their leads/booked/won summed, both in the location list and as one map
  marker (no more overlapping dots for the same spot).

## v3.47.0 — 2026-07-21 · `865b56e`
- **Deal notes in the open-deals drill-down.** In the Users tab, click a stage →
  click any live deal to **expand its Caalano Systems notes** (fetched on demand
  from the contact), newest first with author + date. So when a deal is stuck at
  a stage, you can read the CRM context on *why* right there. Deals with no
  contact link aren't expandable; deals with no notes say so.

## v3.46.0 — 2026-07-21 · `5cb0f22`
- **Lead location map is now a real interactive map.** Replaced the hand-drawn
  Australia outline with a proper **OpenStreetMap** slippy map (Leaflet): pan and
  **zoom right down to street/suburb names**, like Google Maps. Each postcode /
  suburb is a marker **coloured by outcome — red = Leads, amber = Booked, green =
  Won** (the marker takes the furthest outcome), **sized by lead volume**, with a
  click popup showing the leads / booked / won breakdown. A **Show** filter
  toggles All / Leads / Booked / Won, and the map auto-fits to the plotted area.
  Leaflet loads lazily (only when the map is opened), so it doesn't weigh down the
  rest of the app.

## v3.45.0 — 2026-07-21 · `8000a1d`
- **New Super Admin role (owner tier).** Above Admin, with exclusive powers:
  - **Manages Admins** — only a Super Admin can create, promote, demote or remove
    Admins (and other Super Admins). Admins can still manage Users & Viewers.
    A **Super Admin can't be removed, demoted or disabled by an Admin**, and the
    **last Super Admin can never be removed** (no lockout).
  - **Owns client accounts** — only a Super Admin can **add, remove or relink**
    client accounts (connect Meta/Google/Caalano Systems). Admins keep everything
    else: per-client key events, KPIs, conversions, forms, **and diagnostics**.
  - Enforced server-side (auth + settings APIs), not just hidden in the UI. The
    role dropdown only offers Admin/Super-Admin to a Super Admin; unmanageable
    rows show a 🔒 lock.
  - **Your account is auto-promoted:** the founding admin (first account created)
    becomes Super Admin automatically on next load — nothing for you to do.

## v3.44.1 — 2026-07-21 · `1f8e1d2`
- **Users funnel: add total conversion % next to step %.** Each stage in the
  per-rep funnel now shows both **step** (conversion from the previous stage)
  and **total** (conversion from all leads), so you can read stage-to-stage
  drop-off and overall lead→stage rate at a glance.

## v3.44.0 — 2026-07-21 · `f04f612`
- **Users tab: complete open-pipeline view + per-stage deal drill-down.**
  - The per-rep expansion now has an **Open pipeline by stage** panel listing
    **every** stage that has live deals (not just key events), reconciling to the
    rep's total open count/value — so all the "still in play" deals are
    accounted for, wherever their card sits.
  - **Click any stage** to open a popup of the **individual live deals** —
    opportunity name, contact (with email/phone), value, and **days in stage**
    (amber at 30+ days = likely stalled), highest value first. This is the "what's
    still live per person, and can I still capture it" view.
  - The conversion funnel is now purely reached-%; the open/live numbers live in
    the dedicated panel to avoid the earlier confusion where only key-event
    stages showed open counts.

## v3.43.0 — 2026-07-21 · `ab8fc5b`
- **Users tab: pipeline value, open deals per stage, and lost reasons per rep.**
  Expanding a rep now shows:
  - **Value cards** — Total pipeline · **Open (live)** · Won · **Lost** value,
    each with its deal count.
  - **“Open now” on every funnel stage** — how many deals are sitting at that
    stage right now (still in play, not won/lost) **and their value**. So for
    Pool Haus you can see, of the 11 that reached *Quote/Proposal Sent*, how many
    are still open and what they're worth — the live pipeline that can still be
    captured.
  - **Lost reasons per rep** — a table of each rep's lost deals by reason, with
    count and value (pulled from the CRM's lost-reason list).
- **Fixes leaderboard column alignment** — numeric headers and values now
  right-align together (the `mini-tbl` base rule was left-aligning the data).

## v3.42.1 — 2026-07-21 · `d9957ab`
- **Users key-event funnel now follows pipeline order.** The per-rep funnel (and
  the key-events matrix) sort stages by their real pipeline position instead of
  config order, so the cumulative funnel reads top-to-bottom and the step
  conversion % make sense (no more out-of-order stages / >100% steps).

## v3.42.0 — 2026-07-21 · `814b036`
- **Users tab: per-rep key-event funnel + channel filter.**
  - Expanding a rep now shows their funnel across **all of the account's
    configured key events** (Settings → Key events) — Leads → each key stage →
    Won — instead of the fixed Leads/Booked/Shown/Won, with step conversion %.
  - New **All / Paid / Non-Paid / Meta / Google** filter scopes every rep's
    leads by their **first-touch UTM** channel.
  - **Ad spend is scoped to the channel** you pick (Meta spend for Meta, Google
    for Google, both for Paid, none for Non-Paid), and Cost/Won uses that. Note:
    ad spend still can't be attributed to an *individual* rep (spend isn't caused
    by a rep), so Cost/Won stays a blended channel-spend ÷ rep-wins figure —
    now correctly scoped to the selected channel.
- Fixes the Users tab crash ("Invariant failed") from a chart axis mismatch.

## v3.41.0 — 2026-07-21 · `ede8b38`
- **Meta results now auto-detect each campaign's optimisation event.** The Meta
  tab reads every ad set's **optimisation goal + promoted object** (from Windsor)
  and reports its *own* result — so a **Schedule** campaign shows Schedule
  results and a **Leads** campaign shows Leads, side by side in the same account
  (matching Ads Manager). The campaign & ad-set tables now show **Results** (with
  a small result-type chip) and **Cost/result** in place of the fixed Leads/CPL;
  the Meta scorecard shows the account **Results / Cost per result**, and when ad
  sets optimise to different events the total is a per-type breakdown (e.g.
  "24 Schedule · 2 Lead") rather than a misleading single number. Custom-
  conversion campaigns fall back to the client's configured **primary** (Settings
  → Meta conversions), then to Leads. (By-form / by-format / creative tables
  still show Leads for now — a follow-up.)

## v3.40.0 — 2026-07-21 · `35a995b`
- **Per-client Meta conversion selection (Settings → Meta conversions).** A new
  tab in each client's Settings that **loads the Meta conversion events that
  actually fired** for that ad account (last 90 days, incl. custom-pixel events
  like *booked appointment* / *booking confirmed*), each with its 90-day count
  and cost-per. Pick one as the **primary result** and tick any **secondary**
  events. Saved to the shared settings store per client. This is the setup step
  so accounts that optimise to e.g. *Schedule* (a booking) can report the right
  result instead of generic “Leads”. (Next: wiring the chosen events into the
  Meta tab’s headline result, columns and cost-per.)

## v3.39.0 — 2026-07-21 · `15b9358`
- **Team & access — edit users in a popup.** The team list is now a clean table
  (Name · Email · Role · Access · Status) with a single **Edit access** button
  per person and a **+ Invite person** button. Both open a **modal** with a role
  dropdown (Admin / User / Viewer) that reveals the matching controls: choose
  **Viewer** and the assigned-clients list + tab permissions appear; choose
  **User** and the account allow-list (with an “all accounts” toggle) appears.
  The modal also holds enable/disable, resend-invite and remove. Same modal is
  used for inviting.
- **Wider ad-account discovery.** The Add-client account explorer now looks back
  **12 months** (was 90 days) so more Meta/Google accounts surface, and the
  **⟳ Refresh accounts** button re-queries live. Note: accounts are read from
  **Windsor** — one that isn’t connected there yet (or has no spend history)
  won’t appear until Windsor has data for it.

## v3.38.0 — 2026-07-21 · `91e33d5`
- **Add a client with just one account + refresh available accounts.**
  - The Add-client explorer now makes clear you only need **one** linked account
    — a **Meta-only** (or Google-only, or CRM-only) client is fine. The client
    **name auto-fills from whichever account you pick first** (previously only the
    Caalano Systems location filled it, so Meta-only clients were left with a
    blank name and a disabled button). Clearer footer guidance on what’s needed.
  - New **⟳ Refresh accounts** button in the Add/Edit-client window re-queries the
    Meta / Google / Caalano Systems connections so a newly connected ad account
    shows up without reloading the app.
- **Staff account restrictions now enforced in agency-wide aggregates** (from the
  role work): a User limited to specific accounts only sees those accounts in the
  agency overview, trends and coverage — filtered server-side.

## v3.37.0 — 2026-07-21 · `629e084`
- **Three-tier roles + client self-signup with admin approval.** The access
  model now has three roles, enforced both in the UI and on the server:
  - **Admin** — full control (all clients, all tabs, settings, users).
  - **User** (agency staff) — dashboards for their **allowed accounts** (all by
    default, or a chosen subset); **can’t** invite/approve users or edit
    settings. Agency Overview/Daily/Weekly scope to their allowed accounts.
  - **Viewer** (client) — sees **only assigned clients**, and within each only
    the **sub-tabs you allow** (e.g. Meta only). No agency-wide views — a client
    lands straight in their own report, navigating between their clients from a
    “My reports” list.
  - **Team & access** gains an **allocation editor** (role + client picker + tab
    picker + “all accounts” toggle for staff) used when inviting, approving, or
    editing anyone, plus an **Edit access** row on every user.
  - **Client self-signup + approval gate.** The login screen has a **“Request
    client access”** link → the client picks a password → a **Pending** request
    is created that grants nothing. Admins see a **Pending approvals** section in
    Team & access; approving sets the role + client/tab allocation and activates
    the account. Reject removes it. No one gets in without an admin.
  - **Server-enforced, not just hidden.** The data API rejects any client a
    caller isn’t allocated (client accounts are fully isolated), and Settings
    writes are admin-only. The Basic-Auth break-glass path keeps full access.

## v3.36.1 — 2026-07-21 · `e70b382`
- **Team & access is now discoverable before you switch logins on.** Settings
  always shows the **Clients / Team & access** sub-tabs. Open **Team & access**
  and — until the login system is enabled — it explains exactly how to turn it
  on (add the `AUTH_SECRET` env var in Netlify), so the setup steps live in the
  app instead of only in chat.

## v3.36.0 — 2026-07-20 · `794dd4e`
- **Proper login screen + multi-user accounts (replaces the shared password).**
  A real email + password sign-in, individual accounts, and team invites — with
  a zero-lockout rollout.
  - **Login / setup / invite screens.** A branded sign-in page (no more browser
    popup); on first run it asks you to create the first **admin** account; an
    **accept-invite** page (opened via a link) lets invitees set their own
    password. Sessions are signed, httpOnly cookies (14-day), so nobody's
    password is ever stored in the clear (PBKDF2-hashed).
  - **Settings → Team & access** (admins). Invite teammates as **Admin** (full
    control) or **Viewer** (sees dashboards, can't manage users/settings),
    change roles, disable or remove people, and **copy a one-time invite link**
    to send however you like. Invites expire in 7 days. **Settings → Your
    account** lets anyone change their own password.
  - **Invites work with no email setup** — you copy the secure link and send it.
    (Auto-emailing the link can be layered on later without changing the flow.)
  - **Safe, opt-in rollout.** The whole system stays dormant until an
    `AUTH_SECRET` environment variable is set in Netlify; until then the site
    behaves exactly as before. Once enabled, the old shared `SITE_PASSWORD`
    keeps working as a break-glass fallback so you can't lock yourself out —
    remove it once everyone has their own login. The edge gate now also keeps
    the baked client data (`/data`) private to signed-in users.

## v3.35.0 — 2026-07-20 · `96bba81`
- **New Users tab (replaces the client's CRM sub-tab).** A full sales-rep
  performance interface for each account, grouping every opportunity by its
  **assigned user**:
  - **Scorecards** — reps with assigned leads, total leads, booked (+ shown),
    won (+ win rate) and revenue (+ ad spend) for the range.
  - **Won & revenue by rep** — horizontal bar chart ranking the top reps.
  - **Sortable leaderboard** — Leads, Booked, Book %, Shown, Show %, Won,
    Win %, Revenue, Avg deal, Avg close (days) and **Cost / Won**. Click any
    column to sort; click a rep row to expand a **Leads → Booked → Shown → Won
    funnel** (with step conversion %) plus a **by-pipeline** breakdown.
  - **Key events reached, per rep** — a matrix of how many of each rep's leads
    reached each configured key pipeline stage (cumulative), driven by the same
    Settings → Key events configuration as the rest of Caalano360.
  - Booked / Shown / Cancelled come from the appointment feed joined on each
    rep's assigned contacts; Won / Revenue from won opportunities. **Cost / Won**
    divides the account's total ad spend by a rep's won deals — a *blended*
    efficiency measure (ad spend isn't caused by the rep), clearly labelled as
    such. Includes an optional **pipeline selector** to scope the whole view.

## v3.34.0 — 2026-07-20 · `9c87439`
- **Full Meta drill-down.** Every level is clickable and filters the levels below
  it *and* the Performance-by-form table: click a **campaign** or **ad set** to
  filter the tables below plus the forms they drove; ad sets are now clickable;
  click a **creative** to see a lineage chip (**campaign · ad set · form**) and
  filter the forms table to the form it drove; click a **form** to filter the
  campaigns/ad sets/creatives (as before). A unified **drill-in bar** shows every
  active filter with individual clears + "Clear all", and the Performance-by-form
  headers are now **sortable**.

## v3.33.0 — 2026-07-20 · `a194d37`
- **Synced horizontal scroll**: scrolling any table in the Meta / Google view
  scrolls them all to the same offset, so the Caalano360 green columns stay
  aligned across the campaigns / ad sets / creatives tables instead of each
  scrolling on its own.

## v3.32.1 — 2026-07-20 · `53c137b`
- Hardened the calendar/pipeline-stage key-event de-duplication (case/whitespace
  normalisation + name-match fallback) so double-ups can't slip through.

## v3.32.0 — 2026-07-20 · `d75e296`
- **No more double-ups between calendars and pipeline stages** in the Caalano360
  green columns and the Key Events funnel. When a calendar is linked to a
  pipeline stage (e.g. Pool Haus's Pool Specialist call), the two now show as a
  **single event labelled by the pipeline stage**, and the count reached is split
  into **how many came from calendar bookings vs from the pipeline stage** (shown
  in the number's marker + hover, and in the funnel bar's "+Np" / tooltip). The
  standalone duplicate stage row/column is dropped everywhere it appears.

## v3.31.1 — 2026-07-20 · `266097a`
- Appointments "Time to book" now shows the **median** (robust to outliers) as
  the headline with the **average** alongside it.

## v3.31.0 — 2026-07-20 · `2fa2a8d`
- **Lead map — smarter & more useful:**
  - **State disambiguation**: the client's dominant state is inferred from the
    unambiguous answers (postcodes + single-state suburbs), so same-named suburbs
    in other states (Richmond NSW vs VIC) resolve to the right one.
  - **Suburb-level precision**: suburb answers now plot at the suburb's own
    coordinates (not just the postcode centroid).
  - **Outcome shading**: a Colour toggle (Volume / Booked % / Won %) colours each
    dot red→green by its conversion rate while dot size stays lead volume — so
    you see where leads come from *and* where they convert.

## v3.30.0 — 2026-07-20 · `a730a1b`
- **Lead map — detailed + auto-zoom.** Swapped the rough outline for a detailed
  Australia map with state borders, and the map now **auto-zooms to fit the
  plotted leads** — a Sydney-only client (e.g. Pool Haus) sees Sydney at full
  size, not the whole country. Dot and line sizes scale with the zoom; a
  "Fit to leads / All Australia" toggle switches between the fitted view and the
  national view. A single location still shows ~2° of context so it isn't
  over-zoomed.

## v3.29.1 — 2026-07-20 · `ebe041a`
- Removed the Agency Overview "Still maturing" summary banner — the per-row badge
  next to each client name already covers it.

## v3.29.0 — 2026-07-20 · `18869c5`
- **Lead map** on the Forms location breakdown: postcode / suburb answers are now
  plotted on a map of Australia (dot size = lead volume), with a ranked list
  underneath and any unmatched answers listed. Self-contained — a bundled AU
  postcode/suburb → coordinate dataset (3,171 postcodes, 16,196 suburbs), lazy-
  loaded only when the section is opened, so it stays out of the main bundle. No
  external map tiles or dependencies.

## v3.28.0 — 2026-07-20 · `810daf3`
- **Speed to Lead — whole-dataset scan:** a "Scan the whole date range" button
  processes every lead in the range (not just a sample), chunked across polled
  requests with a live progress counter, so you can get the complete figure.
- **Speed to Lead — no-messaging fallback:** for clients who don't use the
  messaging channel (e.g. Pool Haus), when a lead has no manual message the
  **first staff-booked appointment** is used as the speed signal instead
  (automated / self-bookings don't count). The tab calls out how many leads used
  this fallback.
- **Forms location breakdown** is now **collapsed by default** behind a "📍 Where
  leads are located" toggle instead of sitting expanded at the top.

## v3.27.0 — 2026-07-20 · `519101a`
- **Appointments tab — more insights:** cancellation % and reschedule % (overall
  and by lead-time bucket, to see if far-out bookings cancel more), a
  **time-to-book** metric (lead in → booked), and a **"when the call is
  scheduled"** card with show rate by **day of week** and by **time of day**.
- **Settings** clients are now sorted **alphabetically** by default.

## v3.26.0 — 2026-07-20 · `724fbff`
- **Appointments tab — big upgrade:**
  - **Pipeline selector** (per-pipeline booking analysis).
  - Channel filter now includes **Paid** and **Non-Paid** alongside All / Meta /
    Google.
  - **Calendar scope**: defaults to the pipeline's **first booking stage**
    calendar(s) (from your key-events config) and names which calendars it's
    based on; click the calendar chips to include others.
  - **Performance by user** table + a **User filter** to scope the whole tab to
    one person (flags bookings where the appointment user differs from the
    opportunity owner).
  - **Momentum / time-to-close**: average days from booking to won per lead-time
    bucket — does booking sooner close faster?
  - Kept the **Occurred** column.
- **Data-maturity notification on Agency Overview**: a banner lists the clients
  whose sales cycle is longer than the selected range (so their Won / Revenue /
  ROAS understate results), in addition to the per-row and client-header badges.

## v3.25.0 — 2026-07-20 · `7699088`
- **Speed to Lead → outcomes by response speed:** a new table on the Timing tab
  shows, for each response-time bucket (under 5 min … over 24 hrs), the leads'
  downstream **Book % / Show % / Win %** — so you can see whether replying faster
  actually converts better.
- **Working hours for Speed to Lead:** set the team's days + open/close time in
  Settings → client → Summary (auto-detected from the client's calendars, with a
  "Use detected" button). When on, response time counts only **business minutes**
  — a lead at 11pm answered at 9am is a fast response, not a 10-hour one. The
  Timing tab shows which hours are applied.

## v3.24.0 — 2026-07-20 · `f11effc`
- **New Appointments tab** (CRM-connected clients) — booking timing & outcomes:
  - **Booking lead time**: how far in advance calls are booked (same-day → 30+
    days), as a bar chart with **show-rate and win-rate lines overlaid**, plus a
    full table — so you can see whether far-out bookings show/convert worse.
  - **Self-booked vs staff-booked**: derived from the appointments API (staff =
    the event carries a user id; self = the contact booked it), compared on
    volume, avg lead time, show rate and win rate.
  - **Channel split** — All / Meta / Google toggle across everything.
  - Show rate is computed only over appointments that have already happened, so
    future-dated bookings don't unfairly drag it down.
  - A "how self vs staff is decided" validation panel lists the booking sources
    seen, so the classification can be sanity-checked per client.

## v3.23.0 — 2026-07-20 · `11e9c94`
- **Settings → Forms tab redesigned** to match the rest of Settings: each form is
  a clean row with a reviewed tick, an inline pipeline dropdown and a notes
  pencil.
- **Auto-assign pipeline to forms:** single-pipeline clients default every form
  to that pipeline; multi-pipeline clients get a name-match **suggestion** (shown
  as a "suggested" chip, never overwriting a saved link). An "Auto-assign N
  suggested" button fills the unset ones in one click.
- **Forms health icon** on each Settings client card (📝) — green once forms have
  been reviewed. Saving a form counts as reviewed even if intentionally left with
  no pipeline.
- **Removed** the contact self-booking **tag audit** from Settings (superseded by
  the appointments-API approach for booked-by-user vs booked-by-contact).

## v3.22.0 — 2026-07-20 · `dbe6b97`
- **Pipeline filter on Meta Ads & Google Ads.** A "Pipeline" dropdown (shown for
  multi-pipeline clients) re-scopes every Caalano360 green column, the key-event
  funnel and calendar bookings to a single pipeline — so a client whose key
  events differ per pipeline (e.g. FINR) now reads accurately instead of blending
  them. Done accurately on the backend: the attribution is recomputed with the
  opportunity set filtered to that pipeline, so bookings, stage reach, won and
  revenue are all that pipeline's alone. Key events are filtered to the pipeline
  too (calendars linked to the same stage already merge into one event). Ad rows
  (spend/impressions) stay fully visible — only the CRM outcomes scope — and all
  drill-downs (campaign → ad set → creative / keyword) keep working.

## v3.21.0 — 2026-07-20 · `bb0dbba`
- **Speed to Lead accuracy fix** (the Finr "everything under 5 min" problem):
  - Anchor the clock on when the **contact entered the CRM** (`dateAdded`), not
    when the opportunity was created — the opp is often made later by a workflow
    or user, which made human replies look instant.
  - A message now counts as **manual only if it carries a user attribution**. An
    instant, user-less "app"-sourced send (an auto-reply / integration) is
    treated as automated, so it no longer inflates the under-5-min bucket.
  - The classification panel now shows **how each message source was classified**
    (manual vs automated) and splits by whether it had a user, plus a new
    **"Load message-level detail"** button that shows, for a sample of leads, the
    actual first outbound messages (source · user · classification · minutes
    after lead-in) so the logic can be verified against reality.
- Forms table: form-name column left-aligned to match the Meta "Performance by
  form" table; reverted the broken lead-share pie to the centered donut.

## v3.20.0 — 2026-07-20 · `1d9d82e`
- **Speed to Lead** — new **Timing** tab on each client (CRM-connected). Measures
  the time from a lead coming in to the **first manual (human) message** sent to
  them, excluding automated workflow / campaign / bulk sends, so it reflects how
  fast a person actually reaches out. Shows median + average, % contacted within
  5 minutes, a response-time distribution, and how many leads have had only
  automation or no outreach at all. Samples the most recent leads' conversation
  history (bounded, so it stays within the function timeout). Includes an
  expandable "how manual vs automated is decided" panel listing the message
  sources seen, so the classification can be sanity-checked per client.
- Forms tab: left-anchored the "Lead share by form" chart (pie left, legend
  right) and packed the chart row from the left so the Forms reporting reads
  left-to-right like the Meta reporting.

## v3.19.0 — 2026-07-20 · `5ae4cb9`
- **Data maturity flag.** The CRM now calculates each client's average time to
  close a deal (lead-created → won) behind the scenes — never shown as a metric.
  Any date range shorter than that cycle **plus a 20% buffer** gets an amber
  "⏳ Still maturing" badge (Agency Overview per client + the client workspace
  header, on every tab), because recent leads haven't had time to convert so
  Won / Revenue / ROAS understate the real result. Hover the badge for the exact
  cycle length, buffer and how many more days to wait.
- **Manual override** in Settings → client → Summary: see the CRM's calculated
  average (and the +20% buffered figure) and override it if the CRM history is
  too short. A warning explains the 20% buffer is always applied on top.
- Settings page now uses the **full screen width** (more client cards per row on
  wide monitors) instead of being capped, so nothing is squished.

## v3.18.1 — 2026-07-20 · `32bc08b`
- Answer grouping now also merges dates written any way (21st August 2026 ·
  21/8/26 · 21/08/2026 · 2026-08-21 · Aug 21 2026) into one day, shown tidily
  (e.g. "21 Aug 2026"); hover shows the raw spellings combined. Postcodes,
  budgets and other free numbers are still never merged.

## v3.18.0 — 2026-07-20 · `37961c6`
- Form answer breakdown is now one question at a time: pick a question/field from
  the selector and see just that question's answers as a horizontal bar chart
  (Leads / Booked / Won) + a table with % of leads — instead of every question
  stacked on one screen.

## v3.17.0 — 2026-07-20 · `32d40bb`
- Forms edited in ONE place: Settings Forms tab is now just form names + pipeline
  link; the client Forms view shows pipeline/description read-only with a pencil
  that opens the same form-settings modal.
- Forms view visuals: lead-share donut, funnel-by-form and conversion-rate bar
  charts, plus the full table.
- Answer grouping: similar text answers merge (case / spacing / punctuation +
  AU state abbreviations like NSW = New South Wales); hover shows what each group
  combines. Numeric answers (postcodes, budgets) are never merged.

## v3.16.0 — 2026-07-20 · `0093412`
- Forms: link each form to a pipeline and add free-text notes (e.g. "testing
  higher qualification") — editable in Settings (new Forms tab) and on the
  client's Forms tab; a pipeline chip + notes marker show on the form row.
- Auto-description: expanding a form lists the questions it asks, to identify it.
- Pipeline filter on the Forms view (multi-pipeline clients) recategorises the
  table by where each form's leads landed.
- Location breakdown: postcode / suburb answers ranked by lead count (+won),
  the data behind a future map view.
- Use Caalano's actual logo for the CRM setup-health icon.

## v3.15.0 — 2026-07-20 · `7b56181`
- Fix: opening a UI-added client (e.g. Dashing Ducks) from the Overview showed a
  blank screen. Its meta/google are account-id strings (not the baked metrics
  objects snapshot clients have), which crashed clientTotals/OverallTab - both
  are now shape-safe. The client workspace also receives the merged config so
  its Google / Cohorts / Forms tabs appear.
- Added an error boundary around every view: a render error now shows a message
  with a "Back to overview" button instead of blanking the whole app.

## v3.14.3 — 2026-07-20 · `887354c`
- Setup-health strip uses real brand logos (Meta, Google Ads, and Caalano's own
  favicon for CRM) via each site's favicon; the config checks (key events,
  calendars, KPIs, diagnostics) keep simple icons. Falls back to the text label
  if a logo can't load.

## v3.14.2 — 2026-07-20 · `cc1fca1`
- Setup-health strip spans the full card width (equal cells, same width as the
  Edit button) and each icon now carries a short text label under it, so the
  status is legible even if an emoji doesn't render. Swapped to widely-supported
  emoji (📇 CRM, 📡 Diagnostics).

## v3.14.1 — 2026-07-20 · `eeed5c1`
- Settings cards simplified: just the client name + the setup-health icons
  (account IDs moved off the preview into the Edit modal). Icons switched to
  emoji that render everywhere, shading removed — each is a logo with a green ✓
  / red ✗ / amber ● underneath, and a hover tooltip explaining what it is.

## v3.14.0 — 2026-07-20 · `de9349a`
- Settings cards show a compact **setup-health strip** — Meta / Google / CRM /
  Key events / Calendars / KPIs / Diagnostics as green ✓ · amber ! · red ✗
  icons, with a legend, so you can see each client's status at a glance.
- Relinking a client now **busts the CDN cache** on its blend/attribution/
  calendar responses (via an account-signature cache-buster), so a fixed link
  (or a newly app-installed CRM location) pulls fresh pipelines/stages
  immediately instead of serving the stale empty response for ~10 minutes.

## v3.13.0 — 2026-07-20 · `1864b5a`
- Client config modal redesigned with **horizontal tabs** (Summary · Key events ·
  Campaign links · KPI targets · Diagnostics) — content opens full-width under
  the tab instead of stacking.
- **Summary** tab: edit name / description-industry and see + edit linked
  accounts (Meta / Google / Caalano Systems) in one place.
- KPI targets are now **per pipeline** for multi-pipeline clients: pick a
  pipeline, then set every target (channel costs, weekly targets, per-stage
  lead goals) for it. Single-pipeline clients are unchanged.

## v3.12.0 — 2026-07-20 · `f57ec01`
- Settings client management: account **names** now show next to every Meta /
  Google / Caalano Systems id (resolved from discovery) so mis-links are obvious.
- Client card is now a single **Edit** (pencil) button; the config modal has an
  **Open Client View** button top-right.
- Config modal: edit the client **name** and **description / industry**, and
  **Relink accounts** (fix a mis-linked CRM/Meta/Google) or **Remove** the
  client. Add-client auto-fills the name from the chosen Caalano Systems location.

## v3.11.0 — 2026-07-20 · `1934ad9`
- Settings: **Add client** explorer — discover Caalano Systems (GHL) locations
  via the API plus the Meta / Google ad accounts Windsor can see, link one of
  each, and the new client is saved to the shared store and merged into the
  registry (goes live without a code change).
- Per-client configuration now opens in a **modal** instead of expanding inline
  (no more grid reflow); the **Open** button goes straight to the client page.

## v3.10.0 — 2026-07-20 · `c9040aa`
- AI insights (Weekly Traffic Light briefings) now persist server-side like
  every other setting, so a briefing one person generates is shared across the
  team and devices. Theme stays per-device (a local UI preference).

## v3.9.0 — 2026-07-20 · `b3b1e28`
- Added this changelog and surfaced the release number in the app sidebar.

## v3.8.0 — 2026-07-20 · `c957e3c`
- Key events: calendars now link **pipeline → stage** (not just stage name), so
  multi-pipeline clients (e.g. FINR) can target the correct pipeline. Resolution
  is pipeline-aware end to end (funnel, ordering, calendar merging, green
  Caalano360 columns). Existing single-pipeline config is unaffected.

## v3.7.0 — 2026-07-20 · `a20253b`
- Forms: parse Meta Lead Form answers from the `customFields` array (budget,
  pool type, timeframe…), so CDc_04/CDc_05 segment by their real answers.
- Credit each contact to the form that brought them in (earliest submission,
  including the Facebook submission timestamp).

## v3.6.0 — 2026-07-20 · `cb373db`
- Meta view: Daily trend flex-fills to match the Key Events card height.
- Agency Overview hides inactive clients from account-health alerts.
- Settings page defaults its filter to Active clients.

## v3.5.0 — 2026-07-20 · `ce0cb49`
- Settings moved to server-side persistence (Netlify Blobs) so key events, KPI
  targets, campaign links and enabled clients survive cache clears and are
  shared across the team — with one-time migration from browser storage.
- Settings redesigned as a full page with active/inactive filter + search.
- Seeded durable default key events for Pool Haus.

## v3.4.0 — 2026-07-20 · `455bc22`
- Fixed the Agency Overview CRM columns never loading (client `ghl` id was
  missing from the snapshot, so no requests fired).
- First pass at reading Meta lead-form array/nested answers; forms segment
  overlap fixed with per-question horizontal scroll.

## v3.3.0 — 2026-07-20 · `4f98d44`
- Agency Overview reliability: prominent CRM loading banner, per-row error
  markers, sortable columns, Spend/Results per-channel hover breakdowns,
  cost-per-result delta colouring, and a deploy timestamp in the sidebar.

## v3.2.0 — 2026-07-20 · `c710a78`
- Forms: requested the forms/custom-fields/users/conversations GHL scopes, a
  read-only forms probe, a per-client By-Form performance tab with answer-level
  segmentation, and a "Performance by form" section on the Meta tab with
  click-to-filter drill-in.

## v3.1.0 — 2026-07-20 · `b3ad8e6`
- Tracking health calls out manual (CRM UI) opportunities to show the true
  ad-vs-CRM gap.
- Agency Overview full comparison table (results → revenue) with vs-previous
  deltas and All/Paid/Non-Paid filters.

## v3.0.0 — 2026-07-19 · `43dadea`
- Key events framework: green Caalano360 per-event column groups (calendar /
  stage / won), booked-calendar funnel with cost per booked appointment, calendar
  ↔ stage linking with the stage as fallback, readable funnel with next-step
  conversion, and won keyed on the won status. The baseline "version 3.0".

---

_Older history predates formal release numbering; see `git log` for the full record._
