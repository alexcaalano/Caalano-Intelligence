// @needs-fake-blobs
// Every account carries first name, last name, email and phone: the phone is
// normalised to international form, the three creation paths refuse a record
// without them, the self-service update requires all three, and an admin can
// fix one field at a time.
import assert from 'node:assert/strict'
process.env.AUTH_SECRET = 'test-secret'
const A = await import('../netlify/lib/auth.mjs')

assert.equal(A.normPhone('0400 000 000'), '+61400000000')
assert.equal(A.normPhone('(02) 9876-5432'), '+61298765432')
assert.equal(A.normPhone('+61 400 000 000'), '+61400000000')
assert.equal(A.normPhone('61400000000'), '+61400000000')
assert.equal(A.normPhone('0061400000000'), '+61400000000')
assert.equal(A.normPhone('+1 415 555 0123'), '+14155550123')
assert.equal(A.normPhone('12345'), null, 'too short')
assert.equal(A.normPhone('415 555 0123', 'US'), '+14155550123')
assert.equal(A.normPhone('abc'), null)
assert.equal(A.normPhone(''), null)

assert.deepEqual(A.profileFields({ firstName: ' Alex ', lastName: 'Serrano', phone: '0400000000' }), { firstName: 'Alex', lastName: 'Serrano', phone: '+61400000000', name: 'Alex Serrano' })
assert.match(A.profileFields({ firstName: 'A', lastName: 'Serrano', phone: '0400000000' }).error, /first name/)
assert.match(A.profileFields({ firstName: 'Alex', lastName: '', phone: '0400000000' }).error, /last name/)
assert.match(A.profileFields({ firstName: 'Alex', lastName: 'Serrano', phone: '123' }).error, /phone/)

// First account: the identity fields are checked before anything else. (The
// fixture already seeds a superadmin, so a complete request is refused later.)
assert.match((await A.bootstrapAdmin({ email: 'owner@example.com', password: 'longenough', firstName: 'Alex' })).error, /last name/)
assert.match((await A.bootstrapAdmin({ email: 'owner@example', password: 'longenough', firstName: 'Alex', lastName: 'Serrano', phone: '0400 000 000' })).error, /email/)
assert.match((await A.bootstrapAdmin({ email: 'owner@example.com', password: 'longenough', firstName: 'Alex', lastName: 'Serrano', phone: '0400 000 000' })).error, /already complete/)
const boot = { user: { email: 'alex@caalanodigital.com.au', role: 'superadmin' } }

// Invite -> accept needs the fields too.
const inv = await A.createInvite({ email: 'rep@example.com', name: 'Rep Person', role: 'account_user', clients: ['ablycalm'], allClients: false, actor: boot.user })
assert.ok(inv.token)
assert.match((await A.acceptInvite({ token: inv.token, password: 'longenough' })).error, /first name/)
const acc = await A.acceptInvite({ token: inv.token, password: 'longenough', firstName: 'Rep', lastName: 'Person', phone: '+61 411 111 111' })
assert.equal(acc.user.status, 'active'); assert.equal(acc.user.phone, '+61411111111'); assert.equal(acc.user.name, 'Rep Person')

// Access request from a client.
assert.match((await A.signupRequest({ email: 'new@example.com', password: 'longenough', firstName: 'New', lastName: 'Client' })).error, /phone/)
assert.deepEqual(await A.signupRequest({ email: 'new@example.com', password: 'longenough', firstName: 'New', lastName: 'Client', phone: '0412 345 678' }), { ok: true })
assert.equal((await A.getUser('new@example.com')).phone, '+61412345678')
assert.match((await A.signupRequest({ email: 'nz@example.com', password: 'longenough', firstName: 'Kiwi', lastName: 'Client', phone: '(415) 555-0123', phoneCountry: 'AU' })).error, /phone/, 'a US-shaped number is not an AU number')
assert.deepEqual(await A.signupRequest({ email: 'us@example.com', password: 'longenough', firstName: 'Sam', lastName: 'Client', phone: '(415) 555-0123', phoneCountry: 'US' }), { ok: true })
assert.equal((await A.getUser('us@example.com')).phone, '+14155550123')
assert.match((await A.signupRequest({ email: 'bad@example', password: 'longenough', firstName: 'Bad', lastName: 'Email', phone: '0412 345 678' })).error, /email/)

// Self-service: all three required; an older account reads as incomplete until then.
await A.getUser('rep@example.com').then(async (u) => { delete u.phone; await A.updateUser('rep@example.com', {}, boot.user).catch(() => {}) })
const legacy = { email: 'old@example.com', name: 'Old Timer', role: 'user', status: 'active' }
assert.equal(A.profileComplete(legacy), false)
assert.match((await A.updateProfile('rep@example.com', { firstName: 'Rep', lastName: 'Person' })).error, /phone/)
const prof = await A.updateProfile('rep@example.com', { firstName: 'Rep', lastName: 'Persson', phone: '0411111111' })
assert.equal(prof.user.name, 'Rep Persson'); assert.equal(prof.user.profileComplete, true)

// Admin fixes one field; a bad phone is refused; the display name follows.
const up = await A.updateUser('rep@example.com', { phone: '0422 222 222' }, boot.user)
assert.equal(up.user.phone, '+61422222222')
assert.match((await A.updateUser('rep@example.com', { phone: '99' }, boot.user)).error, /phone/)
const up2 = await A.updateUser('rep@example.com', { firstName: 'Rebecca' }, boot.user)
assert.equal(up2.user.name, 'Rebecca Persson')
console.log('profile_test: ok')
