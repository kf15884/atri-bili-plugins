"use strict";
// 0.8.0: plugin-driven ask (pick → watch → card → words), prepared recommendation, conflicts.
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

function fixture(t, { replies = [], list = [A, B, C, D, E], conf = {}, cardFail = false, runtime = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bili080-")), journal = new Journal(path.join(dir, "state.json"));
  const seen = [], sent = [], cards = [], watched = [], asked = [], logs = [];
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
    candidates: async (q, n) => { asked.push([q, n]); if (list instanceof Error) throw list; return list.slice(0, n); },
    readIncoming: async (v) => A,
    watch: async (r) => { watched.push(r.bvid); return { ...r, note: r.note + "\n视频观看资料：画面：" + r.detail.title + "的画面。听到：笑声。", frames: { count: 6 } }; },
    card: async (_b, v, _u, live, submit) => { if (!live()) throw new Error("dead"); if (cardFail) { const { Fault } = require("../api"); throw new Fault("qq-api-rejected"); } submit(); cards.push(v.bvid); sent.push("[card " + v.bvid + "]"); return "111"; },
  });
  bridge.install(service);
  const base = service.getNarrator();
  t.after(() => { bridge.dispose(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { bridge, service, journal, seen, sent, cards, watched, asked, logs, decide: (r) => base.decide(r), setPending: (v) => (pending = v), queue };
}
async function ask(f, text = "发个视频给我", query = "") {
  const tag = await f.bridge.request({}, query, "ask");
  return f.decide(request({ userMessage: tag + "\n" + text }));
}

test("0.8.0 recognition: new phrasings, again-words, and non-asks", () => {
  for (const x of ["你把视频发我试试", "把视频发我", "视频发我看看", "发我个视频", "给我发个猫猫视频", "你发个b站视频给我", "有没有好看的视频", "推荐个视频"]) assert.ok(askVideo(x), x);
  assert.equal(askVideo("给我发个猫猫视频").query, "猫猫");
  assert.equal(askVideo("你把视频发我试试").query, "");
  for (const x of ["我发的视频你看了吗", "你发的视频真好看", "不要发视频", "挑好了吗", "今天好累", "视频看完了吗"]) assert.equal(askVideo(x), null, x);
  for (const x of ["再发一个", "再来一个", "换一个", "再发一次", "再来一个视频"]) assert.equal(askAgain(x), true, x);
  for (const x of ["挑好了吗", "视频呢", "不用再发了", "你再说一遍刚才的话好不好呀我没看懂"]) assert.equal(askAgain(x), false, x);
});

test("0.8.0 ask: silent turn → 5 text candidates → HDS picks → watch → card first, then words without URL", { timeout: 10000 }, async (t) => {
  const f = fixture(t, { replies: [reply(URL(C) + "\n新番我最近在追，想给他看看"), reply("这个新番速评说得挺准<sep/>你肯定喜欢")] });
  const d = await ask(f, "你把视频发我试试");
  assert.equal(d.interaction.reply.mode, "none");
  assert.ok(d.script.trim(), "HDS needs a non-empty script for the silent turn");
  await waitFor(() => f.sent.length >= 3);
  assert.deepEqual(f.sent, ["[card " + C.bvid + "]", "这个新番速评说得挺准", "你肯定喜欢"]);
  assert.deepEqual(f.asked, [["", 5]]);
  const pick = f.seen[0].story.setting.world;
  for (const r of [A, B, C, D, E]) assert.match(pick, new RegExp(r.bvid));
  assert.match(pick, /原则上一定挑一个/);
  assert.doesNotMatch(pick, /字幕。仅API资料/, "pick uses text brief only, not subtitles");
  assert.deepEqual(f.watched, [C.bvid]);
  const share = f.seen[1].story.setting.world;
  assert.match(share, /新番速评的画面/);
  assert.match(share, /为什么想推荐/);
  assert.match(share, /新番我最近在追/);
  assert.equal(f.journal.data.shares.at(-1).status, "accepted");
  assert.equal(f.seen.length, 2);
});

test("0.8.0 ask: HDS picks nothing → persona 'nothing good' reply, no card, no watch", { timeout: 10000 }, async (t) => {
  const f = fixture(t, { replies: [reply("最近刷到的都一般，等我找到好的再说")] });
  await ask(f);
  await waitFor(() => f.sent.length >= 1);
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(f.sent, ["最近刷到的都一般，等我找到好的再说"]);
  assert.deepEqual(f.cards, []);
  assert.deepEqual(f.watched, []);
});

test("0.8.0 ask: no candidates → HDS told honestly, no URL leaks", { timeout: 10000 }, async (t) => {
  const f = fixture(t, { list: new Error("net"), replies: [reply("今天B站好像抽风了，刷不出来 https://www.bilibili.com/video/BV1Yw7M6RERb/")] });
  await ask(f);
  await waitFor(() => f.sent.length >= 1);
  assert.match(f.seen[0].story.setting.world, /没能刷到可以发的视频/);
  assert.deepEqual(f.sent, ["今天B站好像抽风了，刷不出来"]);
});

test("0.8.0 ask: card failure → honest line only, recommendation words withheld", { timeout: 10000 }, async (t) => {
  const f = fixture(t, { cardFail: true, replies: [reply(URL(A)), reply("这个猫猫笑死我了"), reply("卡片好像没发出去，等会儿再试")] });
  await ask(f);
  await waitFor(() => f.sent.length >= 1);
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(f.sent, ["卡片好像没发出去，等会儿再试"]);
  assert.match(f.seen[2].story.setting.world, /卡片没有发出去/);
  assert.equal(f.journal.data.shares.at(-1).status, "failed");
});

test("0.8.0 ask: HDS re-running the same turn stays silent and starts one task", { timeout: 10000 }, async (t) => {
  const f = fixture(t, { replies: [reply(URL(A)), reply("猫猫这段太好笑了")] });
  const tag = await f.bridge.request({}, "", "ask");
  const r1 = await f.decide(request({ userMessage: tag + "\n发个视频" }));
  const r2 = await f.decide(request({ userMessage: tag + "\n发个视频" }));
  assert.equal(r1.interaction.reply.mode, "none");
  assert.equal(r2.interaction.reply.mode, "none");
  await waitFor(() => f.sent.length >= 2);
  assert.equal(f.asked.length, 1);
});

test("0.8.0 conflicts: chat during a running ask gets 'still picking' guidance; 算了 cancels", { timeout: 10000 }, async (t) => {
  let release;
  const gate = new Promise((r) => (release = r));
  const f = fixture(t, { replies: [async () => { await gate; return reply(URL(A)); }, reply("你好呀"), reply("猫猫")] });
  await ask(f);
  await waitFor(() => f.seen.length === 1);
  assert.ok(f.bridge.askLive());
  // Second ask while running does not start another task (middleware passes it to HDS instead).
  await f.decide(request({ userMessage: "挑好了吗" }));
  const chat = f.seen[1].story.setting.world;
  assert.match(chat, /正在挑\/看/);
  assert.match(chat, /不要说已经发了/);
  assert.match(f.bridge.status(), /要视频处理中/);
  f.bridge.ownerMessage("今天天气不错");
  assert.ok(f.bridge.askLive());
  f.bridge.ownerMessage("算了");
  assert.equal(f.bridge.askLive(), false);
  release();
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(f.sent, []);
  assert.deepEqual(f.cards, []);
});

test("0.8.0 conflicts: delivery waits for HDS foreground turn to finish", { timeout: 10000 }, async (t) => {
  const f = fixture(t, { replies: [reply(URL(B)), reply("翻车现场哈哈")] });
  f.setPending(true);
  await ask(f);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(f.seen.length, 0, "even the pick waits for the foreground");
  f.setPending(false);
  await waitFor(() => f.sent.length >= 2);
  assert.deepEqual(f.sent, ["[card " + B.bvid + "]", "翻车现场哈哈"]);
});

test("0.8.0 prep: story shows browsing → watch all candidates → one prepared video; limits apply", { timeout: 10000 }, async (t) => {
  const f = fixture(t, { replies: [reply("嗯，在看", "Atri窝在椅子里刷了会儿B站。"), reply(URL(D) + "这个钢琴改编我循环了三遍<sep/>你也听听"), reply("嗯", "Atri又刷了会儿B站。")] });
  await f.decide(request({ userMessage: "你在干嘛" }));
  await waitFor(() => !!f.journal.data.prepared);
  assert.deepEqual(f.asked, [["", 4]]);
  assert.deepEqual(f.watched, [A.bvid, B.bvid, C.bvid, D.bvid]);
  const judge = f.seen[1].story.setting.world;
  assert.match(judge, /钢琴改编的画面/);
  assert.match(judge, /mode设为none/);
  const p = f.journal.data.prepared;
  assert.equal(p.bvid, D.bvid);
  assert.equal(p.draft.interaction.reply.content, "这个钢琴改编我循环了三遍<sep/>你也听听");
  assert.deepEqual(f.sent, [], "prep never messages by itself");
  assert.match(f.bridge.status(), /预备视频：《钢琴改编》/);
  // Already has a prepared one → no second prep.
  await f.decide(request({ userMessage: "然后呢" }));
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(f.asked.length, 1);
  assert.ok(f.logs.some((l) => /已有预备视频/.test(l)));
});

test("0.8.0 prep: interval and daily limit; judge 'none' keeps nothing", { timeout: 10000 }, async (t) => {
  const f = fixture(t, { replies: [reply("嗯", "Atri刷着视频。"), reply(null), reply("嗯", "Atri刷着视频。")] });
  await f.decide(request());
  await waitFor(() => f.seen.length >= 2);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(f.journal.data.prepared, null);
  await f.decide(request());
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(f.asked.length, 1);
  assert.ok(f.logs.some((l) => /预看间隔未到/.test(l)));
});

test("0.8.0 ask uses the prepared video: fresh draft as-is, older draft refreshed; slot cleared", { timeout: 10000 }, async (t) => {
  const f = fixture(t);
  f.journal.data.prepared = { bvid: D.bvid, title: "钢琴改编", video: D.detail, note: "看过：钢琴", thought: "循环了三遍", draft: reply("这个我循环了三遍<sep/>你听听"), at: Date.now() - 60000 };
  await ask(f);
  await waitFor(() => f.sent.length >= 3);
  assert.deepEqual(f.sent, ["[card " + D.bvid + "]", "这个我循环了三遍", "你听听"]);
  assert.equal(f.seen.length, 0, "no pick, no watch, no rewrite");
  assert.deepEqual(f.watched, []);
  assert.equal(f.journal.data.prepared, null);

  const g = fixture(t, { replies: [reply("之前刷到这个，一直想发你")] });
  g.journal.data.prepared = { bvid: D.bvid, title: "钢琴改编", video: D.detail, note: "看过：钢琴", thought: "循环了三遍", draft: reply("旧稿"), at: Date.now() - 2 * 3600000 };
  await ask(g);
  await waitFor(() => g.sent.length >= 2);
  assert.deepEqual(g.sent, ["[card " + D.bvid + "]", "之前刷到这个，一直想发你"]);
  assert.match(g.seen[0].story.setting.world, /循环了三遍/);
  assert.match(g.seen[0].story.setting.world, /别像背稿/);

  const x = fixture(t, { replies: [reply(null)] });
  x.journal.data.prepared = { bvid: D.bvid, title: "钢琴改编", video: D.detail, note: "", thought: "", draft: null, at: Date.now() - 49 * 3600000 };
  assert.match(x.bridge.status(), /预备视频：无/, "expired after 48h");
});

test("0.8.0 proactive: prepared video offered only on allowed advance turns; URL → card, then words", { timeout: 10000 }, async (t) => {
  const f = fixture(t, { runtime: { autoAdvanceEnabled: true, allowProactiveMessages: true }, replies: [{ script: "Atri想起那个钢琴改编，给他发了消息。", interaction: { reply: { mode: "none" } }, crossConversationActions: [{ participantId: "p1", mode: "immediate", content: URL(D) + "刚刷到这个，钢琴改编绝了<sep/>你有空听听" }] }] });
  f.journal.data.prepared = { bvid: D.bvid, title: "钢琴改编", video: D.detail, note: "看过：钢琴", thought: "循环了三遍", draft: null, at: Date.now() };
  const r = { story: STORY(), participants: [P()], phase: "advance", userMessage: "" };
  const result = await f.decide(r);
  assert.match(f.seen[0].story.setting.world, /主动联系许可/);
  assert.match(f.seen[0].story.setting.world, new RegExp(D.bvid));
  for (const content of f.service.splitOutgoingMessage(result.crossConversationActions[0].content)) {
    const s = outSession(content); await f.bridge.beforeSend(s); f.sent.push(s.content);
  }
  assert.deepEqual(f.sent, ["[card " + D.bvid + "]", "刚刷到这个，钢琴改编绝了", "你有空听听"]);
  assert.deepEqual(f.journal.data.shares.map((x) => x.bvid), [D.bvid]);
  assert.equal(f.journal.data.prepared, null);

  const g = fixture(t, { runtime: { autoAdvanceEnabled: true, allowProactiveMessages: false } });
  g.journal.data.prepared = { bvid: D.bvid, title: "钢琴改编", video: D.detail, note: "", thought: "", draft: null, at: Date.now() };
  await g.decide({ story: STORY(), participants: [P()], phase: "advance", userMessage: "" });
  assert.doesNotMatch(g.seen[0].story.setting.world, /BV1Cd4y1E7fG/);
});

test("0.8.0 outgoing: stray video links are removed; link-only bubble is dropped; command output exempt", async (t) => {
  const f = fixture(t);
  const s1 = outSession("你看这个 https://www.bilibili.com/video/BV1Yw7M6RERb/ 超好笑");
  assert.equal(await f.bridge.beforeSend(s1), undefined);
  assert.equal(s1.content, "你看这个 超好笑");
  const s2 = outSession("https://www.bilibili.com/video/BV1Yw7M6RERb/");
  assert.equal(await f.bridge.beforeSend(s2), true);
  const text = "猫猫\nhttps://www.bilibili.com/video/BV1Yw7M6RERb/";
  f.bridge.exempt(text);
  const s3 = outSession(text);
  assert.equal(await f.bridge.beforeSend(s3), undefined);
  assert.equal(s3.content, text);
  const s4 = outSession("今天吃什么");
  await f.bridge.beforeSend(s4);
  assert.equal(s4.content, "今天吃什么");
});

test("0.8.0 watched library: a BV watched once is reused, not re-watched", { timeout: 10000 }, async (t) => {
  const f = fixture(t, { replies: [reply(URL(A)), reply("猫猫"), reply(URL(A)), reply("又是猫猫")] });
  f.journal.data.shares = [];
  await ask(f);
  await waitFor(() => f.sent.length >= 2);
  f.journal.data.shares = []; // pretend not shared, so A stays a candidate
  await ask(f, "再发一个");
  await waitFor(() => f.sent.length >= 4);
  assert.deepEqual(f.watched, [A.bvid]);
  assert.match(f.seen[3].story.setting.world, /猫猫拆纸箱的画面/);
});
