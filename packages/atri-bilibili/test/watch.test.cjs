"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { Context, h } = require("koishi"),
  plugin = require(".."),
  eyes = require("../../atri-bili-eyes"),
  { Api, Fault, PATHS } = require("../api"),
  { Journal } = require("../journal"),
  { createBridge, quiet, outgoing } = require("../hds"),
  { sendCard } = require("../card");
const V = "BV1Yw7M6RERb",
  V2 = "BV1XNngzHEC5",
  url = `https://www.bilibili.com/video/${V}/`,
  detail = {
    bvid: V,
    title: "测试视频",
    pic: "https://i0.hdslb.com/bfs/archive/test.jpg",
  },
  rec = {
    bvid: V,
    detail,
    note: "字幕：制作动画需要先画分镜。仅API资料，不代表播放。",
  };
const config = () =>
  plugin.Config({
    targetUserId: "1000000001",
    selfId: "1000000002",
    quietStart: 0,
    quietEnd: 0,
  });
const participant = () => ({
  id: "p1",
  storyId: "s1",
  status: "active",
  platform: "onebot",
  selfId: "1000000002",
  userId: "1000000001",
});
const request = (over = {}) => ({
  story: {
    id: "s1",
    platform: "onebot",
    selfId: "1000000002",
    status: "active",
    setting: {
      world: "原世界",
      character: { name: "Atri", profile: "原人设" },
    },
  },
  participant: participant(),
  participants: [participant()],
  phase: "user-message",
  userMessage: "日常聊天",
  ...over,
});
const sent = (body = url + "这个分镜挺细致。") => ({
  content: body,
  elements: h.parse(body),
  isDirect: true,
  platform: "onebot",
  selfId: "1000000002",
  channelId: "private:1000000001",
  bot: { selfId: "1000000002" },
});
function bridgeFixture(t, { decision, card, auto = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bili070-")),
    journal = new Journal(path.join(dir, "state.json")),
    hooks = {};
  let calls = 0,
    received,
    slow = null;
  let narrator = {
    decide: async (r) => {
      received = r;
      return (
        decision || {
          script: "Atri看到了真实资料。",
          interaction: {
            reply: { mode: "immediate", content: url + "这个分镜挺细致。" },
          },
        }
      );
    },
  };
  const initial = narrator,
    service = {
      config: {
        runtime: { autoAdvanceEnabled: auto, allowProactiveMessages: auto },
      },
      getNarrator: () => narrator,
      setNarrator: (n) => (narrator = n),
      splitOutgoingMessage: (s) =>
        s
          .split("<sep/>")
          .map((s) => s.trim())
          .filter(Boolean),
      getDesktopRuntimePhase: () => "running",
    };
  const ctx = {
    baseDir: dir,
    on: (k, fn) => {
      hooks[k] = fn;
    },
    inject: (deps, fn) => fn({ ...ctx, interlude: service }),
  };
  const c = config(),
    bridge = createBridge(ctx, c, {
      journal,
      active: () => !journal.data.paused && !journal.fault,
      candidates: async (q) => {
        calls++;
        return slow ? slow(q) : [rec];
      },
      card: card || (async () => "123"),
    });
  t.after(() => {
    bridge.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return {
    bridge,
    service,
    journal,
    c,
    initial,
    setCandidates(fn) {
      slow = fn;
    },
    get calls() {
      return calls;
    },
    get received() {
      return received;
    },
  };
}
test("API: no POST methods, no account-write or comment read routes; reject alternate write flag", async () => {
  const calls = [],
    api = new Api({
      transport: async (u, o) => {
        calls.push(o);
        return { status: 200, text: '{"code":0,"data":{}}' };
      },
    });
  assert.equal(api.post, undefined);
  assert.equal(api.comments, undefined);
  for (const route of [
    "/x/v2/reply/add",
    "/x/v2/reply",
    "/x/relation/modify",
    "/x/web-interface/archive/like",
  ]) {
    assert.ok(!PATHS.has(route));
    await assert.rejects(
      () => api.get(route),
      (e) => e.code === "api-read-only",
    );
  }
  await assert.rejects(
    () => api.get("/x/web-interface/view", {}, { write: true }),
    (e) => e.code === "api-read-only",
  );
  await assert.rejects(
    () => api.raw("https://api.bilibili.com", { method: "POST" }),
    (e) => e.code === "api-read-only",
  );
  assert.equal(calls.length, 0);
});
test("API: note excludes comments; preserves subtitle missing boundaries", async () => {
  const api = new Api();
  api.detail = async () => ({ ...detail, aid: 1, cid: 2, desc: "简介" });
  api.subtitle = async () => {
    throw new Fault("subtitle-not-found");
  };
  const r = await api.note(V, { subtitles: true, danmaku: false });
  assert.match(r.note, /字幕：subtitle-not-found/);
  assert.match(r.note, /不代表播放或完整观看/);
  assert.doesNotMatch(r.note, /热门评论/);
});
test("HDS: ordinary user turns add capability only, zero API reads and no original setting mutation", async (t) => {
  const f = bridgeFixture(t),
    r = request();
  await f.service.getNarrator().decide(r);
  assert.equal(f.calls, 0);
  assert.match(f.received.story.setting.world, /HDS当前人设/);
  assert.equal(r.story.setting.world, "原世界");
  assert.equal(r.story.setting.character.profile, "原人设");
});
test("HDS: explicit request reads once, uses actual notes, then sends card before unchanged HDS words", async (t) => {
  const events = [],
    f = bridgeFixture(t, {
      card: async (_b, v, u, _a, submit) => {
        assert.equal(v.bvid, V);
        assert.equal(u, "1000000001");
        submit();
        events.push("card");
        return "123";
      },
    }),
    tag = await f.bridge.request({}, "动画");
  const r = request({
      userMessage: tag,
      onEarlyReply: async () => {
        throw Error("must not stream early");
      },
    }),
    result = await f.service.getNarrator().decide(r);
  assert.equal(f.calls, 1);
  assert.match(f.received.story.setting.world, /制作动画需要先画分镜/);
  assert.equal(f.received.onEarlyReply, undefined);
  const s = sent(result.interaction.reply.content);
  await f.bridge.beforeSend(s);
  events.push(s.content);
  assert.deepEqual(events, ["card", "这个分镜挺细致。"]);
  assert.equal(f.journal.data.shares[0].status, "accepted");
  await f.bridge.beforeSend(sent(result.interaction.reply.content));
  assert.equal(events.length, 2);
});
test("HDS: withheld replies never cause standalone card", async (t) => {
  let sends = 0;
  const f = bridgeFixture(t, {
      decision: {
        script: "Atri自己看看，暂时不分享。",
        interaction: { reply: { mode: "none" } },
      },
      card: async () => {
        sends++;
        return "1";
      },
    }),
    tag = await f.bridge.request({}, "");
  await f.service.getNarrator().decide(request({ userMessage: tag }));
  await f.bridge.beforeSend(sent());
  assert.equal(sends, 0);
  assert.equal(f.journal.data.shares.length, 0);
});
test("HDS: group and wrong participant never receive private notes or autonomous reads", async (t) => {
  const f = bridgeFixture(t);
  for (const r of [
    request({ groupContext: { id: "g" } }),
    request({ participant: { ...participant(), userId: "other" } }),
    request({ story: { ...request().story, status: "paused" } }),
  ]) {
    await f.service.getNarrator().decide(r);
    assert.equal(f.received, r);
  }
  assert.equal(f.calls, 0);
});
test("HDS: automatic candidates only on allowed advance, cooldown even when no share", async (t) => {
  const f = bridgeFixture(t, { decision: { script: "她看看资料但不发。" } });
  await f.service
    .getNarrator()
    .decide(request({ participant: null, phase: "advance" }));
  await f.service
    .getNarrator()
    .decide(request({ participant: null, phase: "advance" }));
  assert.equal(f.calls, 1);
  assert.ok(f.journal.data.lastAttempt > 0);
  assert.equal(f.journal.data.shares.length, 0);
});
test("HDS: no auto reads when proactive or auto advance permissions are off", async (t) => {
  const f = bridgeFixture(t, { auto: false });
  await f.service
    .getNarrator()
    .decide(request({ participant: null, phase: "advance" }));
  assert.equal(f.calls, 0);
  f.service.config.runtime.autoAdvanceEnabled = true;
  await f.service
    .getNarrator()
    .decide(request({ participant: null, phase: "advance" }));
  assert.equal(f.calls, 0);
});
test("HDS: automatic crossConversationActions target binds only configured participant", async (t) => {
  let calls = 0;
  const f = bridgeFixture(t, {
    decision: {
      script: "Atri想分享。",
      crossConversationActions: [
        {
          participantId: "p1",
          mode: "immediate",
          content: url + "这个镜头很妙。",
        },
      ],
    },
    card: async () => {
      calls++;
      return "1";
    },
  });
  await f.service
    .getNarrator()
    .decide(request({ participant: null, phase: "advance" }));
  // First advance only starts the background read; the next advance consumes the finished pool.
  await f.bridge.poolSettled();
  await f.service
    .getNarrator()
    .decide(request({ participant: null, phase: "advance" }));
  const s = sent(url + "这个镜头很妙。");
  await f.bridge.beforeSend(s);
  assert.equal(calls, 1);
  assert.equal(s.content, "这个镜头很妙。");
});
test("HDS: do not transform unrelated messages, wrong recipient, group or multiple videos", async (t) => {
  let calls = 0;
  const f = bridgeFixture(t, {
      card: async () => {
        calls++;
        return "1";
      },
    }),
    tag = await f.bridge.request({}, "");
  await f.service.getNarrator().decide(request({ userMessage: tag }));
  for (const s of [
    sent(url + "别的内容"),
    { ...sent(), channelId: "private:1000000003" },
    { ...sent(), isDirect: false, guildId: "g" },
  ])
    await f.bridge.beforeSend(s);
  assert.equal(calls, 0);
});
test("HDS: card timeout leaves original URL, records unknown, never repeats", async (t) => {
  let calls = 0;
  const f = bridgeFixture(t, {
      card: async (_b, _v, _u, _a, submit) => {
        submit();
        calls++;
        throw new Fault("qq-outcome-unknown");
      },
    }),
    tag = await f.bridge.request({}, "");
  await f.service.getNarrator().decide(request({ userMessage: tag }));
  const s = sent();
  await f.bridge.beforeSend(s);
  assert.equal(s.content, url + "这个分镜挺细致。");
  assert.equal(f.journal.data.shares[0].status, "unknown");
  await f.bridge.beforeSend(sent());
  assert.equal(calls, 1);
});
test("HDS: disposal restores narrator without clobbering later decorator", async (t) => {
  const f = bridgeFixture(t);
  f.bridge.dispose();
  assert.equal(f.service.getNarrator(), f.initial);
  const g = bridgeFixture(t),
    other = { decide() {} };
  g.service.setNarrator(other);
  g.bridge.dispose();
  assert.equal(g.service.getNarrator(), other);
});
test("quiet hours and private outbox identity are strict", () => {
  const c = config();
  assert.equal(
    quiet(
      { ...c, quietStart: 23, quietEnd: 8 },
      new Date("2026-01-01T16:00:00Z"),
    ),
    true,
  );
  assert.equal(
    quiet(
      { ...c, quietStart: 23, quietEnd: 8 },
      new Date("2026-01-01T04:00:00Z"),
    ),
    false,
  );
  assert.equal(outgoing(sent(), c), true);
  assert.equal(outgoing({ ...sent(), channelId: "1000000001" }, c), false);
});
test("journal: separate version2, private permissions, crash unknown, never touches old ledger", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "watch-ledger-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const old = path.join(dir, "api-state-v1.json");
  fs.writeFileSync(old, "old-unchanged");
  const f = path.join(dir, "watch-state-v2.json"),
    s = new Journal(f);
  s.data.shares.push({ status: "submitting", bvid: V });
  s.save();
  assert.equal(fs.statSync(f).mode & 0o777, 0o600);
  assert.equal(new Journal(f).data.shares[0].status, "unknown");
  assert.equal(fs.readFileSync(old, "utf8"), "old-unchanged");
});
test("QQ: unsupported generation never invokes send_private_msg", async () => {
  const calls = [],
    bot = {
      internal: {
        _get: async (a) => {
          calls.push(a);
          return { retcode: 1404 };
        },
      },
    };
  await assert.rejects(() => sendCard(bot, detail, "1000000001"));
  assert.deepEqual(calls, ["send_pb"]);
});
test("QQ: no message receipt is unknown, invalid target blocked before network", async () => {
  let calls = 0;
  await assert.rejects(() =>
    sendCard(
      {
        internal: {
          _get: async () => {
            calls++;
          },
        },
      },
      detail,
      "not-a-qq",
    ),
  );
  assert.equal(calls, 0);
});
function mainFixture(t) {
  let middleware;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bili-main-")),
    ctx = new Context();
  ctx.baseDir = dir;
  const original = ctx.middleware.bind(ctx);
  ctx.middleware = (fn, ...args) => {
    middleware = fn;
    return original(fn, ...args);
  };
  const fork = ctx.plugin(plugin, config());
  t.after(async () => {
    await ctx.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const s = (content) => ({
    content,
    isDirect: true,
    platform: "onebot",
    selfId: "1000000002",
    userId: "1000000001",
  });
  return {
    ctx,
    get middleware() {
      return middleware;
    },
    s,
    fork,
    dir,
  };
}
test("runtime: exact /bili only; ordinary conversation, quoted command and raw BV reach HDS unchanged", async (t) => {
  const f = mainFixture(t);
  await f.ctx.start();
  await new Promise((r) => setTimeout(r, 20));
  let next = 0;
  for (const s of [
    "你可以评论吗",
    "帮我艾特一下",
    "看看这个视频 " + V,
    "bili.interact " + V,
    "/bilibilibili pick",
    "他说 /bili pick 动画",
    "/biliography",
    V,
  ]) {
    const msg = f.s(s);
    await f.middleware(msg, () => {
      next++;
      assert.equal(msg.content, s);
    });
  }
  assert.equal(next, 8);
  const status = await f.middleware(f.s("/bili status"), () => assert.fail());
  assert.match(status, /主插件0\.7\.8-beta\.1；[\s\S]*候选池：空/);
  assert.match(status, /HDS服务/);
});
test("runtime: wrong user/group cannot invoke command; no HDS means no fake model reply", async (t) => {
  const f = mainFixture(t);
  await f.ctx.start();
  let next = 0;
  await f.middleware({ ...f.s("/bili status"), userId: "other" }, () => next++);
  await f.middleware({ ...f.s("/bili status"), isDirect: false }, () => next++);
  assert.equal(next, 2);
  assert.match(
    await f.middleware(f.s("/bili pick"), () => assert.fail()),
    /hds-not-connected/,
  );
});
test("runtime: session status and prepare use correct Session APIs, paused blocks reads", async (t) => {
  const f = mainFixture(t);
  await f.ctx.start();
  assert.match(await f.middleware(f.s("/bili session"), () => {}), /登录来源/);
  assert.match(await f.middleware(f.s("/bili pause"), () => {}), /已暂停/);
  assert.match(
    await f.middleware(f.s("/bili read " + V), () => {}),
    /execution-paused/,
  );
  assert.match(await f.middleware(f.s("/bili resume"), () => {}), /已恢复/);
});
test("eyes: retains service and adds scoped sharing middleware without commands", async (t) => {
  const f = mainFixture(t);
  f.ctx.plugin(eyes, eyes.Config({}));
  await f.ctx.start();
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(f.ctx.atriBiliEyes);
  assert.doesNotMatch(
    fs.readFileSync(require.resolve("../../atri-bili-eyes"), "utf8"),
    /\.command\(/,
  );
});
function qqPacket() {
  const raw = {
    appName: "com.tencent.miniapp_01",
    appView: "view_8C8E89B49BE609866298ADDFF2DBABA4",
    ver: ("" + [1,0,0,0].join(".") + ""),
    config: { forward: true },
    metaData: {
      detail_1: { appid: "1109937557", url: "https://b23.tv/UnitOnly" },
    },
  };
  const variable = (n) => {
      const a = [];
      do {
        const b = n & 127;
        n >>>= 7;
        a.push(b | (n ? 128 : 0));
      } while (n);
      return Buffer.from(a);
    },
    field = (n, b) => {
      b = Buffer.isBuffer(b) ? b : Buffer.from(b);
      return Buffer.concat([variable(n * 8 + 2), variable(b.length), b]);
    };
  return {
    cmd: "LightAppSvc.mini_app_share.AdaptShareInfo",
    hex: field(4, field(2, JSON.stringify(raw))).toString("hex"),
  };
}
test("QQ: actual card builder/parser and sender sequence, receipt required, no invented token", async () => {
  const events = [],
    bot = {
      internal: {
        _get: async (a, p) => {
          events.push(a);
          if (a === "send_pb") {
            assert.equal(p.cmd, "LightAppSvc.mini_app_share.AdaptShareInfo");
            assert.match(p.hex, /^[0-9a-f]+$/);
            return { status: "ok", retcode: 0, data: qqPacket() };
          }
          assert.equal(a, "send_private_msg");
          const card = JSON.parse(p.message[0].data.data);
          assert.equal(card.app, "com.tencent.miniapp_01");
          assert.equal(card.meta.detail_1.appid, "1109937557");
          return { retcode: 0, data: { message_id: 123 } };
        },
      },
    };
  const result = await sendCard(
    bot,
    detail,
    "1000000001",
    () => true,
    () => events.push("audit-submitting"),
  );
  assert.equal(result, "123");
  assert.deepEqual(events, ["send_pb", "audit-submitting", "send_private_msg"]);
});
test("QQ: inactive after generation prevents message write; empty receipt marks unknown", async () => {
  let active = true,
    calls = [];
  const bot = {
    internal: {
      _get: async (a) => {
        calls.push(a);
        if (a === "send_pb") {
          active = false;
          return qqPacket();
        }
        return {};
      },
    },
  };
  await assert.rejects(() => sendCard(bot, detail, "1000000001", () => active));
  assert.deepEqual(calls, ["send_pb"]);
  active = true;
  bot.internal._get = async (a) => (a === "send_pb" ? qqPacket() : {});
  await assert.rejects(
    () => sendCard(bot, detail, "1000000001"),
    (e) => e.code === "qq-outcome-unknown",
  );
});
test("transport: SSRF private addresses remain blocked and decompression limits retained", () => {
  const { publicIP, decode } = require("../transport"),
    zlib = require("node:zlib");
  for (const ip of [
    ("" + [127,0,0,1].join(".") + ""),
    ("" + [10,0,0,1].join(".") + ""),
    ("" + [172,16,0,1].join(".") + ""),
    ("" + [192,168,0,1].join(".") + ""),
    ("" + [169,254,169,254].join(".") + ""),
    "::1",
    "fc00::1",
    ("::ffff:" + [127,0,0,1].join(".") + ""),
  ])
    assert.equal(publicIP(ip), false, ip);
  assert.equal(publicIP(("" + [8,8,8,8].join(".") + "")), true);
  // API transport source still pins verified TLS and bounded decompression.
  const source = fs.readFileSync(require.resolve("../transport"), "utf8");
  assert.doesNotMatch(source, /rejectUnauthorized\s*:\s*false/);
  assert.match(source, /maxOutputLength/);
});
test(
  "real Koishi MessageEncoder before-send: raw card first, HDS text afterwards, correct private channel",
  { timeout: 10000 },
  async (t) => {
    const { App, Bot, MessageEncoder } = require("koishi"),
      app = new App(),
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "bili070-encoder-"));
    app.baseDir = dir;
    const journal = new Journal(path.join(dir, "state.json")),
      events = [];
    let narrator = {
      decide: async () => ({
        interaction: {
          reply: { mode: "immediate", content: url + "这个分镜挺细致。" },
        },
      }),
    };
    const service = {
      getNarrator: () => narrator,
      setNarrator: (n) => (narrator = n),
      splitOutgoingMessage: (s) => [s],
      getDesktopRuntimePhase: () => "running",
      config: { runtime: {} },
    };
    const bridge = createBridge(app, config(), {
      journal,
      active: () => true,
      candidates: async () => [rec],
      card: async (_b, _v, _u, _a, submit) => {
        submit();
        events.push("card");
        return "111";
      },
    });
    bridge.install(service);
    t.after(async () => {
      bridge.dispose();
      await app.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    });
    const bot = new Bot(app, {}, "onebot");
    bot.user = { id: "1000000002", name: "test" };
    const disposeBot = bot.dispose.bind(bot);
    bot.dispose = () => (app.bots ? disposeBot() : Promise.resolve());
    class Encoder extends MessageEncoder {
      async prepare() {
        this.session.isDirect = true;
        this.text = "";
      }
      async visit(e) {
        if (e.type === "text") this.text += e.attrs.content;
        else for (const x of e.children) await this.visit(x);
      }
      async flush() {
        events.push(this.text);
        this.results.push({ id: "222", content: this.text });
      }
    }
    await app.start();
    const tag = await bridge.request({}, ""),
      decision = await service
        .getNarrator()
        .decide(request({ userMessage: tag }));
    await new Encoder(bot, "private:1000000001").send(
      decision.interaction.reply.content,
    );
    assert.deepEqual(events, ["card", "这个分镜挺细致。"]);
    assert.equal(journal.data.shares[0].status, "accepted");
  },
);
test("runtime: QR login roundtrip preserves legacy format and saves private file, no POST", async (t) => {
  const f = mainFixture(t),
    generate = Api.prototype.qrGenerate,
    poll = Api.prototype.qrPoll,
    account = Api.prototype.account;
  let calls = [];
  Api.prototype.qrGenerate = async () => {
    calls.push("generate");
    return {
      qrcode_key: "unitqrcodekey123456",
      url: "https://passport.bilibili.com/h5-app/passport/login/scan?unit=1",
    };
  };
  Api.prototype.qrPoll = async () => {
    calls.push("poll");
    return {
      data: {
        code: 0,
        url: "https://passport.biligame.com/crossDomain?SESSDATA=unit,opaque&bili_jct=unit-csrf&DedeUserID=1000000001",
      },
      headers: {},
    };
  };
  Api.prototype.account = async function () {
    calls.push("nav");
    assert.match(this.cookie(), /SESSDATA=unit,opaque/);
    return { isLogin: true, mid: "1000000001", uname: "unit" };
  };
  t.after(() => {
    Api.prototype.qrGenerate = generate;
    Api.prototype.qrPoll = poll;
    Api.prototype.account = account;
  });
  await f.ctx.start();
  const image = await f.middleware(f.s("/bili login"), () => {});
  assert.match(String(image), /image|img/);
  assert.match(
    await f.middleware(f.s("/bili login-check"), () => {}),
    /已核对并保存/,
  );
  assert.deepEqual(calls, ["generate", "poll", "nav"]);
  const file = path.join(f.dir, "data/atri-bilibili/account-session.json");
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(JSON.parse(fs.readFileSync(file)).version, 1);
  assert.match(await f.middleware(f.s("/bili session"), () => {}), /扫码文件/);
});
test("QQ: negative OneBot message IDs are valid receipts", async () => {
  const bot = {
    internal: {
      _get: async (a) =>
        a === "send_pb" ? qqPacket() : { message_id: -123456 },
    },
  };
  assert.equal(await sendCard(bot, detail, "1000000001"), "-123456");
});

test("HDS: advance turn never waits for candidate network reads", async (t) => {
  const f = bridgeFixture(t, { decision: { script: "她在发呆。" } });
  let release;
  f.setCandidates(() => new Promise((r) => (release = r)));
  const started = Date.now();
  await f.service.getNarrator().decide(request({ participant: null, phase: "advance" }));
  assert.ok(Date.now() - started < 500);
  assert.doesNotMatch(f.received.story.setting.world, /准确URL/);
  release([rec]);
  await f.bridge.poolSettled();
  await f.service.getNarrator().decide(request({ participant: null, phase: "advance" }));
  assert.match(f.received.story.setting.world, /准确URL/);
  assert.equal(f.calls, 1);
});
