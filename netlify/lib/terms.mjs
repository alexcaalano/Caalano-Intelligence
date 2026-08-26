// ---------------------------------------------------------------------------
// Caalano360 terms of use + the record of who accepted them.
//
// The text lives here rather than in the frontend so that one source produces
// the version everyone signs, the copy shown back to them later, and the hash
// stored on their acceptance record. That hash is the point: it lets you show
// exactly WHICH wording a person agreed to, even after the terms have moved on.
//
// Bumping TERMS_VERSION records a new version and archives its wording, but on
// its own it does NOT ask anyone to sign again - a signature already on file
// stays valid. Only raising TERMS_MIN_VERSION does that, and it should be
// reserved for a change material enough that the old agreement no longer covers
// what people are agreeing to.
// ---------------------------------------------------------------------------
import { getStore } from '@netlify/blobs'

export const TERMS_VERSION = '1.3'
export const TERMS_EFFECTIVE = '2026-08-25'
// The oldest acceptance still accepted. Raise it only to force a re-sign.
// 1.3 is the first version that both covers every future release of the Platform
// and places a duty on the reader to report anything they can see but shouldn't.
// That duty is new, so it needs a fresh signature; ordinary version bumps after
// this never send anyone back through the gate.
export const TERMS_MIN_VERSION = '1.3'


export const TERMS_TITLE = 'Caalano360 - Terms of Use'
export const TERMS_INTRO = 'Caalano360 is proprietary software owned and operated by Caalano Digital. Access is granted to named individuals only, and only on the terms set out below.'
// Shown above the terms in a bordered notice, before anything else. It states
// plainly that this is a condition of entry and that declining is a real option -
// which is what separates an agreement from a dialog someone dismissed.
export const TERMS_NOTICE = {
  h: 'Read this before proceeding',
  p: [
    'This is a binding legal agreement between you personally and Caalano Digital. It governs your access to and use of Caalano360.',
    'You are required to accept it before you may use the Platform. By signing below and continuing, you agree to be bound by every term in this document, you confirm you have the authority to do so, and you undertake to keep acting in line with it for as long as you have access.',
    'Your signature covers Caalano360 as it is today and every future version of it. We release changes frequently; you will not be asked to sign again for ordinary updates.',
    'If you do not agree to any part of it, do not proceed. Sign out now and contact Caalano Digital. Continuing past this screen without agreeing is not permitted.',
  ],
}

export const TERMS_SECTIONS = [
  {
    h: '1. What Caalano360 is, and who owns it',
    p: [
      'Caalano360 (the "Platform") is proprietary software owned by Caalano Digital ("we", "us"). It includes the interface, the reporting views, the metrics and how they are defined and calculated, the data models, the integrations, the source code and the underlying design and structure.',
      'Nothing in these terms transfers ownership of any part of the Platform to you or to your organisation. You are being given access to use it, and nothing more.',
    ],
  },
  {
    h: '2. Your access',
    p: [
      'We grant you a personal, non-exclusive, non-transferable, revocable right to access the Platform for the purpose of viewing and working with the accounts you have been given access to.',
      'These terms apply to everyone with a login, whether you work for Caalano Digital or you are a client viewing reporting on your own accounts. If you are a client, the access you are given is to your own accounts and to nothing else.',
      'Your login is yours alone. You must not share it, and you must not let anyone else use your session. If you believe someone else has used your account, tell us immediately.',
      'We may change, suspend or withdraw your access at any time, including where these terms have been breached.',
    ],
  },
  {
    h: '3. What you must not do',
    p: ['You must not, directly or indirectly:'],
    list: [
      'Copy, reproduce, republish or redistribute any part of the Platform, its interface, its layouts, its reports or its underlying code.',
      'Reverse engineer, decompile, disassemble or otherwise attempt to derive the source code, structure, logic or calculation methods of the Platform.',
      'Use the Platform, or anything learned from it, to build, specify, brief, commission or assist any product or service that competes with it - including by recreating its reports, metrics, calculations or layouts elsewhere.',
      'Scrape, crawl, harvest or bulk-extract data or content from the Platform, or use any automated tool, script, bot or AI agent to do so.',
      'Feed the Platform, its screens, its outputs or its code into any third-party system - including AI or machine-learning tools - for the purpose of analysing, indexing, training on, or reproducing it.',
      'Take screenshots, recordings or exports for any purpose other than your ordinary use of the accounts you have access to.',
      'Remove, obscure or alter any notice of ownership, confidentiality or authorship.',
      'Attempt to access any account, client or view that has not been allocated to you, or probe, scan or test the security of the Platform.',
      'Share your access, or any output that identifies another client, with anyone outside your organisation.',
    ],
  },
  {
    h: '4. Confidentiality',
    p: [
      'The Platform and everything in it is confidential. That includes how it works, what it measures, how those measures are defined and calculated, the way information is presented, and any data belonging to us or to any client.',
      'You must keep it confidential both while you have access and after your access ends. This obligation continues indefinitely.',
      'If you are given access to data belonging to a client, you may use it only for the purpose it was given to you for.',
    ],
  },
  {
    h: '5. Data',
    p: [
      'Client data shown in the Platform belongs to the client it relates to. Data we generate - including our metrics, benchmarks, aggregations and calculated fields - belongs to us.',
      'If you are a client, the underlying data about your own business, campaigns, leads and customers remains yours, and nothing here limits what you may do with it in your own business. What you may not do is take the Platform itself - its reports, layouts, metric definitions, calculations or design - and reproduce it, or have it reproduced, elsewhere. The numbers are yours; the instrument that produces them is not.',
      'The Platform records your activity for security and support purposes: when you sign in, when you are active, what you access, and errors you encounter. It also records your acceptance of these terms, including the date, time and signature you provide.',
      'We handle personal information in line with the Australian Privacy Principles.',
    ],
  },
  {
    h: '6. If you can see something you should not',
    p: [
      'Access is scoped deliberately: you should only ever see the accounts allocated to you. If at any point you can see data, a client, an account, a report or a screen that does not belong to you - or you suspect you can - you must tell us immediately at alex@caalanodigital.com.au.',
      'Until we confirm it is resolved, you must not use, copy, export, screenshot, share or act on anything you were not meant to see, and you must not investigate further or attempt to reach any more of it.',
      'Reporting something in good faith is never held against you. Staying quiet about it, or making use of it, is a breach of these terms.',
      'The same applies to anything that looks wrong with access or security generally - a login that behaves oddly, a link that shows more than it should, or a session you did not start. Tell us at alex@caalanodigital.com.au rather than testing it yourself.',
    ],
  },
  {
    h: '7. Accuracy and availability',
    p: [
      'The Platform reports on data drawn from third-party systems including advertising platforms and CRMs. Those systems can be delayed, incomplete or inconsistent, and their figures may not always match ours.',
      'The Platform is provided on an "as is" basis. We do not warrant that it will be available without interruption, or that every figure is free from error. It is a decision-support tool and should not be treated as a substitute for your own judgement, or as financial, legal or medical advice.',
    ],
  },
  {
    h: '8. If these terms are breached',
    p: [
      'A breach of clause 3, clause 4 or clause 6 causes harm that money alone may not fix. We may seek an injunction or other equitable relief in addition to any other remedy available to us.',
      'We may suspend or terminate access immediately on breach, and may pursue recovery of any loss suffered.',
    ],
  },
  {
    h: '9. Liability',
    p: [
      'To the extent permitted by law, our total liability arising out of your use of the Platform is limited to resupplying access to it.',
      'Nothing in these terms excludes any right or guarantee that cannot lawfully be excluded, including under the Australian Consumer Law.',
    ],
  },
  {
    h: '10. Your agreement is ongoing, and covers future versions',
    p: [
      'This agreement applies to Caalano360 as it exists on the day you sign and to every future version of it - every release, update, fix, redesign, new tab, new report, new metric, new integration and new module we add, whether or not it existed when you signed. We ship changes frequently, and your acceptance carries across to all of them without you having to sign again.',
      'Your acceptance is not a one-off formality. Every time you sign in and use the Platform you reaffirm these terms and confirm you are still complying with them, in respect of whatever the Platform has become by then.',
      'If at any point you are no longer willing or able to comply, you must stop using the Platform and tell us.',
    ],
  },
  {
    h: '11. Changes to these terms',
    p: [
      'We may update these terms. An updated version takes effect when it is published in the Platform, and your continued use of the Platform after that is your acceptance of it. The current version is always available from the footer of every screen.',
      'We will only ask you to sign again where a change is material enough that an existing signature should not be taken to cover it. Routine revisions do not require a new signature.',
      'The version, date and exact wording you signed is recorded against your account and is not altered when these terms are later revised.',
    ],
  },
  {
    h: '12. Governing law',
    p: ['These terms are governed by the laws of New South Wales, Australia, and you submit to the non-exclusive jurisdiction of its courts.'],
  },
]

export const TERMS_SIGN_STATEMENT = [
  'By signing below, I declare that:',
  'I have read and understood these terms in full, and I have had the opportunity to seek advice on them;',
  'I am the named account holder, I am signing personally, and I have the authority to enter into this agreement;',
  'I agree to be bound by these terms, and I undertake to remain in compliance with them for as long as I hold access - and, where a term says so, after that access ends;',
  'I agree that this applies to Caalano360 as it is today and to every future version, release, module and feature of it, and that I will not be asked to sign again for ordinary updates;',
  'I will tell Caalano Digital at alex@caalanodigital.com.au straight away if I can see any data, account or screen that is not mine to see, and I will not use or share it;',
  'I understand that my acceptance is recorded with my name, the date and time, the version of these terms and my signature, and that this record may be relied upon as evidence of my agreement;',
  'I understand that if I do not agree, I must not use the Platform, and that my only alternative is to sign out now.',
]

// ---------------------------------------------------------------------------
// The live document.
//
// Everything above is the built-in default. A Super Admin can edit the terms in
// the app; the edited document is stored in Blobs and becomes what everyone
// sees, signs and is hashed against. Nothing below reads the constants directly
// - the helpers all take a payload - so a stored document and the built-in one
// go through exactly the same path.
// ---------------------------------------------------------------------------
export const DEFAULT_TERMS = {
  version: TERMS_VERSION, effective: TERMS_EFFECTIVE, title: TERMS_TITLE,
  notice: TERMS_NOTICE, intro: TERMS_INTRO, sections: TERMS_SECTIONS, signStatement: TERMS_SIGN_STATEMENT,
}
export const DEFAULT_MIN_VERSION = TERMS_MIN_VERSION

const store = () => getStore({ name: 'caalano-terms', consistency: 'strong' })
const LIVE_KEY = 'live'

// Flattened text, used for the hash so an acceptance can be tied to exact wording.
export function termsPlainText(t = DEFAULT_TERMS) {
  const parts = [t.title, `Version ${t.version} (effective ${t.effective})`]
  if (t.notice) parts.push(t.notice.h, ...(t.notice.p || []))
  if (t.intro) parts.push(t.intro)
  for (const s of (t.sections || [])) {
    parts.push(s.h)
    for (const p of (s.p || [])) parts.push(p)
    for (const l of (s.list || [])) parts.push('- ' + l)
  }
  parts.push(...(t.signStatement || []))
  return parts.filter(Boolean).join('\n\n')
}
// Short, stable digest of the wording. Not a security control - it exists so a
// stored acceptance can be matched back to the exact text that was on screen.
export async function termsHash(t = DEFAULT_TERMS) {
  const bytes = new TextEncoder().encode(termsPlainText(t))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
}

// Numeric-segment compare, so '1.10' sorts above '1.9' rather than below it.
export function cmpTermsVersion(a, b) {
  const pa = String(a || '').split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b || '').split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d < 0 ? -1 : 1
  }
  return 0
}
// Does a signature on this version still stand?
export function termsAcceptanceValid(version, minVersion = DEFAULT_MIN_VERSION) {
  if (!version) return false
  return cmpTermsVersion(version, minVersion) >= 0
}

// ---- validation -----------------------------------------------------------
// Everything that comes back from the editor is rebuilt field by field rather
// than trusted as-is: unknown keys are dropped, and every string and array is
// bounded so a malformed save can't produce a document nobody can render.
const MAX_STR = 6000
const str = (v, max = MAX_STR) => String(v == null ? '' : v).replace(/\r/g, '').slice(0, max).trim()
const strList = (v, maxItems, max = MAX_STR) => (Array.isArray(v) ? v : []).map((x) => str(x, max)).filter(Boolean).slice(0, maxItems)

export function normaliseTerms(input) {
  const t = input && typeof input === 'object' ? input : {}
  const version = str(t.version, 24)
  if (!/^[0-9]+(\.[0-9]+)*$/.test(version)) return { error: 'Version must be numbers separated by dots, e.g. 1.3.' }
  const title = str(t.title, 200)
  if (!title) return { error: 'Give the document a title.' }
  const effective = str(t.effective, 40)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effective)) return { error: 'Effective date must be in YYYY-MM-DD form.' }
  const sections = (Array.isArray(t.sections) ? t.sections : []).slice(0, 60).map((s) => {
    const out = { h: str(s && s.h, 300), p: strList(s && s.p, 40), list: strList(s && s.list, 60) }
    if (!out.list.length) delete out.list
    return out
  }).filter((s) => s.h || s.p.length || (s.list || []).length)
  if (!sections.length) return { error: 'The terms need at least one section.' }
  const notice = t.notice && (str(t.notice.h, 300) || (Array.isArray(t.notice.p) && t.notice.p.length))
    ? { h: str(t.notice.h, 300), p: strList(t.notice.p, 20) }
    : null
  const signStatement = strList(t.signStatement, 20)
  if (!signStatement.length) return { error: 'The signing declaration can’t be empty - it is what the signature attaches to.' }
  return { terms: { version, effective, title, notice, intro: str(t.intro, 2000), sections, signStatement } }
}

// ---- storage --------------------------------------------------------------
// Falls back to the built-in document whenever nothing has been published or the
// store is unreachable. The gate must never be left with nothing to show.
export async function loadTerms() {
  try {
    const rec = await store().get(LIVE_KEY, { type: 'json' })
    if (rec && rec.terms && Array.isArray(rec.terms.sections) && rec.terms.sections.length) {
      return {
        terms: rec.terms,
        minVersion: rec.minVersion || rec.terms.version || DEFAULT_MIN_VERSION,
        custom: true, updatedAt: rec.updatedAt || null, updatedBy: rec.updatedBy || null,
      }
    }
  } catch {}
  return { terms: DEFAULT_TERMS, minVersion: DEFAULT_MIN_VERSION, custom: false, updatedAt: null, updatedBy: null }
}
export async function saveTerms(input, { minVersion, actor } = {}) {
  const v = normaliseTerms(input)
  if (v.error) return { error: v.error }
  const mv = str(minVersion, 24) || v.terms.version
  if (!/^[0-9]+(\.[0-9]+)*$/.test(mv)) return { error: 'Minimum version must be numbers separated by dots.' }
  // A minimum above the published version would ask everyone to sign a version
  // that doesn't exist yet, and nothing they signed could ever satisfy it.
  if (cmpTermsVersion(mv, v.terms.version) > 0) return { error: 'The minimum accepted version can’t be newer than the version you are publishing.' }
  const rec = { terms: v.terms, minVersion: mv, updatedAt: new Date().toISOString(), updatedBy: actor || null }
  try { await store().setJSON(LIVE_KEY, rec) } catch { return { error: 'Couldn’t save the terms - please try again.' } }
  return { ok: true, ...rec, hash: await termsHash(v.terms) }
}
export async function resetTerms() {
  try { await store().delete(LIVE_KEY) } catch { return { error: 'Couldn’t revert the terms.' } }
  return { ok: true }
}
