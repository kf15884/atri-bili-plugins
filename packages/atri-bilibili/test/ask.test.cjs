"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { App, Bot, MessageEncoder, h } = require("koishi"),
  plugin = require(".."),
  { askVideo } = require("../ask"),
  { isFollowup } = require("../pace"),
  { Journal } = require("../journal"),
  { createBridge } = require("../hds"),
  { Api } = require("../api");
const V = "BV1Yw7M6RERb",
  url = `https://www.bilibili.com/video/${V}/`,
  rec = { bvid: V, detail: { bvid: V, title: "猫猫视频", pic: "https://i0.hdslb.com/bfs/archive/t.jpg" }, note: "字幕：一只猫在拆纸箱。仅API资料。" };
const cfg = (o = {}) => plugin.Config({ targetUserId: "1000000001", selfId: "1000000002", quietStart: 0, quietEnd: 0, ...o });
const participant = () => ({ id: "p1", storyId: "s1", status: "active", platform: "onebot", selfId: "1000000002", userId: "1000000001" });
const request = (over = {}) => ({
  story: { id: "s1", platform: "onebot", selfId: "1000000002", status: "active", setting: { world: "原世界" } },
  participant: participant(), participants: [participant()], phase: "user-message", userMessage: "日常", ...over,
});

test("ask: recognises explicit video requests only", () => {
  for (const [t, q] of [["有没有什么好看的视频发我看看", ""], ["发个猫猫视频给我", "猫猫"], ["推荐个关于原神的视频", "原神"], ["来点搞笑视频", "搞笑"], ["给我发个视频呗", ""], ["B站有什么好看的", ""], ["发我一个做饭的视频", "做饭"]])
    assert.deepEqual(askVideo(t), { query: q }, t);
  for (const t of ["你刚才发的视频挺好", "我发的视频你看了吗", "别发视频了", "你在看什么视频", "视频看了没", "https://b23.tv/abc 发个视频", "/bili pick", "今天好累", "不用发视频了", ""])
    assert.equal(askVideo(t), null, t);
});
test("ask: a request for a new video is not swallowed as a watch follow-up", () => {
  assert.equal(isFollowup("有没有什么好看的视频发我看看"), false);
  assert.equal(isFollowup("发个视频给我"), false);
  assert.equal(isFollowup("视频看了没"), true);
});

function fixture(t, { decision, candidates, gap = [0, 0] }) {
  const app = new App(), dir = fs.mkdtempSync(path.join(os.tmpdir(), "bili073-ask-"));
  app.baseDir = dir;
  const journal = new Journal(path.join(dir, "state.json")), events = [];
  let received;
  let narrator = { decide: async (r) => { received = r; return decision; } };
  const service = { getNarrator: () => narrator, setNarrator: (n) => (narrator = n), splitOutgoingMessage: (s) => s.split("<sep/>"), getDesktopRuntimePhase: () => "running", config: { runtime: {} } };
  const bridge = createBridge(app, cfg({ cardGapMinSec: gap[0], cardGapMaxSec: gap[1] }), {
    journal, active: () => true, candidates,
    card: async (_b, _v, _u, _a, submit) => { submit(); events.push({ kind: "card", at: Date.now() }); return "111"; },
  });
  bridge.install(service);
  const bot = new Bot(app, {}, "onebot");
  bot.user = { id: "1000000002", name: "test" };
  const disposeBot = bot.dispose.bind(bot);
  bot.dispose = () => (app.bots ? disposeBot() : Promise.resolve());
  class Encoder extends MessageEncoder {
    async prepare() { this.session.isDirect = true; this.text = ""; }
    async visit(e) { if (e.type === "text") this.text += e.attrs.content; else for (const x of e.children) await this.visit(x); }
    async flush() { events.push({ kind: "text", text: this.text, at: Date.now() }); this.results.push({ id: "222", content: this.text }); }
  }
  t.after(async () => { bridge.dispose(); await app.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { app, bridge, service, journal, events, bot, Encoder, get received() { return received; } };
}

test("ask: HDS chooses to send -> card first, pause, then HDS words in original segments", { timeout: 15000 }, async (t) => {
  const body = url + "这个拆纸箱的猫好蠢<sep/>你看完再说";
  const f = fixture(t, { decision: { script: "Atri翻到一个猫猫视频发给他。", interaction: { seen: true, reply: { mode: "immediate", content: body } } }, candidates: async (q) => { assert.equal(q, "猫猫"); return [rec]; }, gap: [1, 1] });
  await f.app.start();
  const tag = await f.bridge.request({}, "猫猫", "ask");
  assert.match(tag, /atri-bili-request/);
  const decision = await f.service.getNarrator().decide(request({ userMessage: tag + "\n发个猫猫视频给我" }));
  const world = f.received.story.setting.world;
  assert.match(world, /向你要视频/);
  assert.match(world, /自己决定这次发不发/);
  assert.match(world, /拆纸箱/);
  assert.match(world, new RegExp(V));
  assert.doesNotMatch(world, /自动回合可以不分享/);
  assert.equal(f.received.onEarlyReply, undefined);
  const parts = f.service.splitOutgoingMessage(decision.interaction.reply.content);
  for (const p of parts) await new f.Encoder(f.bot, "private:1000000001").send(p);
  assert.deepEqual(f.events.map((e) => e.kind === "card" ? "card" : e.text), ["card", "这个拆纸箱的猫好蠢", "你看完再说"]);
  assert.ok(f.events[1].at - f.events[0].at >= 900, "pause between card and words");
  assert.equal(f.journal.data.shares[0].status, "accepted");
});

test("ask: HDS declines in persona -> no card, words unchanged", { timeout: 10000 }, async (t) => {
  const f = fixture(t, { decision: { script: "Atri正在看番，懒得找。", interaction: { seen: true, reply: { mode: "immediate", content: "自己找去 哼" } } }, candidates: async () => [rec] });
  await f.app.start();
  const tag = await f.bridge.request({}, "", "ask");
  const decision = await f.service.getNarrator().decide(request({ userMessage: tag + "\n有没有什么好看的视频发我看看" }));
  await new f.Encoder(f.bot, "private:1000000001").send(decision.interaction.reply.content);
  assert.deepEqual(f.events.map((e) => e.kind === "card" ? "card" : e.text), ["自己找去 哼"]);
  assert.equal(f.journal.data.shares.length, 0);
});

test("ask: candidate read failure still reaches HDS, which is told not to send any URL", { timeout: 10000 }, async (t) => {
  const { Fault } = require("../api");
  const f = fixture(t, { decision: { script: "x", interaction: { seen: true, reply: { mode: "immediate", content: "现在刷不出来 晚点" } } }, candidates: async () => { throw new Fault("no-readable-unseen-video"); } });
  await f.app.start();
  const tag = await f.bridge.request({}, "", "ask");
  await f.service.getNarrator().decide(request({ userMessage: tag + "\n发个视频" }));
  assert.match(f.received.story.setting.world, /没有取得可读的候选视频 \[no-readable-unseen-video\]/);
  assert.match(f.received.story.setting.world, /不能发视频/);
});

test("ask: real Koishi + HDS + SQLite middleware tags only the request and keeps HDS setting", { timeout: 20000 }, async (t) => {
  const HTTP = require("@koishijs/plugin-http").default, SQLite = require("@koishijs/plugin-database-sqlite").default, HDS = require("koishi-plugin-hds-interlude");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bili073-hds-")), app = new App();
  app.baseDir = dir;
  const mws = [];
  const om = app.middleware.bind(app);
  app.middleware = (fn, ...a) => { if (fn.toString().includes("askVideo")) mws.push(fn); return om(fn, ...a); };
  app.plugin(HTTP, {});
  app.plugin(SQLite, { path: path.join(dir, "koishi.db") });
  app.plugin(plugin, cfg({ autoEnabled: false, candidateLimit: 1 }));
  app.plugin(HDS, HDS.Config({ storyDefaults: { characterName: "Atri", characterProfile: "原人设", world: "原世界" }, runtime: { autoAdvanceEnabled: false, allowProactiveMessages: false, splitReplyMessages: true, messageSeparator: "<sep/>" }, model: { providers: [] }, memory: { enabled: false }, onebot: { enabled: false }, logging: { logScriptPreview: false } }));
  const note = Api.prototype.note, search = Api.prototype.search, popular = Api.prototype.popular;
  let searched = null;
  Api.prototype.note = async () => rec;
  Api.prototype.search = async (q) => { searched = q; return [rec.detail]; };
  Api.prototype.popular = async () => { searched = "(popular)"; return [rec.detail]; };
  t.after(async () => { Api.prototype.note = note; Api.prototype.search = search; Api.prototype.popular = popular; await app.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  await app.start();
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(mws.length, 1);
  const service = app.interlude, base = { platform: "onebot", selfId: "1000000002", userId: "1000000001", channelId: "private:1000000001", username: "kf", isDirect: true };
  const story = await service.createStory(base), p = await service.ensureParticipant(story, base), saved = JSON.stringify(story.setting);
  const inner = Object.getPrototypeOf(service.getNarrator()), decide = inner.decide;
  let seen;
  inner.decide = async (r) => { seen = r; return { script: "Atri在看番，不想找。", interaction: { seen: true, reply: { mode: "immediate", content: "刚在看番呢<sep/>自己看去" } } }; };
  t.after(() => (inner.decide = decide));
  const plain = { ...base, content: "你刚刚在干什么" };
  let n = 0;
  await mws[0](plain, () => n++);
  assert.equal(plain.content, "你刚刚在干什么");
  const ask = { ...base, content: "有没有什么好看的视频发我看看" };
  await mws[0](ask, () => n++);
  assert.equal(n, 2);
  assert.match(ask.content, /^\[atri-bili-request:[0-9a-f]+\]\n有没有什么好看的视频发我看看$/);
  assert.equal(searched, "(popular)");
  const d = await service.getNarrator().decide({ story, participant: p, participants: [p], phase: "user-message", userMessage: ask.content, webContext: [], writingOptions: { messageSeparator: "<sep/>", splitReplyMessages: true, browserMode: "disabled" } });
  assert.match(seen.story.setting.world, /向你要视频/);
  assert.equal(d.interaction.reply.content, "刚在看番呢<sep/>自己看去");
  assert.equal(JSON.stringify(story.setting), saved);
  const cat = { ...base, content: "发个猫猫视频给我" };
  await mws[0](cat, () => {});
  assert.equal(searched, "猫猫");
});
