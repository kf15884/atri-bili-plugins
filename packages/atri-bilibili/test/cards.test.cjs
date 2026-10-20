'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildShareCard, createCardSender } = require('../cards')

const video = { bvid: 'BV1ZKJb68EjZ', title: '【EVA-明日香】耗时一年，自制CG动画', up: '测试 UP', pic: '//i1.hdslb.com/example.jpg' }
const config = { cardMode: 'ark', targetUserId: '1000000001', cardJumpPath: 'pages/video/video?bvid={bvid}' }
const cardBody = call => JSON.parse(call.params.message[0].data.data)
function fake(get) {
  const calls = []
  const bot = { internal: { _get: async (action, params) => {
    calls.push({ action, params }); return get(action, params)
  } } }
  return { bot, calls }
}
test('LLBot auto mode requests link delivery without sending an unreadable JSON card', async () => {
  const f = fake(action => {
    if (action === 'get_version_info') return { app_name: 'LLOneBot', app_version: '8.3.2' }
    if (action === 'send_private_msg') return { message_id: 123 }
    throw Error('unexpected action: ' + action)
  })
  const sender = createCardSender()
  assert.equal(await sender.send(f.bot, video, config), 'link')
  assert.deepEqual(f.calls.map(c => c.action), ['get_version_info'])
})
test('NapCat keeps its generated mini-app card and its configured jump path', async () => {
  const ark = { app: 'com.tencent.miniapp_01', meta: { detail_1: { title: video.title } } }
  const f = fake((action, params) => {
    if (action === 'get_version_info') return { app_name: 'NapCat.Onebot' }
    if (action === 'get_mini_app_ark') {
      assert.equal(params.jumpUrl, 'pages/video/video?bvid=BV1ZKJb68EjZ')
      return { data: { data: JSON.stringify(ark) } }
    }
    return { message_id: 123 }
  })
  const sender = createCardSender()
  assert.equal(await sender.send(f.bot, video, config), 'ark')
  assert.deepEqual(cardBody(f.calls.at(-1)), ark)
})
test('an unknown implementation with retcode 1404 switches once and caches the capability', async () => {
  const f = fake(action => {
    if (action === 'get_version_info') return { app_name: 'unknown' }
    if (action === 'get_mini_app_ark') {
      const error = Error('API unavailable'); error.retcode = 1404; throw error
    }
    return { message_id: 123 }
  })
  let selections = 0
  const sender = createCardSender({ onBackendSelected: () => selections++ })
  await sender.send(f.bot, video, config); await sender.send(f.bot, video, config)
  assert.equal(f.calls.filter(c => c.action === 'get_version_info').length, 1)
  assert.equal(f.calls.filter(c => c.action === 'get_mini_app_ark').length, 1)
  assert.equal(f.calls.filter(c => c.action === 'send_private_msg').length, 0)
  assert.equal(selections, 1)
})
test('recognizes the actual Koishi adapter 1404 error text reported by the user', async () => {
  const f = fake(action => {
    if (action === 'get_version_info') throw Error('version unavailable')
    if (action === 'get_mini_app_ark') throw Error('Error with request get_mini_app_ark, args: {}, retcode: 1404')
    return { message_id: 123 }
  })
  assert.equal(await createCardSender().send(f.bot, video, config), 'link')
})
test('raw _request envelope preserves error codes and uses normal sends after fallback', async () => {
  const calls = []
  const bot = { internal: { _request: async action => {
    calls.push(action)
    if (action === 'get_version_info') return { retcode: 0, data: { app_name: 'unknown' } }
    if (action === 'get_mini_app_ark') return { retcode: 1404, data: null }
    return { retcode: 0, data: { message_id: 123 } }
  } } }
  assert.equal(await createCardSender().send(bot, video, config), 'link')
  assert.deepEqual(calls, ['get_version_info', 'get_mini_app_ark'])
})
test('a timeout building a mini-app is not cached as unsupported and sends no card', async () => {
  const f = fake(action => {
    if (action === 'get_version_info') return { app_name: 'NapCat' }
    throw Error('request timed out')
  })
  await assert.rejects(createCardSender().send(f.bot, video, config), /timed out/)
  assert.equal(f.calls.filter(c => c.action === 'send_private_msg').length, 0)
})
test('a failed private card send does not retry another card', async () => {
  const f = fake(action => {
    if (action === 'get_version_info') return { app_name: 'NapCat' }
    if (action === 'get_mini_app_ark') return { app: 'com.tencent.miniapp_01' }
    throw Error('send failed: retcode: 1404')
  })
  await assert.rejects(createCardSender().send(f.bot, video, config), /send failed/)
  assert.equal(f.calls.filter(c => c.action === 'send_private_msg').length, 1)
})
test('experimental web card mode remains an explicit opt-in with no capability probes', async () => {
  const f = fake(action => { assert.equal(action, 'send_private_msg'); return { message_id: 123 } })
  await createCardSender().send(f.bot, video, { ...config, cardMode: 'share' })
  assert.equal(f.calls.length, 1)
  const sent = f.calls[0]
  assert.equal(sent.params.user_id, 1000000001)
  assert.equal(sent.params.message[0].type, 'json')
  assert.equal(cardBody(sent).meta.news.jumpUrl, 'https://www.bilibili.com/video/BV1ZKJb68EjZ')
})
test('capability caches are isolated between bot instances', async () => {
  const one = fake(action => action === 'get_version_info' ? { app_name: 'LLOneBot' } : { message_id: 1 })
  const two = fake(action => action === 'get_version_info' ? { app_name: 'NapCat' }
    : action === 'get_mini_app_ark' ? { app: 'miniapp' } : { message_id: 2 })
  const sender = createCardSender()
  assert.equal(await sender.send(one.bot, video, config), 'link')
  assert.equal(await sender.send(two.bot, video, config), 'ark')
})
test('card builder escapes JSON text, rejects invalid BV IDs, and excludes unsafe covers', () => {
  const title = 'quote " and slash \\ and 中文'
  const card = buildShareCard({ ...video, title, pic: 'javascript:alert(1)' }, 1000)
  assert.equal(JSON.parse(JSON.stringify(card)).meta.news.title, title)
  assert.equal(card.meta.news.preview, '')
  assert.equal(card.meta.news.ctime, 1)
  assert.throws(() => buildShareCard({ ...video, bvid: '../anything' }), /BV/)
  const original = structuredClone(video)
  buildShareCard(video); assert.deepEqual(video, original)
})
test('invalid recipients cannot send a card', async () => {
  const f = fake(() => { throw Error('must not call') })
  await assert.rejects(createCardSender().send(f.bot, video, { ...config, cardMode: 'share', targetUserId: 'invalid' }), /QQ/)
  assert.equal(f.calls.length, 0)
})

test('explicit link mode never probes or sends a card even on NapCat', async () => {
  const f = fake(() => { throw Error('must not call') })
  assert.equal(await createCardSender().send(f.bot, video, { ...config, cardMode: 'link' }), 'link')
  assert.equal(f.calls.length, 0)
})
