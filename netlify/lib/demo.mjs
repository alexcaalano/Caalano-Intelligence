// ---------------------------------------------------------------------------
// Demo account - a complete, self-consistent fake clinic.
//
// The trick here is WHERE the data is faked. Rather than stubbing each view's
// output (55 scopes, every one a different shape, all of which would drift the
// moment a builder changed), this fakes the GoHighLevel API *responses*. Every
// real builder - blend, attribution, cohorts, forms, appointments, timing,
// clinic, calendar performance - then runs its genuine logic over synthetic
// input. Two consequences worth having:
//
//   * every tab agrees with every other, because they are all derived from one
//     dataset by the same code that derives the real ones;
//   * the demo cannot rot. A change to a builder flows into the demo for free,
//     and there is no second implementation to keep in step.
//
// Everything is generated from a fixed seed, so the numbers are identical on
// every load and across every viewer - a demo that changes shape mid-pitch is
// worse than no demo.
// ---------------------------------------------------------------------------

export const DEMO_LOCATION = 'demo-norwest-mdc'
export const DEMO_META_ACCT = '900000000000001'
export const DEMO_GOOGLE_ACCT = '900-000-0001'
export const DEMO_CLIENT_ID = 'norwest-mdc'
export const DEMO_GA4_PROP = '900000001'
export const isDemoLocation = (id) => String(id || '') === DEMO_LOCATION
// locationToken() hands this back for the demo location; ghlGet/ghlPost see the
// prefix and answer from here instead of going to the network.
export const DEMO_TOKEN = 'demo::norwest'
export const isDemoToken = (t) => String(t || '').startsWith('demo::')

// ---- deterministic RNG ----------------------------------------------------
// mulberry32: small, fast, and stable across runtimes - the same seed gives the
// same clinic on every cold start, which is what makes the demo cacheable and
// repeatable.
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length]
const between = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1))
const chance = (r, p) => r() < p
const id16 = (r) => { let s = ''; const c = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'; for (let i = 0; i < 20; i++) s += c[Math.floor(r() * c.length)]; return s }
const iso = (ms) => new Date(ms).toISOString()
const DAY = 86400000

// ---- the practice ---------------------------------------------------------
const PRACTITIONERS = [
  { name: 'Dr Amelia Nguyen', discipline: 'Physiotherapy', fee: 110 },
  { name: 'Josh Fairweather', discipline: 'Physiotherapy', fee: 110 },
  { name: 'Dr Priya Raghavan', discipline: 'Chiropractic', fee: 95 },
  { name: 'Hannah Boyle', discipline: 'Psychology', fee: 220 },
  { name: 'Dr Marcus Webb', discipline: 'Psychology', fee: 220 },
  { name: 'Sophie Tran', discipline: 'Occupational Therapy', fee: 190 },
]
const DISCIPLINES = ['Physiotherapy', 'Chiropractic', 'Psychology', 'Occupational Therapy']
// The funnel the user demos: enquiry -> discovery call booked -> attended ->
// initial appointment booked -> attended -> ongoing care.
const STAGES = [
  'New Enquiry',
  'Contacted',
  'Appointment Booked',
  'Appointment Attended',
  'Treatment Plan Active',
]
const HEARD = ['Instagram', 'Facebook', 'Google', 'Friend Recommended', 'GP Referral', 'Other']
// Where the patients live: the Hills district around the clinic, thinning out
// with distance, so the Location tab and the catchment map have a real shape.
const PLACES = [
  ['2153', 'Baulkham Hills', 14], ['2153', 'Bella Vista', 5], ['2153', 'Norwest', 4], ['2154', 'Castle Hill', 18], ['2155', 'Kellyville', 9], ['2155', 'Rouse Hill', 5],
  ['2125', 'West Pennant Hills', 5], ['2126', 'Cherrybrook', 5], ['2768', 'Stanhope Gardens', 4], ['2768', 'Glenwood', 3], ['2151', 'North Rocks', 4], ['2118', 'Carlingford', 5],
  ['2150', 'Parramatta', 4], ['2145', 'Westmead', 3], ['2148', 'Blacktown', 3], ['2147', 'Seven Hills', 2], ['2763', 'Quakers Hill', 3], ['2762', 'Schofields', 2],
  ['2765', 'Box Hill', 2], ['2156', 'Glenhaven', 2], ['2158', 'Dural', 2], ['2114', 'Meadowbank', 1], ['2115', 'Ermington', 1], ['2000', 'Sydney', 1],
]
const PLACE_W = PLACES.reduce((t, p) => t + p[2], 0)
const pickPlace = (r) => { let x = r() * PLACE_W; for (const p of PLACES) { x -= p[2]; if (x <= 0) return p } return PLACES[0] }
const STREETS = ['Windsor Road', 'Old Northern Road', 'Showground Road', 'Excelsior Avenue', 'Seven Hills Road', 'Merindah Road', 'Gilbert Road', 'Aiken Road', 'Castle Street', 'Pennant Hills Road', 'Cecil Avenue', 'Crane Road']
// Lost reasons as the CRM stores them: an id per reason, the name looked up
// from the location's list - which is how the real builders read them.
const LOST_REASONS = ['Cost / no rebate', 'Went elsewhere', 'No longer needed', 'Wrong service', 'Could not get a suitable time', 'No answer after 3 attempts'].map((name, i) => ({ id: 'demoLR' + i, name }))
const OPP_CASH_FIELD = 'democf_opp_cash_collected'
const OPP_SERVICE_FIELD = 'democf_opp_service_sold'
const FIRST = ['Olivia', 'Jack', 'Charlotte', 'Noah', 'Amelia', 'Liam', 'Isla', 'William', 'Mia', 'Henry', 'Grace', 'Thomas', 'Chloe', 'Lucas', 'Zoe', 'Ethan', 'Ruby', 'Oliver', 'Ava', 'Leo', 'Harper', 'Max', 'Freya', 'Elijah', 'Sienna', 'Hugo', 'Poppy', 'Archie', 'Willow', 'Rafael']
const LAST = ['Whitfield', 'Kaur', 'O’Sullivan', 'Nguyen', 'Papadopoulos', 'Bennett', 'Rahman', 'Castellano', 'Okafor', 'Lindqvist', 'Moreau', 'Silva', 'Zhang', 'Ferreira', 'MacLeod', 'Haddad', 'Novak', 'Ellis', 'Tupou', 'Marchetti']

const META_CAMPAIGNS = [
  { name: 'NW_01_LeadGen_Physio_Broad', discipline: 'Physiotherapy' },
  { name: 'NW_02_LeadGen_Psychology_Broad', discipline: 'Psychology' },
  { name: 'NW_03_LeadGen_Chiro_Local', discipline: 'Chiropractic' },
  { name: 'NW_04_LeadGen_NDIS_OT', discipline: 'Occupational Therapy' },
]
const META_ADSETS = ['NW_Broad_25-55_Hills', 'NW_Interest_BackPain', 'NW_Lookalike_Patients_3pc', 'NW_Retarget_SiteVisitors_30d']
const META_ADS = [
  'NWa_11_Vid_Physio_BackPain_Testimonial_9x16',
  'NWa_12_Img_Physio_Team_Clinic_1x1',
  'NWa_21_Vid_Psych_Anxiety_Practitioner_9x16',
  'NWa_22_Img_Psych_Medicare_Rebate_1x1',
  'NWa_31_Vid_Chiro_Adjustment_Explainer_9x16',
  'NWa_41_Img_OT_NDIS_Kids_1x1',
]
const GOOGLE_CAMPAIGNS = [
  { name: 'NW_Search_Physio_Norwest', discipline: 'Physiotherapy' },
  { name: 'NW_Search_Psychologist_Hills', discipline: 'Psychology' },
  { name: 'NW_Search_Chiropractor_NearMe', discipline: 'Chiropractic' },
]
const GOOGLE_ADGROUPS = ['Physio - Exact', 'Back Pain - Phrase', 'Psychologist - Exact', 'Chiro - Exact']

// ---- the dataset ----------------------------------------------------------
// Built once per cold start and reused. ~150 days of history so year-to-date,
// quarter and month windows all have something in them.
let _cache = null
export function demoData() {
  if (_cache) return _cache
  const r = rng(20260825)
  const now = Date.now()
  const today = new Date(now); today.setUTCHours(0, 0, 0, 0)
  const t0 = today.getTime()
  const HISTORY = 150

  const pipelineId = 'demoPipeNorwest01'
  const stages = STAGES.map((name, i) => ({ id: `demoStage${String(i).padStart(2, '0')}`, name, position: i }))
  const users = PRACTITIONERS.map((p, i) => ({
    id: `demoUser${String(i).padStart(2, '0')}`, name: p.name, email: `${p.name.toLowerCase().replace(/[^a-z]+/g, '.')}@norwestmdc.com.au`,
    firstName: p.name.split(' ').slice(-2, -1)[0] || p.name, lastName: p.name.split(' ').pop(), roles: { type: 'account', role: 'user' },
  }))
  // Front desk books most discovery calls, so intake sits with two coordinators
  // rather than the practitioners - which is what makes the Users tab interesting.
  const coordinators = [
    { id: 'demoUser90', name: 'Rachel Fields', email: 'rachel@norwestmdc.com.au', roles: { type: 'account', role: 'user' } },
    { id: 'demoUser91', name: 'Daniel Osei', email: 'daniel@norwestmdc.com.au', roles: { type: 'account', role: 'user' } },
  ]
  const allUsers = [...coordinators, ...users]

  // Calendars: one discovery-call calendar (triage) + a service calendar per
  // discipline (clinical). This is exactly the shape the Clinic settings tab
  // classifies by type, so the demo exercises that logic rather than dodging it.
  // Opening hours per calendar, because utilisation measures booked time against
  // them. The eight service calendars are four practitioners with two service
  // types each, not eight people - declaring a full week on all eight would claim
  // 400 hours of weekly capacity for four staff and drive utilisation to single
  // digits. So each discipline gets one clinician's week, split across their two
  // calendars: a day of initial consults, three days of follow-ups.
  const mkHours = (days, openHour, closeHour) => days.map((x) => ({ daysOfTheWeek: [x], hours: [{ openHour, openMinute: 0, closeHour, closeMinute: 0 }] }))
  const initHours = mkHours([2], 9, 14)             // one clinic day of new patients
  const fupHours = mkHours([1, 3, 4], 8, 14)        // three days of returning patients
  const calendars = [
    ...DISCIPLINES.map((d, i) => ({ id: `demoCalInit${i}`, locationId: DEMO_LOCATION, name: `${d} Initial Consult`, calendarType: 'service', isActive: true, openHours: initHours, slotDuration: 45 })),
    ...DISCIPLINES.map((d, i) => ({ id: `demoCalFup${i}`, locationId: DEMO_LOCATION, name: `${d} Follow-up`, calendarType: 'service', isActive: true, openHours: fupHours, slotDuration: 30 })),
  ]

  const opportunities = []
  const contacts = []
  const events = []
  const notesByContact = new Map()

  const mkAttribution = (ch, disc) => {
    if (ch === 'meta') {
      const c = META_CAMPAIGNS.find((x) => x.discipline === disc) || META_CAMPAIGNS[0]
      const ad = META_ADS.find((a) => a.includes(disc.slice(0, 5))) || pick(r, META_ADS)
      return { utmSource: 'facebook', sessionSource: 'Paid Social', medium: 'facebook', campaign: c.name, utmMedium: pick(r, META_ADSETS), utmContent: ad, adId: `1202${between(r, 10000000, 99999999)}`, isFirst: true, url: 'https://norwestmdc.com.au/book' }
    }
    if (ch === 'google') {
      const c = GOOGLE_CAMPAIGNS.find((x) => x.discipline === disc) || GOOGLE_CAMPAIGNS[0]
      return { utmSource: 'google', sessionSource: 'Paid Search', medium: 'cpc', campaign: c.name, utmMedium: pick(r, GOOGLE_ADGROUPS), utmContent: pick(r, GOOGLE_ADGROUPS), isFirst: true, url: 'https://norwestmdc.com.au/physiotherapy' }
    }
    if (ch === 'referral') return { sessionSource: 'Referral', medium: 'referral', referrer: 'https://healthdirect.gov.au', isFirst: true }
    // No utm_source here on purpose: any mention of "google" would be classified
    // as paid search by channelOf(), which is how organic silently becomes Google.
    return { sessionSource: 'Organic', medium: 'organic', referrer: 'https://norwestmdc.com.au', isFirst: true }
  }

  // Lead volume climbs gently over the period - a flat line reads as fake.
  for (let d = HISTORY; d >= 0; d--) {
    const dayMs = t0 - d * DAY
    const dow = new Date(dayMs).getUTCDay()
    if (dow === 0) continue                       // closed Sundays
    const ramp = 1 + (HISTORY - d) / HISTORY * 0.55
    const base = dow === 6 ? 1.6 : 3.5
    const nLeads = Math.max(0, Math.round(base * ramp + (r() * 2.2 - 1.1)))
    for (let i = 0; i < nLeads; i++) {
      const disc = pick(r, DISCIPLINES)
      const chRoll = r()
      const ch = chRoll < 0.5 ? 'meta' : chRoll < 0.74 ? 'google' : chRoll < 0.87 ? 'organic' : 'referral'
      const createdMs = dayMs + between(r, 8, 19) * 3600000 + between(r, 0, 59) * 60000
      const cid = id16(r), oid = id16(r)
      const name = `${pick(r, FIRST)} ${pick(r, LAST)}`
      const prac = pick(r, PRACTITIONERS.filter((p) => p.discipline === disc))
      const pracUser = users[PRACTITIONERS.indexOf(prac)]
      const coord = pick(r, coordinators)
      const age = (now - createdMs) / DAY

      // Funnel. Paid converts a little worse than referral at the top and a
      // little better in the middle - which is the story the demo tells.
      const contacted = chance(r, ch === 'referral' ? 0.95 : 0.88)
      const bookedInitial = contacted && chance(r, ch === 'referral' ? 0.74 : ch === 'meta' ? 0.55 : 0.62)
      const attendedInitial = bookedInitial && chance(r, 0.87)
      const ongoing = attendedInitial && chance(r, 0.66)
      // Anything that hasn't moved in a fortnight is done, not "in progress".
      const settled = age > 14

      let stageIdx = 0
      if (ongoing) stageIdx = 4; else if (attendedInitial) stageIdx = 3
      else if (bookedInitial) stageIdx = 2; else if (contacted) stageIdx = 1
      const won = ongoing && settled
      const lost = settled && !ongoing && chance(r, 0.82)
      const status = won ? 'won' : lost ? 'lost' : 'open'
      // A care plan, not a single visit - that's what makes clinic LTV interesting.
      const planVisits = won ? between(r, 5, 16) : (attendedInitial ? between(r, 1, 4) : 0)
      // Won deals carry the care plan's value. Open and lost deals that got as far
      // as a booking carry the estimate the front desk entered, so the pipeline
      // has a value and lost revenue is a number rather than a blank.
      const value = won ? planVisits * prac.fee : (bookedInitial ? between(r, 4, 8) * prac.fee : 0)
      // Cash collected on the won deal: most paid in full, some part-way through
      // the plan, a few not yet entered - so the Cash Collected toggle has every
      // state to show.
      const cashRoll = r()
      const cash = won ? (cashRoll < 0.6 ? value : cashRoll < 0.9 ? Math.round(value * (0.4 + r() * 0.4)) : null) : null
      const place = pickPlace(r)
      const address = { address1: `${between(r, 1, 180)} ${pick(r, STREETS)}`, city: place[1], state: 'NSW', postalCode: place[0], country: 'AU' }
      const deliveredVisits = attendedInitial ? planVisits : 0
      const statusAtMs = createdMs + between(r, 3, 26) * DAY

      const att = mkAttribution(ch, disc)
      opportunities.push({
        id: oid, name, pipelineId, pipelineStageId: stages[stageIdx].id, status,
        monetaryValue: value, source: ch === 'meta' ? 'Facebook' : ch === 'google' ? 'Google' : ch === 'referral' ? 'Referral' : 'Website',
        createdAt: iso(createdMs), updatedAt: iso(Math.min(now, statusAtMs)),
        lastStatusChangeAt: status === 'open' ? iso(createdMs + between(r, 1, 6) * DAY) : iso(statusAtMs),
        lastStageChangeAt: iso(createdMs + between(r, 1, 9) * DAY),
        contactId: cid, assignedTo: bookedInitial ? pracUser.id : coord.id,
        contact: { id: cid, name, email: `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com.au`, phone: `+6149${between(r, 1000000, 9999999)}`, tags: bookedInitial ? ['customer booked appointment'] : [], ...address },
        attributions: [att],
        lostReasonId: lost ? pick(r, LOST_REASONS).id : null,
        customFields: won ? [
          ...(cash != null ? [{ id: OPP_CASH_FIELD, fieldValueNumber: cash }] : []),
          { id: OPP_SERVICE_FIELD, fieldValueString: `${disc} care plan` },
        ] : [],
        _address: address,
      })

      // Calendar events. Discovery calls on the triage calendar; the initial
      // appointment on that discipline's service calendar.
      if (bookedInitial) {
        const di = DISCIPLINES.indexOf(disc)
        const bookedAtMs = createdMs + between(r, 0, 3) * DAY + between(r, 1, 8) * 3600000
        let visitMs = bookedAtMs + between(r, 2, 12) * DAY + between(r, 8, 16) * 3600000
        const total = Math.max(1, planVisits || 1)
        for (let v = 0; v < total; v++) {
          if (visitMs > now + 45 * DAY) break
          const attended = v === 0 ? attendedInitial : chance(r, 0.9)
          events.push({
            id: id16(r), calendarId: v === 0 ? `demoCalInit${di}` : `demoCalFup${di}`, locationId: DEMO_LOCATION, contactId: cid,
            title: `${name} x Norwest MDC | ${disc} ${v === 0 ? 'Initial Consult' : 'Follow-up'}`,
            appointmentStatus: visitMs > now ? 'confirmed' : (attended ? 'showed' : (chance(r, 0.6) ? 'noshow' : 'cancelled')),
            startTime: iso(visitMs), endTime: iso(visitMs + (v === 0 ? 45 : 30) * 60000),
            dateAdded: iso(v === 0 ? bookedAtMs : visitMs - between(r, 3, 20) * DAY),
            assignedUserId: pracUser.id, createdBy: { source: v === 0 ? 'booking_widget' : 'user' },
          })
          visitMs += between(r, 7, 21) * DAY
        }
      }

      // Contact record, carrying the practice-management fields the Clinic tab reads.
      const attendedVisits = attendedInitial ? planVisits : 0
      const spent = attendedVisits * prac.fee
      const upcoming = won && chance(r, 0.55) ? between(r, 1, 3) : 0
      const firstVisitMs = bookedInitial ? createdMs + between(r, 5, 16) * DAY : null
      contacts.push({
        id: cid, locationId: DEMO_LOCATION, firstName: name.split(' ')[0], lastName: name.split(' ')[1],
        contactName: name, email: `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com.au`,
        phone: `+6149${between(r, 1000000, 9999999)}`, dateAdded: iso(createdMs), dateUpdated: iso(now - between(r, 0, 3) * DAY),
        ...address,
        tags: ['patient'], source: ch === 'meta' ? 'Facebook' : 'Website',
        attributionSource: att, lastAttributionSource: att,
        _clinic: {
          patient_id: attendedVisits > 0 ? String(between(r, 10000, 99999)) : '',
          total_amount_spent: attendedVisits > 0 ? spent : '',
          total_amount_paid: attendedVisits > 0 ? Math.round(spent * (chance(r, 0.85) ? 1 : 0.7)) : '',
          total_unpaid_balance: attendedVisits > 0 && chance(r, 0.14) ? Math.round(prac.fee * between(r, 1, 3)) : '',
          total_remaining_balance: '',
          total_spent_this_month: attendedVisits > 0 && chance(r, 0.3) ? prac.fee * between(r, 1, 3) : '',
          total_appointments: attendedVisits + (chance(r, 0.2) ? 1 : 0),
          total_arrived: attendedVisits,
          total_cancelled: chance(r, 0.18) ? 1 : 0,
          noshow_count: chance(r, 0.12) ? 1 : 0,
          upcoming_appt_count: upcoming,
          upcoming_appt_start_time: upcoming ? iso(now + between(r, 2, 21) * DAY) : '',
          upcoming_appt_practitioner: upcoming ? prac.name : '',
          upcoming_appt_type: upcoming ? `${disc} Follow-up` : '',
          first_appointment_date: firstVisitMs ? iso(firstVisitMs).slice(0, 10) : '',
          first_visit_date: firstVisitMs ? iso(firstVisitMs).slice(0, 10) : '',
          last_appointment_date: attendedVisits > 0 ? iso(now - between(r, 1, 60) * DAY).slice(0, 10) : '',
          last_appt_practitioner: attendedVisits > 0 ? prac.name : '',
          last_appt_type: attendedVisits > 0 ? `${disc} ${attendedVisits > 1 ? 'Follow-up' : 'Initial Appointment'}` : '',
          last_appt_cancel_reason: chance(r, 0.1) ? pick(r, ['Unwell', 'Work commitment', 'Rescheduled', 'Transport']) : '',
          retention_status: attendedVisits === 0 ? '' : upcoming ? 'Active' : attendedVisits >= 4 ? 'Lapsing' : 'At risk',
          accepted_email_marketing: chance(r, 0.72) ? 'Yes' : '',
          accepted_sms_marketing: chance(r, 0.64) ? 'Yes' : '',
          how_did_you_hear_about_us: pick(r, HEARD),
          likelihood_to_recommend: attendedVisits > 1 && chance(r, 0.35) ? String(between(r, 7, 10)) : '',
          overall_satisfaction: attendedVisits > 1 && chance(r, 0.3) ? pick(r, ['Very Satisfied', 'Satisfied']) : '',
          last_updated_via_api: iso(now - between(r, 0, 1) * DAY),
        },
      })

      if (chance(r, 0.35)) {
        notesByContact.set(cid, [{
          id: id16(r), body: pick(r, [
            `Called - ${disc.toLowerCase()} enquiry, ${chance(r, 0.5) ? 'chronic' : 'recent'} presentation. Booked in with ${prac.name}.`,
            'Left voicemail, sent SMS with booking link.',
            `Asked about Medicare rebate / EPC referral. Explained gap fee. Happy to proceed.`,
            'NDIS plan-managed - confirmed plan details before booking.',
            `Prefers ${chance(r, 0.5) ? 'early morning' : 'after 4pm'} appointments. Noted for scheduling.`,
          ]),
          dateAdded: iso(createdMs + between(r, 1, 5) * 3600000),
          userId: coord.id,
        }])
      }
    }
  }

  // Form submissions - the entry point each lead actually came through. Meta
  // leads land on a lead form, everything else on the website enquiry form, so
  // the Forms tab's friction-vs-quality comparison has something real to show.
  const FORMS = [
    { id: 'demoForm1', name: 'NW_Physio_Assessment_Lead_Form' },
    { id: 'demoForm2', name: 'NW_Psychology_Intake_Lead_Form' },
    { id: 'demoForm3', name: 'Website Enquiry (Book an Appointment)' },
  ]
  const formSubmissions = []
  for (const o of opportunities) {
    const a = (o.attributions || [])[0] || {}
    const isMeta = String(a.utmSource || '') === 'facebook'
    const disc = String(a.campaign || '').includes('Psychology') ? 1 : 0
    const f = isMeta ? FORMS[disc] : FORMS[2]
    // Answers sit under `others`, which is where the real API puts them and where
    // the Forms builder reads them: the postcode feeds the Location tab, the
    // UTMs feed the per-form campaign list, a Meta lead form is named as one, and
    // the free-text answer gives the "written" segment kind something to show.
    const concern = pick(r, ['Back or neck pain', 'Sports injury', 'Anxiety or stress', 'Child development', 'Post-surgical rehab', 'NDIS supports'])
    const written = chance(r, 0.45) ? [
      pick(r, ['Lower back pain', 'Rolled my ankle at soccer', 'Stress at work is getting on top of me', 'Concerns about my son\'s coordination', 'Knee replacement rehab', 'Plan-managed NDIS participant', 'Headaches most days', 'Shoulder pain reaching overhead', 'Neck stiffness after a car accident', 'Post-natal pelvic floor', 'Tennis elbow that will not settle', 'Sleep has been terrible for months']),
      pick(r, ['for about', 'for roughly', 'for the last', 'since about']), `${between(r, 2, 11)} ${pick(r, ['weeks', 'weeks', 'months'])}`,
      pick(r, ['- worse in the mornings.', '- worse after sitting at work.', ', GP suggested I come in.', ', a friend recommended you.', ', would prefer a female practitioner.', ', can only do after 4pm.', ', happy to start this week.', '.']),
    ].join(' ').replace(' ,', ',') : null
    formSubmissions.push({
      id: 'demoSub' + o.id, formId: f.id, name: f.name, locationId: DEMO_LOCATION,
      contactId: o.contactId, createdAt: o.createdAt,
      others: {
        first_name: o.name.split(' ')[0], last_name: o.name.split(' ')[1], email: o.contact.email, phone: o.contact.phone,
        postal_code: o._address.postalCode,
        ...(isMeta ? { facebookFormName: f.name } : {}),
        eventData: { timestamp: Date.parse(o.createdAt), page: { url: a.url || 'https://norwestmdc.com.au/' }, url_params: isMeta || a.medium === 'cpc' ? { utm_source: a.utmSource, utm_medium: a.utmMedium, utm_campaign: a.campaign, utm_content: a.utmContent } : {} },
        'What are you seeking help with?': concern,
        'How soon would you like to be seen?': pick(r, ['This week', 'Within 2 weeks', 'This month', 'Just researching']),
        'Do you have a referral?': pick(r, ['GP referral (EPC)', 'NDIS plan', 'No referral - private', 'Not sure']),
        'Preferred days': pick(r, ['Weekdays', 'Weekdays', 'Saturday', 'Any']),
        ...(written ? { 'Anything else we should know?': written } : {}),
      },
    })
  }
  formSubmissions.sort((x, y) => Date.parse(y.createdAt) - Date.parse(x.createdAt))

  // Conversation activity for the two intake coordinators. The shape matters:
  // an automated acknowledgement with no user goes out first (so speed to lead
  // measures the human reply, not the autoresponder), most leads then get one to
  // three manual attempts, some are never worked, and a share of patients ring
  // back or reply - so Call Reporting has inbound and missed calls to show.
  const messages = []
  for (const o of opportunities) {
    const owner = coordinators.find((c) => c.id === o.assignedTo) || coordinators[0]
    const base = Date.parse(o.createdAt)
    const conv = 'demoConv' + o.contactId
    if (chance(r, 0.7)) messages.push({ id: id16(r), conversationId: conv, contactId: o.contactId, direction: 'outbound', messageType: 'TYPE_SMS', type: 'SMS', source: 'workflow', userId: null, dateAdded: iso(base + between(r, 1, 3) * 60000), status: 'delivered', meta: null, body: 'Thanks for reaching out to Norwest MDC - one of our team will call you shortly.' })
    if (chance(r, 0.08)) continue                    // never worked
    const attempts = between(r, 1, 3)
    let t = base
    for (let i = 0; i < attempts; i++) {
      const isCall = chance(r, 0.6)
      t += (i === 0 ? between(r, 4, 240) : between(r, 60, 2400)) * 60000
      messages.push({
        id: id16(r), conversationId: conv, contactId: o.contactId,
        direction: 'outbound', messageType: isCall ? 'TYPE_CALL' : 'TYPE_SMS', type: isCall ? 'CALL' : 'SMS', source: 'app',
        userId: owner.id, dateAdded: iso(t),
        status: isCall ? pick(r, ['completed', 'completed', 'no-answer', 'voicemail']) : 'delivered',
        meta: isCall ? { call: { duration: between(r, 20, 480), status: 'completed' } } : null,
        body: isCall ? '' : pick(r, ['Hi! Following up on your enquiry - are you free for a quick call?', 'Here is the booking link for your discovery call.', 'Just checking you got our message about your appointment.']),
      })
    }
    if (chance(r, 0.3)) {
      const missed = chance(r, 0.25)
      messages.push({ id: id16(r), conversationId: conv, contactId: o.contactId, direction: 'inbound', messageType: 'TYPE_CALL', type: 'CALL', source: 'app', userId: missed ? null : owner.id, dateAdded: iso(t + between(r, 30, 1800) * 60000), status: missed ? 'no-answer' : 'completed', meta: { call: { duration: missed ? 0 : between(r, 40, 600), status: missed ? 'no-answer' : 'completed' } }, body: '' })
    }
    if (chance(r, 0.25)) messages.push({ id: id16(r), conversationId: conv, contactId: o.contactId, direction: 'inbound', messageType: 'TYPE_SMS', type: 'SMS', source: 'app', userId: null, dateAdded: iso(t + between(r, 10, 600) * 60000), status: 'received', meta: null, body: pick(r, ['Yes please, tomorrow afternoon works.', 'Can I get a time after 4pm?', 'Thanks, booked online.', 'Do you take NDIS?']) })
  }
  messages.sort((x, y) => Date.parse(y.dateAdded) - Date.parse(x.dateAdded))

  _cache = { pipelineId, stages, users: allUsers, calendars, opportunities, contacts, events, notesByContact, formSubmissions, messages, forms: FORMS, seedNow: now }
  return _cache
}

// ---- GHL API surface ------------------------------------------------------
// Answers the same endpoints the builders call, in the same shapes. Anything
// not modelled returns a benign empty result rather than throwing, so a scope we
// haven't thought about degrades to "no data" instead of an error banner.
const CF_ID = (key) => 'democf_' + key
const CLINIC_FIELD_KEYS = [
  'patient_id', 'total_amount_spent', 'total_amount_paid', 'total_unpaid_balance', 'total_remaining_balance',
  'total_spent_this_month', 'total_appointments', 'total_arrived', 'total_cancelled', 'noshow_count',
  'upcoming_appt_count', 'upcoming_appt_start_time', 'upcoming_appt_practitioner', 'upcoming_appt_type',
  'first_appointment_date', 'first_visit_date', 'last_appointment_date', 'last_appt_practitioner',
  'last_appt_type', 'last_appt_cancel_reason', 'retention_status', 'accepted_email_marketing',
  'accepted_sms_marketing', 'how_did_you_hear_about_us', 'likelihood_to_recommend', 'overall_satisfaction',
  'last_updated_via_api',
]
const titleise = (k) => k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

export function demoGhl(path, query = {}, body = null) {
  const d = demoData()
  const p = String(path)

  if (p === '/opportunities/pipelines') {
    return { pipelines: [{ id: d.pipelineId, name: 'Patient Journey', locationId: DEMO_LOCATION, stages: d.stages }] }
  }
  if (p === '/opportunities/lost-reason') return { lostReasons: LOST_REASONS.map((x) => ({ ...x, locationId: DEMO_LOCATION })) }
  if (p === '/users/') return { users: d.users }
  if (p.startsWith('/locations/') && p.endsWith('/customFields')) {
    // Contact fields are the clinic's practice-management sync; opportunity
    // fields are the two the sales side fills on a won deal. The real API
    // filters by `model` and returns everything when it is not given.
    const contact = CLINIC_FIELD_KEYS.map((k, i) => ({ id: CF_ID(k), name: titleise(k), fieldKey: `contact.${k}`, model: 'contact', dataType: /date|time/.test(k) ? 'DATE' : /count|total|likelihood/.test(k) ? 'NUMERICAL' : 'TEXT', position: i * 50, locationId: DEMO_LOCATION }))
    const opp = [
      { id: OPP_CASH_FIELD, name: 'Cash Collected', fieldKey: 'opportunity.cash_collected', model: 'opportunity', dataType: 'MONETORY', position: 0, locationId: DEMO_LOCATION },
      { id: OPP_SERVICE_FIELD, name: 'Service Sold', fieldKey: 'opportunity.service_sold', model: 'opportunity', dataType: 'SINGLE_OPTIONS', position: 50, locationId: DEMO_LOCATION, options: DISCIPLINES.map((x) => `${x} care plan`) },
    ]
    const model = String(query.model || '').toLowerCase()
    return { customFields: model === 'opportunity' ? opp : model === 'contact' ? contact : [...contact, ...opp] }
  }
  if (p.startsWith('/locations/') && p.endsWith('/customValues')) {
    return { customValues: [{ id: 'demoCV1', name: 'Appointment Name', fieldKey: '{{ custom_values.appointment_name }}', value: 'Discovery Call', locationId: DEMO_LOCATION }] }
  }
  if (p.startsWith('/locations/') && p.endsWith('/tags')) {
    return { tags: ['patient', 'customer booked appointment', 'ndis', 'medicare-epc'].map((t, i) => ({ id: 'demoTag' + i, name: t })) }
  }
  if (/^\/locations\/[^/]+$/.test(p)) {
    return { location: { id: DEMO_LOCATION, name: 'Norwest Multi-Disciplinary', timezone: 'Australia/Sydney', website: 'https://norwestmdc.com.au', address: '12 Century Circuit', city: 'Norwest', state: 'NSW', country: 'AU', postalCode: '2153' } }
  }
  if (p === '/calendars/') return { calendars: d.calendars }
  if (p === '/calendars/services/catalog') {
    // The service calendars above already carry calendarType 'service', so the
    // separate Services-catalog surface is empty - which is the commoner setup.
    return { services: [] }
  }
  if (p === '/calendars/services/bookings') return { bookings: [] }
  if (p === '/calendars/events') {
    const calId = query.calendarId ? String(query.calendarId) : null
    const s = Number(query.startTime) || 0, e = Number(query.endTime) || Infinity
    const evs = d.events.filter((ev) => (!calId || ev.calendarId === calId) && (() => { const t = Date.parse(ev.startTime); return t >= s && t <= e })())
    return { events: evs }
  }
  if (p === '/opportunities/search') {
    // Newest-first with the same startAfter/startAfterId cursor contract the
    // real endpoint uses, so the pager's stop conditions behave identically.
    const sorted = [...d.opportunities].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    const limit = Math.min(100, Number(query.limit) || 100)
    let start = 0
    if (query.startAfterId) {
      const i = sorted.findIndex((o) => o.id === String(query.startAfterId))
      start = i >= 0 ? i + 1 : sorted.length
    }
    const page = sorted.slice(start, start + limit)
    const last = page[page.length - 1]
    return {
      opportunities: page,
      meta: { total: sorted.length, currentPage: Math.floor(start / limit) + 1, startAfterId: last ? last.id : null, startAfter: last ? Date.parse(last.createdAt) : null },
    }
  }
  if (p === '/contacts/search') {
    const limit = Math.min(100, Number((body && body.pageLimit) || 100))
    let start = 0
    if (body && body.searchAfter) {
      const afterId = Array.isArray(body.searchAfter) ? body.searchAfter[1] : null
      const i = d.contacts.findIndex((c) => c.id === afterId)
      start = i >= 0 ? i + 1 : d.contacts.length
    }
    const page = d.contacts.slice(start, start + limit).map((c) => ({
      ...c,
      customFields: Object.entries(c._clinic).filter(([, v]) => v !== '' && v != null).map(([k, v]) => ({ id: CF_ID(k), value: String(v) })),
      searchAfter: [Date.parse(c.dateAdded), c.id],
    }))
    return { contacts: page, total: d.contacts.length }
  }
  const notes = p.match(/^\/contacts\/([^/]+)\/notes$/)
  if (notes) return { notes: d.notesByContact.get(notes[1]) || [] }
  if (p === '/forms/') return { forms: d.forms.map((f) => ({ ...f, locationId: DEMO_LOCATION })) }
  if (p === '/forms/submissions') {
    // One submission per lead that came through a tracked form, so the Forms tab
    // shows the same people the funnel does rather than a separate population.
    // Honours the startAt/endAt window the way the real endpoint does, otherwise
    // the Forms tab counts the whole history against a 30-day funnel.
    const page = Math.max(1, Number(query.page) || 1)
    const limit = Math.min(100, Number(query.limit) || 100)
    const sAt = query.startAt ? Date.parse(String(query.startAt)) : -Infinity
    const eAt = query.endAt ? Date.parse(String(query.endAt)) + (String(query.endAt).length <= 10 ? DAY : 0) : Infinity
    const all = d.formSubmissions.filter((x) => { const t = Date.parse(x.createdAt); return t >= sAt && t < eAt })
    const slice = all.slice((page - 1) * limit, page * limit)
    return { submissions: slice, meta: { total: all.length, currentPage: page } }
  }
  if (p === '/conversations/messages/export') {
    // Outbound call + SMS activity per coordinator. `messages` must be an array -
    // an empty object here is what made the Call Reporting builder throw.
    return { messages: d.messages, meta: { total: d.messages.length } }
  }
  // Per-contact conversation lookups, used by speed to lead and the people
  // drills when the bulk export is not enough: one conversation per contact.
  if (p === '/conversations/search') {
    const cid = query.contactId ? String(query.contactId) : (body && body.contactId) || null
    const ids = new Set(d.messages.filter((m) => !cid || m.contactId === cid).map((m) => m.conversationId))
    const convs = [...ids].slice(0, Number(query.limit) || 20).map((id) => { const ms = d.messages.filter((m) => m.conversationId === id); return { id, locationId: DEMO_LOCATION, contactId: ms[0].contactId, lastMessageDate: ms[0].dateAdded, lastMessageDirection: ms[0].direction, lastMessageType: ms[0].messageType, unreadCount: 0 } })
    return { conversations: convs, total: convs.length }
  }
  const convMsgs = p.match(/^\/conversations\/([^/]+)\/messages$/)
  if (convMsgs) return { messages: { messages: d.messages.filter((m) => m.conversationId === convMsgs[1]), nextPage: false } }
  if (p.startsWith('/conversations')) return { conversations: [], messages: [], total: 0 }
  // Unmodelled endpoint: an empty envelope keeps the caller on its own
  // "no data" path rather than throwing an error into the view.
  return {}
}

// ---- Windsor (Meta / Google) surface --------------------------------------
// Ad rows are generated to AGREE with the CRM: spend is derived from the leads
// the dataset already produced at a believable cost per lead, so cost-per-key-
// event, ROAS and the Caalano360 blend all reconcile instead of telling three
// different stories.
let _ads = null
function demoAdRows() {
  if (_ads) return _ads
  const d = demoData()
  const r = rng(77123)
  const t0 = new Date(); t0.setUTCHours(0, 0, 0, 0)
  // Leads per (channel, campaign, ad, day) straight from the opportunities.
  const key = (o) => { const a = (o.attributions || [])[0] || {}; return a }
  const meta = [], google = []
  const byDay = new Map()
  for (const o of d.opportunities) {
    const a = key(o)
    const src = String(a.utmSource || '')
    const ch = src === 'facebook' ? 'meta' : src === 'google' && a.medium === 'cpc' ? 'google' : null
    if (!ch) continue
    const day = o.createdAt.slice(0, 10)
    const k = [ch, day, a.campaign, a.utmMedium, a.utmContent].join('|')
    byDay.set(k, (byDay.get(k) || 0) + 1)
  }
  for (const [k, leads] of byDay) {
    const [ch, date, campaign, adset, content] = k.split('|')
    // Cost per lead sits in a believable band and drifts by channel.
    const cpl = ch === 'meta' ? 38 + r() * 26 : 52 + r() * 34
    const spend = Math.round(leads * cpl * 100) / 100
    const impressions = Math.round(spend * (ch === 'meta' ? between(r, 55, 95) : between(r, 18, 34)))
    const clicks = Math.max(leads, Math.round(impressions * (ch === 'meta' ? 0.013 + r() * 0.012 : 0.055 + r() * 0.03)))
    const row = {
      date, account_id: ch === 'meta' ? DEMO_META_ACCT : DEMO_GOOGLE_ACCT,
      campaign, campaign_id: 'demo' + Math.abs(hash(campaign)), spend, impressions, clicks,
      inline_link_clicks: Math.round(clicks * 0.86), reach: Math.round(impressions / (1.4 + r() * 0.8)),
    }
    if (ch === 'meta') {
      meta.push({
        ...row, adset_name: adset, adset_id: 'demo' + Math.abs(hash(adset)), ad_name: content, ad_id: 'demo' + Math.abs(hash(content)),
        actions_lead: leads, actions_offsite_conversion_fb_pixel_lead: leads,
        thumbnail_url: thumbFor(content), instagram_permalink_url: '', quality_ranking: pick(r, ['ABOVE_AVERAGE', 'AVERAGE', 'BELOW_AVERAGE_35']),
        actions_video_view: /_vid_|video|reel/i.test(content) ? Math.round(clicks * (3 + r() * 5)) : 0,
        campaign_objective: 'OUTCOME_LEADS', adset_optimization_goal: 'LEAD_GENERATION', adset_destination_type: 'ON_AD', adset_promoted_object: 'lead_form',
      })
    } else {
      google.push({ ...row, ad_group_name: adset, ad_group_id: 'demo' + Math.abs(hash(adset)), conversions: leads, cost: spend })
    }
  }
  _ads = { meta, google }
  return _ads
}
// A stand-in creative image per ad: a coloured tile carrying the ad's short
// name, so the creative cards, the Ad Library and the fatigue view have a
// picture to show without fetching anything.
function thumbFor(name) {
  const hues = [258, 168, 216, 36, 330, 200, 350]
  const h = hues[Math.abs(hash(name)) % hues.length]
  const short = String(name || '').replace(/^NW_/, '').replace(/_/g, ' ').slice(0, 22).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><rect width="320" height="320" fill="hsl(${h} 55% 42%)"/><rect x="18" y="18" width="284" height="284" rx="18" fill="none" stroke="hsl(${h} 60% 70%)" stroke-width="3"/><text x="160" y="150" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="22" font-weight="700" fill="#fff">Norwest MDC</text><text x="160" y="186" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="15" fill="hsl(${h} 70% 90%)">${short}</text></svg>`
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg)
}
function hash(s) { let h = 0; const t = String(s); for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return h }

// Serve a Windsor connector request for the demo accounts. `fields` is honoured
// loosely - extra keys are harmless, and anything missing simply reads as 0/empty
// downstream, exactly as a real connector gap would.
const GA4_SLUGS = new Set(['googleanalytics4', 'google_analytics_4', 'google_analytics', 'ga4', 'google_analytics4'])
// Keywords per ad group, with the share of the group's spend each takes, and
// the search terms that matched them. Used only when the Google tab asks for
// keyword or search-term fields; the daily campaign rows stay as they are.
const KEYWORDS = {
  'Physio - Exact': [['physio norwest', 0.34, 8], ['physiotherapist castle hill', 0.28, 7], ['physio near me', 0.24, 6], ['baulkham hills physio', 0.14, 7]],
  'Back Pain - Phrase': [['back pain treatment', 0.4, 6], ['lower back pain physio', 0.35, 7], ['sciatica treatment', 0.25, 5]],
  'Psychologist - Exact': [['psychologist norwest', 0.38, 8], ['psychologist castle hill', 0.32, 7], ['anxiety counselling hills district', 0.3, 5]],
  'Chiro - Exact': [['chiropractor norwest', 0.4, 8], ['chiro castle hill', 0.33, 7], ['chiropractor near me', 0.27, 6]],
}
const SEARCH_TERMS = {
  'physio norwest': ['physio norwest', 'norwest physio open saturday', 'physio norwest business park'], 'physiotherapist castle hill': ['physiotherapist castle hill', 'castle hill physio bulk bill'], 'physio near me': ['physio near me', 'physio near me open now', 'physiotherapy near me'], 'baulkham hills physio': ['baulkham hills physio', 'physio baulkham hills'],
  'back pain treatment': ['back pain treatment', 'back pain treatment near me', 'best treatment for lower back pain'], 'lower back pain physio': ['lower back pain physio', 'physio for lower back pain'], 'sciatica treatment': ['sciatica treatment', 'sciatica physio castle hill'],
  'psychologist norwest': ['psychologist norwest', 'norwest psychologist medicare'], 'psychologist castle hill': ['psychologist castle hill', 'child psychologist castle hill'], 'anxiety counselling hills district': ['anxiety counselling hills district', 'anxiety psychologist hills'],
  'chiropractor norwest': ['chiropractor norwest', 'chiro norwest'], 'chiro castle hill': ['chiro castle hill', 'chiropractor castle hill'], 'chiropractor near me': ['chiropractor near me', 'chiropractor near me open today'],
}
function demoGoogleKeywordRows(rows, fields) {
  const r = rng(4411)
  const wantTerm = fields.includes('search_term'), wantDate = fields.includes('date')
  const out = []
  const agg = new Map()
  for (const rw of rows) { const k = wantDate ? [rw.date, rw.campaign, rw.ad_group_name].join('|') : [rw.campaign, rw.ad_group_name].join('|'); const e = agg.get(k) || { date: rw.date, campaign: rw.campaign, ag: rw.ad_group_name, spend: 0, impressions: 0, clicks: 0, conversions: 0 }; e.spend += rw.spend; e.impressions += rw.impressions; e.clicks += rw.clicks; e.conversions += rw.conversions; agg.set(k, e) }
  for (const e of agg.values()) {
    const kws = KEYWORDS[e.ag] || [[String(e.ag).toLowerCase(), 1, 6]]
    const match = /exact/i.test(e.ag) ? 'EXACT' : /phrase/i.test(e.ag) ? 'PHRASE' : 'BROAD'
    for (const [kw, share, qs] of kws) {
      const base = { account_id: DEMO_GOOGLE_ACCT, campaign: e.campaign, ad_group_name: e.ag, spend: Math.round(e.spend * share * 100) / 100, impressions: Math.round(e.impressions * share), clicks: Math.round(e.clicks * share), conversions: Math.round(e.conversions * share), cost: Math.round(e.spend * share * 100) / 100, ...(wantDate ? { date: e.date } : {}) }
      if (!wantTerm) { out.push({ ...base, keyword_text: kw, keyword: kw, match_type: match, search_keyword_match_type: match, quality_score: qs }); continue }
      const terms = SEARCH_TERMS[kw] || [kw]
      const w = terms.map((_, i) => (i === 0 ? 0.6 : 0.4 / Math.max(1, terms.length - 1)))
      terms.forEach((t, i) => { if (wantDate && i > 0 && r() < 0.5) return; out.push({ ...base, search_term: t, keyword_text: kw, spend: Math.round(base.spend * w[i] * 100) / 100, impressions: Math.round(base.impressions * w[i]), clicks: Math.round(base.clicks * w[i]), conversions: Math.round(base.conversions * w[i]) }) })
    }
  }
  return out
}
// GA4 rows that agree with the ad rows and the CRM: paid sessions follow the
// clicks the ad rows already carry, organic and direct sit on top, and key
// events are the leads the CRM created that day.
function demoGa4Rows(fields, from, to) {
  const r = rng(9090)
  const d = demoData()
  const { meta, google } = demoAdRows()
  const clicksByDay = new Map()
  for (const rw of [...meta, ...google]) clicksByDay.set(rw.date, (clicksByDay.get(rw.date) || 0) + rw.clicks)
  const leadsByDay = new Map()
  for (const o of d.opportunities) { const k = o.createdAt.slice(0, 10); leadsByDay.set(k, (leadsByDay.get(k) || 0) + 1) }
  const t0 = new Date(); t0.setUTCHours(0, 0, 0, 0)
  const start = from ? Date.parse(from) : t0.getTime() - 29 * DAY, end = to ? Date.parse(to) : t0.getTime()
  const days = []
  for (let t = start; t <= end; t += DAY) {
    const date = iso(t).slice(0, 10), dow = new Date(t).getUTCDay()
    const paid = Math.round((clicksByDay.get(date) || 0) * 0.92)
    const organic = Math.round((dow === 0 ? 22 : dow === 6 ? 30 : 46) * (1 + (t - start) / Math.max(DAY, end - start) * 0.25) + r() * 10)
    const sessions = paid + organic
    days.push({ date, sessions, engaged: Math.round(sessions * (0.54 + r() * 0.08)), conversions: Math.round((leadsByDay.get(date) || 0) * 0.85), pageViews: Math.round(sessions * (2.3 + r() * 0.6)), users: Math.round(sessions * 0.84), newUsers: Math.round(sessions * 0.6), events: Math.round(sessions * 7.2), dur: 88 + r() * 30, bounce: 0.38 + r() * 0.1 })
  }
  const tot = days.reduce((a, x) => ({ sessions: a.sessions + x.sessions, engaged: a.engaged + x.engaged, conversions: a.conversions + x.conversions, pageViews: a.pageViews + x.pageViews, users: a.users + x.users, newUsers: a.newUsers + x.newUsers, events: a.events + x.events }), { sessions: 0, engaged: 0, conversions: 0, pageViews: 0, users: 0, newUsers: 0, events: 0 })
  const row = (extra, share, eng = 0.58, bounce = 0.42) => ({ account_id: DEMO_GA4_PROP, sessions: Math.round(tot.sessions * share), engaged_sessions: Math.round(tot.sessions * share * eng), conversions: Math.round(tot.conversions * share), event_count: Math.round(tot.events * share), screen_page_views: Math.round(tot.pageViews * share), total_users: Math.round(tot.users * share), new_users: Math.round(tot.newUsers * share), bounce_rate: bounce, average_session_duration: 100, ...extra })
  const has = (f) => fields.includes(f)
  if (has('date')) return days.map((x) => ({ account_id: DEMO_GA4_PROP, date: x.date, sessions: x.sessions, engaged_sessions: x.engaged, conversions: x.conversions, screen_page_views: x.pageViews, total_users: x.users, new_users: x.newUsers, event_count: x.events, bounce_rate: x.bounce, average_session_duration: x.dur }))
  if (has('session_source')) return [['google', 'cpc', 0.27, 0.6], ['facebook', 'paid_social', 0.23, 0.52], ['instagram', 'paid_social', 0.08, 0.5], ['google', 'organic', 0.22, 0.66], ['(direct)', '(none)', 0.1, 0.62], ['healthdirect.gov.au', 'referral', 0.04, 0.7], ['instagram', 'social', 0.04, 0.48], ['bing', 'organic', 0.02, 0.6]].map(([src, med, sh, eng]) => row({ session_source: src, session_medium: med }, sh, eng))
  if (has('session_default_channel_grouping')) return [['Paid Search', 0.27, 0.6], ['Paid Social', 0.31, 0.51], ['Organic Search', 0.24, 0.66], ['Direct', 0.1, 0.62], ['Referral', 0.04, 0.7], ['Organic Social', 0.04, 0.48]].map(([g, sh, eng]) => row({ session_default_channel_grouping: g }, sh, eng))
  if (has('event_name')) return [['page_view', tot.pageViews, 0], ['session_start', tot.sessions, 0], ['user_engagement', tot.engaged, 0], ['scroll', Math.round(tot.sessions * 0.45), 0], ['click', Math.round(tot.sessions * 0.3), 0], ['form_start', Math.round(tot.sessions * 0.12), 0], ['form_submit', Math.round(tot.conversions * 0.8), Math.round(tot.conversions * 0.8)], ['book_appointment', Math.round(tot.conversions * 0.5), Math.round(tot.conversions * 0.5)], ['click_to_call', Math.round(tot.conversions * 0.35), Math.round(tot.conversions * 0.35)]].map(([n, c, k]) => ({ account_id: DEMO_GA4_PROP, event_name: n, event_count: c, conversions: k }))
  if (has('landing_page')) return [['/', 0.3, 0.56, 0.44], ['/physiotherapy', 0.18, 0.63, 0.37], ['/book', 0.14, 0.72, 0.25], ['/psychology', 0.12, 0.6, 0.4], ['/chiropractic', 0.08, 0.58, 0.42], ['/occupational-therapy', 0.06, 0.57, 0.43], ['/ndis', 0.05, 0.61, 0.39], ['/blog/back-pain-at-your-desk', 0.07, 0.41, 0.6]].map(([lp, sh, eng, b]) => row({ landing_page: lp }, sh, eng, b))
  if (has('device_category')) return [['mobile', 0.66, 0.55], ['desktop', 0.29, 0.64], ['tablet', 0.05, 0.58]].map(([dv, sh, eng]) => row({ device_category: dv }, sh, eng))
  return [row({}, 1)]
}
export function demoWindsor(connector, fields, from, to) {
  const { meta, google } = demoAdRows()
  const inRange = (rw) => (!from || rw.date >= from) && (!to || rw.date <= to)
  const fl = Array.isArray(fields) ? fields : String(fields || '').split(',')
  if (GA4_SLUGS.has(connector)) return demoGa4Rows(fl, from, to)
  if (connector === 'facebook') return meta.filter(inRange)
  if (connector === 'google_ads') {
    const rows = google.filter(inRange)
    return fl.includes('keyword_text') || fl.includes('keyword') || fl.includes('search_term') ? demoGoogleKeywordRows(rows, fl) : rows
  }
  if (connector === 'gohighlevel') {
    const d = demoData()
    return d.opportunities.filter((o) => { const day = o.createdAt.slice(0, 10); return (!from || day >= from) && (!to || day <= to) }).map((o) => ({
      account_id: DEMO_LOCATION, opportunity_status: o.status, opportunity_monetary_value: o.monetaryValue,
      opportunity_pipeline_id: o.pipelineId, opportunity_pipeline_stage_id: o.pipelineStageId,
      opportunity_created_at: o.createdAt, opportunity_source: o.source,
      pipeline_id: o.pipelineId, pipeline_name: 'Patient Journey',
    }))
  }
  return []
}
export const isDemoAdAccount = (acct) => {
  const n = String(acct || '').replace(/[^0-9]/g, '')
  return n !== '' && (n === DEMO_META_ACCT || n === String(DEMO_GOOGLE_ACCT).replace(/[^0-9]/g, ''))
}
