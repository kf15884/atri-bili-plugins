"use strict";
const path = require("node:path"),
  crypto = require("node:crypto"),
  { Service, h } = require("koishi");
const { Api, Fault, flat } = require("./api"),
  { Session, parseQrCookies, sessionSummary } = require("./session"),
  { Journal } = require("./journal"),
  { createBridge } = require("./hds"),
  { askVideo } = require("./ask"),
  { Senses } = require("./senses");
exports.name = "atri-bilibili";
exports.Config = require("./config");
exports.usage =
  "## 功能简介\n只读B站API与HDS原人设对话。主动推荐先发QQ卡片再发HDS感想；眼镜0.5.2可让本人分享视频先收到HDS开场，随后读取、生成预回复、随机等待或追问提前发送。\n\n## 最新更新0.7.5\n看视频同时听声音：第二台抽帧并截取开头音频，由第二台按自己配置的线路顺序一起理解画面和声音（如a6api gemini-3.8-flash经主服务器代理，失败再用DeepSeek只看画面）。\n\n## 0.7.4\n可选“04 第二台画面抽帧”：看本人分享的视频时，请第二台服务器（WireGuard内网）抽6帧并用三条识图线路依次尝试，结果作为“静止画面”资料附给HDS；失败或超时只用文字资料。默认关闭。\n\n## 0.7.3\n本人私聊要视频时（如“有没有好看的视频发我看看”），先读取候选再交给HDS：发不发由HDS按剧本状态与人设决定；发的话先发QQ视频卡片，停顿2–5秒后再按HDS原有分段发她的话；不发就按人设回应。保留0.7.2观看节奏。无站内写操作、Puppeteer或真实音视频播放；保留原会话、旧数据与主动联系门控。";
exports.apply = (ctx, c) => {
  const root = path.resolve(ctx.baseDir || process.cwd()),
    instances = (globalThis[Symbol.for("atri-bilibili.api-instances")] ||=
      new Map());
  if (instances.has(root))
    throw new Error("同一工程只能启用一个atri-bilibili实例");
  const instance = {};
  instances.set(root, instance);
  let disposed = false,
    readBusy = false,
    qr = null,
    commandBusy = false,
    askBusy = false;
  const dir = path.join(root, "data", "atri-bilibili"),
    session = new Session(dir, () => c.cookie),
    api = new Api({ cookie: () => session.cookie(), timeout: c.timeoutSec }),
    journal = new Journal(path.join(dir, "watch-state-v2.json")),
    cache = new Map(),
    senses = new Senses(c);
  const allowed = (s) =>
    !disposed &&
    !!c.targetUserId &&
    !!c.selfId &&
    s?.isDirect === true &&
    s.platform === c.platform &&
    String(s.userId) === c.targetUserId &&
    String(s.selfId || s.bot?.selfId) === c.selfId;
  const active = () => !disposed && !journal.fault && !journal.data.paused;
  async function read(value) {
    if (!active()) throw new Fault("execution-paused");
    if (readBusy) throw new Fault("read-busy");
    readBusy = true;
    try {
      const bvid = await api.resolve(value),
        key =
          bvid +
          ":" +
          crypto.createHash("sha256").update(session.cookie()).digest("hex"),
        cached = cache.get(key);
      if (cached && Date.now() - cached.at < c.cacheMinutes * 60000)
        return cached.rec;
      const day = new Date().toISOString().slice(0, 10);
      if (journal.data.readDay?.day !== day)
        journal.data.readDay = { day, count: 0 };
      if (
        c.readDailyLimit > 0 &&
        journal.data.readDay.count >= c.readDailyLimit
      )
        throw new Fault("read-daily-limit");
      journal.data.readDay.count++;
      journal.save();
      const rec = await api.note(bvid, c);
      if (!active()) throw new Fault("execution-paused");
      journal.read(bvid);
      if (cache.size >= 30) cache.delete(cache.keys().next().value);
      cache.set(key, { rec, at: Date.now() });
      return rec;
    } finally {
      readBusy = false;
    }
  }
  async function candidates(query) {
    if (!active()) throw new Fault("execution-paused");
    if (
      /^(?:BV1[A-Za-z0-9]{9}|https:\/\/www\.bilibili\.com\/video\/BV1[A-Za-z0-9]{9}\/?|https:\/\/b23\.tv\/[A-Za-z0-9]+)$/.test(
        query || "",
      )
    )
      return [await framed(await read(query), c.framesScope === "all")];
    const rows = query ? await api.search(query) : await api.popular(),
      recent = new Set(
        journal.data.reads
          .filter((v) => Date.now() - v.at < c.rewatchDays * 86400000)
          .map((v) => v.bvid),
      ),
      items = [];
    for (const v of rows
      .filter((v) => /^BV1[A-Za-z0-9]{9}$/.test(v.bvid) && !recent.has(v.bvid))
      .slice(0, c.candidateLimit)) {
      try {
        items.push(await read(v.bvid));
      } catch (e) {
        if (!active()) throw e;
      }
    }
    if (!items.length) throw new Fault("no-readable-unseen-video");
    return c.framesScope === "all" ? Promise.all(items.map((v) => framed(v, true))) : items;
  }
  // Frames run outside the readBusy lock; senses caches per BV and never throws.
  async function framed(rec, want = true) {
    if (!want || !senses.on || !rec?.bvid) return rec;
    const out = await senses.attach(rec);
    if (!active()) throw new Fault("execution-paused");
    return out;
  }
  const readShared = async (value) => framed(await read(value));
  class ApiService extends Service {
    constructor() {
      super(ctx, "atriBiliApi");
    }
    watch(v) {
      return read(typeof v === "string" ? v : v.bvid);
    }
    canReadShared() { return active() && bridge.ready; }
    pacedReady() { return bridge.pacedReady(); }
    beginPaced(s, value, opts) {
      if (!allowed(s)) throw new Fault("private-owner-required");
      return bridge.beginPaced(s, value, opts);
    }
    followPaced(s, text) { return allowed(s) ? bridge.followPaced(s, text) : false; }
    cancelPaced(reason) { bridge.cancelPaced(reason); }
    prepareShared(s, value) {
      if (!allowed(s)) throw new Fault("private-owner-required");
      return bridge.request(s, value, "incoming");
    }
    allowed(s) {
      return allowed(s);
    }
  }
  new ApiService();
  const bridge = createBridge(ctx, c, { journal, active, candidates, readIncoming: readShared });
  // Explicit "send me a video" requests: read candidates, then let HDS decide in persona.
  ctx.middleware(async (s, next) => {
    if (c.askEnabled === false || !allowed(s) || !active() || !bridge.ready || askBusy) return next();
    const raw = String(s.content || "").trim(),
      elements = s.elements || h.parse(raw);
    if (!raw || elements.some((e) => e.type !== "text")) return next();
    const ask = askVideo(elements.map((e) => e.attrs?.content || "").join(""));
    if (!ask) return next();
    askBusy = true;
    try {
      const tag = await bridge.request(s, ask.query || c.discoveryKeyword, "ask");
      s.content = tag + "\n" + raw;
      s.elements = h.parse(s.content);
    } catch {
      // Paused or HDS gone: leave the message untouched for HDS.
    } finally {
      askBusy = false;
    }
    return next();
  }, true);
  const help =
    "只在本人私聊、消息开头精确输入：\n/bili pick [兴趣词或BV号]：让HDS选一个视频并分享卡片与感想\n（也可以直接说“有没有好看的视频发我看看”“发个猫猫视频”，由HDS决定发不发）\n/bili read BV号：只查看API资料\n/bili search 关键词：只搜索\n/bili status：状态\n/bili pause / /bili resume：暂停/恢复\n/bili login / /bili login-check：官方扫码登录\n/bili account：核对账号\n/bili session：本地脱敏会话状态\n/bili prepare：准备缺失的官方设备标识\n/bili cancel-login / /bili logout\n/bili history：最近卡片结果\n不再支持旧bili.interact、确认、评论、艾特或自然语言操作匹配。";
  const err = (e) =>
    "未完成 [" +
    (e instanceof Fault ? e.code : "local-error") +
    "]；未输出凭据或远端异常正文，未自动重试。";
  ctx.middleware(async (s, next) => {
    if (!allowed(s)) return next();
    const raw = String(s.content || "").trim();
    if (!/^\/bili(?:\s|$)/.test(raw)) return next();
    const match = /^\/bili(?:\s+([a-z-]+))?(?:\s+([^\r\n]*))?$/.exec(raw);
    if (!match) return h.escape(help);
    const op = match[1] || "help",
      arg = (match[2] || "").trim();
    if (["help", "status", "session", "pause", "cancel-login"].includes(op)) {
      if (op === "help") return h.escape(help);
      if (op === "status")
        return h.escape(
          `主插件0.7.5-beta.1；第二台看视频：${await senses.health()}（范围：${c.framesScope === "all" ? "分享+候选" : "仅分享"}）\n`+`只读API；无站内写操作/独立模型\nHDS：${bridge.status()}\n暂停：${journal.data.paused}；本地状态故障：${journal.fault}\n自主选片：${c.autoEnabled ? "开启（依赖HDS自身后台推进与主动消息许可）" : "关闭"}\n卡片：QQ生成的B站小程序卡片；需send_pb；有回执不代表客户端展示\n读取：${journal.data.readDay?.count || 0}；日上限：${c.readDailyLimit || "不限"}\n管理命令必须以 /bili 开头；眼镜0.5.2可读取本人明确分享的视频。`,
        );
      if (op === "cancel-login") {
        qr = null;
        return "已取消二维码会话，不退出已有登录。";
      }
      if (op === "pause") {
        bridge.cancelPaced("plugin-paused");
        journal.data.paused = true;
        try {
          journal.save();
          return "已暂停；已发出的请求无法撤回。";
        } catch (e) {
          return h.escape(err(e));
        }
      }
      try {
        return h.escape(sessionSummary(session.status()));
      } catch (e) {
        return h.escape(err(e));
      }
    }
    if (commandBusy) return "上一条B站命令仍在执行，请稍后再试。";
    commandBusy = true;
    let handoff = false;
    try {
      if (op === "resume") {
        journal.data.paused = false;
        journal.save();
        return "已恢复；不重发旧消息。";
      }
      if (op === "history")
        return h.escape(
          journal.data.shares
            .slice(-8)
            .reverse()
            .map(
              (v) =>
                `${v.bvid}：${v.status}${v.code ? " [" + v.code + "]" : ""}`,
            )
            .join("\n") || "暂无QQ卡片发送记录。",
        );
      if (!active()) throw new Fault("execution-paused");
      if (op === "pick") {
        const tag = await bridge.request(s, arg || c.discoveryKeyword);
        s.content = h.escape(
          tag +
            "\n本人明确请求：请挑选一个真正有资料支持的B站视频，发QQ卡片，并按你原本的人设和HDS输出格式跟我聊聊。",
        );
        s.elements = h.parse(s.content);
        handoff = true;
      } else if (op === "read") {
        if (!arg) throw new Fault("video-requires-bv");
        return h.escape((await read(arg)).note);
      } else if (op === "search") {
        return h.escape(
          (await api.search(arg))
            .map(
              (v) =>
                flat(v.title, 100) +
                "\nhttps://www.bilibili.com/video/" +
                v.bvid +
                "/",
            )
            .join("\n\n") || "未找到视频",
        );
      } else if (op === "account") {
        const a = await api.account();
        return h.escape(
          `登录：${!!a.isLogin}；UID：${a.mid || "无"}；昵称：${flat(a.uname, 80)}${c.accountUid ? "；与预期UID一致：" + (String(a.mid) === c.accountUid) : ""}；未输出Cookie。`,
        );
      } else if (op === "prepare") {
        await session.prepare(api, { explicit: true });
        return h.escape(
          sessionSummary(session.status()) +
            "\n已复用或准备设备标识；只读插件不执行站内互动。",
        );
      } else if (op === "login") {
        if (c.cookie) throw new Fault("manual-cookie-present");
        if (session.vaultFault) throw new Fault("vault-unavailable");
        const d = await api.qrGenerate();
        if (disposed) throw new Fault("execution-paused");
        qr = { key: d.qrcode_key, expires: Date.now() + 180000 };
        const q = require("./qrcode.cjs")(0, "M");
        q.addData(d.url);
        q.make();
        return (
          h.image(
            Buffer.from(q.createDataURL(5, 10).split(",")[1], "base64"),
            "image/gif",
          ) + "\n请用B站APP扫码确认，3分钟内发送 /bili login-check。"
        );
      } else if (op === "login-check") {
        if (!qr || Date.now() > qr.expires) throw new Fault("qr-expired");
        const current = qr,
          { data, headers } = await api.qrPoll(qr.key);
        if (qr !== current || disposed) throw new Fault("qr-cancelled");
        if (data.code === 0) {
          const candidate = parseQrCookies(data, headers),
            nav = await new Api({
              cookie: () => candidate,
              timeout: c.timeoutSec,
            }).account();
          if (qr !== current || disposed) throw new Fault("qr-cancelled");
          session.saveLogin(candidate, nav, c.accountUid);
          qr = null;
          cache.clear();
          return "登录凭据已核对并保存；可发 /bili account 检查。";
        }
        if (data.code === 86090) return "已扫码，请在B站APP确认。";
        if (data.code === 86101) return "等待扫码。";
        if (data.code === 86038) {
          qr = null;
          throw new Fault("qr-expired");
        }
        throw new Fault("qr-verification-required");
      } else if (op === "logout") {
        bridge.cancelPaced("account-logout");
        qr = null;
        session.clear();
        cache.clear();
        return "已清除本地扫码登录；手填Cookie如仍有值请在后台清空。不影响其他设备。";
      } else return h.escape(help);
    } catch (e) {
      return h.escape(err(e));
    } finally {
      commandBusy = false;
    }
    if (handoff) return next();
  }, true);
  ctx.on("dispose", () => {
    disposed = true;
    qr = null;
    session.close();
    senses.dispose();
    bridge.dispose();
    cache.clear();
    if (instances.get(root) === instance) instances.delete(root);
  });
};
