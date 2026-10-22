"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { Senses, formatFrames, base } = require("../senses");

const ID = "fr_0123456789abcdef", SRV = "http://senses.example.invalid:8101", MAIN = "https://main.example/v1/chat/completions";
const mat = (audio = true) => ({ id: ID, bvid: "BV1xx411c7mD", prompt: "P-AUDIO", promptNoAudio: "P-NOAUDIO", audioError: audio ? null : "audio-empty",
  frames: [{ t: 5, at: "0:05", jpeg: "AAA" }, { t: 65, at: "1:05", jpeg: "BBB" }], audio: audio ? { format: "mp3", sec: 600, data: "MP3DATA" } : null });
const reply = (n = 2, audio = true) => JSON.stringify({ choices: [{ message: { content: "<think>x</think>```json\n" + JSON.stringify({ frames: Array.from({ length: n }, (_, i) => ({ index: i + 1, desc: "画面" + (i + 1) })), audio: audio ? { speech: "大家好，今天做蛋糕", sounds: "轻快的背景音乐" } : null, summary: "做蛋糕教程" }) + "\n```" } }] });

// Route-based fake fetch. handlers: [[matcher(url,opt)->bool, responder(url,opt)->[status, bodyString|obj]]]
function router(handlers) {
  const calls = [];
  const f = async (url, opt) => {
    const body = opt.body ? JSON.parse(opt.body) : undefined;
    calls.push({ url, method: opt.method, headers: opt.headers, body });
    for (const [m, r] of handlers) if (m(url, opt, body)) {
      const out = await r(url, opt, body);
      if (out instanceof Error) throw out;
      return { status: out[0], text: async () => (typeof out[1] === "string" ? out[1] : JSON.stringify(out[1])) };
    }
    throw new Error("unexpected " + url);
  };
  return { f, calls };
}
const cfg = (o = {}) => ({ framesEnabled: true, framesUrl: SRV, framesToken: "t".repeat(30), framesWaitSec: 180, ...o });
const rec = { bvid: "BV1xx411c7mD", detail: { cid: 9, duration: 600, title: "猫" }, note: "视频：猫" };
const main = (o = {}) => ({ label: "gemini-a6", endpoint: MAIN, apiKey: "MAINKEY", model: "gemini-3.8-flash", timeout: 60000, extraBody: '{"stream": false}', extraHeaders: "", proxy: false, ...o });
const is = (suffix, method) => (u, o) => u.startsWith(SRV) && u.slice(SRV.length).split("?")[0] === suffix && (!method || o.method === method);
const srv = (extra = []) => [
  [is("/v1/jobs", "POST"), () => [202, { id: ID, status: "queued" }]],
  [is("/v1/jobs/" + ID, "GET"), () => [200, { id: ID, status: "ready" }]],
  [is("/v1/jobs/" + ID + "/result", "POST"), (u, o, b) => [200, { id: ID, status: "done", result: { ...b.result, count: 2, via: "main" } }]],
  ...extra,
];

const RES = { count: 2, via: "emergency", provider: "a6", frames: [{ t: 5, desc: "画面1" }, { t: 65, desc: "画面2" }], audio: { speech: "大家好，今天做蛋糕", sounds: "轻快的背景音乐", sec: 600 }, audioError: null, summary: "做蛋糕教程", failedProviders: [] };

test("second server lines understand frames + audio; plugin polls until done", async () => {
  let polls = 0;
  const { f, calls } = router([
    [is("/v1/jobs", "POST"), () => [202, { id: ID, status: "queued" }]],
    [is("/v1/jobs/" + ID, "GET"), () => (polls++ < 1 ? [200, { id: ID, status: "describing" }] : [200, { id: ID, status: "done", result: RES }])],
  ]);
  const s = new Senses(cfg(), { fetch: f });
  const out = await s.attach(rec);
  assert.deepEqual(calls[0].body, { type: "watch", describe: "server", bvid: rec.bvid, cid: 9, duration: 600, title: "猫" });
  assert.match(calls[1].url, /\?wait=55$/);
  assert.match(out.note, /视频观看资料（第二台取材：2帧静止画面＋开头约10分钟声音；a6理解/);
  assert.match(out.note, /\[0:05\] 画面1\n\[1:05\] 画面2\n听到：讲话\/台词：大家好，今天做蛋糕；声音：轻快的背景音乐\n整体：做蛋糕教程/);
  assert.equal(s.last.audio, true);
});

test("fallback line without audio is stated plainly", () => {
  const n = formatFrames({ ...RES, provider: "line2", audio: null, audioError: "emergency-line-no-audio" });
  assert.match(n, /2帧静止画面；line2理解/);
  assert.match(n, /声音：未取得 \[emergency-line-no-audio\]，不要描述声音。/);
});

test("a leftover ready job is handed to the server lines", async () => {
  const { f, calls } = router([
    [is("/v1/jobs", "POST"), () => [200, { id: ID, status: "ready" }]],
    [is("/v1/jobs/" + ID + "/describe", "POST"), () => [202, { id: ID, status: "describe_queued" }]],
    [is("/v1/jobs/" + ID, "GET"), () => [200, { id: ID, status: "done", result: RES }]],
  ]);
  const r = await new Senses(cfg(), { fetch: f }).frames(rec);
  assert.equal(r.summary, "做蛋糕教程");
  assert.deepEqual(calls.map((c) => c.method + " " + c.url.slice(SRV.length).split("?")[0]), ["POST /v1/jobs", "POST /v1/jobs/" + ID + "/describe", "GET /v1/jobs/" + ID]);
});

test("health shows line order, audio and proxy", async () => {
  const { f } = router([[is("/v1/health", "GET"), () => [200, { ok: true, version: "0.2.0", audio: true, today: 2, vision: [{ name: "a6", audio: true, proxy: true, coolingSec: 0 }, { name: "ds", audio: false, proxy: false, coolingSec: 30 }] }]]]);
  assert.equal(await new Senses(cfg(), { fetch: f }).health(), "在线 0.2.0；声音开启；线路：a6(画面+声音，经代理)可用 → ds(画面)冷却30秒；今日任务2");
});

test("finished result on second server is reused without calling models", async () => {
  const { f, calls } = router([[is("/v1/jobs", "POST"), () => [200, { id: ID, status: "done", result: { count: 1, via: "main", frames: [{ t: 1, desc: "x" }], summary: "y" } }]]]);
  const s = new Senses(cfg(), { fetch: f });
  assert.equal((await s.frames(rec)).summary, "y"); assert.equal(calls.length, 1);
  await s.attach(rec); assert.equal(calls.length, 1); // cached
});

test("failures never throw and become a marked note", async () => {
  for (const [h, c] of [
    [[[is("/v1/jobs", "POST"), () => [401, { error: "unauthorized" }]]], "frames-unauthorized"],
    [[[is("/v1/jobs", "POST"), () => [429, { error: "daily-limit" }]]], "frames-daily-limit"],
    [[[is("/v1/jobs", "POST"), () => Object.assign(new Error("x"), { name: "TypeError" })]], "frames-unreachable"],
    [[[is("/v1/jobs", "POST"), () => [202, { id: ID, status: "queued" }]], [is("/v1/jobs/" + ID, "GET"), () => [200, { id: ID, status: "failed", error: "frames-extract-failed" }]]], "frames-frames-extract-failed"],
  ]) {
    const s = new Senses(cfg(), { fetch: router(h).f });
    const out = await s.attach(rec);
    assert.match(out.note, new RegExp("视频观看资料未取得 \\[" + c + "\\]"));
    assert.equal(s.last.code, c);
  }
});

test("deadline stops polling", async () => {
  let t = 0;
  const { f, calls } = router([[is("/v1/jobs", "POST"), () => [202, { id: ID, status: "queued" }]], [is("/v1/jobs/" + ID, "GET"), () => [200, { id: ID, status: "running" }]]]);
  const s = new Senses(cfg({ framesWaitSec: 20 }), { fetch: async (...a) => { t += 8000; return f(...a); }, now: () => t });
  assert.equal((await s.frames(rec)).error, "frames-timeout");
  assert.ok(calls.length <= 4);
});

test("disabled or bad url", async () => {
  const s = new Senses(cfg({ framesEnabled: false }), { fetch: () => assert.fail() });
  assert.equal(await s.attach(rec), rec);
  assert.equal(await s.health(), "关闭");
  for (const u of ["http://a@senses.example.invalid:8101", "ftp://senses.example.invalid", "http://senses.example.invalid:8101/x", "nope"]) assert.throws(() => base(u));
  assert.equal(base("http://senses.example.invalid:8101/"), "http://senses.example.invalid:8101");
  const s2 = new Senses(cfg({ framesUrl: "http://senses.example.invalid/evil" }), { fetch: () => assert.fail() });
  assert.match((await s2.attach(rec)).note, /frames-url-invalid/);
});

test("format caps", () => {
  assert.ok(formatFrames({ count: 12, frames: Array.from({ length: 20 }, (_, i) => ({ t: i, desc: "x".repeat(500) })), summary: "y", audio: { speech: "z".repeat(2000), sounds: "w", sec: 30 } }).length <= 3200);
  assert.match(formatFrames({ frames: [], summary: "" }), /frames-empty/);
  assert.match(formatFrames({ count: 1, provider: "a6", frames: [{ t: 1, desc: "a" }], summary: "b", audio: { speech: "", sounds: "鸟叫", sec: 45 } }), /开头约45秒声音.*\n画面：\n\[0:01\] a\n听到：声音：鸟叫/);
});

test("runtime: config defaults off; enabled plugin reports second-server health in /bili status", async (t) => {
  const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), { Context } = require("koishi");
  const plugin = require("..");
  const def = plugin.Config({ targetUserId: "1", selfId: "2" });
  assert.equal(def.framesUrl, ""); assert.equal(def.framesEnabled, false); assert.equal(def.framesScope, "shared"); assert.equal(def.framesWaitSec, 180); 
  const orig = globalThis.fetch, seen = [];
  globalThis.fetch = async (url, opt) => { seen.push([url, opt.headers.Authorization]); return { status: 200, text: async () => JSON.stringify({ ok: true, version: "0.2.0", audio: true, today: 0, vision: [{ name: "line1", coolingSec: 0 }] }) }; };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bili-senses-")), ctx = new Context();
  ctx.baseDir = dir;
  let mw; const o = ctx.middleware.bind(ctx); ctx.middleware = (fn, ...a) => { mw = fn; return o(fn, ...a); };
  ctx.plugin(plugin, plugin.Config({ targetUserId: "1", selfId: "2", quietStart: 0, quietEnd: 0, framesEnabled: true, framesUrl: SRV, framesToken: "k".repeat(30) }));
  t.after(async () => { globalThis.fetch = orig; await ctx.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  await ctx.start();
  const out = await mw({ content: "/bili status", isDirect: true, platform: "onebot", selfId: "2", userId: "1" }, () => assert.fail());
  assert.match(out, /主插件0\.7\.5-beta\.1；第二台看视频：在线 0\.2\.0；声音开启；线路：line1\(画面\)可用；今日任务0/);
  assert.deepEqual(seen, [["http://senses.example.invalid:8101/v1/health", "Bearer " + "k".repeat(30)]]);
});


test("beta privacy: account and second-server credentials default to empty; missing endpoint does not connect", async () => {
  const plugin = require("..");
  const c = plugin.Config({});
  for (const key of ["targetUserId", "selfId", "cookie", "accountUid", "framesUrl", "framesToken"])
    assert.equal(c[key], "", key);
  const s = new Senses({ ...c, framesEnabled: true, framesToken: "synthetic-test-token" }, { fetch: () => assert.fail("must not connect without endpoint") });
  assert.equal(s.on, false);
  assert.equal(await s.frames(rec), null);
  const eyes = require("../../atri-bili-eyes/package.json");
  assert.match(eyes.peerDependencies["koishi-plugin-atri-bilibili"], /0\.7\.5-beta\.1/);
});
