'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createAutonomy, parseIntent, compatible, quiet, dayKey } = require('../autonomy')
const plugin = require('../index')
const BV = 'BV1ZKJb68EjZ'
const URL = `https://www.bilibili.com/video/${BV}`
const intent = () => ({ mode: 'visit', url: URL, purpose: '刚聊到动画，想了解一下这段制作过程', timing: 'deferred' })

function matches(row, query) {
  return Object.entries(query).every(([key, expected]) => {
    const value = row[key]
    if (expected instanceof Date) return +new Date(value) === +expected
    if (expected && typeof expected === 'object') {
      if ('$gte' in expected) return +new Date(value) >= +new Date(expected.$gte)
      return value && matches(value, expected)
    }
    return value === expected
  })
}

function setup(t, options = {}) {
  let time = new Date('2026-10-19T12:00:00Z')
  let id = 0, phase = 'running', failCommit = false, commitEmpty = false, saveFail = false
  const story = { id: 'character:onebot:1000000002', selfId: '1000000002', platform: 'onebot', status: 'active',
    createdAt: new Date('2026-10-18T00:00:00Z'), setting: { character: { name: 'Atri', profile: '原有人设' }, world: '原有世界' }, state: {} }
  const participant = { id: 'owner', storyId: story.id, status: 'active', userId: '1000000001' }
  const db = { interlude_story: [story], interlude_participant: [participant], interlude_script_entry: [] }
  const calls = { login: 0, watch: 0, discover: 0, save: 0, arguments: [], persist: [], narrator: [] }
  const account = 'SESSDATA=unit-test-secret; bili_jct=unit-test-csrf; DedeUserID=123'
  const state = { sent: { oldVideo: 123 }, daily: { date: '2026-10-18', count: 2 }, paused: false, extra: 'retained', ...(options.state || {}) }
  const config = plugin.Config({targetUserId:'1000000001',selfId:'1000000002', workflow: 'hds', cookie: account, quietStart: 0, quietEnd: 0, ...options.config })
  const database = { async get(table, query, modifier = {}) {
    let result = db[table].filter(row => matches(row, query))
    if (modifier.sort) result.sort((a, b) => b.id - a.id)
    if (modifier.limit) result = result.slice(0, modifier.limit)
    return result
  } }
  const narrator = { async decide(request) { calls.narrator.push(request); return options.decision || { script: '她想找个动画看看。', browserIntents: [intent()] } } }
  const service = {
    getNarrator() { return this.narrator }, setNarrator(next) { this.narrator = next }, narrator,
    getDesktopRuntimePhase: () => phase,
    async serial(storyId, fn) { assert.equal(storyId, story.id); return fn() },
    async appendEntry(storyId, draft, now, participantId = '') {
      const row = { id: ++id, storyId, participantId, ...draft, occurredAt: new Date(draft.occurredAt || now), createdAt: now }
      db.interlude_script_entry.push(row); return row
    },
    async persistDecision(...args) {
      calls.persist.push(args)
      if (failCommit) throw Error('commit-failed')
      if (!commitEmpty && args[2]?.script) await this.appendEntry(args[0].id, {
        kind: 'script', content: args[2].script, metadata: {},
      }, args[4], args[1]?.id || '')
      return { messages: [] }
    },
  }
  const timers = []
  const ctx = { interlude: service, baseDir: '/no-install-needed-for-unit-test', database,
    atriBiliEyes: { version: '0.2.0', async readDiscussion() { calls.discussion = (calls.discussion || 0) + 1; return { at: +time, note: '热门评论：我有不同的理解。弹幕：有意思。', got: { comments: true, danmaku: true } } }, async watch(video, opts) {
      calls.watch++; calls.arguments.push({ video, opts })
      if (options.watch) return options.watch(video, opts)
      return { bvid: BV, p: 1, aid: 1234, cid: 4321, at: +time, discussion: { at: +time, status: { comments: '已取得样本', danmaku: '返回空列表' } }, title: '动画制作过程', note: '字幕：[00:00] 作者解释动画制作。热门评论：画面好看。',
        got: { subtitle: true, danmaku: false, comments: true } }
    } },
    logger: () => ({ info() {}, warn() {} }),
    setTimeout(fn, ms) { const timer = { fn, ms, cancelled: false }; timers.push(timer); return () => { timer.cancelled = true } },
  }
  const originalPersist = service.persistDecision
  const controller = createAutonomy(ctx, config, {
    state, hdsVersion: options.version || '1.0.1-rc57', now: () => time,
    save() { calls.save++; if (options.onSave) options.onSave(state); if (saveFail) throw Error('write-failed') },
    bili: { async nav() { calls.login++; return options.nav ? options.nav() : { isLogin: options.login !== false, mid: 123 } } },
    validateVideo: options.validateVideo, account: options.account, research: options.research,
    async discover(query) { calls.discover++; calls.query = query; return [{ bvid: BV, title: '动画制作', up: 'UP', desc: '简介只是元信息', duration: 300 }] },
  })
  t.after(() => controller.dispose())
  const request = (patch = {}) => ({ story, participant, phase: 'user-message', writingOptions: { browserMode: 'disabled' },
    recentEntries: [], webContext: [], ...patch })
  const commit = async (decision = { script: 'Atri 拿起手机，想了解这段动画的制作。', browserIntents: [intent()] }, who = participant, sourceStory = story) =>
    service.persistDecision(sourceStory, who, decision, time, time, true, who ? 'user-message' : 'advance', [])
  return { ctx, db, calls, state, config, service, controller, story, participant, request, commit, narrator, originalPersist, timers,
    setTime(value) { time = new Date(value) }, setPhase(value) { phase = value }, failCommit(value = true) { failCommit = value },
    emptyCommit() { commitEmpty = true }, saveFail() { saveFail = true },
  }
}

test('intent parser only accepts an explicit safe Bili namespace or HTTPS allowlisted video', () => {
  assert.equal(parseIntent(intent()).action, 'watch')
  assert.equal(parseIntent({ ...intent(), url: URL + '?p=2&tracking=discard' }).p, 2)
  assert.equal(parseIntent({ mode: 'search', query: 'bili: 猫', purpose: '想看猫' }).query, '猫')
  assert.equal(parseIntent({ mode: 'search', query: 'bilibili:', purpose: '想随便看看' }).action, 'feed')
  assert.equal(parseIntent({ ...intent(), url: 'https://www.bilibili.com/' }).action, 'feed')
  assert.equal(parseIntent({ ...intent(), url: 'https://search.bilibili.com/all?keyword=动画' }).action, 'search')
  for (const url of ['http://www.bilibili.com/video/' + BV, 'https://www.bilibili.com.evil.test/video/' + BV,
    'https://user:pass@www.bilibili.com/video/' + BV, 'https://127.0.0.1/', URL + '?p=0', URL + '?p=1.5', URL + '?p=101', 'file:///etc/passwd']) {
    assert.equal(parseIntent({ ...intent(), url }), null)
  }
  assert.equal(parseIntent({ ...intent(), purpose: '' }), null)
  assert.equal(parseIntent({ mode: 'search', query: 'ordinary internet search', purpose: '正常网页搜索' }), null)
})

test('new workflow default is HDS; card settings and legacy mode remain available', () => {
  assert.equal(plugin.Config({targetUserId:'1000000001',selfId:'1000000002',}).workflow, 'hds')
  assert.equal(plugin.Config({targetUserId:'1000000001',selfId:'1000000002', workflow: 'legacy' }).workflow, 'legacy')
  assert.equal(plugin.Config({targetUserId:'1000000001',selfId:'1000000002',}).cardMode, 'ark')
  assert.equal(plugin.Config({targetUserId:'1000000001',selfId:'1000000002',}).reportWatch, false)
})

test('compatibility guard fails closed for another HDS version or missing interfaces', () => {
  assert.match(compatible({}, '1.0.2'), /未挂接/)
  assert.match(compatible({}, '1.0.1-rc57'), /缺少/)
})

test('timezone, midnight daily boundaries, and cross-midnight quiet window are deterministic', () => {
  assert.equal(dayKey(new Date('2026-10-19T16:01:00Z')), '2026-10-20')
  assert.equal(quiet({ timezone: 'Asia/Shanghai', quietStart: 23, quietEnd: 9 }, new Date('2026-10-19T16:01Z')), true)
  assert.equal(quiet({ timezone: 'Asia/Shanghai', quietStart: 23, quietEnd: 9 }, new Date('2026-10-19T12:01Z')), false)
})

test('request enrichment uses actual HDS persona without rewriting stored canon or calling the old selection model', async t => {
  const f = setup(t)
  const original = JSON.stringify(f.story)
  const enriched = await f.controller.enrichRequest(f.request())
  assert.match(enriched.story.setting.world, /bili: /)
  assert.equal(enriched.story.setting.character.profile, '原有人设')
  assert.equal(JSON.stringify(f.story), original)
  assert.equal(enriched.writingOptions.browserMode, 'deferred-only')
  assert.equal(f.calls.watch + f.calls.discover + f.calls.login, 0)
})

test('an uncommitted or superseded narrator proposal never causes a read', async t => {
  const f = setup(t, { decision: { script: '草稿', browserIntents: [{ ...intent(), timing: 'immediate' }] } })
  const decision = await f.service.getNarrator().decide(f.request())
  assert.equal(decision.browserIntents[0].timing, 'deferred')
  await f.controller.drain()
  assert.equal(f.calls.watch, 0)
  assert.equal(f.state.autonomy.jobs.length, 0)
})

test('failed persistence does not queue a watch', async t => {
  const f = setup(t); f.failCommit()
  await assert.rejects(() => f.commit(), /commit-failed/)
  await f.controller.drain()
  assert.equal(f.calls.watch, 0)
})

test('a persistence call without a committed script does not queue a watch', async t => {
  const f = setup(t); f.emptyCommit()
  await f.commit()
  await f.controller.drain()
  assert.equal(f.calls.watch, 0)
})

test('only committed Bili intents are consumed; unrelated native browsing is preserved', async t => {
  const f = setup(t)
  const web = { mode: 'visit', url: 'https://example.com/', purpose: '普通公开网页' }
  await f.commit({ script: '她想看动画。', browserIntents: [intent(), web] })
  assert.deepEqual(f.calls.persist[0][2].browserIntents, [web])
  assert.equal(f.state.autonomy.jobs.length, 1)
  assert.equal(f.calls.watch, 0)
})

test('a successful read is written to the HDS story as sourced observation, not sent as a recommendation', async t => {
  const f = setup(t)
  await f.commit()
  await f.controller.drain()
  const notes = f.db.interlude_script_entry.filter(row => row.kind === 'web-observation')
  assert.equal(notes.length, 1)
  assert.equal(notes[0].metadata.source, 'atri-bilibili')
  assert.equal(notes[0].metadata.origin, 'hds-narrator')
  assert.equal(notes[0].metadata.evidenceMode, 'text-only')
  assert.equal(notes[0].metadata.sourceEntryId, 1)
  assert.equal(notes[0].participantId, f.participant.id)
  assert.match(notes[0].content, /作者解释动画制作/)
  assert.match(notes[0].content, /没有播放完整音视频/)
  assert.match(notes[0].content, /没有义务推荐/)
  assert.equal(f.state.autonomy.jobs[0].status, 'done')
  assert.deepEqual(f.state.sent, { oldVideo: 123 })
  assert.deepEqual(f.state.daily, { date: '2026-10-18', count: 2 })
  assert.equal(f.state.extra, 'retained')
  assert.equal(f.calls.watch, 1)
})

test('configured login is reused internally but no credential reaches history or state', async t => {
  const f = setup(t)
  await f.commit(); await f.controller.drain()
  assert.equal(f.calls.arguments[0].opts.cookie, f.config.cookie)
  for (const value of [JSON.stringify(f.state), JSON.stringify(f.db.interlude_script_entry)]) {
    assert.ok(!value.includes('unit-test-secret')); assert.ok(!value.includes('unit-test-csrf'))
  }
})

test('discovery is a separate stage and never silently watches the first candidate', async t => {
  const f = setup(t)
  await f.commit({ script: '她想找一段动画制作视频。', browserIntents: [{ mode: 'search', query: 'bili: 动画制作', purpose: '想了解动画怎么做' }] })
  await f.controller.drain()
  assert.equal(f.calls.discover, 1)
  assert.equal(f.calls.query, '动画制作')
  assert.equal(f.calls.watch, 0)
  const note = f.db.interlude_script_entry.at(-1)
  assert.equal(note.metadata.evidenceMode, 'discovery-only')
  assert.match(note.content, /尚未读取任何视频正文/)
  assert.match(note.content, /后续正常叙事/)
})

test('a model returning no intent performs no external action', async t => {
  const f = setup(t)
  await f.commit({ script: '她决定今天不看视频。', browserIntents: [] })
  await f.controller.drain()
  assert.equal(f.calls.watch + f.calls.discover + f.calls.login, 0)
})

test('out-of-scope private and group requests are not enriched or executed', async t => {
  const f = setup(t)
  const other = { ...f.participant, id: 'other', userId: '999' }
  const privateRequest = f.request({ participant: other })
  assert.equal(await f.controller.enrichRequest(privateRequest), privateRequest)
  const groupRequest = f.request({ groupContext: { groupId: '123' } })
  assert.equal(await f.controller.enrichRequest(groupRequest), groupRequest)
  await f.commit(undefined, other)
  await f.commit(undefined, f.participant, { ...f.story, selfId: 'different' })
  await f.controller.drain()
  assert.equal(f.calls.watch, 0)
})

test('an invalid login records failure without reading or pretending to have watched', async t => {
  const f = setup(t, { login: false })
  await f.commit(); await f.controller.drain()
  assert.equal(f.calls.watch, 0)
  assert.equal(f.state.autonomy.jobs[0].status, 'failed')
  assert.match(f.db.interlude_script_entry.at(-1).content, /没有获得视频内容/)
})

test('network errors do not leak response text and are not retried as engagement', async t => {
  const f = setup(t, { watch: async () => { throw Error('SESSDATA=do-not-log https://evil.test/?token=private') } })
  await f.commit(); await f.controller.drain(); await f.controller.drain()
  assert.equal(f.calls.watch, 1)
  assert.equal(f.state.autonomy.jobs[0].status, 'failed')
  assert.ok(!JSON.stringify(f.state).includes('do-not-log'))
  assert.ok(!JSON.stringify(f.db.interlude_script_entry).includes('token=private'))
})

test('missing subtitles stay explicitly missing rather than becoming invented video content', async t => {
  const f = setup(t, { watch: async () => ({ title: '仅有简介', note: '简介：动画短片', got: { subtitle: false, danmaku: false, comments: false } }) })
  await f.commit(); await f.controller.drain()
  assert.match(f.db.interlude_script_entry.at(-1).content, /字幕无、弹幕无、评论无/)
  assert.equal(f.db.interlude_script_entry.at(-1).metadata.got.subtitle, false)
})

test('direct autonomous video intents still respect existing candidate filters', async t => {
  const f = setup(t, { validateVideo: async () => false })
  await f.commit(); await f.controller.drain()
  assert.equal(f.calls.watch, 0)
  assert.equal(f.db.interlude_script_entry.at(-1).metadata.status, 'blocked')
  assert.match(f.db.interlude_script_entry.at(-1).content, /本次未读取正文/)
  assert.equal(Object.keys(f.state.autonomy.watched).length, 0)
})

test('daily viewing limit remains separate from legacy recommendation counters', async t => {
  const f = setup(t, { config: { dailyLimit: 1, watchCooldownMinutes: 1 } })
  await f.commit(); await f.controller.drain()
  f.setTime('2026-10-19T12:05:00Z')
  await f.commit({ script: '还想看看别的视频。', browserIntents: [{ ...intent(), url: 'https://www.bilibili.com/video/BV1Q541167Qg' }] })
  await f.controller.drain()
  assert.equal(f.calls.watch, 1)
  assert.equal(f.state.autonomy.jobs.at(-1).status, 'pending')
  assert.match(f.state.autonomy.last, /上限/)
})

test('quiet hours defer work without performing account requests', async t => {
  const f = setup(t, { config: { quietStart: 0, quietEnd: 9 } })
  f.setTime('2026-10-19T17:00:00Z')
  await f.commit(); await f.controller.drain()
  assert.equal(f.calls.watch + f.calls.login, 0)
  assert.equal(f.state.autonomy.jobs[0].status, 'pending')
})

test('turning automatic execution off never falls back to legacy direct recommendations', async t => {
  const f = setup(t, { config: { auto: false } })
  await f.commit(); await f.controller.drain()
  assert.equal(f.calls.watch + f.calls.login, 0)
  assert.equal(f.state.autonomy.jobs.length, 0)
  assert.equal(f.calls.persist[0][2].browserIntents.length, 0)
})

test('purge/reset removes the authority for queued work; deleted history is not recreated', async t => {
  const f = setup(t)
  await f.commit()
  f.db.interlude_script_entry.length = 0
  await f.controller.drain()
  assert.equal(f.calls.watch, 0)
  assert.equal(f.db.interlude_script_entry.length, 0)
  assert.equal(f.state.autonomy.jobs[0].status, 'cancelled')
})

test('a purge while the network read is in flight also prevents result resurrection', async t => {
  let release, started
  const ready = new Promise(resolve => { started = resolve })
  const f = setup(t, { watch: () => { started(); return new Promise(resolve => { release = resolve }) } })
  await f.commit()
  const drain = f.controller.drain()
  await ready
  f.db.interlude_script_entry.length = 0
  release({ note: '已获得资料', got: {} })
  await drain
  assert.equal(f.db.interlude_script_entry.length, 0)
  assert.equal(f.state.autonomy.jobs[0].status, 'cancelled')
})

test('HDS pause prevents queued video reads', async t => {
  const f = setup(t)
  await f.commit(); f.setPhase('paused'); await f.controller.drain()
  assert.equal(f.calls.watch, 0)
  assert.equal(f.state.autonomy.jobs[0].status, 'cancelled')
})

test('old thoughts expire instead of silently executing much later', async t => {
  const f = setup(t)
  await f.commit(); f.setTime('2026-10-20T12:00:00Z'); await f.controller.drain()
  assert.equal(f.calls.watch, 0)
  assert.match(f.state.autonomy.jobs[0].result, /过期/)
})

test('a crash after story append but before state completion is idempotent', async t => {
  const f = setup(t)
  await f.commit(); await f.controller.drain()
  f.state.autonomy.jobs[0].status = 'running'
  f.state.autonomy.lastWatchAt = 0
  await f.controller.drain()
  assert.equal(f.calls.watch, 1)
  assert.equal(f.db.interlude_script_entry.filter(row => row.kind === 'web-observation').length, 1)
  assert.equal(f.state.autonomy.jobs[0].status, 'done')
})

test('a recent already-read video is referenced but not fetched again', async t => {
  const f = setup(t)
  await f.commit(); await f.controller.drain()
  f.setTime('2026-10-19T13:00:00Z')
  await f.commit(); await f.controller.drain()
  assert.equal(f.calls.watch, 1)
  assert.match(f.state.autonomy.jobs.at(-1).result, /未重复读取/)
})

test('private video evidence is never added to another participant or unattended global context', async t => {
  const f = setup(t)
  await f.commit(); await f.controller.drain()
  const privateContext = await f.controller.enrichRequest(f.request())
  assert.ok(privateContext.webContext.some(note => note.excerpt.includes('作者解释动画制作')))
  const globalContext = await f.controller.enrichRequest(f.request({ participant: null, phase: 'advance' }))
  assert.equal(globalContext.webContext.length, 0)
})

test('state persistence failure fails closed before any external read', async t => {
  const f = setup(t); f.saveFail()
  await f.commit(); await f.controller.drain()
  assert.equal(f.calls.watch + f.calls.login, 0)
  assert.equal(f.state.paused, true)
})

test('disposal restores HDS hooks without overwriting a later third-party decorator', async t => {
  const f = setup(t)
  f.controller.dispose()
  assert.equal(f.service.getNarrator(), f.narrator)
  assert.equal(f.service.persistDecision, f.originalPersist)
  const g = setup(t)
  const later = Object.create(g.service.getNarrator())
  g.service.setNarrator(later)
  g.controller.dispose()
  assert.equal(g.service.getNarrator(), later)
})
const opinion = '这个分镜的节奏让我觉得很灵动。'
const commentIntent = (message = opinion) => ({ mode: 'search', query: `bili-comment:${BV} ${message}`, purpose: '她自己想公开聊一句动画制作的感想' })
function accountStub(calls, change = {}) {
  return { async mention(mid) { calls.push('mention'); return { mid, name: '测试朋友' } },
    async comment(input) { assert.equal(await input.beforeSend(), true); calls.push({ action: 'comment', input }); return { status: 'accepted', rpid: '99001', visibility: 'unverified', mentionStatus: 'unverified' } },
    async openHistory(input) { assert.equal(await input.beforeSend(), true); calls.push({ action: 'history', input }); return { status: 'accepted-open-only', progressSeconds: 0 } }, ...change }
}
async function readVideo(f) { await f.commit(); await f.controller.drain(); f.setTime('2026-10-19T12:02:00Z') }
async function comment(f, message = opinion, script = `她想留下这句感想：“${message}”`) {
  await f.commit({ script, browserIntents: [commentIntent(message)] }); await f.controller.drain()
}
const socialConfig = { publicCommentsEnabled: true, mentionUserUid: '67890' }

test('new account writes and paid research are disabled by default, while the local diary is enabled', () => {
  const config = plugin.Config({targetUserId:'1000000001',selfId:'1000000002',})
  assert.equal(config.publicCommentsEnabled, false); assert.equal(config.mentionUserUid, '')
  assert.equal(config.accountHistoryMode, 'local-only'); assert.equal(config.webReadEnabled, false)
  assert.equal(config.commentDailyLimit, 2); assert.equal(config.commentCooldownMinutes, 60)
})
test('explicit social/research namespaces parse, but malformed commands are not normal browser searches', async t => {
  const { ownedIntent } = require('../autonomy')
  assert.equal(parseIntent(commentIntent()).action, 'comment')
  assert.equal(parseIntent({ mode: 'search', query: `bili-discuss:${BV}`, purpose: '想再看看讨论' }).action, 'discussion')
  assert.equal(parseIntent({ mode: 'search', query: `bili-research:${BV} 动画关键帧原理`, purpose: '想弄明白' }).action, 'research')
  assert.equal(parseIntent({ mode: 'search', query: `bili-fetch:${BV} https://www.wikipedia.org/wiki/Animation`, purpose: '想读背景' }).action, 'fetch')
  for (const query of ['bili-comment: bad command', `bili-fetch:${BV} http://127.0.0.1/`, 'bili-unknown: unsafe']) {
    const draft = { mode: 'search', query, purpose: '测试' }
    assert.equal(parseIntent(draft), null); assert.equal(ownedIntent(draft), true)
    const f = setup(t); await f.commit({ script: '这不是一个有效操作。', browserIntents: [draft] })
    assert.deepEqual(f.calls.persist[0][2].browserIntents, []); assert.equal(f.state.autonomy.jobs.length, 0)
  }
})
test('actual reads create a dated journal tied to a surviving HDS observation', async t => {
  const f = setup(t); await readVideo(f)
  const list = await f.controller.journal()
  assert.equal(list.length, 1); assert.equal(list[0].bvid, BV)
  assert.equal(list[0].got.subtitle, true); assert.equal(list[0].accountHistoryStatus, 'local-only')
  assert.equal(list[0].evidenceMode, 'text-only'); assert.equal(list[0].accountUid, '123')
  assert.ok(list[0].discussionAt); assert.ok(list[0].evidenceId)
})
test('a diary is not a backup that can resurrect purged HDS evidence', async t => {
  const f = setup(t); await readVideo(f); f.db.interlude_script_entry.length = 0
  assert.deepEqual(await f.controller.journal(), [])
  const r = await f.controller.enrichRequest(f.request()); assert.equal(r.webContext.length, 0)
})
test('a later discussion intention reads comments/danmaku separately and records their source', async t => {
  const f = setup(t); await readVideo(f)
  await f.commit({ script: '她还想对照网友的理解。', browserIntents: [{ mode: 'search', query: `bili-discuss:${BV}`, purpose: '想对照自己的理解' }] })
  await f.controller.drain()
  assert.equal(f.calls.discussion, 1)
  const note = f.db.interlude_script_entry.at(-1)
  assert.equal(note.metadata.evidenceMode, 'discussion-only'); assert.ok(note.metadata.evidenceEntryId)
  assert.match(note.content, /不能把热门评论当作事实/)
})
test('a committed persona sentence is audited before public POST and actual acceptance is audited afterwards', async t => {
  const calls = [], snapshots = []
  const f = setup(t, { config: socialConfig, account: accountStub(calls), onSave: s => snapshots.push(JSON.parse(JSON.stringify(s))) })
  await readVideo(f); await comment(f)
  const sent = calls.find(c => c.action === 'comment')
  assert.ok(sent); assert.equal(sent.input.mention.mid, '67890'); assert.equal(sent.input.message, opinion)
  const notes = f.db.interlude_script_entry.filter(r => r.metadata?.action === 'comment')
  assert.equal(notes.length, 2); assert.equal(notes[0].metadata.final, false)
  assert.equal(notes[1].metadata.status, 'accepted'); assert.equal(notes[1].metadata.notification, 'unverified')
  assert.match(notes[1].content, /不能声称对方已看见/)
  assert.ok(snapshots.some(s => Object.values(s.autonomy.effectLedger).some(e => e.status === 'submitting')))
  assert.equal((await f.controller.journal())[0].commentStatus, 'accepted')
  assert.ok(!JSON.stringify(f.state).includes('unit-test-secret'))
})
test('disabled public comments are recorded as not executed rather than forced through', async t => {
  const calls = []; const f = setup(t, { account: accountStub(calls) })
  await readVideo(f); await comment(f)
  assert.equal(calls.length, 0); assert.equal(f.db.interlude_script_entry.at(-1).metadata.status, 'blocked')
})
test('a missing @UID, another cookie identity, or an uncommitted literal sentence cannot cause a public POST', async t => {
  for (const mode of ['no-uid', 'wrong-account', 'not-literal']) {
    const calls = []
    const f = setup(t, { config: { ...socialConfig, ...(mode === 'no-uid' ? { mentionUserUid: '' } : {}) },
      nav: mode === 'wrong-account' ? () => ({ isLogin: true, mid: 999 }) : undefined, account: accountStub(calls) })
    await readVideo(f); await comment(f, opinion, mode === 'not-literal' ? '她并未承诺发送这段字。' : undefined)
    assert.equal(calls.filter(c => c.action === 'comment').length, 0, mode)
  }
})
test('an unseen video, a video without primary subtitle, or an out-of-scope private observation cannot be publicly commented', async t => {
  for (const mode of ['not-read', 'no-subtitle', 'other-scope']) {
    const calls = [], f = setup(t, { config: socialConfig, account: accountStub(calls),
      watch: mode === 'no-subtitle' ? async () => ({ bvid: BV, aid: 1234, cid: 4321, note: '只有简介和评论', got: { subtitle: false, comments: true } }) : undefined })
    if (mode !== 'not-read') await readVideo(f)
    if (mode === 'other-scope') f.db.interlude_script_entry.find(r => r.kind === 'web-observation').participantId = 'other-private-person'
    await comment(f); assert.equal(calls.filter(c => c.action === 'comment').length, 0, mode)
  }
})
test('privacy guard and one-sentence rule reject public leaks or model-selected @ targets', async t => {
  for (const message of ['第一句。第二句。', '我的QQ是1000000001', '我的手机号是13800138000', '来这里 https://evil.com/', '你好 @别的人', '我完整看完了这个视频。']) {
    const calls = [], f = setup(t, { config: socialConfig, account: accountStub(calls) })
    await readVideo(f); await comment(f, message)
    assert.equal(calls.filter(c => c.action === 'comment').length, 0, message)
  }
})
test('changing the cookie or fixed recipient after an intention cancels the write', async t => {
  for (const mode of ['cookie', 'uid']) {
    const calls = [], f = setup(t, { config: socialConfig, account: accountStub(calls) })
    await readVideo(f); await f.commit({ script: opinion, browserIntents: [commentIntent()] })
    if (mode === 'cookie') f.config.cookie = 'SESSDATA=new; bili_jct=new; DedeUserID=555'
    else f.config.mentionUserUid = '99999'
    await f.controller.drain(); assert.equal(calls.filter(c => c.action === 'comment').length, 0)
  }
})
test('a deleted source while resolving the mention prevents the public request', async t => {
  const calls = []; let f
  f = setup(t, { config: socialConfig, account: accountStub(calls, { async mention(mid) {
    f.db.interlude_script_entry.length = 0; return { mid, name: '测试朋友' }
  } }) })
  await readVideo(f); await comment(f)
  assert.equal(calls.filter(c => c.action === 'comment').length, 0); assert.equal(f.db.interlude_script_entry.length, 0)
})
test('a source purged during a public request does not erase the external outcome or recreate the story', async t => {
  const calls = []; let f
  f = setup(t, { config: socialConfig, account: accountStub(calls, { async comment(input) {
    assert.equal(await input.beforeSend(), true); calls.push('posted'); f.db.interlude_script_entry.length = 0
    return { status: 'accepted', rpid: '99001' }
  } }) })
  await readVideo(f); await comment(f)
  assert.equal(calls.filter(c => c === 'posted').length, 1)
  assert.equal(Object.values(f.state.autonomy.effectLedger)[0].status, 'accepted')
  assert.equal(f.db.interlude_script_entry.length, 0); assert.deepEqual(await f.controller.journal(), [])
})
test('same video/account is never commented twice even in a later committed turn', async t => {
  const calls = [], f = setup(t, { config: socialConfig, account: accountStub(calls) })
  await readVideo(f); await comment(f); f.setTime('2026-10-19T14:02:00Z'); await comment(f)
  assert.equal(calls.filter(c => c.action === 'comment').length, 1)
  assert.equal(f.db.interlude_script_entry.at(-1).metadata.status, 'deduplicated')
})
test('ambiguous public timeout is retained as unknown and is never retried', async t => {
  const calls = [], f = setup(t, { config: socialConfig, account: accountStub(calls, { async comment() { calls.push('post'); throw Error('timeout with SESSDATA=secret') } }) })
  await readVideo(f); await comment(f); await f.controller.drain()
  f.setTime('2026-10-19T14:02:00Z'); await comment(f)
  assert.equal(calls.filter(c => c === 'post').length, 1)
  assert.equal(Object.values(f.state.autonomy.effectLedger)[0].status, 'unknown')
  assert.ok(!JSON.stringify(f.state).includes('SESSDATA=secret'))
})
test('an interrupted prepared/submitting attempt recovers an unknown audit without another POST', async t => {
  const calls = [], f = setup(t, { config: socialConfig, account: accountStub(calls) })
  await readVideo(f); await comment(f)
  const job = f.state.autonomy.jobs.find(j => j.action === 'comment')
  f.db.interlude_script_entry = f.db.interlude_script_entry.filter(r => r.metadata?.action !== 'comment' || r.metadata?.final === false)
  f.state.autonomy.effectLedger[job.effectKey].status = 'submitting'; job.status = 'running'
  await f.controller.drain()
  assert.equal(calls.filter(c => c.action === 'comment').length, 1)
  assert.equal(f.db.interlude_script_entry.at(-1).metadata.status, 'unknown')
})
test('explicit platform rejection pauses new public comments instead of evading risk controls', async t => {
  const { AccountError } = require('../social')
  const calls = [], f = setup(t, { config: socialConfig, account: accountStub(calls, { async comment() { calls.push('post'); throw new AccountError('rejected', -352) } }) })
  await readVideo(f); await comment(f)
  assert.equal(Object.values(f.state.autonomy.effectLedger)[0].status, 'rejected')
  assert.equal(f.state.autonomy.commentBlocked.code, -352)
  f.setTime('2026-10-19T14:02:00Z'); await comment(f)
  assert.equal(calls.filter(c => c === 'post').length, 1)
})
test('a persistence failure before the public write cannot submit a comment', async t => {
  const calls = [], f = setup(t, { config: socialConfig, account: accountStub(calls) })
  await readVideo(f); await f.commit({ script: opinion, browserIntents: [commentIntent()] }); f.saveFail()
  await assert.rejects(() => f.controller.drain(), /write-failed/)
  assert.equal(calls.filter(c => c.action === 'comment').length, 0)
})
test('optional account history is a separate audited zero-progress action after the HDS read is committed', async t => {
  const calls = [], f = setup(t, { config: { accountHistoryMode: 'record-open' }, account: accountStub(calls) })
  await readVideo(f)
  assert.equal(calls.length, 0, 'the actual HDS read must commit first')
  assert.ok(f.state.autonomy.jobs.some(j => j.action === 'history'))
  await f.controller.drain()
  assert.equal(calls.filter(c => c.action === 'history').length, 1)
  assert.equal(f.db.interlude_script_entry.at(-1).metadata.progressSeconds, 0)
  assert.equal((await f.controller.journal())[0].accountHistoryStatus, 'accepted-open-only')
})
test('account history skipping an existing position remains distinct from a viewing failure', async t => {
  const f = setup(t, { config: { accountHistoryMode: 'record-open' }, account: accountStub([], { async openHistory() { return { status: 'skipped-preserve-progress', progressSeconds: null } } }) })
  await readVideo(f); await f.controller.drain()
  assert.equal((await f.controller.journal())[0].accountHistoryStatus, 'skipped-preserve-progress')
  assert.equal(f.state.autonomy.jobs[0].status, 'done')
})
test('old search blocked, sourced public page uses shared API interpretation',async t=>{
  const calls=[],url='https://www.wikipedia.org/wiki/Animation',f=setup(t,{config:{webReadEnabled:true},research:{available:()=>true,async search(){throw Error('must not search')},async fetch(u,urls){assert.ok(urls.includes(u));calls.push(u);return {url:u,title:'动画背景',content:'实际公开节选',summary:'综合理解'}}}})
  await readVideo(f)
  await f.commit({script:'她想查询背景。',browserIntents:[{mode:'search',query:`bili-research:${BV} 关键帧原理`,purpose:'背景问题'}]});await f.controller.drain();assert.equal(calls.length,0);assert.match(f.state.autonomy.jobs.at(-1).result,/已移除/)
  await f.service.appendEntry(f.story.id,{kind:'user-message',content:'参考 '+url,metadata:{}},new Date(),f.participant.id)
  f.setTime('2026-10-19T12:15:00Z');await f.commit({script:'她决定读给出的来源。',browserIntents:[{mode:'search',query:`bili-fetch:${BV} ${url}`,purpose:'想读原文'}]});await f.controller.drain();assert.equal(calls.length,1);assert.match(f.db.interlude_script_entry.at(-1).content,/综合理解/);assert.equal(f.db.interlude_script_entry.at(-1).metadata.evidenceMode,'public-page-excerpt')
})
test('the persona is invited to think and initiate contact, without switching native HDS permissions', async t => {
  const f = setup(t)
  f.service.config = { runtime: { autoAdvanceEnabled: false, allowProactiveMessages: false } }
  const before = JSON.stringify(f.service.config), r = await f.controller.enrichRequest(f.request())
  assert.match(r.story.setting.world, /不必等对方先问/); assert.match(r.story.setting.world, /仍须遵守 HDS/)
  assert.equal(JSON.stringify(f.service.config), before)
  assert.match(f.controller.status(), /主动消息：关闭/)
})

test('a surviving observation whose original read script was purged cannot authorize a public write', async t => {
  const calls = [], f = setup(t, { config: socialConfig, account: accountStub(calls) })
  await readVideo(f)
  const id = f.state.autonomy.jobs[0].sourceEntryId
  f.db.interlude_script_entry = f.db.interlude_script_entry.filter(row => row.id !== id)
  await comment(f)
  assert.equal(calls.filter(c => c.action === 'comment').length, 0)
  assert.deepEqual(await f.controller.journal(), [])
})
test('the known HDS/provider secret cannot be embedded in a public opinion even without a key prefix', async t => {
  const calls = [], f = setup(t, { config: socialConfig, account: accountStub(calls) })
  f.service.config = { model: { providers: [{ apiKey: 'hiddenCredentialWord' }] } }
  await readVideo(f); await comment(f, '这个视频让我想到hiddenCredentialWord。')
  assert.equal(calls.filter(c => c.action === 'comment').length, 0)
})
test('daily comment limit postpones further intents and counts attempts rather than pretending they were delivered', async t => {
  const calls = [], f = setup(t, { config: { ...socialConfig, commentDailyLimit: 1 }, account: accountStub(calls) })
  await readVideo(f); await comment(f); f.setTime('2026-10-19T14:02:00Z'); await comment(f)
  assert.equal(calls.filter(c => c.action === 'comment').length, 1)
  assert.equal(f.state.autonomy.jobs.at(-1).status, 'pending'); assert.match(f.state.autonomy.last, /上限/)
})
test('HDS native proactive-contact proposals and persona opinion are forwarded, not converted into forced plugin sends', async t => {
  const contact = { participantId: 'owner', origin: 'life-event', motive: '她想分享自己的感想', disclosure: 'ordinary', outcome: 'send-now' }
  const decision = { script: '她想到朋友可能也喜欢，想叫他看看。', proactiveContact: contact, browserIntents: [] }
  const f = setup(t, { decision }); const result = await f.service.getNarrator().decide(f.request({ participant: null, phase: 'advance' }))
  assert.deepEqual(result.proactiveContact, contact); assert.equal(result.script, decision.script)
  assert.equal(f.calls.watch + f.calls.discover, 0)
})
