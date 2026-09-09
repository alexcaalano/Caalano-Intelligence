// The demo account must give every client tab something true to show: the
// Location tab needs postcodes, Forms needs answers under `others`, the Cash
// toggle needs an opportunity field, Lost Reasons needs ids, Call Reporting
// needs inbound calls, Analytics needs GA4 rows, the Google tab needs keywords.
import { demoData, demoGhl, demoWindsor, DEMO_LOCATION, DEMO_GA4_PROP } from '../netlify/lib/demo.mjs'
import { buildForms, buildCrm, buildUserCalls, buildCcDrill, buildSpeedToLead, buildAppointmentInsights, buildCalPerf, buildUserPerformance, monthlyDeals } from '../netlify/lib/ghl.mjs'
let n = 0, f = 0
const ok = (c, m) => { n++; if (!c) { f++; console.log('FAIL:', m) } }
const to = new Date().toISOString().slice(0, 10), from = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10)

const d = demoData()
ok(d.contacts.every((c) => /^\d{4}$/.test(c.postalCode) && c.city && c.address1 && c.state === 'NSW'), 'every contact has a street address, suburb, state and postcode')
ok(new Set(d.contacts.map((c) => c.postalCode)).size >= 12, 'postcodes spread across the district')
ok(d.opportunities.every((o) => o.contact.postalCode === o._address.postalCode), 'the opportunity contact carries the same postcode')
ok(d.opportunities.filter((o) => o.status === 'lost').every((o) => /^demoLR\d$/.test(o.lostReasonId)), 'lost deals carry a lost-reason id')
const won = d.opportunities.filter((o) => o.status === 'won')
ok(won.every((o) => o.customFields.some((c) => c.id === 'democf_opp_service_sold')), 'won deals name the service sold')
ok(won.some((o) => o.customFields.some((c) => c.id === 'democf_opp_cash_collected')) && won.some((o) => !o.customFields.some((c) => c.id === 'democf_opp_cash_collected')), 'cash collected is entered on most, not all, won deals')
ok(d.opportunities.some((o) => o.status === 'open' && o.monetaryValue > 0), 'open deals carry an estimated value')
ok(d.messages.some((m) => m.direction === 'inbound' && /CALL/.test(m.messageType)), 'patients ring in')
ok(d.messages.some((m) => m.direction === 'inbound' && m.status === 'no-answer'), 'some inbound calls are missed')
ok(d.messages.some((m) => m.source === 'workflow' && !m.userId), 'an automated acknowledgement goes out with no user')
const sub = d.formSubmissions[0]
ok(sub.others && sub.others.postal_code && sub.others['What are you seeking help with?'], 'form answers and the postcode sit under others')
ok(d.formSubmissions.some((s) => s.others.facebookFormName) && d.formSubmissions.some((s) => !s.others.facebookFormName), 'Meta lead forms are named as such; website forms are not')

// API surface
const cf = demoGhl(`/locations/${DEMO_LOCATION}/customFields`, { model: 'opportunity' })
ok(cf.customFields.some((x) => /cash collected/i.test(x.name)), 'opportunity custom fields include Cash Collected')
ok(demoGhl(`/locations/${DEMO_LOCATION}/customFields`, { model: 'contact' }).customFields.every((x) => x.model === 'contact'), 'contact model returns only contact fields')
ok(demoGhl('/opportunities/lost-reason', {}).lostReasons.length === 6, 'six lost reasons listed')
const inWin = demoGhl('/forms/submissions', { locationId: DEMO_LOCATION, limit: 100, page: 1, startAt: from, endAt: to })
ok(inWin.meta.total < d.formSubmissions.length && inWin.meta.total > 0, `submissions honour the window (${inWin.meta.total} of ${d.formSubmissions.length})`)
const cid = d.opportunities[0].contactId
const convs = demoGhl('/conversations/search', { locationId: DEMO_LOCATION, contactId: cid, limit: 10 })
ok(convs.conversations.length >= 0 && (!convs.conversations.length || demoGhl(`/conversations/${convs.conversations[0].id}/messages`, { limit: 100 }).messages.messages.length > 0), 'a contact\'s conversation lists its messages')

// Builders end to end
const forms = await buildForms(DEMO_LOCATION, from, to)
ok(forms.forms.every((x) => (x.locations || []).length > 0), 'every form has locations')
ok(forms.forms.every((x) => x.leadRows.questions.length >= 4), 'every form has questions')
ok(forms.forms.some((x) => (x.segments || []).some((s) => s.kind === 'written')), 'a written answer segment exists')
ok(forms.forms.some((x) => (x.campaigns || []).length > 0), 'form campaigns come from the submission UTMs')
const crm = await buildCrm(DEMO_LOCATION, from, to)
ok(crm.lostReasons.length >= 4 && !crm.lostReasons.some((x) => x.name === 'Not set'), 'lost reasons resolve to names')
ok(crm.totals.openValue > 0, 'open pipeline has value')
const calls = await buildUserCalls(DEMO_LOCATION, from, to, false, true)
ok(calls.totals.inbound > 0 && calls.totals.missedInbound > 0, 'Call Reporting has inbound and missed calls')
const drill = await buildCcDrill(DEMO_LOCATION, from, to, 'all', 'created')
// A no-show is an appointment that occurred and was not shown; a cancellation
// was called off in advance and is neither. So on calendars where the demo has
// no-shows, occurred exceeds shown and the show rate sits under 100%.
const fup = drill.bookingByCalendar.filter((c) => /Follow-up/.test(c.calendar))
ok(fup.length > 0 && fup.every((c) => c.occurred >= c.shown) && fup.some((c) => c.occurred > c.shown), 'no-shows count as occurred but not shown on the calendar tiles')
// Booked is by the day the booking was made; occurred is by the appointment's
// time. They are different bases, so neither bounds the other - only the
// result split is a hard identity.
ok(fup.every((c) => c.cancelled <= c.booked && c.shown + c.noShow + c.unresulted === c.occurred), 'cancellations sit within bookings and never inside occurred')
ok(drill.bookingByCalendar.every((c) => c.resulted === c.shown + c.noShow && c.unresulted === c.occurred - c.resulted && c.unresulted >= 0), 'resulted = shown + no-show; unresulted = occurred - resulted')
ok(drill.bookingByCalendar.some((c) => c.cancelled > 0) && drill.bookingByCalendar.every((c) => c.cancelled <= c.booked), 'cancellations are counted per calendar, within bookings')
ok(drill.bookingByCalendar.every((c) => (c.people || []).every((p) => [p.shown, p.noShow, p.cancelled].filter(Boolean).length <= 1)), 'a person has one result')
ok(drill.cash && drill.cash.collected > 0 && drill.cash.paidInFull > 0 && drill.cash.paidInFull < drill.cash.won, 'cash collected reads with some paid in full')
const speed = await buildSpeedToLead(DEMO_LOCATION, from, to)
ok(speed.contactRate.rate < 100 && speed.onlyAuto > 0, 'speed to lead sees unworked leads and auto-only leads')

// One appointment rule on every tab: show rate = shown ÷ (shown + no-show),
// cancelled is neither, unresulted = occurred with no result.
const ai = await buildAppointmentInsights(DEMO_LOCATION, from, to)
const A = ai.channels.all
ok(A.showRate === Math.round((A.shown / (A.shown + A.noShow)) * 100), 'Appointments tab show rate is on resulted appointments')
ok(A.unresulted === A.occurredNotResulted && A.occurred === A.shown + A.noShow + A.unresulted, 'Appointments tab: occurred = shown + no-show + unresulted')
ok(A.byUser.every((u) => u.showRate == null || u.showRate === Math.round((u.shown / (u.shown + u.noShow)) * 100)), 'per-user show rate on the same basis')
const cp = await buildCalPerf(DEMO_LOCATION, from, to)
ok('unresulted' in cp.totals && cp.calendars.every((c) => c.unresulted >= 0), 'Calendars tab carries unresulted per calendar')
const up = await buildUserPerformance(DEMO_LOCATION, from, to)
ok(up.users.every((u) => u.showRate == null || u.showRate === Math.round((u.shown / (u.shown + u.noShow)) * 100)), 'Users tab show rate on resulted appointments')

// Monthly report deals: lost on both bases, each with reasons and a value.
const md = await monthlyDeals(DEMO_LOCATION, from, to)
ok(md.lost.total.count > 0 && md.lostCreatedOn.total.count > 0 && md.lost.total.count !== md.lostCreatedOn.total.count, 'lost by status change and lost by created-on are both present and differ')
// Dates on a deal are UTC days; the window is the client's local month, so a
// lead created late on the last UTC day before the month can sit inside it.
const dayBefore = new Date(Date.parse(from) - 86400000).toISOString().slice(0, 10), dayAfter = new Date(Date.parse(to) + 86400000).toISOString().slice(0, 10)
ok(md.lostCreatedOn.deals.every((d) => d.createdAt >= dayBefore && d.createdAt <= dayAfter), 'created-on lost deals all have their lead created in the month')
ok(md.lostCreatedOn.byReason.reduce((a, r) => a + r.value, 0) === md.lostCreatedOn.total.value, 'reasons sum to the value lost')

// Windsor surface
ok(demoWindsor('googleanalytics4', ['account_id', 'sessions'], from, to)[0].account_id === DEMO_GA4_PROP, 'GA4 totals row')
ok(demoWindsor('ga4', ['account_id', 'date', 'sessions'], from, to).length === 30, 'GA4 daily rows for 30 days')
ok(demoWindsor('googleanalytics4', ['account_id', 'landing_page', 'sessions'], from, to).length >= 6, 'GA4 landing pages')
ok(demoWindsor('google_ads', ['account_id', 'campaign', 'ad_group_name', 'keyword_text', 'match_type', 'quality_score', 'spend'], from, to).every((r) => r.keyword_text && r.quality_score), 'Google keyword rows')
ok(demoWindsor('google_ads', ['account_id', 'campaign', 'ad_group_name', 'search_term', 'spend'], from, to).every((r) => r.search_term), 'Google search-term rows')
const meta = demoWindsor('facebook', ['account_id', 'campaign', 'ad_name', 'thumbnail_url', 'spend'], from, to)
ok(meta.every((r) => r.thumbnail_url.startsWith('data:image/svg+xml')) && meta.some((r) => r.actions_video_view > 0), 'Meta ads carry a thumbnail and some are video')
console.log(`${n} assertions, ${f} failed`)
if (f) process.exit(1)
