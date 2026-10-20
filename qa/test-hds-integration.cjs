'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { App, Service } = require('koishi')
const HTTP = require('@koishijs/plugin-http').default
const SQLite = require('@koishijs/plugin-database-sqlite').default
const HDS = require('koishi-plugin-hds-interlude')
const bili = require('koishi-plugin-atri-bilibili')
const eyes = require('koishi-plugin-atri-bili-eyes')
const { createAutonomy } = require('koishi-plugin-atri-bilibili/autonomy')
const BV = 'BV1ZKJb68EjZ'
const settle = () => new Promise(resolve => setTimeout(resolve, 30))

async function appFor(t) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atri-hds-sqlite-'))
  const app = new App()
  app.baseDir = baseDir
  app.plugin(HTTP, {})
  app.plugin(SQLite, { path: path.join(baseDir, 'koishi.db') })
  t.after(async () => { await app.stop(); fs.rmSync(baseDir, { recursive: true, force: true }) })
  return app
}

test('real Koishi Eyes service: per-call account, caching, in-flight sharing, and private file permissions', { timeout: 15000 }, async t => {
  const app = await appFor(t)
  const original = eyes._test.Bili.prototype.view
  const cookies = []
  eyes._test.Bili.prototype.view = async function (bvid) {
    cookies.push(this.getCookie())
    return { view: { bvid, aid: 123, cid: 456, title: '资料测试', duration: 300,
      desc: '只有简介', pages: [{ page: 1, cid: 456, duration: 300 }], owner: { name: 'UP' } }, tags: [] }
  }
  t.after(() => { eyes._test.Bili.prototype.view = original })
  app.plugin(eyes, eyes.Config({ cookie: 'SESSDATA=own; DedeUserID=1', subtitle: false, danmaku: false, comments: false }))
  await app.start()
  await settle()
  assert.equal(app.atriBiliEyes.version, '0.3.0')
  const opts = { cookie: 'SESSDATA=caller-secret; DedeUserID=2' }
  const first = await app.atriBiliEyes.watch({ bvid: BV }, opts)
  const again = await app.atriBiliEyes.watch({ bvid: BV }, opts)
  assert.equal(first.note, again.note)
  assert.equal(cookies.length, 1)
  assert.equal(cookies[0], opts.cookie)
  first.note = 'caller mutation must not corrupt cache'
  assert.notEqual((await app.atriBiliEyes.watch({ bvid: BV }, opts)).note, first.note)
  const other = await app.atriBiliEyes.watch({ bvid: BV }, { cookie: 'SESSDATA=other; DedeUserID=3' })
  assert.match(other.note, /未播放完整画面或声音/)
  assert.equal(cookies.length, 2)
  await Promise.all([app.atriBiliEyes.watch({ bvid: BV }), app.atriBiliEyes.watch({ bvid: BV })])
  assert.equal(cookies.length, 3)
  await assert.rejects(() => app.atriBiliEyes.watch({ bvid: '../../etc/passwd' }), /参数无效/)
  await assert.rejects(() => app.atriBiliEyes.watch({ bvid: BV, p: 2 }), /分 P/)
  await new Promise(resolve => setTimeout(resolve, 400))
  const file = path.join(app.baseDir, 'data/atri-bili-eyes/state.json')
  assert.equal(fs.statSync(file).mode & 0o777, 0o600)
  const state = fs.readFileSync(file, 'utf8')
  assert.ok(!state.includes('caller-secret'))
  assert.ok(!state.includes('SESSDATA'))
})

test('real Koishi + pinned HDS rc57 + SQLite: committed intent -> Eyes -> immutable story observation', { timeout: 20000 }, async t => {
  const app = await appFor(t)
  const hdsConfig = HDS.Config({
    storyDefaults: { characterName: 'Atri', characterProfile: '测试人设，保持不变', world: '测试世界，保持不变' },
    runtime: { autoAdvanceEnabled: false, allowProactiveMessages: false },
    model: { providers: [] }, logging: { logScriptPreview: false }, onebot: { enabled: false },
  })
  app.plugin(HDS, hdsConfig)
  await app.start()
  await settle()
  assert.ok(app.interlude)
  assert.equal(HDS.version, '1.0.1-rc57')
  const service = app.interlude
  const session = { platform: 'onebot', selfId: '1000000002', userId: '1000000001', channelId: 'private:1000000001',
    username: '测试用户', isDirect: true }
  let story = await service.createStory(session)
  const participant = await service.ensureParticipant(story, session)
  const savedSetting = JSON.stringify(story.setting)
  const state = { sent: { legacy: 123 }, daily: { count: 2, date: '2026-10-18' } }
  const config = bili.Config({targetUserId:'1000000001',selfId:'1000000002', quietStart: 0, quietEnd: 0, cookie: 'SESSDATA=not-real; DedeUserID=1' })
  let watchCalls = 0
  const ctx = Object.create(app)
  ctx.atriBiliEyes = { version: '0.2.0', readDiscussion: async () => ({ note: '测试讨论', got: {} }), watch: async () => {
    watchCalls++
    return { bvid: BV, title: '实际字幕测试', note: '字幕：[00:00] 测试作者介绍如何制作动画。', got: { subtitle: true } }
  } }
  const controller = createAutonomy(ctx, config, { state, hdsVersion: HDS.version, save() {},
    bili: { nav: async () => ({ isLogin: true }) }, discover: async () => [],
  })
  t.after(() => controller.dispose())
  const now = new Date()
  await service.serial(story.id, () => service.persistDecision(story, participant, {
    script: 'Atri 拿起手机，想了解刚才提到的动画制作过程，决定找这个视频看看。',
    interaction: { reply: { mode: 'none' } },
    browserIntents: [{ mode: 'visit', url: `https://www.bilibili.com/video/${BV}`, purpose: '她自己对动画制作过程产生了好奇', timing: 'deferred' }],
  }, now, now, false, 'user-message', []))
  assert.equal(watchCalls, 0)
  assert.equal(state.autonomy.jobs.length, 1, 'actual SQLite timestamps must locate the committed HDS script')
  await controller.drain()
  assert.equal(watchCalls, 1)
  const rows = await app.database.get('interlude_script_entry', {
    storyId: story.id, metadata: { source: 'atri-bilibili', autonomyJobId: state.autonomy.jobs[0].id },
  })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].kind, 'web-observation')
  assert.match(rows[0].content, /测试作者介绍如何制作动画/)
  assert.equal(rows[0].participantId, participant.id)
  const request = { story, participant, phase: 'user-message', recentEntries: [], webContext: [],
    writingOptions: { browserMode: 'disabled' } }
  const enriched = await controller.enrichRequest(request)
  assert.ok(enriched.webContext.some(value => value.excerpt.includes('测试作者')))
  assert.equal(JSON.stringify((await app.database.get('interlude_story', { id: story.id }))[0].setting), savedSetting)
  assert.equal(hdsConfig.runtime.allowProactiveMessages, false)
  assert.equal(hdsConfig.runtime.autoAdvanceEnabled, false)
  assert.deepEqual(state.sent, { legacy: 123 })
  // Purging the source and observation followed by a stale queued job cannot restore either.
  await app.database.remove('interlude_script_entry', { storyId: story.id })
  state.autonomy.jobs[0].status = 'pending'; state.autonomy.lastWatchAt = 0
  await controller.drain()
  assert.equal(watchCalls, 1)
  assert.equal((await app.database.get('interlude_script_entry', { storyId: story.id })).length, 0)
})

test('actual plugin injection works in either plugin load order and preserves pause/history', { timeout: 20000 }, async t => {
  const app = await appFor(t)
  // Use the real HDS and real Eyes services. Bili comes first deliberately.
  app.plugin(bili, bili.Config({targetUserId:'1000000001',selfId:'1000000002', quietStart: 0, quietEnd: 0, auto: false }))
  app.plugin(eyes, eyes.Config({ subtitle: false, danmaku: false, comments: false }))
  app.plugin(HDS, HDS.Config({ runtime: { autoAdvanceEnabled: false }, model: { providers: [] } }))
  await app.start()
  await settle()
  assert.ok(app.interlude)
  assert.ok(app.atriBiliEyes)
  assert.match(app.interlude.getNarrator().decide.toString(), /enrichRequest/)
  // No legacy scheduling exists in this mode even with preserved legacy settings.
  assert.equal(app.interlude.config.runtime.autoAdvanceEnabled, false)
})
test('coupled real plugins: character finds candidates, chooses later, Eyes evidence reaches real HDS SQLite', { timeout: 20000 }, async t => {
  const app = await appFor(t)
  const calls = { nav: 0, search: 0, view: 0, cookies: [] }
  const change = (proto, key, value) => { const old = proto[key]; proto[key] = value; t.after(() => { proto[key] = old }) }
  const detail = { bvid: BV, title: '动画幕后', duration: 300, views: 1000, pubdate: Math.floor(Date.now() / 1000),
    up: '测试 UP', zone: '动画', tags: [], desc: '这是元信息，不是视频正文' }
  change(bili._internal.Bili.prototype, 'nav', async function () {
    calls.nav++; calls.cookies.push(this.getCookie()); return { isLogin: true, uname: '测试账号' }
  })
  change(bili._internal.Bili.prototype, 'search', async () => { calls.search++; return [{ ...detail, source: '搜索' }] })
  change(bili._internal.Bili.prototype, 'detail', async () => ({ ...detail }))
  change(eyes._test.Bili.prototype, 'view', async function () {
    calls.view++; calls.cookies.push(this.getCookie())
    return { view: { ...detail, aid: 123, cid: 456, pages: [{ page: 1, cid: 456, duration: 300 }], owner: { name: '测试 UP' } }, tags: [] }
  })
  change(eyes._test.Bili.prototype, 'subtitle', async () => ({ ai: false, body: [{ from: 0, text: '这次先画关键帧，再补中间帧。' }] }))
  app.plugin(eyes, eyes.Config({ danmaku: false, comments: false }))
  app.plugin(HDS, HDS.Config({ runtime: { autoAdvanceEnabled: false, allowProactiveMessages: false }, model: { providers: [] } }))
  await app.start(); await settle()
  const service = app.interlude
  const session = { platform: 'onebot', selfId: '1000000002', userId: '1000000001', channelId: 'private:1000000001', username: '测试用户', isDirect: true }
  const story = await service.createStory(session), participant = await service.ensureParticipant(story, session)
  let step = 0
  service.setNarrator({ async decide(request) {
    step++
    assert.match(request.story.setting.world, /可选的 B 站生活能力/)
    if (step === 1) return { script: 'Atri 自己想了解动画是怎样制作的，决定先找相关视频。', browserIntents: [
      { mode: 'search', query: 'bili: 动画制作', purpose: '她自己对动画产生了兴趣', timing: 'deferred' },
    ] }
    assert.ok(request.webContext.some(row => row.summary.includes('尚未读取任何视频正文')))
    return { script: 'Atri 在候选里发现幕后制作，决定了解这个视频。', browserIntents: [
      { mode: 'visit', url: `https://www.bilibili.com/video/${BV}`, purpose: '候选里的制作过程令她好奇', timing: 'deferred' },
    ] }
  } })
  app.plugin(bili, bili.Config({targetUserId:'1000000001',selfId:'1000000002', cookie: 'SESSDATA=coupled-test; DedeUserID=42', quietStart: 0, quietEnd: 0, maxAgeDays: 0 }))
  await settle()
  async function next() {
    const request = { story, participant, phase: 'user-message', webContext: [], writingOptions: { browserMode: 'disabled' } }
    const decision = await service.getNarrator().decide(request), now = new Date()
    await service.serial(story.id, () => service.persistDecision(story, participant, decision, now, now, false, 'user-message', []))
  }
  async function waitFor(action) {
    const deadline = Date.now() + 9000
    while (Date.now() < deadline) {
      const rows = await app.database.get('interlude_script_entry', { storyId: story.id, metadata: { source: 'atri-bilibili', action } })
      if (rows.length) return rows
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    assert.fail('No persisted ' + action + ' observation before deadline')
  }
  await next()
  assert.equal(calls.search, 0, 'no network in narrative/persistence hot path')
  const candidates = await waitFor('search')
  assert.match(candidates[0].content, /尚未读取任何视频正文/)
  assert.equal(calls.view, 0, 'must not auto-watch the first candidate')
  await next()
  const observations = await waitFor('watch')
  assert.equal(calls.view, 1)
  assert.match(observations[0].content, /这次先画关键帧，再补中间帧/)
  assert.equal(observations[0].metadata.got.subtitle, true)
  assert.equal(observations[0].metadata.evidenceMode, 'text-only')
  assert.ok(calls.cookies.every(value => value === 'SESSDATA=coupled-test; DedeUserID=42'))
  const disk = fs.readFileSync(path.join(app.baseDir, 'data/atri-bilibili/state.json'), 'utf8')
  assert.ok(!disk.includes('coupled-test'))
  assert.equal(service.config.runtime.allowProactiveMessages, false)
  assert.equal(service.config.runtime.autoAdvanceEnabled, false)
})
