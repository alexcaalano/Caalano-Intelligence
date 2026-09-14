// @needs-fake-blobs
// Meta "Results" match Ads Manager: each row reports its own optimisation
// event (lead forms, a custom conversion by name, reach for awareness), the
// client's configured primary is only the fallback for an unreadable goal,
// and the hover lists every action the row accrued, custom conversions
// included. Fixture rows are a real 30-day pull for one account, where the
// old blanket injection made 65 leads read as 86.
process.env.AUTH_SECRET = 'test-secret'
import assert from 'node:assert/strict'
const { _rollupMeta: rollupMeta, _resolveMetaResult: resolveMetaResult, _promotedCustomId: promotedCustomId } = await import('../netlify/functions/windsor.mjs')

const PAGE = JSON.stringify({ page_id: '426741757185139', smart_pse_enabled: false })
const CUSTOM = JSON.stringify({ pixel_id: '1600248710835485', custom_event_type: 'OTHER', custom_conversion_id: '1358086299689101', smart_pse_enabled: false })
const A = 'CDc_08_Leads_AlliedHealth_Local_Melb', B = 'CD_12_Page_View_A_ADHD_Assessments_New', C = 'CD_01_Lead Gen_Consultation_ADHD Assessments', D = 'CDc_06_Impressions'
const camp = (campaign, o) => ({ account_id: '538799668712983', campaign, ...o })
const campRows = [
  camp(A, { spend: 3558.16, impressions: 101692, inline_link_clicks: 648, reach: 35907, actions_onsite_conversion_lead_grouped: 65, actions_onsite_conversion_messaging_conversation_started_7d: 2, actions_landing_page_view: 55 }),
  camp(B, { spend: 2649.63, impressions: 127675, inline_link_clicks: 1974, reach: 51236, actions_onsite_conversion_messaging_conversation_started_7d: 4, actions_landing_page_view: 1826 }),
  camp(C, { spend: 736.76, impressions: 29208, inline_link_clicks: 242, reach: 17188, actions_onsite_conversion_lead_grouped: 14, actions_landing_page_view: 9 }),
  camp(D, { spend: 150.29, impressions: 25429, inline_link_clicks: 47, reach: 2126, actions_landing_page_view: 32 }),
]
const adsetRows = [
  camp(A, { adset_name: 'CDas_004_Allied Health_MEL_INT_Adv+', adset_optimization_goal: 'LEAD_GENERATION', adset_destination_type: 'ON_AD', adset_promoted_object: PAGE, spend: 3558.16, reach: 35907, inline_link_clicks: 648, actions_onsite_conversion_lead_grouped: 65, actions_onsite_conversion_messaging_conversation_started_7d: 2 }),
  camp(B, { adset_name: 'CD_01_Broad', adset_optimization_goal: 'OFFSITE_CONVERSIONS', adset_destination_type: 'UNDEFINED', adset_promoted_object: CUSTOM, spend: 2649.63, reach: 51236, inline_link_clicks: 1974, actions_onsite_conversion_messaging_conversation_started_7d: 4 }),
  camp(C, { adset_name: 'CD_01_Broad_Syd+Melb+Perth', adset_optimization_goal: 'LEAD_GENERATION', adset_destination_type: 'ON_AD', adset_promoted_object: PAGE, spend: 736.76, reach: 17188, inline_link_clicks: 242, actions_onsite_conversion_lead_grouped: 14 }),
  camp(D, { adset_name: 'CDas_01_Ret_Leads', adset_optimization_goal: 'IMPRESSIONS', adset_destination_type: 'UNDEFINED', adset_promoted_object: PAGE, spend: 150.29, reach: 2126, inline_link_clicks: 47 }),
]
const adRows = [
  camp(B, { adset_name: 'CD_01_Broad', ad_name: 'B ad 1', spend: 2000, inline_link_clicks: 1500 }),
  camp(B, { adset_name: 'CD_01_Broad', ad_name: 'B ad 2', spend: 649.63, inline_link_clicks: 474 }),
  camp(A, { adset_name: 'CDas_004_Allied Health_MEL_INT_Adv+', ad_name: 'A ad', spend: 3558.16, actions_onsite_conversion_lead_grouped: 65 }),
]
const names = new Map([['1358086299689101', 'A_event_pageview'], ['958499050169954', 'L_event_pageview']])
const pc = (o) => new Map(Object.entries(o))
const perCamp = new Map([
  [A, pc({ offsite_conversion_custom_1358086299689101: 21, a_event_pageview: 21, offsite_conversion_custom_958499050169954: 5, l_event_pageview: 5, lead: 65, link_click: 648 })],
  [B, pc({ offsite_conversion_custom_1358086299689101: 64, a_event_pageview: 64, offsite_conversion_custom_958499050169954: 45, l_event_pageview: 45 })],
  [C, pc({ offsite_conversion_custom_1358086299689101: 5, a_event_pageview: 5, lead: 14 })],
])
const ccData = { names, perCamp, total: new Map() }
// The client's configured primary is the on-Facebook lead plus the custom event.
const fallback = { field: 'actions_onsite_conversion_lead_grouped', fields: ['actions_onsite_conversion_lead_grouped', 'cc:id:1358086299689101'], label: 'Lead - on-Facebook +1 more', extra: [] }

assert.equal(promotedCustomId(CUSTOM), '1358086299689101'); assert.equal(promotedCustomId(PAGE), null)
assert.deepEqual(resolveMetaResult({ adset_optimization_goal: 'OFFSITE_CONVERSIONS', adset_promoted_object: CUSTOM }, names), { field: 'cc:id:1358086299689101', label: 'A_event_pageview', custom: '1358086299689101' })
assert.deepEqual(resolveMetaResult({ adset_optimization_goal: 'IMPRESSIONS' }), { field: 'reach', label: 'Reach' })
assert.equal(resolveMetaResult({ adset_optimization_goal: 'OFFSITE_CONVERSIONS', adset_promoted_object: JSON.stringify({ custom_event_type: 'OTHER' }) }), null, 'no id: the configured primary decides')

const roll = rollupMeta(adRows, [], campRows, campRows, adsetRows, [], fallback, [], ccData)
const by = Object.fromEntries(roll.campaigns.map((c) => [c.name, c]))
// Headline = the row's own optimisation event, as Ads Manager shows it.
assert.equal(by[A].results, 65); assert.equal(by[A].resultType, 'On-Facebook leads'); assert.equal(by[A].costPerResult, 54.74)
assert.equal(by[B].results, 64); assert.equal(by[B].resultType, 'A_event_pageview'); assert.equal(by[B].costPerResult, 41.4)
assert.equal(by[C].results, 14); assert.equal(by[C].resultType, 'On-Facebook leads')
assert.equal(by[D].results, 2126); assert.equal(by[D].resultType, 'Reach')
// Hover = every action, custom conversions by name, the primary among them.
assert.deepEqual(by[A].breakdown, [{ label: 'On-Facebook leads', count: 65 }, { label: 'A_event_pageview', count: 21 }, { label: 'L_event_pageview', count: 5 }, { label: 'Messaging conversations', count: 2 }])
assert.deepEqual(by[B].breakdown, [{ label: 'A_event_pageview', count: 64 }, { label: 'L_event_pageview', count: 45 }, { label: 'Messaging conversations', count: 4 }])
assert.deepEqual(by[D].breakdown, [])
// Ad sets carry the same, and the account total is per result type.
const as = Object.fromEntries(roll.adsets.map((a) => [a.name, a]))
assert.equal(as['CD_01_Broad'].results, 64); assert.equal(as['CD_01_Broad'].resultType, 'A_event_pageview')
assert.equal(as['CDas_01_Ret_Leads'].results, 2126)
assert.deepEqual(roll.totals.resultBreakdown, [{ label: 'Reach', count: 2126 }, { label: 'On-Facebook leads', count: 79 }, { label: 'A_event_pageview', count: 64 }])
// Ads inside a custom-conversion ad set share the campaign's count by spend.
const ads = Object.fromEntries(roll.ads.map((a) => [a.name, a]))
assert.equal(ads['B ad 1'].results + ads['B ad 2'].results, 64); assert.equal(ads['B ad 1'].resultType, 'A_event_pageview'); assert.ok(ads['B ad 1'].results > ads['B ad 2'].results)
assert.equal(ads['A ad'].results, 65)
// Without the custom data (a client with no custom conversions) nothing custom appears and nothing breaks.
const plain = rollupMeta([], [], campRows, campRows, adsetRows.filter((r) => r.campaign !== B), [], null, [])
assert.equal(Object.fromEntries(plain.campaigns.map((c) => [c.name, c.results]))[A], 65)
assert.equal(Object.fromEntries(plain.campaigns.map((c) => [c.name, c.resultType]))[B], 'Leads', 'no ad set and no primary: the plain lead count')
console.log('metaresults_test: ok')
