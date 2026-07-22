# Caalano360 — Changelog

Release history for the reporting dashboard. Each release is pinned to the exact
git commit that produced it, so any version can be redeployed or reverted to.

**How to revert to a release**
- Inspect a release without changing anything: `git checkout v3.5.0`
- Roll the live branch back to a release (redeploys it on Netlify):
  `git checkout claude/reporting-dashboard-multi-platform-ov1wlv`
  then `git revert --no-edit <bad-commit>..HEAD` (safe, keeps history)
  or `git reset --hard v3.5.0 && git push --force-with-lease` (hard rollback).
- Every release below is also a git tag, so `git checkout <tag>` works directly.
- The live build's exact commit + time is always shown bottom-left in the app
  ("Last deployed …"), and the current version is shown next to it.

The version number also appears in the app sidebar. Newest first.

---

## v3.57.1 — 2026-07-22 · `PENDING`
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

## v3.57.0 — 2026-07-22 · `PENDING`
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

## v3.56.0 — 2026-07-22 · `PENDING`
- **Creative Cockpit — AI layer.** Two AI helpers (existing Anthropic
  integration, server-side key):
  - **Suggest tags** per creative: Claude reads the ad's copy / CTA / format and
    proposes awareness stage, persona and angle (reusing the client's existing
    labels), dropped into the editor for you to confirm or override.
  - **AI creative strategy**: a briefing over the whole tagged + performance set
    — what's working by angle / persona / format, what to cut, and concrete new
    concepts to test. All figures are computed here; Claude only interprets them.

## v3.55.0 — 2026-07-22 · `PENDING`
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

## v3.54.1 — 2026-07-22 · `PENDING`
- **Location map colours retuned:** Leads = yellow, Booked = blue, Won = green,
  Lost = red (legend and markers updated to match).

## v3.54.0 — 2026-07-22 · `PENDING`
- **Location map — new colour scheme with Lost.** Open leads are now **blue**
  (was red) and **lost** leads are **red**, alongside amber = booked and green =
  won. Added a **Lost** filter to the map's Show toggle and a Lost count to the
  legend, location scorecards, popups and the ranked list. Lost is now tracked
  per location in the forms feed (backend). Marker colour = furthest milestone
  reached (won > booked > lost > open lead). Applies to both the Location tab
  and the per-form location map.

## v3.53.0 — 2026-07-22 · `PENDING`
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

## v3.52.0 — 2026-07-22 · `PENDING`
- **Revenue bottleneck analysis** added to the Caalano 360 executive tab: the
  whole-account funnel (Leads → Qualified → Booked → Shown → Won) with the step
  conversion rate at each stage, flagging the single biggest drop-off as the
  bottleneck — where a small improvement moves the most revenue.
- **Simplified the executive tab.** Removed the collapsible "Full Caalano 360
  breakdown" (the old blended campaigns/pipelines/per-rep view) so the tab is
  just the executive dashboard. The detailed paid/CRM breakdowns remain on the
  Meta Ads, Google Ads, Users and Cohorts tabs.

## v3.51.2 — 2026-07-22 · `PENDING`
- **Executive KPI scorecard now spans the full width.** The seven headline tiles
  (ad spend, leads, qualified, cost/lead, booked, won, revenue) stretch evenly
  across the row instead of clustering on the left, stepping down to 4 then 2
  columns on narrower screens.

## v3.51.1 — 2026-07-22 · `PENDING`
- **Open-deals drill table now fits the modal — no horizontal scroll.** The
  Users open-pipeline drill-down (and the executive Revenue-at-risk table) used
  to overflow sideways because long emails/phone numbers wouldn't wrap, clipping
  the Opportunity column. Switched those tables to a fixed layout with wrapping
  so every column is visible without scrolling, on desktop and mobile.

## v3.51.0 — 2026-07-22 · `PENDING`
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

## v3.50.0 — 2026-07-22 · `PENDING`
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

## v3.49.0 — 2026-07-21 · `PENDING`
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

## v3.48.0 — 2026-07-21 · `PENDING`
- **Deal notes now render as clean text.** GHL note bodies are HTML; they're now
  converted to readable text (lists → bullets, block tags → line breaks, entities
  decoded) instead of showing raw `<p style=…>` markup.
- **Location map/list merges postcode + suburb duplicates.** Where a postcode and
  its suburb name refer to the same place (e.g. **2110** and **Hunters Hill**),
  they're now combined into a single entry — labelled **"Hunters Hill (2110)"** —
  with their leads/booked/won summed, both in the location list and as one map
  marker (no more overlapping dots for the same spot).

## v3.47.0 — 2026-07-21 · `PENDING`
- **Deal notes in the open-deals drill-down.** In the Users tab, click a stage →
  click any live deal to **expand its Caalano Systems notes** (fetched on demand
  from the contact), newest first with author + date. So when a deal is stuck at
  a stage, you can read the CRM context on *why* right there. Deals with no
  contact link aren't expandable; deals with no notes say so.

## v3.46.0 — 2026-07-21 · `PENDING`
- **Lead location map is now a real interactive map.** Replaced the hand-drawn
  Australia outline with a proper **OpenStreetMap** slippy map (Leaflet): pan and
  **zoom right down to street/suburb names**, like Google Maps. Each postcode /
  suburb is a marker **coloured by outcome — red = Leads, amber = Booked, green =
  Won** (the marker takes the furthest outcome), **sized by lead volume**, with a
  click popup showing the leads / booked / won breakdown. A **Show** filter
  toggles All / Leads / Booked / Won, and the map auto-fits to the plotted area.
  Leaflet loads lazily (only when the map is opened), so it doesn't weigh down the
  rest of the app.

## v3.45.0 — 2026-07-21 · `PENDING`
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

## v3.44.1 — 2026-07-21 · `PENDING`
- **Users funnel: add total conversion % next to step %.** Each stage in the
  per-rep funnel now shows both **step** (conversion from the previous stage)
  and **total** (conversion from all leads), so you can read stage-to-stage
  drop-off and overall lead→stage rate at a glance.

## v3.44.0 — 2026-07-21 · `PENDING`
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

## v3.43.0 — 2026-07-21 · `PENDING`
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

## v3.42.1 — 2026-07-21 · `PENDING`
- **Users key-event funnel now follows pipeline order.** The per-rep funnel (and
  the key-events matrix) sort stages by their real pipeline position instead of
  config order, so the cumulative funnel reads top-to-bottom and the step
  conversion % make sense (no more out-of-order stages / >100% steps).

## v3.42.0 — 2026-07-21 · `PENDING`
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

## v3.41.0 — 2026-07-21 · `PENDING`
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

## v3.40.0 — 2026-07-21 · `PENDING`
- **Per-client Meta conversion selection (Settings → Meta conversions).** A new
  tab in each client's Settings that **loads the Meta conversion events that
  actually fired** for that ad account (last 90 days, incl. custom-pixel events
  like *booked appointment* / *booking confirmed*), each with its 90-day count
  and cost-per. Pick one as the **primary result** and tick any **secondary**
  events. Saved to the shared settings store per client. This is the setup step
  so accounts that optimise to e.g. *Schedule* (a booking) can report the right
  result instead of generic “Leads”. (Next: wiring the chosen events into the
  Meta tab’s headline result, columns and cost-per.)

## v3.39.0 — 2026-07-21 · `PENDING`
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

## v3.38.0 — 2026-07-21 · `PENDING`
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

## v3.37.0 — 2026-07-21 · `PENDING`
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

## v3.36.1 — 2026-07-21 · `PENDING`
- **Team & access is now discoverable before you switch logins on.** Settings
  always shows the **Clients / Team & access** sub-tabs. Open **Team & access**
  and — until the login system is enabled — it explains exactly how to turn it
  on (add the `AUTH_SECRET` env var in Netlify), so the setup steps live in the
  app instead of only in chat.

## v3.36.0 — 2026-07-20 · `PENDING`
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

## v3.35.0 — 2026-07-20 · `PENDING`
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

## v3.34.0 — 2026-07-20 · `PENDING`
- **Full Meta drill-down.** Every level is clickable and filters the levels below
  it *and* the Performance-by-form table: click a **campaign** or **ad set** to
  filter the tables below plus the forms they drove; ad sets are now clickable;
  click a **creative** to see a lineage chip (**campaign · ad set · form**) and
  filter the forms table to the form it drove; click a **form** to filter the
  campaigns/ad sets/creatives (as before). A unified **drill-in bar** shows every
  active filter with individual clears + "Clear all", and the Performance-by-form
  headers are now **sortable**.

## v3.33.0 — 2026-07-20 · `PENDING`
- **Synced horizontal scroll**: scrolling any table in the Meta / Google view
  scrolls them all to the same offset, so the Caalano360 green columns stay
  aligned across the campaigns / ad sets / creatives tables instead of each
  scrolling on its own.

## v3.32.1 — 2026-07-20 · `PENDING`
- Hardened the calendar/pipeline-stage key-event de-duplication (case/whitespace
  normalisation + name-match fallback) so double-ups can't slip through.

## v3.32.0 — 2026-07-20 · `PENDING`
- **No more double-ups between calendars and pipeline stages** in the Caalano360
  green columns and the Key Events funnel. When a calendar is linked to a
  pipeline stage (e.g. Pool Haus's Pool Specialist call), the two now show as a
  **single event labelled by the pipeline stage**, and the count reached is split
  into **how many came from calendar bookings vs from the pipeline stage** (shown
  in the number's marker + hover, and in the funnel bar's "+Np" / tooltip). The
  standalone duplicate stage row/column is dropped everywhere it appears.

## v3.31.1 — 2026-07-20 · `PENDING`
- Appointments "Time to book" now shows the **median** (robust to outliers) as
  the headline with the **average** alongside it.

## v3.31.0 — 2026-07-20 · `PENDING`
- **Lead map — smarter & more useful:**
  - **State disambiguation**: the client's dominant state is inferred from the
    unambiguous answers (postcodes + single-state suburbs), so same-named suburbs
    in other states (Richmond NSW vs VIC) resolve to the right one.
  - **Suburb-level precision**: suburb answers now plot at the suburb's own
    coordinates (not just the postcode centroid).
  - **Outcome shading**: a Colour toggle (Volume / Booked % / Won %) colours each
    dot red→green by its conversion rate while dot size stays lead volume — so
    you see where leads come from *and* where they convert.

## v3.30.0 — 2026-07-20 · `PENDING`
- **Lead map — detailed + auto-zoom.** Swapped the rough outline for a detailed
  Australia map with state borders, and the map now **auto-zooms to fit the
  plotted leads** — a Sydney-only client (e.g. Pool Haus) sees Sydney at full
  size, not the whole country. Dot and line sizes scale with the zoom; a
  "Fit to leads / All Australia" toggle switches between the fitted view and the
  national view. A single location still shows ~2° of context so it isn't
  over-zoomed.

## v3.29.1 — 2026-07-20 · `PENDING`
- Removed the Agency Overview "Still maturing" summary banner — the per-row badge
  next to each client name already covers it.

## v3.29.0 — 2026-07-20 · `PENDING`
- **Lead map** on the Forms location breakdown: postcode / suburb answers are now
  plotted on a map of Australia (dot size = lead volume), with a ranked list
  underneath and any unmatched answers listed. Self-contained — a bundled AU
  postcode/suburb → coordinate dataset (3,171 postcodes, 16,196 suburbs), lazy-
  loaded only when the section is opened, so it stays out of the main bundle. No
  external map tiles or dependencies.

## v3.28.0 — 2026-07-20 · `PENDING`
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

## v3.27.0 — 2026-07-20 · `PENDING`
- **Appointments tab — more insights:** cancellation % and reschedule % (overall
  and by lead-time bucket, to see if far-out bookings cancel more), a
  **time-to-book** metric (lead in → booked), and a **"when the call is
  scheduled"** card with show rate by **day of week** and by **time of day**.
- **Settings** clients are now sorted **alphabetically** by default.

## v3.26.0 — 2026-07-20 · `PENDING`
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

## v3.25.0 — 2026-07-20 · `PENDING`
- **Speed to Lead → outcomes by response speed:** a new table on the Timing tab
  shows, for each response-time bucket (under 5 min … over 24 hrs), the leads'
  downstream **Book % / Show % / Win %** — so you can see whether replying faster
  actually converts better.
- **Working hours for Speed to Lead:** set the team's days + open/close time in
  Settings → client → Summary (auto-detected from the client's calendars, with a
  "Use detected" button). When on, response time counts only **business minutes**
  — a lead at 11pm answered at 9am is a fast response, not a 10-hour one. The
  Timing tab shows which hours are applied.

## v3.24.0 — 2026-07-20 · `PENDING`
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

## v3.23.0 — 2026-07-20 · `PENDING`
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

## v3.22.0 — 2026-07-20 · `PENDING`
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

## v3.21.0 — 2026-07-20 · `PENDING`
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

## v3.20.0 — 2026-07-20 · `PENDING`
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

## v3.19.0 — 2026-07-20 · `PENDING`
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
