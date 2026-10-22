"use strict";
// 0.7.8: ask follow-up window, no-video guard, deferred fulfilment, self-watch after sharing.
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { App } = require("koishi"),
  plugin = require(".."),
  { askVideo, askFollowup } = require("../ask"),
  { Journal } = require("../journal"),
  { createBridge } = require("../hds"),
  { Api } = require("../api");
const V = "BV1Yw7M6RERb",
  url = `https://www.bilibili.com/video/${V}/`,
  rec = { bvid: V, detail: { bvid: V, title: "猫猫视频", pic: "https://i0.hdslb.com/bfs/archive/t.jpg" }, note: "字幕：一只猫在拆纸箱。仅API资料。" };
const cfg = (o = {}) => plugin.Config({ targetUserId: "1000000001", selfId: "1000000002", quietStart: 0, quietEnd: 0, cardGapMinSec: 0, cardGapMaxSec: 0, selfWatchWaitMinSec: 0, selfWatchWaitMaxSec: 0, ...o });
const P = () => ({ id: "p1", storyId: "s1", status: "active", platform: "onebot", selfId: "1000000002", userId: "1000000001" });
const STORY = () => ({ id: "s1", platform: "onebot", selfId: "1000000002", status: "active", setting: { world: "原世界" } });
const request = (over = {}) => ({ story: STORY(), participant: P(), participants: [P()], phase: "user-message", userMessage: "日常", ...over });
const waitFor = async (fn, ms = 3000) => { const end = Date.now() + ms; while (!fn() && Date.now() < end) await new Promise((r) => setTimeout(r, 5)); assert.ok(fn(), "condition reached"); };
const outSession = (content) => ({ isDirect: true, platform: "onebot", selfId: "1000000002", channelId: "private:1000000001", content, bot: {} });

function fixture(t, { replies = [], candidates, conf = {}, read } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bili078-")), journal = new Journal(path.join(dir, "state.json"));
  const seen = [], sent = [], cards = [];
  let k = 0, bridge;
  const reply = (content) => (content === null ? { script: "x", interaction: { reply: { mode: "none" } } } : { script: "Atri说：" + content, interaction: { seen: true, reply: { mode: "immediate", content } } });
  let narrator = { decide: async (r) => { seen.push(r); return reply(replies[Math.min(k++, replies.length - 1)]); } };
  const service = {
    config: { runtime: {} }, getNarrator: () => narrator, setNarrator: (n) => (narrator = n),
    splitOutgoingMessage: (s) => s.split("<sep/>").map((x) => x.trim()).filter(Boolean), getDesktopRuntimePhase: () => "running",
    confirmOutgoingDeliveries: async (_s, e) => e,
    persistDecision: async (_st, p, d) => ({ messages: service.splitOutgoingMessage(d.interaction.reply.content).map((content) => ({ participantId: p.id, content })) }),
    deliverOutgoingMessages: async (_st, msgs) => { for (const m of msgs) { const s = outSession(m.content); await bridge.beforeSend(s); sent.push(s.content); } return msgs; },
    serial: async (_id, fn) => fn(), getStory: async () => STORY(), getParticipant: async () => P(), dbGet: async () => [],
    recentEntriesForPrompt: async () => [], taskGeneration: () => "g", taskGenerationCurrent: () => true,
    canHandleStory: () => true, canHandleParticipant: () => true, appendEntry: async () => {}, recordIncomingMessage: async () => {}, hasPendingNarrative: () => false,
  };
  const ctx = { baseDir: dir, on: () => {}, inject: () => {} };
  bridge = createBridge(ctx, cfg(conf), {
    journal, active: () => true, candidates: candidates || (async () => [rec]),
    readIncoming: read || (async () => ({ ...rec, note: rec.note + "\n视频观看资料：画面：猫跳进纸箱。听到：撕纸声。" })),
    card: async (_b, _v, _u, _a, submit) => { submit(); cards.push(_v.bvid); sent.push("[card]"); return "111"; },
  });
  bridge.install(service);
  const base = service.getNarrator();
  t.after(() => { bridge.dispose(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { bridge, service, journal, seen, sent, cards, decide: (r) => base.decide(r) };
}
function slow() { let release, calls = 0; const fn = () => { calls++; return new Promise((r) => (release = r)); }; return { fn, release: (v) => release(v), get calls() { return calls; } }; }

test("0.7.8 ask follow-ups: recognised only as short continuations", () => {
  for (const x of ["你再试试能不能发给我卡片", "挑好了吗", "挑好没", "再发一次", "再发一个", "视频呢", "发了吗", "发过来", "好了没", "还没发吗"]) assert.equal(askFollowup(x), true, x);
  for (const x of ["今天好累", "我发的视频你看了吗", "不用发了", "看了没", "你在干嘛", "别发了", "https://b23.tv/x 再发一次", "我昨天和同学去吃饭了然后再发生了一件很好笑的事情你猜猜看"]) assert.equal(askFollowup(x), false, x);
  assert.equal(askVideo("你再试试能不能发给我卡片"), null);
});

test("0.7.8 guard: card talk with no video in hand forbids pretending to send", async (t) => {
  const f = fixture(t, { replies: ["还没找到呢"] });
  await f.decide(request({ userMessage: "你再试试能不能发给我卡片" }));
  assert.match(f.seen[0].story.setting.world, /手上没有新读取、可以发出的视频/);
  assert.match(f.seen[0].story.setting.world, /看这个/);
  await f.decide(request({ userMessage: "今天好累" }));
  assert.doesNotMatch(f.seen[1].story.setting.world, /手上没有新读取/);
});

test("0.7.8 deferred: loading candidates finish → HDS continues, card first, then words, then self-watch impressions", { timeout: 15000 }, async (t) => {
  const s = slow();
  const f = fixture(t, { candidates: s.fn, conf: { askWaitSec: 0 }, replies: ["我找找", url + "找到了，这只猫笑死<sep/>你看", "看完了，最后撕纸那下好吵哈哈"] });
  f.bridge.ownerMessage();
  const tag = await f.bridge.request({}, "猫猫", "ask");
  await f.decide(request({ userMessage: tag + "\n发个猫猫视频" }));
  assert.match(f.seen[0].story.setting.world, /还在后台读取/);
  assert.match(f.bridge.status(), /待补发：猫猫/);
  s.release([rec]);
  await waitFor(() => f.sent.length >= 4);
  assert.deepEqual(f.sent, ["[card]", "找到了，这只猫笑死", "你看", "看完了，最后撕纸那下好吵哈哈"]);
  const cont = f.seen[1];
  assert.match(cont.userMessage, /要视频请求的延续/);
  assert.match(cont.story.setting.world, /拆纸箱/);
  assert.match(cont.story.setting.world, /reply.mode设为none/);
  const self = f.seen[2];
  assert.match(self.story.setting.world, /你刚才自己把这个视频分享给了对方/);
  assert.match(self.story.setting.world, /找到了，这只猫笑死/);
  assert.match(self.story.setting.world, /撕纸声/);
  assert.doesNotMatch(self.story.setting.world, /准确URL/);
  await waitFor(() => f.journal.data.viewTasks.at(-1)?.status === "sent");
  assert.equal(f.journal.data.viewTasks.at(-1).mode, "self");
  assert.equal(f.journal.data.shares[0].status, "accepted");
  assert.equal(s.calls, 1);
});

test("0.7.8 deferred: any new owner message cancels; HDS 'none' drops quietly", { timeout: 10000 }, async (t) => {
  const s = slow();
  const f = fixture(t, { candidates: s.fn, conf: { askWaitSec: 0 }, replies: ["我找找"] });
  f.bridge.ownerMessage();
  const tag = await f.bridge.request({}, "猫猫", "ask");
  await f.decide(request({ userMessage: tag + "\n发个猫猫视频" }));
  f.bridge.ownerMessage();
  s.release([rec]);
  await f.bridge.poolSettled();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(f.seen.length, 1);
  assert.deepEqual(f.sent, []);
  assert.match(f.bridge.status(), /已就绪1个/);

  const s2 = slow();
  const g = fixture(t, { candidates: s2.fn, conf: { askWaitSec: 0 }, replies: ["等着", null] });
  g.bridge.ownerMessage();
  const tag2 = await g.bridge.request({}, "", "ask");
  await g.decide(request({ userMessage: tag2 + "\n发个视频" }));
  s2.release([rec]);
  await waitFor(() => g.seen.length === 2);
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(g.sent, []);
  assert.match(g.bridge.status(), /补发未进行：HDS决定这次不发/);
});

test("0.7.8 deferred: a read that finished before the HDS turn is used directly", { timeout: 10000 }, async (t) => {
  const s = slow();
  const f = fixture(t, { candidates: s.fn, conf: { askWaitSec: 0 }, replies: [url + "喏，这个"] });
  const tag = await f.bridge.request({}, "猫猫", "ask");
  s.release([rec]);
  await f.bridge.poolSettled();
  await f.decide(request({ userMessage: tag + "\n发个猫猫视频" }));
  assert.match(f.seen[0].story.setting.world, new RegExp(V));
  assert.doesNotMatch(f.bridge.status(), /待补发/);
});

test("0.7.8 self-watch never displaces a live watch of the owner's share; can be disabled", { timeout: 10000 }, async (t) => {
  const f = fixture(t, { replies: [url + "这个给你"] });
  f.bridge.beginPaced({}, "BV1xxxxxxxxx", { waitMinSec: 0, waitMaxSec: 0, taskTimeoutSec: 30 });
  const tag = await f.bridge.request({}, "猫猫", "ask");
  const d = await f.decide(request({ userMessage: tag + "\n发个猫猫视频" }));
  const s = outSession(d.interaction.reply.content);
  await f.bridge.beforeSend(s);
  assert.deepEqual(f.cards, [V]);
  assert.notEqual(f.journal.data.viewTasks.at(-1).mode, "self");

  const g = fixture(t, { replies: [url + "这个给你"], conf: { selfWatchEnabled: false } });
  const tag2 = await g.bridge.request({}, "猫猫", "ask");
  const d2 = await g.decide(request({ userMessage: tag2 + "\n发个猫猫视频" }));
  await g.bridge.beforeSend(outSession(d2.interaction.reply.content));
  assert.deepEqual(g.cards, [V]);
  assert.equal(g.journal.data.viewTasks.length, 0);
});

test("0.7.8 self-watch: follow-up 看了没 delivers early; status shows self mode", { timeout: 10000 }, async (t) => {
  const f = fixture(t, { replies: [url + "这个给你", "看完啦，猫太蠢了"], conf: { selfWatchWaitMinSec: 300, selfWatchWaitMaxSec: 300 } });
  const tag = await f.bridge.request({}, "猫猫", "ask");
  const d = await f.decide(request({ userMessage: tag + "\n发个猫猫视频" }));
  await f.bridge.beforeSend(outSession(d.interaction.reply.content));
  await waitFor(() => f.journal.data.viewTasks.at(-1)?.status === "waiting");
  assert.match(f.bridge.status(), /观看任务（自己分享后去看）：等待分享/);
  assert.equal(await f.bridge.followPaced({}, "看了没"), true);
  await waitFor(() => f.sent.includes("看完啦，猫太蠢了"));
  // A normal chat turn while she is still "watching" gets the self-mode guidance.
});

test("0.7.8 middleware: follow-up within 10 minutes reuses the ask query (real Koishi + HDS)", { timeout: 20000 }, async (t) => {
  const HTTP = require("@koishijs/plugin-http").default, SQLite = require("@koishijs/plugin-database-sqlite").default, HDS = require("koishi-plugin-hds-interlude");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bili078-hds-")), app = new App();
  app.baseDir = dir;
  const mws = [];
  const om = app.middleware.bind(app);
  app.middleware = (fn, ...a) => { if (fn.toString().includes("askVideo")) mws.push(fn); return om(fn, ...a); };
  app.plugin(HTTP, {});
  app.plugin(SQLite, { path: path.join(dir, "koishi.db") });
  app.plugin(plugin, cfg({ autoEnabled: false, candidateLimit: 1 }));
  app.plugin(HDS, HDS.Config({ storyDefaults: { characterName: "Atri", characterProfile: "原人设", world: "原世界" }, runtime: { autoAdvanceEnabled: false, allowProactiveMessages: false, splitReplyMessages: true, messageSeparator: "<sep/>" }, model: { providers: [] }, memory: { enabled: false }, onebot: { enabled: false }, logging: { logScriptPreview: false } }));
  const note = Api.prototype.note, search = Api.prototype.search, popular = Api.prototype.popular;
  const searched = [];
  Api.prototype.note = async () => rec;
  Api.prototype.search = async (q) => { searched.push(q); return [rec.detail]; };
  Api.prototype.popular = async () => { searched.push("(popular)"); return [rec.detail]; };
  t.after(async () => { Api.prototype.note = note; Api.prototype.search = search; Api.prototype.popular = popular; await app.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  await app.start();
  await new Promise((r) => setTimeout(r, 100));
  const base = { platform: "onebot", selfId: "1000000002", userId: "1000000001", channelId: "private:1000000001", username: "kf", isDirect: true };
  const early = { ...base, content: "挑好了吗" };
  await mws[0](early, () => {});
  assert.equal(early.content, "挑好了吗", "no ask yet → not a follow-up");
  await mws[0]({ ...base, content: "发个猫猫视频给我" }, () => {});
  const fu = { ...base, content: "你再试试能不能发给我卡片" };
  await mws[0](fu, () => {});
  assert.match(fu.content, /^\[atri-bili-request:[0-9a-f]+\]\n你再试试能不能发给我卡片$/);
  assert.deepEqual(searched, ["猫猫", "猫猫"]);
  const chat = { ...base, content: "今天好累" };
  await mws[0](chat, () => {});
  assert.equal(chat.content, "今天好累");
});

test("0.7.8 fix: HDS re-running the narrator for the same turn keeps the candidates", { timeout: 10000 }, async (t) => {
  const f = fixture(t, { replies: ["结构缺失的一稿", url + "喏<sep/>别说我不给"] });
  const tag = await f.bridge.request({}, "", "ask");
  await f.decide(request({ userMessage: tag + "\n发个视频" }));
  const d2 = await f.decide(request({ userMessage: tag + "\n发个视频", outputRecovery: true }));
  assert.match(f.seen[1].story.setting.world, new RegExp(V), "second draft still sees the candidate");
  await f.bridge.beforeSend(outSession(f.service.splitOutgoingMessage(d2.interaction.reply.content)[0]));
  assert.deepEqual(f.cards, [V]);
});

test("0.7.8 fix: explicit ask with candidates defaults to sending; delivery truth is stated", async (t) => {
  const f = fixture(t, { replies: ["不给"] });
  const tag = await f.bridge.request({}, "", "ask");
  await f.decide(request({ userMessage: tag + "\n发个视频" }));
  const w = f.seen[0].story.setting.world;
  assert.match(w, /默认要从中挑一个发出去/);
  assert.match(w, /第一气泡开头就必须真的放视频URL/);
  assert.match(w, /最近24小时没有任何QQ视频卡片真正发出/);
  assert.doesNotMatch(w, /不必每次都发/);
  f.journal.data.shares.push({ bvid: V, status: "accepted", at: Date.now() });
  await f.decide(request({ userMessage: "刚才那个卡片呢" }));
  assert.doesNotMatch(f.seen[1].story.setting.world, /没有任何QQ视频卡片真正发出/);
  assert.match(f.seen[1].story.setting.world, /最近QQ卡片适配器已回执/);
});

test("0.7.8 fix: '你最近看的视频' no longer searches for the word 看", () => {
  assert.deepEqual(askVideo("找个你最近看的视频给我看看呗"), { query: "" });
  assert.deepEqual(askVideo("我靠，你给我发点你看的视频，等会给你加新功能"), { query: "" });
  assert.deepEqual(askVideo("发个你在刷的猫猫视频"), { query: "猫猫" });
});
