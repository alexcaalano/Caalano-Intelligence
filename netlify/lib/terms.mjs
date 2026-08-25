// ---------------------------------------------------------------------------
// Caalano360 terms of use + the record of who accepted them.
//
// The text lives here rather than in the frontend so that one source produces
// the version everyone signs, the copy shown back to them later, and the hash
// stored on their acceptance record. That hash is the point: it lets you show
// exactly WHICH wording a person agreed to, even after the terms have moved on.
//
// Bumping TERMS_VERSION re-prompts everyone on their next load. Do that for any
// change of substance; fixing a typo doesn't need it.
// ---------------------------------------------------------------------------
export const TERMS_VERSION = '1.0'
export const TERMS_EFFECTIVE = '2026-08-25'

export const TERMS_TITLE = 'Caalano360 - Terms of Use'
export const TERMS_INTRO = 'Caalano360 is proprietary software owned and operated by Caalano Digital. Access is granted to named individuals only. Please read these terms - you are asked to sign them because they are a binding agreement, not a formality.'

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
      'The Platform records your activity for security and support purposes: when you sign in, when you are active, what you access, and errors you encounter. It also records your acceptance of these terms, including the date, time and signature you provide.',
      'We handle personal information in line with the Australian Privacy Principles.',
    ],
  },
  {
    h: '6. Accuracy and availability',
    p: [
      'The Platform reports on data drawn from third-party systems including advertising platforms and CRMs. Those systems can be delayed, incomplete or inconsistent, and their figures may not always match ours.',
      'The Platform is provided on an "as is" basis. We do not warrant that it will be available without interruption, or that every figure is free from error. It is a decision-support tool and should not be treated as a substitute for your own judgement, or as financial, legal or medical advice.',
    ],
  },
  {
    h: '7. If these terms are breached',
    p: [
      'A breach of clause 3 or clause 4 causes harm that money alone may not fix. We may seek an injunction or other equitable relief in addition to any other remedy available to us.',
      'We may suspend or terminate access immediately on breach, and may pursue recovery of any loss suffered.',
    ],
  },
  {
    h: '8. Liability',
    p: [
      'To the extent permitted by law, our total liability arising out of your use of the Platform is limited to resupplying access to it.',
      'Nothing in these terms excludes any right or guarantee that cannot lawfully be excluded, including under the Australian Consumer Law.',
    ],
  },
  {
    h: '9. Changes',
    p: [
      'We may update these terms. Where a change is significant you will be asked to review and accept the updated version before continuing to use the Platform. The version and date you accepted is recorded against your account.',
    ],
  },
  {
    h: '10. Governing law',
    p: ['These terms are governed by the laws of New South Wales, Australia, and you submit to the non-exclusive jurisdiction of its courts.'],
  },
]

export const TERMS_SIGN_STATEMENT = 'By signing below I confirm I have read and understood these terms, that I accept them, and that I am signing as the named account holder.'

// Flattened text, used for the hash so an acceptance can be tied to exact wording.
export function termsPlainText() {
  const parts = [TERMS_TITLE, `Version ${TERMS_VERSION} (effective ${TERMS_EFFECTIVE})`, TERMS_INTRO]
  for (const s of TERMS_SECTIONS) {
    parts.push(s.h)
    for (const p of (s.p || [])) parts.push(p)
    for (const l of (s.list || [])) parts.push('- ' + l)
  }
  parts.push(TERMS_SIGN_STATEMENT)
  return parts.join('\n\n')
}
// Short, stable digest of the wording. Not a security control - it exists so a
// stored acceptance can be matched back to the exact text that was on screen.
export async function termsHash() {
  const bytes = new TextEncoder().encode(termsPlainText())
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
}
export function termsPayload() {
  return { version: TERMS_VERSION, effective: TERMS_EFFECTIVE, title: TERMS_TITLE, intro: TERMS_INTRO, sections: TERMS_SECTIONS, signStatement: TERMS_SIGN_STATEMENT }
}
