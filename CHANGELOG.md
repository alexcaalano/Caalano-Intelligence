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

## v3.130.1 — 2026-08-05 · `PENDING`
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

## v3.123.0 — 2026-07-31 · `PENDING`
- **Delete a client (Settings), not just deactivate.** The client Edit modal now has a
  **Delete client** action (Super Admin, with a confirm). Deleting removes the client
  from **every** list — dashboard, sidebar switcher, Settings and agency-wide
  aggregates — for the whole team, whether it's a UI-added client or a built-in one.
  Its per-client settings (key events, KPIs, notes) are kept so it can be restored. A
  new **Deleted** filter in Settings → Clients lists deleted clients with a **Restore**
  button. Backend drops deleted clients from the `CLIENTS` registry across all scopes.

## v3.122.0 — 2026-07-31 · `PENDING`
- **Outbound calls now count as manual contact (Speed to Lead + Contact rate).** A
  placed outbound **call / voicemail** is treated as human outreach even when the
  dialer didn't attribute a GoHighLevel user — so phone-first teams get credited for
  reaching out, instead of showing as "no manual message." Automated sources
  (workflow / campaign / bulk / RVM) are still excluded, and messages (SMS / email /
  DM) still require a human user as before. Copy updated to "first manual message or
  call." Applies to both the sampled view and the full-range scan.

## v3.121.1 — 2026-07-31 · `PENDING`
- **Contact rate now follows the full scan.** Previously the Contact rate card stayed
  on the 60-lead sample even after "Scan the whole date range." The whole-range scan
  now computes the contact-rate breakdown (and Lead outcomes) across every lead it
  processes, and the card updates live with it — the label switches to "of N leads
  (full scan)". Both the scan and the initial sample share the same computation.

## v3.121.0 — 2026-07-31 · `PENDING`
- **Timing tab — Contact rate section (manual messages + appointments booked).** New
  card on the Timing tab: **total contact rate** (% of sampled leads we made human
  contact with — a manual message *or* an appointment booked), broken out into
  **Manual messages**, **Appointments booked**, and the appointment split of
  **User-booked** (a staff member created the appointment) vs **Customer self-booked**
  (the lead booked via a calendar link). Every tile drills to the leads behind it
  (contact info, source, value). Backend now distinguishes self- vs staff-booked
  appointments per lead and separates the "messaged" signal from the appointment
  fallback. Same sample basis as Speed to Lead (full scan makes it exact).

## v3.120.0 — 2026-07-31 · `PENDING`
- **Timing tab — Open / Won / Lost lead outcomes with drill-downs.** The Timing
  (Speed to Lead) tab now shows a **Lead outcomes** row for the whole cohort of leads
  created in the range: **Open** (count + pipeline value), **Won** (count + revenue)
  and **Lost** (count + value lost). Click any of the three to open a **popup listing
  the actual leads** — contact name, lead-created date, source, contact info (email /
  phone) and value; **Won shows the deal value**, **Lost shows the lost reason**.
  Backend `scope=speed` now returns the per-outcome deal lists (lost reasons resolved
  from GoHighLevel), computed across the full cohort independent of the speed sample.

## v3.119.0 — 2026-07-31 · `PENDING`
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

## v3.118.0 — 2026-07-31 · `PENDING`
- **Organic Social trend — total followers each month + organic-only stats.** The
  KPIs & Trends view now shows the **total follower count at each month-end** (and
  where it started), reconstructed from today's count back through the monthly net
  gains — added as a KPI tile, a trend line and a column in the month-by-month table.
  **All figures are now organic only:** Facebook stats use the organic-specific
  fields (`page_impressions_organic`, `page_impressions_organic_unique`,
  `page_video_views_organic`) so paid-boosted reach & impressions are never counted,
  with an "Organic only" badge and clearer labels. The trend window is now a true
  rolling window ending on the current month.

## v3.117.0 — 2026-07-31 · `PENDING`
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

## v3.116.1 — 2026-07-31 · `PENDING`
- **Keep the dashboard out of search engines.** Added a `robots.txt` that disallows
  all crawlers, a `noindex, nofollow` robots meta tag (plus a Googlebot-specific one)
  in the page head, and an `X-Robots-Tag: noindex, nofollow` response header on every
  route via Netlify — three layers so Google (and other engines) never index or rank
  this private client reporting tool.

## v3.116.0 — 2026-07-31 · `PENDING`
- **Monthly Report sizing fixes.** Removed the forced tall slide height and stopped
  short slides stretching to the tallest one, so each page sits at its natural size
  again — no more out-of-proportion pages or extra scrolling. Creative cards are now
  compact horizontal cards (portrait thumbnail + stats + CRM key events side by side,
  6 per slide); the full 9:16 view still opens on ▶ Play. **Removed the results tiles
  from the cover page** — it's now just the client, industry and month.

## v3.115.0 — 2026-07-31 · `PENDING`
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

## v3.114.0 — 2026-07-31 · `PENDING`
- **Monthly Report — page-by-page slide view (PowerPoint / Canva style).** The deck
  now opens in **Slides** mode: one section per page, with **‹ ›  arrows, a clickable
  chip strip** to jump to any section (Cover, Meta, Ad sets, Creative, Google,
  Keywords, CRM, ROI…), a **page counter**, and **keyboard navigation** (←/→,
  PageUp/Down, Home/End). A **Slides / Scroll** toggle in the toolbar switches back
  to the old continuous view any time. Print and PDF export are unchanged — both
  still lay out every section, one per page, regardless of which view you're in.

## v3.113.0 — 2026-07-31 · `PENDING`
- **Add competitors from a dropdown, not manual typing.** The Competitors tab now
  adds a competitor by picking from a **dropdown of the connected public Instagram
  accounts** — the competitor name and handle are taken straight from the account's
  profile, and it's mapped and pulling metrics the moment you add it. No more typing
  a name and handle by hand. Accounts already added are hidden from the list. Backend
  `scope=socialaccounts` now also returns each account's **profile display name** and
  **handle** (falling back gracefully for connectors that don't expose them).

## v3.112.0 — 2026-07-31 · `PENDING`
- **"You vs competitors" benchmark strip.** The Competitors tab now opens with a
  side-by-side table comparing the client's own Instagram against every mapped
  competitor on **followers, posts, engagement, avg engagement per post and
  estimated engagement rate**. The client's row is highlighted and pinned to the
  top; the group leader on each metric is flagged in green. Comparison uses
  **likes + comments only** so the client's private saves/shares don't unfairly
  inflate it against public competitor data. Pulls the client's own IG via
  `scope=social` and collects each competitor's numbers as their cards load.

## v3.111.0 — 2026-07-31 · `PENDING`
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

## v3.110.0 — 2026-07-31 · `PENDING`
- **Fix competitor Instagram cards showing all zeros.** The `instagram_public`
  connector uses different field names to the owned `instagram` one, so the metric
  pull was silently returning nothing. Backend `scope=competitor` now reads the
  correct public fields — `profile_followers_count`, `profile_media_count`,
  `profile_username` (profile), and `media_timestamp` for post dates — and falls
  back to `media_url` when a post has no `media_thumbnail_url` (images/carousels).
  Format mix now labels by surface (REELS / FEED / STORY). Verified live against
  `jjpoolsbrisbane` (9,408 followers, 130 posts).

## v3.109.0 — 2026-07-29 · `PENDING`
- **Competitor Instagram insights (public).** Once a competitor is mapped to a
  Windsor public IG account, its card now pulls a live summary from public data —
  **followers, posts, engagement (likes+comments), estimated engagement rate, format
  mix** and its **top 3 posts** (thumbnail + engagement, linking out). Backend
  `scope=competitor` reads the public connector defensively (falls back through
  simpler field sets). Facebook deferred; IG-only for now. Engagement rate is
  estimated (avg likes+comments per post ÷ followers) since competitor reach is private.

## v3.108.0 — 2026-07-29 · `PENDING`
- **Competitors → map to Windsor public accounts.** The Competitors tab now lists
  every public Instagram / Facebook account your Windsor key can access (backend
  `scope=socialaccounts`, auto-detecting the public connector slug) and lets you
  map each competitor to its account via a dropdown, saved per client. If no public
  accounts are found it prompts for the connector name. Also added a generic
  `scope=windsorprobe&connector=<slug>` to inspect any connector's accounts/fields.
  Live competitor metrics render off these mappings next.

## v3.107.0 — 2026-07-29 · `PENDING`
- **Fix "Caalano360 columns hidden: attribution request failed."** The GHL-backed
  attribution build is heavy and can transiently time out / cold-start / rate-limit;
  it now **auto-retries twice with backoff** before showing an error, which clears
  the common transient case without a manual Refresh. When it does fail, the message
  now shows the **real backend reason** (e.g. timeout, GHL 429) instead of a generic
  "network / HTTP error", so any persistent cause is diagnosable.

## v3.106.0 — 2026-07-29 · `PENDING`
- **Organic Social → Competitors tab (assignment + structure).** A Performance /
  Competitors tab toggle. In Competitors you assign a client's competitors by public
  Instagram / Facebook handle (stored server-side, per client), with profile links
  and the benchmark layout ready. Live public metrics (follower growth, posting
  cadence & format mix, top posts, estimated engagement rate) and the paid-vs-organic
  follower split / "% of new followers from ads" wire up once Windsor's public
  connector + Meta ad fields are verified against live data (connector was offline).

## v3.105.0 — 2026-07-29 · `PENDING`
- **Inbound social DMs on the Organic Social dashboard.** Counts conversations
  started via Instagram / Facebook Messenger from the client's GoHighLevel inbox
  (channel = IG/FB, started in the period): tiles for total / IG / FB plus a
  per-day stacked bar. Backend `scope=socialdm` (with a `?probe=1` sample to verify
  the GHL channel fields against live data). Shows only when DMs are found.

## v3.104.0 — 2026-07-29 · `PENDING`
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

## v3.103.0 — 2026-07-29 · `PENDING`
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

## v3.102.0 — 2026-07-29 · `PENDING`
- **Account summary now shows Deals Won on both bases as headline tiles** — "created"
  (this month's leads, created-on cohort) and "closed" (marked won this month), so
  the two are visible at a glance without reading the matrix.

## v3.101.0 — 2026-07-29 · `PENDING`
- **CAC (cost per paid won)** added to the revenue matrix — ad spend ÷ paid deals
  won, for both bases (status change vs created on), sitting under Paid ROAS so the
  two efficiency metrics read together.

## v3.100.0 — 2026-07-29 · `PENDING`
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

## v3.99.0 — 2026-07-29 · `PENDING`
- **Monthly Report fixes:** the Status-Change vs Created-On revenue matrix no longer
  runs off the card — it now uses a fixed layout with a hard width cap and wrapping
  headers, so both columns always fit.
- **Average time to close** (lead created → won) added: a KPI on the Account summary,
  a row in the revenue matrix (both bases), and a per-deal "Days to close" column in
  the won drill-downs.
- **Dates now display DD/MM/YYYY** throughout the drill-downs.

## v3.98.0 — 2026-07-29 · `PENDING`
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

## v3.97.0 — 2026-07-29 · `PENDING`
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

## v3.96.0 — 2026-07-29 · `PENDING`
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

## v3.95.0 — 2026-07-29 · `PENDING`
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

## v3.94.0 — 2026-07-29 · `PENDING`
- **Sidebar client switcher (GoHighLevel-style).** Added a dropdown pill at the top
  of the sidebar showing the active client (avatar + name + industry subline) with a
  chevron. Clicking it opens a searchable list of **every** client; picking one jumps
  straight to that client's workspace (the Client View). Type to filter by name or
  industry, click-away / Esc to close, and the current client is ticked. Shows for
  admins on all views (placeholder "Select a client" until one is open) and for
  viewers who have more than one report assigned.

## v3.93.0 — 2026-07-28 · `PENDING`
- **Command centre decluttered — fewer, calmer tiles.** Cut ~24 tiles down to ~17
  and dropped a whole group. Each rate now rides as a small line under its number
  instead of being its own box: Booked shows "68% booking rate", Shown "5% show
  rate", Won "3% conversion", Revenue "avg $67k · 35.9x ROAS". Open now + open
  value merged into one **Open pipeline** tile (count · value), Lost + lost value
  merged into one **Lost** tile. The Pipeline & revenue group is now a tidy two-row
  block — the funnel (Opportunities → Booked → Shown → Won) on top, the money
  (Revenue, Open, Lost, Close rate) below. Every tile stays clickable to its drill.

## v3.92.0 — 2026-07-28 · `PENDING`
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

## v3.91.0 — 2026-07-28 · `PENDING`
- **The Caalano360 channel filter now re-pivots the whole drill layer.** Selecting
  All / Paid / Non-paid / Google / Meta now filters the **Revenue bottleneck
  funnel**, **Open pipeline by stage**, **Lost reasons**, **Key event reach** and
  every tile drill (opportunities by source, revenue, close rate, bookings) to
  that channel's opportunities — not just the top scorecards. buildCcDrill takes a
  channel and filters the opportunity cohort (calendar bookings are scoped to the
  same channel's contacts). So filtering Pool Haus to **Paid** for the last 30
  days now correctly shows only paid opportunities everywhere — and reads **0**
  where there are none, instead of falling back to account-wide numbers.

## v3.90.0 — 2026-07-28 · `PENDING`
- **Lost reasons drill now shows each lead's source + opens to their notes.** In
  the Caalano360 Lost reasons view, clicking a reason lists the people lost with
  their **source trail** — opportunity source, channel, UTM source and first-touch
  UTM content (whichever are available) — alongside their form answers. Click any
  lead to expand their **Caalano Systems notes** inline. buildCcDrill now attaches
  the source fields to each lost person.

## v3.89.0 — 2026-07-28 · `PENDING`
- **Open-by-stage deals now show the assigned rep and open to their notes.** Each
  open deal in the bottleneck's Open pipeline by stage list gains an **Assigned**
  column (who owns it), and clicking a lead expands to that contact's **Caalano
  Systems notes** — the same notes drill used on the Users tab. buildCcDrill now
  loads the user list and tags each open deal with its owner + contact id.

## v3.88.0 — 2026-07-28 · `PENDING`
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

## v3.87.0 — 2026-07-28 · `PENDING`
- **Command Centre — Booked tile now drills into bookings per calendar.** Clicking
  **Booked** in the Caalano360 command centre opens a per-calendar breakdown
  (booked · occurred · shown, with show rate per calendar), and clicking any
  calendar lists who booked in and whether they occurred / showed. Uses the same
  calendar drill already behind the booking-rate and show-rate tiles.

## v3.86.0 — 2026-07-28 · `PENDING`
- **Command Centre channel filter now re-pivots every metric.** Previously only a
  few CRM tiles responded to All / Paid / Non-paid / Google / Meta. Now ad spend,
  cost per lead, cost per booked, cost per won, ROAS, booked, shown and all the
  rates (booking / show / conversion / close) all slice by the selected channel
  too. **Cost per won** reflects the channel's paid-attributed wons only (Meta →
  Meta spend ÷ Meta-attributed wons, etc.); non-paid shows no cost figures since
  there's no attributable spend.

## v3.85.0 — 2026-07-28 · `PENDING`
- **Appointments — Resulted column on the "Booked ahead" table, clickable.** Each
  lead-time bucket now shows how many resulted, and clicking it drills into that
  bucket's appointments by status (Showed / No-show / Cancelled / Other) plus the
  reporting-gap groups — the same Resulted drill, scoped to the booked-ahead row.

## v3.84.0 — 2026-07-28 · `PENDING`
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

## v3.83.0 — 2026-07-28 · `PENDING`
- **Appointments — status breakdown + reporting-gap detection.** New status row:
  Booked · Occurred · Resulted · Shown · Show rate, where "Resulted" means the
  appointment's status has actually moved out of "confirmed" into an outcome. An
  amber warning flags "N occurred but not resulted — needs status updating" (the
  calls that happened but were never marked showed/no-show), plus the reverse odd
  case. Click **Resulted** to drill into who fell into each status (Showed /
  No-show / Cancelled / Other) and the two reporting-gap groups. Backend adds the
  normalised status, per-status tallies and a per-appointment people list to
  buildAppointmentInsights (additive — the client-update path is untouched).

## v3.82.0 — 2026-07-28 · `PENDING`
- **Forms tab reworked around Key Events.** The top scorecards now span full width
  and show Forms · Leads · one tile per client Key Event · Revenue (instead of the
  generic Leads/Booked/Shown/Won). The Form performance table swaps its
  Booked/Shown/Won columns for one column per Key Event (count + % of the form's
  leads), and every column is sortable on header click. The charts are reworked to
  "Key events by form" and "Conversion to each key event", with a consistent
  palette. Clients with no key events configured fall back to the old Booked/Won
  view. (Backend: buildForms attaches a per-form people list, cap 120.)

## v3.81.0 — 2026-07-28 · `PENDING`
- **Command Centre — Lost reasons full width, no sideways scroll.** Moved the
  Lost reasons panel to its own full-width card (long reason names wrap) and added
  a Share column. Channel split is now its own card and hides in present mode.

## v3.80.0 — 2026-07-28 · `PENDING`
- **Present mode.** A sidebar toggle that hides agency-internal cost/spend/margin
  figures so the dashboard is safe to screen-share with a client. First pass hides
  the Command Centre's "Spend & efficiency" block; the mechanism (`.x-internal`
  elements shown only when present mode is off) is reusable to tag more internal
  figures across other views. Always starts off so it can't be left on by mistake.

## v3.79.0 — 2026-07-28 · `PENDING`
- **Collapsible sidebar.** A « toggle collapses the left nav on desktop to give
  the main screen more room; a » button brings it back. The choice is remembered.
- **Users drill-down fits the panel.** The expanded rep detail no longer inherits
  the wide leaderboard's scroll-width and run off-screen — it's pinned to the
  left and clamped to the visible area (and adapts when the sidebar is collapsed).

## v3.78.0 — 2026-07-28 · `PENDING`
- **Caalano360 pared back to a clean command centre.** Removed the business-health
  gauge + pillar breakdown (and with it the "Build trend history" 504), the
  Forecast panel, and the AI executive summary. The command-centre metrics are
  now grouped into labelled sections (Spend & efficiency · Pipeline & revenue ·
  Rates). Priority actions are rebuilt to read straight from the CRM + spend data
  (cost-per-lead moves, low show/booking rates, deals lost + top reason, open
  pipeline to chase, no-wins-yet) instead of health pillars. "By pipeline" only
  shows when a client runs more than one pipeline.

## v3.77.0 — 2026-07-28 · `PENDING`
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

## v3.76.0 — 2026-07-23 · `PENDING`
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

## v3.75.0 — 2026-07-23 · `PENDING`
- **Client Update now reads the whole client profile.** The generator pulls in
  every tab's data, not just spend + pipeline: Location (where leads and the
  booked/won ones come from), Appointments (booking lead time, self vs
  staff-booked, show rate, downstream wins), Timing/speed-to-lead (typical
  response time and the book-rate gap between fast and slow follow-up), Cohorts
  (whether newer lead cohorts are converting better or worse), and Forms (which
  offer pulls the best-converting leads). It's fed as background so the AI has
  the full picture, but instructed to surface only the one or two most valuable
  insights (often as a smart client question), keeping the email tight.

## v3.74.0 — 2026-07-23 · `PENDING`
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

## v3.73.0 — 2026-07-23 · `PENDING`
- **Meta Insights — Opportunity score tab (live from the Graph API).** Meta's own
  0–100 account health score per client, with its top recommendations ranked by
  expected point lift (e.g. "Maximise qualified leads · +4 · 24% lower cost per
  quality lead"), each linking into Ads Manager. Backend `scope=opportunity`
  calls the Graph API with a stored System User token (`META_SYSTEM_TOKEN`, env
  var, read-only). Shows a clear setup banner until the token is configured.
  This is the first tab that pulls *from* Meta (the webhook pushes *to* us).

## v3.72.0 — 2026-07-23 · `PENDING`
- **Meta fatigue tab — show subscribed-but-quiet accounts.** Previously only
  accounts that had already sent a webhook event appeared, which made it look
  like the others weren't connected. Added an "Awaiting Meta's first event"
  panel listing the remaining Meta clients, so you can see the full picture:
  a card shows once Meta pushes an account's first event; everything else waits
  in the panel until then.

## v3.71.1 — 2026-07-23 · `PENDING`
- **Webhook receiver panel is now collapsible** — it starts collapsed to a single
  status line (green dot + "events received" + count) and expands on click to
  show the recent-events table, so it stays out of the way.

## v3.71.0 — 2026-07-23 · `PENDING`
- **Meta Insights — Ad recommendations tab.** New sub-tab that surfaces Meta's
  own `ad_recommendations` webhook events (already streaming in once the field is
  subscribed), grouped by client, newest first, with whatever detail the payload
  carried. Backend `scope=recommendations` reads them from the webhook store.

## v3.70.0 — 2026-07-23 · `PENDING`
- **Meta webhook — live connection status panel.** The "Creative fatigue · Meta"
  tab now shows a receiver-status card that lists every event Meta has sent
  (test or real), so you get instant confirmation the pipe works — even for test
  events whose placeholder account id doesn't map to a client. Backend
  `scope=webhookstatus` lists the stored events across all accounts.

## v3.69.1 — 2026-07-23 · `PENDING`
- **Fix: Meta webhook was blocked by the site auth gate.** The `auth` edge
  function refuses any `/.netlify/functions/*` call without a login cookie, which
  also blocked Meta's server-side webhook verification (it has no cookie).
  Added `/.netlify/functions/meta-webhook` to the edge function's `excludedPath`
  so Meta can reach it. The endpoint still secures itself with the
  `X-Hub-Signature-256` HMAC check, so it's safe to leave un-gated.

## v3.69.0 — 2026-07-23 · `PENDING`
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

## v3.68.0 — 2026-07-23 · `PENDING`
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

## v3.67.0 — 2026-07-23 · `PENDING`
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

## v3.66.0 — 2026-07-23 · `PENDING`
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

## v3.65.0 — 2026-07-23 · `PENDING`
- **Client context / notes** on the Client Update page. A free-text field where
  you record background about a client (their business, tone to use, what they
  care about, current focus, sensitivities, offers, relationship notes). It's fed
  into the update as **background to guide tone and framing** — with a hard
  guardrail that it is never treated as a metric and can't override or invent
  numbers. Saved per client to the shared settings blob (so it lives in Settings)
  but editable right here on the comms screen.

## v3.64.0 — 2026-07-23 · `PENDING`
- **Client Update — call out the channel split when two channels run.** When a
  client runs both Meta and Google in the period, the supporting dashboard now
  splits the headline into **Meta leads / Meta cost-per-lead** and **Google
  conversions / Google cost-per-conversion** as separate tiles (so each matches
  its own platform exactly), with a note that Google conversions aren't always
  the same as a form lead, plus the blended combined figure. The email's Quick
  Summary now explicitly breaks out the Meta vs Google split too. Single-channel
  clients are unchanged (one combined leads/cost-per-lead view).

## v3.63.1 — 2026-07-23 · `PENDING`
- **Fix: ad thumbnail preview was being clipped** by the table's scroll
  container. The hover preview now renders as a fixed overlay positioned from the
  thumbnail, so it sits over the top of everything (and flips below the thumbnail
  when there isn't room above).

## v3.63.0 — 2026-07-23 · `PENDING`
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

## v3.62.0 — 2026-07-23 · `PENDING`
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

## v3.61.2 — 2026-07-23 · `PENDING`
- **Fix: Client Update lead count + cost per lead now reconcile with Ads
  Manager.** The headline "leads" was using the CRM opportunity count (every
  source) but dividing it against Meta-only spend, so cost per lead came out low
  (e.g. 85 leads / $46 instead of Meta's 66 / $59). The update now uses the
  **ad-reported lead count** (Meta + Google, matching Ads Manager) for the
  headline leads and cost per lead, with the vs-previous delta on the same basis,
  and reports the CRM opportunity total separately and clearly labelled.
- **Fix: email is now plain text for clean copy-paste** — no Markdown asterisks
  or hash headings; section titles are plain lines and lists use simple hyphens.

## v3.61.1 — 2026-07-23 · `PENDING`
- **Fix: Client Update sometimes returned the old saved copy instead of a new
  one.** The generator asked Claude for a JSON object, but the multi-line email
  body produced literal newlines that broke `JSON.parse`, so generation failed
  silently and the UI fell back to the last saved update. Switched to a robust
  marker-based output format (`###SUBJECT/EMAIL/WHATSAPP###`), raised the token
  budget so the two-version output can't truncate, and made a failed regenerate
  say so clearly instead of looking like the same response.

## v3.61.0 — 2026-07-23 · `PENDING`
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

## v3.60.0 — 2026-07-23 · `PENDING`
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

## v3.59.0 — 2026-07-23 · `PENDING`
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

## v3.58.0 — 2026-07-22 · `PENDING`
- **Creative Cockpit headline metric → cost per booked call** (replaces cost per
  qualified lead). "Booked" is now the concrete, per-pipeline definition used
  across the platform: a lead counts as booked if it has a calendar booking in
  period, OR its opportunity reached that pipeline's booked-call stage, OR it was
  won — read from the pipeline each lead actually landed in (no reliance on the
  campaign→pipeline link). The grid, scorecards, "what's working" rollup and AI
  strategy all now rank on cost per booked call. (Qualified-lead was ambiguous
  across clients with no consistent stage; booked is unambiguous.)

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
