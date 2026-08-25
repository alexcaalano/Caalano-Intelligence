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
  'Booked Discovery Call',
  'Discovery Call Attended',
  'Booked Initial Appointment',
  'Initial Appointment Attended',
  'Ongoing Care Plan',
]
const HEARD = ['Instagram', 'Facebook', 'Google', 'Friend Recommended', 'GP Referral', 'Other']
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
  const calendars = [
    { id: 'demoCalDiscovery', locationId: DEMO_LOCATION, name: 'Discovery Call', calendarType: 'round_robin', isActive: true,
      openHours: [1, 2, 3, 4, 5].map((d) => ({ daysOfTheWeek: [d], hours: [{ openHour: 8, openMinute: 0, closeHour: 18, closeMinute: 0 }] })), slotDuration: 15 },
    ...DISCIPLINES.map((d, i) => ({
      id: `demoCalSvc${i}`, locationId: DEMO_LOCATION, name: `${d} - Initial Appointment`, calendarType: 'service', isActive: true,
      openHours: [1, 2, 3, 4, 5].map((x) => ({ daysOfTheWeek: [x], hours: [{ openHour: 8, openMinute: 0, closeHour: 18, closeMinute: 0 }] })), slotDuration: 45,
    })),
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
      const bookedDisc = contacted && chance(r, ch === 'referral' ? 0.82 : ch === 'meta' ? 0.62 : 0.68)
      const attendedDisc = bookedDisc && chance(r, 0.79)
      const bookedInitial = attendedDisc && chance(r, ch === 'referral' ? 0.78 : 0.66)
      const attendedInitial = bookedInitial && chance(r, 0.86)
      const ongoing = attendedInitial && chance(r, 0.68)
      // Anything that hasn't moved in a fortnight is done, not "in progress".
      const settled = age > 14

      let stageIdx = 0
      if (ongoing) stageIdx = 6; else if (attendedInitial) stageIdx = 5; else if (bookedInitial) stageIdx = 4
      else if (attendedDisc) stageIdx = 3; else if (bookedDisc) stageIdx = 2; else if (contacted) stageIdx = 1
      const won = ongoing && settled
      const lost = settled && !ongoing && chance(r, 0.82)
      const status = won ? 'won' : lost ? 'lost' : 'open'
      // A care plan, not a single visit - that's what makes clinic LTV interesting.
      const planVisits = won ? between(r, 5, 16) : (attendedInitial ? between(r, 1, 4) : 0)
      const value = won ? planVisits * prac.fee : 0
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
        contact: { id: cid, name, email: `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com.au`, phone: `+6149${between(r, 1000000, 9999999)}`, tags: bookedDisc ? ['customer booked appointment'] : [] },
        attributions: [att],
        lostReasonName: lost ? pick(r, ['Cost / no rebate', 'Went elsewhere', 'No longer needed', 'Wrong service', 'Could not get a suitable time', 'No answer after 3 attempts']) : null,
      })

      // Calendar events. Discovery calls on the triage calendar; the initial
      // appointment on that discipline's service calendar.
      if (bookedDisc) {
        const bookedAtMs = createdMs + between(r, 0, 2) * DAY + between(r, 1, 8) * 3600000
        const startMs = bookedAtMs + between(r, 1, 6) * DAY + between(r, 0, 6) * 3600000
        events.push({
          id: id16(r), calendarId: 'demoCalDiscovery', locationId: DEMO_LOCATION, contactId: cid,
          title: `${name} x Norwest MDC | Discovery Call`, appointmentStatus: attendedDisc ? 'showed' : (chance(r, 0.55) ? 'noshow' : 'cancelled'),
          startTime: iso(startMs), endTime: iso(startMs + 15 * 60000), dateAdded: iso(bookedAtMs),
          assignedUserId: coord.id, createdBy: { source: 'booking_widget' },
        })
      }
      if (bookedInitial) {
        const calId = `demoCalSvc${DISCIPLINES.indexOf(disc)}`
        // First clinical visit, then the care plan's follow-ups every 1-3 weeks.
        let visitMs = createdMs + between(r, 5, 16) * DAY + between(r, 8, 16) * 3600000
        const total = Math.max(1, planVisits || 1)
        for (let v = 0; v < total; v++) {
          if (visitMs > now + 45 * DAY) break
          const attended = v === 0 ? attendedInitial : chance(r, 0.9)
          events.push({
            id: id16(r), calendarId: calId, locationId: DEMO_LOCATION, contactId: cid,
            title: `${name} x Norwest MDC | ${disc} ${v === 0 ? 'Initial Appointment' : 'Follow-up'}`,
            appointmentStatus: visitMs > now ? 'confirmed' : (attended ? 'showed' : (chance(r, 0.6) ? 'noshow' : 'cancelled')),
            startTime: iso(visitMs), endTime: iso(visitMs + 45 * 60000),
            dateAdded: iso(visitMs - between(r, 3, 20) * DAY),
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
        tags: ['patient'], source: ch === 'meta' ? 'Facebook' : 'Website',
        attributionSource: att, lastAttributionSource: att,
        _clinic: {
          patient_id: attendedVisits > 0 ? String(between(r, 10000, 99999)) : '',
          total_amount_spent: attendedVisits > 0 ? spent : '',
          total_amount_paid: attendedVisits > 0 ? Math.round(spent * (chance(r, 0.85) ? 1 : 0.7)) : '',
          total_unpaid_balance: attendedVisits > 0 && chance(r, 0.14) ? Math.round(prac.fee * between(r, 1, 3)) : '',
          total_remaining_balance: '',
          total_spent_this_month: attendedVisits > 0 && chance(r, 0.3) ? prac.fee * between(r, 1, 3) : '',
          total_appointments: attendedVisits + (bookedDisc ? 1 : 0) + (chance(r, 0.2) ? 1 : 0),
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
    formSubmissions.push({
      id: 'demoSub' + o.id, formId: f.id, name: f.name, locationId: DEMO_LOCATION,
      contactId: o.contactId, createdAt: o.createdAt,
      others: { first_name: o.name.split(' ')[0], last_name: o.name.split(' ')[1], email: o.contact.email, phone: o.contact.phone },
      // The intake answers that make the per-answer breakdown worth opening.
      'What are you seeking help with?': pick(r, ['Back or neck pain', 'Sports injury', 'Anxiety or stress', 'Child development', 'Post-surgical rehab', 'NDIS supports']),
      'How soon would you like to be seen?': pick(r, ['This week', 'Within 2 weeks', 'This month', 'Just researching']),
      'Do you have a referral?': pick(r, ['GP referral (EPC)', 'NDIS plan', 'No referral - private', 'Not sure']),
    })
  }
  formSubmissions.sort((x, y) => Date.parse(y.createdAt) - Date.parse(x.createdAt))

  // Outbound call / SMS activity for the two intake coordinators.
  const messages = []
  for (const o of opportunities) {
    const owner = coordinators.find((c) => c.id === o.assignedTo) || coordinators[0]
    const base = Date.parse(o.createdAt)
    const attempts = between(r, 1, 3)
    for (let i = 0; i < attempts; i++) {
      const isCall = chance(r, 0.6)
      messages.push({
        id: id16(r), conversationId: 'demoConv' + o.contactId, contactId: o.contactId,
        direction: 'outbound', messageType: isCall ? 'TYPE_CALL' : 'TYPE_SMS', type: isCall ? 'CALL' : 'SMS',
        userId: owner.id, dateAdded: iso(base + (i * between(r, 2, 40) + between(r, 5, 90)) * 60000),
        status: isCall ? pick(r, ['completed', 'completed', 'no-answer', 'voicemail']) : 'delivered',
        meta: isCall ? { call: { duration: between(r, 20, 480), status: 'completed' } } : null,
        body: isCall ? '' : pick(r, ['Hi! Following up on your enquiry - are you free for a quick call?', 'Here is the booking link for your discovery call.', 'Just checking you got our message about your appointment.']),
      })
    }
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
  if (p === '/opportunities/lost-reason') {
    const seen = new Map()
    for (const o of d.opportunities) if (o.lostReasonName && !seen.has(o.lostReasonName)) seen.set(o.lostReasonName, { id: 'demoLR' + seen.size, name: o.lostReasonName })
    return { lostReasons: [...seen.values()] }
  }
  if (p === '/users/') return { users: d.users }
  if (p.startsWith('/locations/') && p.endsWith('/customFields')) {
    return { customFields: CLINIC_FIELD_KEYS.map((k, i) => ({ id: CF_ID(k), name: titleise(k), fieldKey: `contact.${k}`, model: 'contact', dataType: /date|time/.test(k) ? 'DATE' : /count|total|likelihood/.test(k) ? 'NUMERICAL' : 'TEXT', position: i * 50, locationId: DEMO_LOCATION })) }
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
    const page = Math.max(1, Number(query.page) || 1)
    const limit = Math.min(100, Number(query.limit) || 100)
    const all = d.formSubmissions
    const slice = all.slice((page - 1) * limit, page * limit)
    return { submissions: slice, meta: { total: all.length, currentPage: page } }
  }
  if (p === '/conversations/messages/export') {
    // Outbound call + SMS activity per coordinator. `messages` must be an array -
    // an empty object here is what made the Call Reporting builder throw.
    return { messages: d.messages, meta: { total: d.messages.length } }
  }
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
        thumbnail_url: '', instagram_permalink_url: '', quality_ranking: pick(r, ['ABOVE_AVERAGE', 'AVERAGE', 'BELOW_AVERAGE_35']),
        actions_video_view: Math.round(clicks * (3 + r() * 5)),
      })
    } else {
      google.push({ ...row, ad_group_name: adset, ad_group_id: 'demo' + Math.abs(hash(adset)), conversions: leads, cost: spend })
    }
  }
  _ads = { meta, google }
  return _ads
}
function hash(s) { let h = 0; const t = String(s); for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return h }

// Serve a Windsor connector request for the demo accounts. `fields` is honoured
// loosely - extra keys are harmless, and anything missing simply reads as 0/empty
// downstream, exactly as a real connector gap would.
export function demoWindsor(connector, fields, from, to) {
  const { meta, google } = demoAdRows()
  const inRange = (rw) => (!from || rw.date >= from) && (!to || rw.date <= to)
  if (connector === 'facebook') return meta.filter(inRange)
  if (connector === 'google_ads') return google.filter(inRange)
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
