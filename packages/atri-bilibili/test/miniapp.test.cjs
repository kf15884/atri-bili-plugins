'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { COMMAND, buildMiniAppRequest, parseMiniAppResponse } = require('../miniapp')
const { createCardSender } = require('../cards')
// Fixture PB bytes generated independently with Python google.protobuf.
const fixture = require('./miniapp-fixture.json')
const config = { cardMode: 'miniapp', targetUserId: '1000000001', cardJumpPath: 'pages/video/video?bvid={bvid}' }

test('QQ share request matches independent protobuf wire fixture with UTF-8 title and millisecond time', () => {
  assert.deepEqual(buildMiniAppRequest(fixture.video, config, fixture.now), fixture.request)
})

test('only server-generated Bilibili mini-app metadata is used, preserving the generated URL and config', () => {
  const card = parseMiniAppResponse(fixture.response)
  assert.equal(card.app, 'com.tencent.miniapp_01')
  assert.deepEqual(card.config, fixture.raw.config)
  assert.deepEqual(card.meta, fixture.raw.metaData)
  assert.equal(card.miniappShareOrigin, 3)
  assert.equal(card.miniappOpenRefer, '10002')
  assert.ok(!JSON.stringify(card).includes('com.tencent.structmsg'))
})

test('service failures and mismatched commands never produce a card or expose response details', () => {
  assert.throws(() => parseMiniAppResponse(fixture.failure), /状态 17/)
  assert.throws(() => parseMiniAppResponse({ ...fixture.response, cmd: 'other' }), /命令不匹配/)
  assert.throws(() => parseMiniAppResponse(fixture.wrongApp), /不是有效/)
  assert.throws(() => parseMiniAppResponse(fixture.wrongBiliApp), /不是有效/)
})

test('malformed and oversized protobuf frames are rejected without hanging', () => {
  for (const hex of ['', 'abc', 'gg', '00', '22ff', '22ffffffffffffffffffff01', 'ffffffffffffffffffff02', '0b', '09ff', '0dff', 'ff'.repeat(1024 * 1024 + 1)]) {
    assert.throws(() => parseMiniAppResponse({ hex }))
  }
})

test('invalid video, cover, and jump paths cannot cause a QQ share request', () => {
  assert.throws(() => buildMiniAppRequest({ ...fixture.video, bvid: '../bad' }), /BV/)
  for (const pic of ['javascript:bad', 'file:///etc/passwd', 'https://user:pass@example.com/a']) {
    assert.throws(() => buildMiniAppRequest({ ...fixture.video, pic }), /封面/)
  }
  assert.throws(() => buildMiniAppRequest(fixture.video, { cardJumpPath: 'https://example.com/{bvid}' }), /跳转/)
})

test('LLBot requests an actual QQ-generated card and sends it to the configured recipient once', async () => {
  const calls = []
  const bot = { internal: { _get: async (action, params) => {
    calls.push({ action, params })
    if (action === 'send_pb') { assert.equal(params.cmd, COMMAND); return fixture.response }
    assert.equal(action, 'send_private_msg'); return { message_id: 7 }
  } } }
  assert.equal(await createCardSender().send(bot, fixture.video, config), 'miniapp')
  assert.deepEqual(calls.map(c => c.action), ['send_pb', 'send_private_msg'])
  assert.equal(calls[1].params.user_id, 1000000001)
  assert.equal(calls[1].params.message.length, 1)
  const sent = JSON.parse(calls[1].params.message[0].data.data)
  assert.deepEqual(sent.meta, fixture.raw.metaData)
})

test('no card is sent for failed or invalid QQ generation and diagnostics omit raw frames', async () => {
  for (const response of [fixture.failure, fixture.wrongApp, { hex: 'abc' }]) {
    const calls = []
    const bot = { internal: { _get: async action => { calls.push(action); return response } } }
    await assert.rejects(createCardSender().send(bot, fixture.video, config))
    assert.deepEqual(calls, ['send_pb'])
  }
  const bot = { internal: { _get: async () => { throw Error('request failed; raw hex=secret-frame; retcode: 1404') } } }
  await assert.rejects(createCardSender().send(bot, fixture.video, config), e => /不支持 send_pb/.test(e.message) && !e.message.includes('secret-frame'))
})

test('a failed card delivery is not retried and does not expose generated share metadata', async () => {
  const calls = []
  const bot = { internal: { _get: async action => {
    calls.push(action)
    if (action === 'send_pb') return fixture.response
    throw Error('send failed '+fixture.raw.config.token)
  } } }
  await assert.rejects(createCardSender().send(bot, fixture.video, config), e => /发送请求失败/.test(e.message) && !e.message.includes(fixture.raw.config.token))
  assert.deepEqual(calls, ['send_pb', 'send_private_msg'])
})

test('invalid recipients are rejected before generating a share', async () => {
  const bot = { internal: { _get: async () => { throw Error('must not call') } } }
  await assert.rejects(createCardSender().send(bot, fixture.video, { ...config, targetUserId: 'invalid' }), /QQ/)
})
