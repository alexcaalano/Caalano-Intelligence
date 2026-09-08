const ROOT = new URL('../', import.meta.url).pathname
// Forms: lead rows decode, ideal-client criteria, cross-question filter,
// rebuilt segments and the CSV export.
import fs from 'fs'
const src = fs.readFileSync(ROOT + 'src/App.jsx', 'utf8')
const lift = (name) => {
  const a = src.indexOf(`function ${name}(`); if (a < 0) throw new Error('missing ' + name)
  let i = src.indexOf('{', src.indexOf(')', a)), depth = 0
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) break } }
  return src.slice(a, i + 1)
}
const { formLeadsOf, formQualMatch, formFilterMatch, formSegmentsFrom, formsCsv } = new Function("const fmtDMY = (v) => String(v).split('-').reverse().join('/')\n" + ['formLeadsOf', 'formQualMatch', 'formFilterMatch', 'formSegmentsFrom', 'formsCsv'].map(lift).join('\n') + '\nreturn { formLeadsOf, formQualMatch, formFilterMatch, formSegmentsFrom, formsCsv }')()
let n = 0, bad = 0
const ok = (name, c, x) => { n++; if (!c) { bad++; console.log('FAIL', name, JSON.stringify(x)) } }

const keys = ['contactId', 'name', 'status', 'stagePos', 'pipelineId', 'value', 'booked', 'shown', 'occurred', 'channel', 'campaign', 'adset', 'creative', 'createdMs', 'ageDays', 'stageName', 'pipelineName']
const form = { form: 'ADHD enquiry', leadRows: { keys, questions: ['NDIS participant?', 'Age group', 'Notes'], values: [['Yes', 'No'], ['Child', 'Adult'], ['hello', 'call me']], rows: [
  ['c1', 'Ann', 1, 3, 'p1', 3200, 1, 1, 1, 'meta', 'CampA', 'setA', 'crA', 1756000000000, 4, 'Won', 'ADHD', 0, 0, 0],
  ['c2', 'Bob', 0, 1, 'p1', 0, 1, 0, 0, 'google', null, null, null, 1756100000000, 9, 'Booked', 'ADHD', 1, 0, 1],
  ['c3', 'Cy, "The" Third', 2, 0, 'p1', 0, 0, 0, 0, 'other', null, null, null, 1756200000000, 20, 'New', 'ADHD', 0, 1, -1],
  ['c4', 'Di', 0, 2, 'p1', 0, 1, 1, 1, 'meta', 'CampA', 'setA', 'crB', 1756300000000, 2, 'Shown', 'ADHD', 1, 1, -1],
], capped: false } }
const leads = formLeadsOf(form)
ok('decodes every lead', leads.length === 4 && leads[0].name === 'Ann' && leads[0].status === 'won' && leads[2].status === 'lost' && leads[1].booked === true && leads[2].booked === false)
ok('answers by question', leads[0].answers['NDIS participant?'] === 'Yes' && leads[1].answers['Age group'] === 'Child' && leads[2].answers.Notes === undefined && leads[3].answers['Age group'] === 'Adult')
ok('no rows → null', formLeadsOf({}) === null)

// Criteria: AND across questions, OR within; empty = not set.
const qual = { 'NDIS participant?': ['Yes'], 'Age group': ['Child', 'Adult'] }
ok('fits', formQualMatch(leads[0].answers, qual) === true)
ok('wrong answer', formQualMatch(leads[1].answers, qual) === false)
ok('missing answer fails', formQualMatch({ 'NDIS participant?': 'Yes' }, qual) === false)
ok('empty criteria = null', formQualMatch(leads[0].answers, {}) === null && formQualMatch(leads[0].answers, { 'Age group': [] }) === null)
ok('or within a question', formQualMatch(leads[3].answers, { 'Age group': ['Adult', 'Child'] }) === true)

// Cross-question filter, with the current question exempt.
const filt = { 'NDIS participant?': ['No'] }
ok('filter passes', formFilterMatch(leads[1].answers, filt) === true && formFilterMatch(leads[0].answers, filt) === false)
ok('filter exempt', formFilterMatch(leads[0].answers, filt, 'NDIS participant?') === true)
ok('no filter passes all', formFilterMatch(leads[0].answers, {}) === true)
const segs = formSegmentsFrom(leads, form.leadRows.questions, new Map([['Notes', 'written']]), filt)
const age = segs.find((s) => s.question === 'Age group')
ok('filtered counts', age && age.total === 2 && age.answers.find((a) => a.value === 'Child').leads === 1 && age.answers.find((a) => a.value === 'Adult').leads === 1, age)
const ndis = segs.find((s) => s.question === 'NDIS participant?')
ok('own question shows all answers', ndis && ndis.total === 4 && ndis.answers.find((a) => a.value === 'Yes').leads === 2, ndis)
ok('written keeps kind, drops people', segs.find((s) => s.question === 'Notes').kind === 'written' && !('people' in segs.find((s) => s.question === 'Notes').answers[0]))
ok('people on choice answers', ndis.answers.find((a) => a.value === 'Yes').people.length === 2)
ok('funnel on answers', ndis.answers.find((a) => a.value === 'Yes').won === 1 && ndis.answers.find((a) => a.value === 'Yes').revenue === 3200)

// CSV: header, one row per lead, quoting, qualification column.
const csv = formsCsv([form], [{ label: '📅 15 Minute Call', kind: 'calendar' }], (p, k) => p.booked, { 'ADHD enquiry': qual })
const lines = csv.split('\r\n')
ok('csv rows', lines.length === 5, lines.length)
ok('csv header', lines[0].startsWith('Form,Name,Status,Pipeline,Stage,Value,Booked,Shown,Won,15 Minute Call,Ideal client,') && lines[0].endsWith('NDIS participant?,Age group,Notes'))
ok('csv quoting', lines[3].includes('"Cy, ""The"" Third"'), lines[3])
ok('csv qualified column', lines[1].split(',')[10] === 'yes' && lines[2].split(',')[10] === 'no')
ok('csv dates DD/MM/YYYY', /\d{2}\/\d{2}\/\d{4}/.test(lines[1]))

console.log(`forms_test: ${n - bad}/${n} passed`)
if (bad) process.exit(1)
