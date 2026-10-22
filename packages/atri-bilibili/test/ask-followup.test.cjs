"use strict";
// Ask recognition kept from 0.7.8 (deferred/self-watch flows replaced by recommend.test.cjs in 0.8.0).
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

test("0.7.8 fix: '你最近看的视频' no longer searches for the word 看", () => {
  assert.deepEqual(askVideo("找个你最近看的视频给我看看呗"), { query: "" });
  assert.deepEqual(askVideo("我靠，你给我发点你看的视频，等会给你加新功能"), { query: "" });
  assert.deepEqual(askVideo("发个你在刷的猫猫视频"), { query: "猫猫" });
});
test("0.8.1 ask query: time and politeness words are not topics", () => {
  const { askVideo } = require("../ask");
  for (const t of ["你现在把视频发我", "现在发个视频给我", "能不能发个视频给我", "你把视频发我试试"]) assert.equal(askVideo(t).query, "", t);
  assert.equal(askVideo("你马上给我发个猫猫视频").query, "猫猫");
  assert.equal(askVideo("来个快乐的视频").query, "快乐");
  assert.equal(askVideo("给我发个下饭视频").query, "下饭");
});
