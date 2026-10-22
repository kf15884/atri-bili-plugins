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

test("ask: HDS declines in persona -> no card, words unchanged", { timeout: 10000 }, async (t) => {
  const f = fixture(t, { decision: { script: "Atri正在看番，懒得找。", interaction: { seen: true, reply: { mode: "immediate", content: "自己找去 哼" } } }, candidates: async () => [rec] });
  await f.app.start();
  const tag = await f.bridge.request({}, "", "ask");
  const decision = await f.service.getNarrator().decide(request({ userMessage: tag + "\n有没有什么好看的视频发我看看" }));
  await new f.Encoder(f.bot, "private:1000000001").send(decision.interaction.reply.content);
  assert.deepEqual(f.events.map((e) => e.kind === "card" ? "card" : e.text), ["自己找去 哼"]);
  assert.equal(f.journal.data.shares.length, 0);
});

function qqPacket() {
  const raw = { appName: "com.tencent.miniapp_01", appView: "view_8C8E89B49BE609866298ADDFF2DBABA4", ver: "1.0.0.0", config: { forward: true }, metaData: { detail_1: { appid: "1109937557", url: "https://b23.tv/UnitOnly" } } };
  const variable = (n) => { const a = []; do { const b = n & 127; n >>>= 7; a.push(b | (n ? 128 : 0)); } while (n); return Buffer.from(a); },
    field = (n, b) => { b = Buffer.isBuffer(b) ? b : Buffer.from(b); return Buffer.concat([variable(n * 8 + 2), variable(b.length), b]); };
  return { cmd: "LightAppSvc.mini_app_share.AdaptShareInfo", hex: field(4, field(2, JSON.stringify(raw))).toString("hex") };
}
test("ask 0.8.0: real Koishi + HDS + SQLite: tag → silent turn → pick → watch → card → persisted words", { timeout: 20000 }, async (t) => {
  const HTTP = require("@koishijs/plugin-http").default, SQLite = require("@koishijs/plugin-database-sqlite").default, HDS = require("koishi-plugin-hds-interlude");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bili080-hds-")), app = new App();
  app.baseDir = dir;
  const mws = [];
  const om = app.middleware.bind(app);
  app.middleware = (fn, ...a) => { if (fn.toString().includes("askVideo")) mws.push(fn); return om(fn, ...a); };
  app.plugin(HTTP, {});
  app.plugin(SQLite, { path: path.join(dir, "koishi.db") });
  app.plugin(plugin, cfg({ autoEnabled: false, prepEnabled: false, cardGapMinSec: 0, cardGapMaxSec: 0 }));
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
  const events = [];
  const bot = new Bot(app, {}, "onebot");
  bot.user = { id: "1000000002", name: "test" };
  bot.selfId = "1000000002";
  bot.internal = { _get: async (a, p) => { events.push(a); if (a === "send_pb") return { retcode: 0, data: qqPacket() }; assert.equal(p.user_id, 1000000001); events.push("card"); return { retcode: 0, data: { message_id: 7 } }; } };
  const service = app.interlude, base = { platform: "onebot", selfId: "1000000002", userId: "1000000001", channelId: "private:1000000001", username: "kf", isDirect: true };
  const story = await service.createStory(base), p = await service.ensureParticipant(story, base), saved = JSON.stringify(story.setting);
  const oldSend = service.sendOutgoingMessages;
  service.sendOutgoingMessages = async (_s, m, _p, _se, cancel) => { const ok = m.filter(() => !cancel?.(p)); events.push(...ok.map((x) => x.content)); return ok; };
  const inner = Object.getPrototypeOf(service.getNarrator()), decide = inner.decide;
  const worlds = [];
  inner.decide = async (r) => {
    const w = r.story.setting.world; worlds.push(w);
    if (/内部挑选结果/.test(w)) return { script: "Atri翻了翻。", interaction: { seen: true, reply: { mode: "immediate", content: url + "\n猫拆纸箱很治愈" } } };
    if (/待发送消息草稿/.test(w)) return { script: "Atri把卡片发了过去。", interaction: { seen: true, reply: { mode: "immediate", content: "这只猫拆纸箱太认真了<sep/>你看完肯定想笑" } } };
    return { script: "Atri随口回了一句。", interaction: { seen: true, reply: { mode: "immediate", content: "嗯？" } } };
  };
  t.after(() => { inner.decide = decide; service.sendOutgoingMessages = oldSend; });
  const plain = { ...base, content: "你刚刚在干什么" };
  let n = 0;
  await mws[0](plain, () => n++);
  assert.equal(plain.content, "你刚刚在干什么");
  const ask = { ...base, content: "你把视频发我试试" };
  await mws[0](ask, () => n++);
  assert.equal(n, 2);
  assert.match(ask.content, /^\[atri-bili-request:[0-9a-f]+\]\n你把视频发我试试$/);
  const d = await service.getNarrator().decide({ story, participant: p, participants: [p], phase: "user-message", userMessage: ask.content, webContext: [], writingOptions: { messageSeparator: "<sep/>", splitReplyMessages: true, browserMode: "disabled" } });
  assert.equal(d.interaction.reply.mode, "none", "ask turn itself stays silent");
  for (let i = 0; i < 400 && events.length < 5; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(searched, "(popular)");
  assert.deepEqual(events, ["send_pb", "send_private_msg", "card", "这只猫拆纸箱太认真了", "你看完肯定想笑"]);
  assert.equal(events.filter((x) => x === "card").length, 1);
  assert.ok(events.indexOf("card") < events.indexOf("这只猫拆纸箱太认真了"), "card first, then words");
  assert.ok(worlds.some((w) => /猫拆纸箱很治愈/.test(w)), "pick reason reaches the writing turn");
  const entries = await service.dbGet("interlude_script_entry", { storyId: story.id });
  assert.equal(entries.filter((x) => x.kind === "character-message" && x.content === "这只猫拆纸箱太认真了").length, 1, "words persisted through HDS");
  assert.equal(JSON.stringify((await service.getStory(story.id)).setting), saved);
  const cat = { ...base, content: "发个猫猫视频给我" };
  await mws[0](cat, () => {});
  assert.match(cat.content, /^\[atri-bili-request:/);
});
