"use strict";
// 0.8.3: browser/search coordination — link→card, HDS browser guard, Bilibili browserIntents → watch task.
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const plugin = require(".."),
  { askVideo, askAgain } = require("../ask"),
  { Journal } = require("../journal"),
  { createBridge } = require("../hds");
const mk = (bv, title) => ({ bvid: bv, detail: { bvid: bv, title, pic: "https://i0.hdslb.com/bfs/archive/t.jpg", owner: { name: "UP" }, duration: 60, desc: title + "的简介" }, note: "视频：" + title + "\n字幕：" + title + "字幕。仅API资料。" });
const A = mk("BV1Yw7M6RERb", "猫猫拆纸箱"), B = mk("BV1XNngzHEC5", "做饭翻车"), C = mk("BV1Ab4y1C7dE", "新番速评"), D = mk("BV1Cd4y1E7fG", "钢琴改编"), E = mk("BV1Ef4y1G7hI", "露营日记");
const URL = (r) => "https://www.bilibili.com/video/" + r.bvid + "/";
const cfg = (o = {}) => plugin.Config({ targetUserId: "1000000001", selfId: "1000000002", quietStart: 0, quietEnd: 0, cardGapMinSec: 0, cardGapMaxSec: 0, ...o });
const P = () => ({ id: "p1", storyId: "s1", status: "active", platform: "onebot", selfId: "1000000002", userId: "1000000001" });
const STORY = () => ({ id: "s1", platform: "onebot", selfId: "1000000002", status: "active", setting: { world: "原世界" } });
const request = (over = {}) => ({ story: STORY(), participant: P(), participants: [P()], phase: "user-message", userMessage: "日常", ...over });
const waitFor = async (fn, ms = 3000) => { const end = Date.now() + ms; while (!fn() && Date.now() < end) await new Promise((r) => setTimeout(r, 5)); assert.ok(fn(), "condition reached"); };
const outSession = (content) => ({ isDirect: true, platform: "onebot", selfId: "1000000002", channelId: "private:1000000001", content, bot: {} });
const reply = (content, script) => (content === null ? { script: script || "Atri想了想。", interaction: { reply: { mode: "none" } } } : { script: script || "Atri说：" + content, interaction: { seen: true, reply: { mode: "immediate", content } } });

function fixture(t, { replies = [], list = [A, B, C, D, E], conf = {}, cardFail = false, runtime = {}, readable = [A, B, C, D, E] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bili080-")), journal = new Journal(path.join(dir, "state.json"));
  const seen = [], sent = [], cards = [], watched = [], asked = [], logs = [], reads = [];
  let k = 0, bridge, pending = false;
  const queue = [...replies];
  let narrator = { decide: async (r) => { seen.push(r); const x = queue.length ? queue.shift() : reply("嗯"); return typeof x === "function" ? x(r) : x; } };
  const service = {
    config: { runtime }, getNarrator: () => narrator, setNarrator: (n) => (narrator = n),
    splitOutgoingMessage: (s) => s.split("<sep/>").map((x) => x.trim()).filter(Boolean), getDesktopRuntimePhase: () => "running",
    confirmOutgoingDeliveries: async (_s, e) => e,
    persistDecision: async (_st, p, d) => ({ messages: service.splitOutgoingMessage(d.interaction.reply.content).map((content) => ({ participantId: p.id, content })) }),
    deliverOutgoingMessages: async (_st, msgs) => { const out = []; for (const m of msgs) { const s = outSession(m.content); if (await bridge.beforeSend(s)) continue; sent.push(s.content); out.push(m); } return out; },
    serial: async (_id, fn) => fn(), getStory: async () => STORY(), getParticipant: async () => P(), dbGet: async () => [],
    recentEntriesForPrompt: async () => [], taskGeneration: () => "g", taskGenerationCurrent: () => true,
    canHandleStory: () => true, canHandleParticipant: () => true, appendEntry: async () => {}, recordIncomingMessage: async () => {}, hasPendingNarrative: () => pending,
  };
  const ctx = { baseDir: dir, on: () => {}, inject: () => {}, logger: () => ({ info: (...a) => logs.push(a.join(" ")), warn: (...a) => logs.push("W " + a.join(" ")) }) };
  bridge = createBridge(ctx, cfg(conf), {
    journal, active: () => true,
    candidates: async (q, n) => { asked.push([q, n]); if (list instanceof Error) throw list; const hit = list.find((x) => String(q).includes(x.bvid)); return hit ? [hit] : list.slice(0, n); },
    readIncoming: async (v) => A,
    readVideo: async (v) => { reads.push(v); const r = readable.find((x) => x.bvid === v || v.includes(x.bvid)); if (!r) { const { Fault } = require("../api"); throw new Fault("bili-code-404"); } return r; },
    watch: async (r) => { watched.push(r.bvid); return { ...r, note: r.note + "\n视频观看资料：画面：" + r.detail.title + "的画面。听到：笑声。", frames: { count: 6 } }; },
    card: async (_b, v, _u, live, submit) => { if (!live()) throw new Error("dead"); if (cardFail) { const { Fault } = require("../api"); throw new Fault("qq-api-rejected"); } submit(); cards.push(v.bvid); sent.push("[card " + v.bvid + "]"); return "111"; },
  });
  bridge.install(service);
  const base = service.getNarrator();
  t.after(() => { bridge.dispose(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { bridge, service, journal, seen, sent, cards, watched, asked, logs, reads, decide: (r) => base.decide(r), setPending: (v) => (pending = v), queue };
}

test("0.8.3 link→card: real video links become QQ cards; invented ids, owner shares and duplicates only lose the link", async (t) => {
  const f = fixture(t);
  const s1 = outSession("你看这个 " + URL(B) + " 超好笑");
  assert.equal(await f.bridge.beforeSend(s1), undefined);
  assert.equal(s1.content, "你看这个 超好笑");
  assert.deepEqual(f.cards, [B.bvid]);
  assert.equal(f.journal.data.shares.at(-1).via, "link");
  assert.equal(f.journal.data.shares.at(-1).status, "accepted");
  // same video again within rewatchDays → no second card
  const s2 = outSession(URL(B));
  assert.equal(await f.bridge.beforeSend(s2), true);
  assert.deepEqual(f.cards, [B.bvid]);
  // invented BV → removed, no card
  const s3 = outSession("这个 https://www.bilibili.com/video/BV1zzzzzzzzz/ 好看");
  await f.bridge.beforeSend(s3);
  assert.equal(s3.content, "这个 好看");
  assert.deepEqual(f.cards, [B.bvid]);
  // a link-only bubble that becomes a card is not sent as text
  const s4 = outSession("https://m.bilibili.com/video/" + C.bvid + "?p=1");
  assert.equal(await f.bridge.beforeSend(s4), true);
  assert.deepEqual(f.cards, [B.bvid, C.bvid]);
  // plain text untouched, no read
  const n = f.reads.length, s5 = outSession("今天吃什么");
  await f.bridge.beforeSend(s5);
  assert.equal(s5.content, "今天吃什么");
  assert.equal(f.reads.length, n);
});

test("0.8.3 link→card: the owner's own shared video is never echoed back as a card", async (t) => {
  const f = fixture(t);
  await f.decide(request({ userMessage: "你看这个 " + URL(D) }));
  const s = outSession(URL(D) + " 哈哈这个我也刷到了");
  await f.bridge.beforeSend(s);
  assert.equal(s.content, "哈哈这个我也刷到了");
  assert.deepEqual(f.cards, []);
  const tag = await f.bridge.request({}, E.bvid, "incoming");
  await f.decide(request({ userMessage: tag + "\n分享视频" }));
  const s2 = outSession(URL(A) + "感想");
  await f.bridge.beforeSend(s2); // readIncoming returns A in this fixture
  assert.deepEqual(f.cards, []);
});

test("0.8.3 link→card: card failure keeps the original link; linkToCard=false only strips", async (t) => {
  const f = fixture(t, { cardFail: true });
  const s = outSession("看 " + URL(B));
  await f.bridge.beforeSend(s);
  assert.equal(s.content, "看 " + URL(B));
  assert.equal(f.journal.data.shares.at(-1).status, "failed");
  const g = fixture(t, { conf: { linkToCard: false } });
  const s2 = outSession("看 " + URL(B) + " 吧");
  await g.bridge.beforeSend(s2);
  assert.equal(s2.content, "看 吧");
  assert.deepEqual(g.cards, []);
  assert.deepEqual(g.reads, []);
});

test("0.8.3 browser guard: owner Bilibili link turns disable HDS browsing; ordinary turns keep HDS settings", async (t) => {
  const f = fixture(t);
  await f.decide(request({ userMessage: "这个好好笑 https://b23.tv/abcd123", writingOptions: { browserMode: "deferred-only" } }));
  assert.equal(f.seen[0].writingOptions.browserMode, "disabled");
  await f.decide(request({ userMessage: "今天好累", writingOptions: { browserMode: "deferred-only" } }));
  assert.equal(f.seen[1].writingOptions.browserMode, "deferred-only");
  assert.match(f.seen[1].story.setting.world, /不要用浏览器打开B站/);
  const g = fixture(t, { conf: { browserHandoff: false } });
  await g.decide(request({ userMessage: "看 " + URL(A), writingOptions: { browserMode: "deferred-only" } }));
  assert.equal(g.seen[0].writingOptions.browserMode, "deferred-only");
  assert.doesNotMatch(g.seen[0].story.setting.world, /不要用浏览器打开B站/);
});

test("0.8.3 handoff: HDS browserIntent for a Bilibili video → removed, watched by eyes, judged into the prepared slot", { timeout: 10000 }, async (t) => {
  const f = fixture(t, { replies: [
    { script: "Atri想去B站看看那个视频。", interaction: { seen: true, reply: { mode: "immediate", content: "等我去看看" } }, browserIntents: [{ mode: "visit", url: URL(C), purpose: "看视频", timing: "immediate" }, { mode: "search", query: "明天天气", purpose: "查天气", timing: "deferred" }] },
    reply(URL(C) + "这个新番速评挺准，想发给他"),
  ] });
  const result = await f.decide(request({ userMessage: "你去看看那个新番速评" }));
  assert.deepEqual(result.browserIntents.map((x) => x.query), ["明天天气"]);
  await waitFor(() => f.journal.data.prepared?.bvid === C.bvid);
  assert.deepEqual(f.watched, [C.bvid]);
  assert.deepEqual(f.asked[0], [C.bvid, 1]);
  assert.equal(f.journal.data.prepared.draft.interaction.reply.content, "这个新番速评挺准，想发给他");
  assert.ok(f.logs.some((x) => /HDS想用浏览器打开B站/.test(x)));
});

test("0.8.3 handoff: B站 search intent → plugin search with the cleaned words; full prepared slot → watch only", { timeout: 10000 }, async (t) => {
  const f = fixture(t, { replies: [{ script: "Atri想上B站搜猫猫。", interaction: { reply: { mode: "none" } }, browserIntents: [{ mode: "search", query: "B站 猫猫 视频", purpose: "找视频" }] }] });
  f.journal.data.prepared = { bvid: E.bvid, title: "露营日记", video: E.detail, note: "", thought: "", draft: null, at: Date.now() };
  const result = await f.decide(request({ userMessage: "日常" }));
  assert.deepEqual(result.browserIntents, []);
  await waitFor(() => f.watched.length === 3);
  assert.deepEqual(f.asked[0], ["猫猫", 3]);
  assert.equal(f.journal.data.prepared.bvid, E.bvid);
  assert.equal(f.seen.length, 1, "no HDS judge turn when the slot is full");
});

test("0.8.3 handoff API for other plugins: needs a recent HDS turn; daily limit respected", { timeout: 10000 }, async (t) => {
  const f = fixture(t, { conf: { handoffDailyLimit: 1 }, replies: [reply("嗯"), reply(null)] });
  assert.match(f.bridge.handoff(URL(B)), /还没有可用的HDS私聊回合/);
  await f.decide(request({ userMessage: "日常" }));
  assert.equal(f.bridge.handoff("看看 " + URL(B), "atri-search"), "已交给观看任务");
  await waitFor(() => f.watched.includes(B.bvid));
  await waitFor(() => !f.bridge.recommender.prepLive());
  assert.equal(f.bridge.handoff(URL(A)), "今日交接次数已满");
});
