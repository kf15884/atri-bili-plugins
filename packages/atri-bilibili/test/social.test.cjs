'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { uid, fingerprint, publicSentence, createAccountClient, AccountError } = require('../social')
const BV = 'BV1ZKJb68EjZ'
const cookie = 'SESSDATA=mock-secret; bili_jct=mock-csrf; DedeUserID=123'
function mock(t, fn) { const original = global.fetch; global.fetch = fn; t.after(() => { global.fetch = original }) }
function client(extra = {}) { return createAccountClient({ headers: () => ({ Cookie: cookie, Referer: 'https://www.bilibili.com/' }),
  async get(url, params) { return url.endsWith('/card') ? { card: { mid: params.mid, name: '测试朋友' } } : { last_play_time: 0, last_play_cid: 0 } }, ...extra }) }
const comment = { aid: '1234', message: '这个节奏让我觉得很灵动。', mention: { mid: '67890', name: '测试朋友' }, cookie, beforeSend: async () => true }

test('UID validation never treats a QQ default, floating point, or unsafe integer as a configured recipient', () => {
  assert.equal(uid(''), ''); assert.equal(uid('0'), ''); assert.equal(uid('1e6'), ''); assert.equal(uid('9007199254740993'), '')
  assert.equal(uid('67890'), '67890'); assert.equal(fingerprint(cookie).length, 64); assert.ok(!fingerprint(cookie).includes('mock-secret'))
})
test('a public comment has one fixed origin, one sentence, literal fixed recipient mapping and no redirects', async t => {
  let seen; mock(t, async (url, options) => { seen = { url, options }; return { ok: true, json: async () => ({ code: 0, data: { rpid_str: '9991', reply: { content: { members: [{ mid: '67890' }] } } } }) } })
  const result = await client().comment(comment)
  assert.equal(seen.url, 'https://api.bilibili.com/x/v2/reply/add'); assert.equal(seen.options.method, 'POST')
  assert.equal(seen.options.redirect, 'error'); assert.equal(seen.options.headers.Cookie, cookie)
  const p = seen.options.body; assert.equal(p.get('oid'), '1234'); assert.equal(p.get('csrf'), 'mock-csrf')
  assert.equal(p.get('message'), comment.message + ' @测试朋友 ')
  assert.deepEqual(JSON.parse(p.get('at_name_to_mid')), { 测试朋友: 67890 })
  assert.equal(result.status, 'accepted'); assert.equal(result.mentionStatus, 'acknowledged')
  assert.equal(result.visibility, 'unverified'); assert.equal(result.notification, 'unverified')
})
test('an unacknowledged mention is explicitly unverified rather than a delivered notification', async t => {
  mock(t, async () => ({ ok: true, json: async () => ({ code: 0, data: { rpid: 9991 } }) }))
  const result = await client().comment(comment); assert.equal(result.mentionStatus, 'unverified')
})
test('nickname resolution must return the exact UID and cannot inject a second mention', async () => {
  assert.deepEqual(await client().mention('67890'), { mid: '67890', name: '测试朋友' })
  for (const card of [{ mid: '99999', name: 'wrong' }, { mid: '67890', name: 'bad @other' }, { mid: '67890', name: '' }]) {
    await assert.rejects(() => client({ get: async () => ({ card }) }).mention('67890'), /target-not-verified/)
  }
})
test('the last source/permission guard runs before any account POST', async t => {
  let calls = 0; mock(t, async () => { calls++; throw Error('must not call') })
  await assert.rejects(() => client().comment({ ...comment, beforeSend: async () => false }), e => e.kind === 'cancelled-before-send')
  assert.equal(calls, 0)
})
test('missing csrf cannot be guessed or submitted', async t => {
  let calls = 0; mock(t, async () => { calls++ })
  await assert.rejects(() => client().comment({ ...comment, cookie: 'SESSDATA=mock' }), e => e.kind === 'missing-auth')
  assert.equal(calls, 0)
})
test('timeouts, invalid acknowledgments and non-JSON responses have unknown outcomes and no retry', async t => {
  let calls = 0; mock(t, async () => { calls++; throw Error('network timed out; secret body') })
  await assert.rejects(() => client().comment(comment), e => e instanceof AccountError && e.kind === 'unknown')
  assert.equal(calls, 1)
  global.fetch = async () => ({ ok: true, json: async () => ({ code: 0, data: {} }) })
  await assert.rejects(() => client().comment(comment), e => e.kind === 'unknown')
})
test('risk controls and captcha are reported, never bypassed', async t => {
  mock(t, async () => ({ ok: true, json: async () => ({ code: -352, message: 'do not leak remote body' }) }))
  await assert.rejects(() => client().comment(comment), e => e.kind === 'rejected' && e.code === -352 && !e.message.includes('remote body'))
  global.fetch = async () => ({ ok: true, json: async () => ({ code: 0, data: { need_captcha: true } }) })
  await assert.rejects(() => client().comment(comment), e => e.kind === 'verification-required')
})
test('only a verified empty playback position can get a zero-second entry record, never a heartbeat', async t => {
  const calls = []; mock(t, async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ code: 0 }) } })
  const result = await client().openHistory({ bvid: BV, aid: '1234', cid: '4321', cookie, beforeSend: async () => true })
  assert.equal(result.status, 'accepted-open-only'); assert.equal(calls[0].url, 'https://api.bilibili.com/x/v2/history/report')
  assert.equal(calls[0].options.body.get('progress'), '0'); assert.equal(calls[0].options.body.has('played_time'), false)
})
test('existing, completed, unknown or missing progress is preserved with no history POST', async t => {
  let calls = 0; mock(t, async () => { calls++ })
  for (const progress of [{ last_play_time: 5000, last_play_cid: 4321 }, { last_play_time: -1, last_play_cid: 4321 }, {}, { last_play_time: 0, last_play_cid: 4321 }]) {
    const result = await client({ get: async () => progress }).openHistory({ bvid: BV, aid: '1234', cid: '4321', cookie, beforeSend: async () => true })
    assert.equal(result.status, 'skipped-preserve-progress')
  }
  assert.equal(calls, 0)
})
test('public one-sentence checks retain a natural opinion and reject multiline, links, private numbers and invented playback', () => {
  assert.equal(publicSentence('这个转场让我想起翻书时的停顿。'), '这个转场让我想起翻书时的停顿。')
  for (const body of ['第一句。第二句。', '我完整看完了。', '我的QQ是1000000001', '@另一个人 看这个', '第一行\n第二行', 'www.evil.com', 'SESSDATA=private']) assert.throws(() => publicSentence(body))
})
