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
