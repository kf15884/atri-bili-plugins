'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { App } = require('koishi')
const HTTP = require('@koishijs/plugin-http').default
const SQLite = require('@koishijs/plugin-database-sqlite').default
const HDS = require('koishi-plugin-hds-interlude')
const bili = require('koishi-plugin-atri-bilibili'), eyes = require('koishi-plugin-atri-bili-eyes')
const BV = 'BV1ZKJb68EjZ', UID = '67890'
const sleep = ms => new Promise(r => setTimeout(r, ms))
function patch(t, object, name, value) { const old = object[name]; object[name] = value; t.after(() => { object[name] = old }) }
async function appFor(t) {
  const app = new App(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atri-social-integration-'))
  app.baseDir = dir; app.plugin(HTTP, {}); app.plugin(SQLite, { path: path.join(dir, 'koishi.db') })
  t.after(async () => { await app.stop(); fs.rmSync(dir, { recursive: true, force: true }) }); return app
}
function view(bvid) { return { view: { bvid, aid: 1234, cid: 4321, title: '关键帧节奏', duration: 300, stat: {}, owner: { name: '测试 UP' },
  desc: '介绍动画制作', pages: [{ page: 1, cid: 4321, duration: 300 }] }, tags: ['动画'] } }

test('real Eyes service reads primary subtitle before comments/danmaku and independently refreshes discussion', { timeout: 15000 }, async t => {
  const app = await appFor(t), order = [], proto = eyes._test.Bili.prototype
  patch(t, proto, 'view', async bvid => view(bvid))
  patch(t, proto, 'subtitle', async () => { order.push('subtitle-start'); await sleep(5); order.push('subtitle-finished'); return { body: [{ from: 0, text: '先画关键帧。' }] } })
  patch(t, proto, 'comments', async () => { order.push('comments'); return [{ text: '这是观众的观点，不是作者原话', like: 10, rpid: '888' }] })
  patch(t, proto, 'danmaku', async () => { order.push('danmaku'); return [{ t: 4, text: '有趣' }] })
  app.plugin(eyes, eyes.Config({ discussionCacheMinutes: 1 })); await app.start(); await sleep(20)
  const options = { cookie: 'SESSDATA=mock; DedeUserID=123', refreshDiscussion: true }
  const first = await app.atriBiliEyes.watch({ bvid: BV }, options)
  assert.ok(order.indexOf('comments') > order.indexOf('subtitle-finished'))
  assert.ok(order.indexOf('danmaku') > order.indexOf('subtitle-finished'))
  assert.match(first.note, /辅助讨论/); assert.equal(first.discussion.got.comments, true)
  await app.atriBiliEyes.watch({ bvid: BV }, options); assert.equal(order.length, 4)
  const originalNow = Date.now, later = originalNow() + 61000
  try {
    Date.now = () => later
    const discussion = await app.atriBiliEyes.readDiscussion({ bvid: BV }, options)
    assert.equal(discussion.evidenceMode, 'discussion-only'); assert.equal(discussion.at, later)
    assert.ok(discussion.primaryReadAt < discussion.at)
  } finally { Date.now = originalNow }
  assert.equal(order.filter(x => x === 'comments').length, 2); assert.equal(order.filter(x => x === 'subtitle-start').length, 1)
})

test('real Eyes reports absent/failing discussion honestly and never embeds a remote error body', { timeout: 15000 }, async t => {
  const app = await appFor(t), proto = eyes._test.Bili.prototype
  patch(t, proto, 'view', async bvid => view(bvid))
  patch(t, proto, 'subtitle', async () => null)
  patch(t, proto, 'comments', async () => { throw Error('SESSDATA=never-expose') })
  patch(t, proto, 'danmaku', async () => [])
  app.plugin(eyes, eyes.Config({})); await app.start(); await sleep(20)
  const result = await app.atriBiliEyes.watch({ bvid: BV })
  assert.equal(result.got.subtitle, false); assert.equal(result.got.comments, false); assert.equal(result.got.danmaku, false)
  assert.equal(result.discussion.status.comments, '读取失败/超时'); assert.equal(result.discussion.status.danmaku, '返回空列表')
  assert.ok(!result.note.includes('never-expose')); assert.match(result.note, /不能编造/)
})

test('real plugin + pinned HDS + SQLite: durable diary, pre-POST audit, fixed @UID and truthful outcome', { timeout: 20000 }, async t => {
  const app = await appFor(t), proto = eyes._test.Bili.prototype, requests = []
  patch(t, proto, 'view', async bvid => view(bvid))
  patch(t, proto, 'subtitle', async () => ({ body: [{ from: 0, text: '先画关键帧，再补中间帧。' }] }))
  patch(t, proto, 'comments', async () => [{ text: '我喜欢这个节奏', like: 3, rpid: '888' }])
  patch(t, proto, 'danmaku', async () => [{ t: 20, text: '好流畅' }])
  patch(t, bili._internal.Bili.prototype, 'nav', async () => ({ isLogin: true, mid: 123, uname: '模拟发布账号' }))
  patch(t, bili._internal.Bili.prototype, 'detail', async () => ({ title: '关键帧节奏', aid: 1234, cid: 4321, duration: 300, tags: [], pubdate: Date.now() / 1000 }))
  patch(t, bili._internal.Bili.prototype, 'get', async (url, params) => {
    if (url.endsWith('/card')) return { card: { mid: params.mid, name: '测试朋友' } }
    throw Error('unexpected unmocked GET')
  })
  patch(t, global, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.bilibili.com/x/v2/reply/add'); requests.push({ url, options })
    const stateFile = path.join(app.baseDir, 'data/atri-bilibili/state.json')
    assert.equal(fs.statSync(stateFile).mode & 0o777, 0o600)
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
    assert.equal(Object.values(state.autonomy.effectLedger)[0].status, 'submitting')
    const preparing = await app.database.get('interlude_script_entry', { metadata: { source: 'atri-bilibili', event: 'account-attempt' } })
    assert.equal(preparing.length, 1); assert.equal(preparing[0].metadata.final, false)
    assert.equal(JSON.parse(options.body.get('at_name_to_mid'))['测试朋友'], Number(UID))
    return { ok: true, json: async () => ({ code: 0, data: { rpid_str: '99911', reply: { content: { members: [{ mid: UID }] } } } }) }
  })
  const hdsConfig = HDS.Config({ storyDefaults: { characterName: 'Atri', characterProfile: '原人设，不改写', world: '原世界，不改写' },
    runtime: { autoAdvanceEnabled: false, allowProactiveMessages: false }, model: { providers: [] }, onebot: { enabled: false } })
  app.plugin(HDS, hdsConfig); app.plugin(eyes, eyes.Config({})); await app.start(); await sleep(25)
  const service = app.interlude, session = { platform: 'onebot', selfId: '1000000002', userId: '1000000001', channelId: 'private:1000000001', username: '测试用户', isDirect: true }
  const story = await service.createStory(session), participant = await service.ensureParticipant(story, session), canon = JSON.stringify(story.setting)
  app.plugin(bili, bili.Config({targetUserId:'1000000001',selfId:'1000000002', quietStart: 0, quietEnd: 0, maxAgeDays: 0, cookie: 'SESSDATA=mock-secret; bili_jct=mock-csrf; DedeUserID=123', publicCommentsEnabled: true, mentionUserUid: UID }))
  await sleep(25)
  async function commit(script, intent) { const now = new Date(); await service.serial(story.id, () => service.persistDecision(story, participant,
    { script, interaction: { reply: { mode: 'none' } }, browserIntents: [intent] }, now, now, false, 'user-message', [])); await sleep(1250) }
  await commit('Atri 自己想了解这段动画的制作，决定读取资料。', { mode: 'visit', url: `https://www.bilibili.com/video/${BV}`, purpose: '她对关键帧的处理产生好奇' })
  const evidence = await app.database.get('interlude_script_entry', { metadata: { source: 'atri-bilibili', action: 'watch', status: 'success' } })
  assert.equal(evidence.length, 1); assert.equal(evidence[0].metadata.accountUid, '123')
  assert.equal(evidence[0].metadata.got.comments, true)
  const sentence = '这个分镜的节奏让我觉得很灵动。'
  await commit(`她斟酌后打算公开留下一句：“${sentence}”`, { mode: 'search', query: `bili-comment:${BV} ${sentence}`, purpose: '她想让朋友一起讨论这种节奏' })
  assert.equal(requests.length, 1)
  const audited = await app.database.get('interlude_script_entry', { metadata: { source: 'atri-bilibili', action: 'comment', status: 'accepted' } })
  assert.equal(audited.length, 1); assert.equal(audited[0].metadata.rpid, '99911'); assert.equal(audited[0].metadata.notification, 'unverified')
  const stateText = fs.readFileSync(path.join(app.baseDir, 'data/atri-bilibili/state.json'), 'utf8'), state = JSON.parse(stateText)
  assert.equal(state.autonomy.journal[0].commentStatus, 'accepted'); assert.ok(!stateText.includes('mock-secret'))
  assert.equal(JSON.stringify((await app.database.get('interlude_story', { id: story.id }))[0].setting), canon)
  assert.equal(hdsConfig.runtime.autoAdvanceEnabled, false); assert.equal(hdsConfig.runtime.allowProactiveMessages, false)
})
