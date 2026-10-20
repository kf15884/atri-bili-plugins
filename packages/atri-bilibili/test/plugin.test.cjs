'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const plugin = require('../index')
const fixture = require('./miniapp-fixture.json')
const video = { bvid: 'BV1ZKJb68EjZ', title: '【EVA-明日香】耗时一年，自制CG动画', up: '测试 UP', pic: 'https://i1.hdslb.com/example.jpg' }

function setup(t, { failSend = false, cardMode = 'ark', appName = 'LLOneBot', sendCover = true, failLink = false, badMiniApp = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atri-bili-plugin-test-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const statePath = path.join(directory, 'data/atri-bilibili/state.json')
  fs.mkdirSync(path.dirname(statePath), { recursive: true })
  const stateBytes = JSON.stringify({ sent: { BV0000000000: 123 }, paused: true })
  fs.writeFileSync(statePath, stateBytes)
  const calls = [], links = [], actions = new Map()
  const bot = { platform: 'onebot', selfId: '1000000002', internal: { _get: async (action, params) => {
    calls.push({ action, params })
    if (action === 'get_version_info') return { app_name: appName, app_version: '8.3.2' }
    if (action === 'send_pb') return badMiniApp ? fixture.failure : fixture.response
    assert.equal(action, 'send_private_msg')
    if (failSend) throw Error('card rejected')
    return { message_id: 123 }
  } }, sendPrivateMessage: async (target, content) => {
    links.push({ target, content })
    if (failLink) throw Error('link rejected')
    return ['123']
  } }
  const logs = []
  const ctx = { baseDir: directory, bots: [bot],
    logger: () => ({ info: (...args) => logs.push(args), warn: (...args) => logs.push(args) }),
    on() {}, setTimeout() { throw Error('No background jobs in a card test') },
    command(name) { return { action(handler) { actions.set(name.split(' ')[0], handler); return this } } },
  }
  const detail = plugin._internal.Bili.prototype.detail
  plugin._internal.Bili.prototype.detail = async bvid => { assert.equal(bvid, video.bvid); return { ...video } }
  t.after(() => { plugin._internal.Bili.prototype.detail = detail })
  const config = plugin.Config({targetUserId:'1000000001',selfId:'1000000002', auto: false, cardMode, sendCover })
  plugin.apply(ctx, config)
  return { calls, links, logs, statePath, stateBytes, config,
    card: (userId = '1000000001', mode) => actions.get('bili.card')({ session: { userId } }, video.bvid, mode) }
}
test('Koishi schema keeps legacy defaults and accepts the new explicit share mode', () => {
  assert.equal(plugin.Config({targetUserId:'1000000001',selfId:'1000000002',}).cardMode, 'ark')
  assert.equal(plugin.Config({targetUserId:'1000000001',selfId:'1000000002', cardMode: 'share' }).cardMode, 'share')
  assert.equal(plugin.Config({targetUserId:'1000000001',selfId:'1000000002', cardMode: 'link' }).cardMode, 'link')
  assert.equal(plugin.Config({targetUserId:'1000000001',selfId:'1000000002', cardMode: 'miniapp' }).cardMode, 'miniapp')
})
test('bili.card auto on LLBot sends a readable link and cover without a card or history changes', async t => {
  const f = setup(t)
  assert.equal(await f.card(), undefined)
  assert.equal(f.links.length, 1)
  assert.deepEqual(f.calls.map(call => call.action), ['get_version_info'])
  assert.equal(f.links[0].target, '1000000001')
  assert.ok(f.links[0].content.some(e => e.type === 'text' && e.attrs.content.includes('https://www.bilibili.com/video/' + video.bvid)))
  assert.ok(f.links[0].content.some(e => e.type === 'img' && e.attrs.src === video.pic))
  assert.ok(f.logs.some(args => String(args[0]).includes('QQ 展示效果需接收端确认') && args[1] === 'link'))
  assert.ok(f.logs.every(args => !args.join(' ').includes('卡片发送成功')))
  assert.equal(fs.readFileSync(f.statePath, 'utf8'), f.stateBytes)
})
test('a rejected explicitly requested web card preserves the existing link and cover fallback', async t => {
  const f = setup(t, { failSend: true, cardMode: 'share' })
  assert.match(await f.card(), /已改发链接/)
  assert.equal(f.links.length, 1)
  assert.equal(f.links[0].target, '1000000001')
  assert.ok(f.links[0].content.some(element => element.type === 'text' && element.attrs.content.includes(video.bvid)))
  assert.ok(f.links[0].content.some(element => element.type === 'img' && element.attrs.src === video.pic))
  assert.equal(fs.readFileSync(f.statePath, 'utf8'), f.stateBytes)
})

test('bili.card respects explicit link mode even when the backend is NapCat', async t => {
  const f = setup(t, { cardMode: 'link', appName: 'NapCat' })
  await f.card()
  assert.equal(f.calls.length, 0)
  assert.equal(f.links.length, 1)
  assert.equal(fs.readFileSync(f.statePath, 'utf8'), f.stateBytes)
})

test('cover preference is preserved in LLBot auto fallback', async t => {
  const f = setup(t, { sendCover: false })
  await f.card()
  assert.equal(f.links.length, 1)
  assert.equal(f.links[0].content.length, 1)
  assert.equal(f.links[0].content[0].type, 'text')
})

test('a failed link does not log completion or repeat delivery', async t => {
  const f = setup(t, { failLink: true })
  assert.match(await f.card(), /link rejected/)
  assert.equal(f.links.length, 1)
  assert.ok(f.logs.every(args => !args.join(' ').includes('发送请求已完成')))
})
test('an unauthorized user cannot invoke the card test', async t => {
  const f = setup(t)
  assert.equal(await f.card('another-user'), undefined)
  assert.equal(f.calls.length, 0)
  assert.equal(f.links.length, 0)
})

test('single miniapp trial leaves active link configuration and recommendation history unchanged', async t => {
  const f = setup(t, { cardMode: 'link' })
  await f.card('1000000001', 'miniapp')
  assert.deepEqual(f.calls.map(c => c.action), ['send_pb', 'send_private_msg'])
  assert.equal(f.links.length, 0)
  assert.equal(f.config.cardMode, 'link')
  assert.equal(fs.readFileSync(f.statePath, 'utf8'), f.stateBytes)
  const sent = JSON.parse(f.calls[1].params.message[0].data.data)
  assert.equal(sent.app, 'com.tencent.miniapp_01')
})

test('QQ share generation failure sends the proven link fallback once without a JSON card', async t => {
  const f = setup(t, { cardMode: 'miniapp', badMiniApp: true })
  assert.match(await f.card(), /已改发链接/)
  assert.deepEqual(f.calls.map(c => c.action), ['send_pb'])
  assert.equal(f.links.length, 1)
  assert.equal(fs.readFileSync(f.statePath, 'utf8'), f.stateBytes)
})

test('invalid trial mode is rejected before requesting video or sending messages', async t => {
  const f = setup(t)
  assert.match(await f.card('1000000001', 'anything'), /仅支持/)
  assert.equal(f.calls.length, 0)
  assert.equal(f.links.length, 0)
})

test('unreadable/corrupt public-action state fails closed without overwriting the original file', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atri-corrupt-ledger-')), file = path.join(directory, 'data/atri-bilibili/state.json')
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, '{corrupt ledger remains private')
  const actions = new Map(), cleanups = []
  const ctx = { baseDir: directory, bots: [], logger: () => ({ info() {}, warn() {} }), on(event, fn) { if (event === 'dispose') cleanups.push(fn) },
    command(name) { return { action(fn) { actions.set(name.split(' ')[0], fn) } } } }
  t.after(() => { cleanups.forEach(fn => fn()); fs.rmSync(directory, { recursive: true, force: true }) })
  plugin.apply(ctx, plugin.Config({targetUserId:'1000000001',selfId:'1000000002', auto: false }))
  const session = { userId: '1000000001', isDirect: true }
  assert.match(actions.get('bili.status')({ session }), /无法安全读取/)
  assert.match(actions.get('bili.resume')({ session }), /未恢复/)
  assert.equal(fs.readFileSync(file, 'utf8'), '{corrupt ledger remains private')
})
test('a duplicate plugin instance in the same project cannot register another sender or overwrite its state', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atri-duplicate-instance-')), cleanups = [], warnings = []
  let commands = 0
  const ctx = { baseDir: directory, bots: [], logger: () => ({ info() {}, warn: m => warnings.push(m) }),
    on(event, fn) { if (event === 'dispose') cleanups.push(fn) }, command() { commands++; return { action() {} } } }
  t.after(() => { cleanups.forEach(fn => fn()); fs.rmSync(directory, { recursive: true, force: true }) })
  plugin.apply(ctx, plugin.Config({targetUserId:'1000000001',selfId:'1000000002', auto: false })); const before = commands
  plugin.apply(ctx, plugin.Config({targetUserId:'1000000001',selfId:'1000000002', auto: false }))
  assert.equal(commands, before); assert.ok(warnings.some(m => /重复实例未启动/.test(m)))
})

test('legacy client no longer exposes a fabricated playback heartbeat', () => {
  assert.equal(plugin._internal.Bili.prototype.heartbeat, undefined)
})

test('legacy subtitle CDN reads never forward account Cookie or follow redirects', async t => {
  const client = new plugin._internal.Bili(() => 'SESSDATA=account-cookie', () => {})
  client.get = async () => ({ subtitle: { subtitles: [{ lan: 'zh-CN', subtitle_url: '//aisubtitle.hdslb.com/test.json' }] } })
  const previous = global.fetch
  t.after(() => { global.fetch = previous })
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://aisubtitle.hdslb.com/test.json')
    assert.equal(options.redirect, 'error')
    assert.ok(Object.keys(options.headers).every(name => name.toLowerCase() !== 'cookie'))
    return { ok: true, json: async () => ({ body: [{ content: '字幕内容' }] }) }
  }
  assert.equal(await client.subtitle(video.bvid, 123), '字幕内容')
})

test('legacy subtitle URL outside the trusted CDN list is rejected without a fetch', async t => {
  const client = new plugin._internal.Bili(() => 'SESSDATA=account-cookie', () => {})
  client.get = async () => ({ subtitle: { subtitles: [{ lan: 'zh-CN', subtitle_url: 'https://untrusted.example.org/private' }] } })
  const previous = global.fetch
  t.after(() => { global.fetch = previous })
  global.fetch = async () => { assert.fail('an untrusted subtitle target must not be fetched') }
  await assert.rejects(() => client.subtitle(video.bvid, 123), /安全校验/)
})
