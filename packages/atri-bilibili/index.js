"use strict";
const path = require("node:path"),
  crypto = require("node:crypto"),
  { Service, h } = require("koishi");
const { Api, Fault, flat } = require("./api"),
  { Session, parseQrCookies, sessionSummary } = require("./session"),
  { Journal } = require("./journal"),
  { createBridge } = require("./hds"),
  { askVideo, askAgain } = require("./ask"),
  { Senses } = require("./senses");
exports.name = "atri-bilibili";
exports.Config = require("./config");
exports.usage =
  "## 功能简介\n只读B站API与HDS原人设对话。要视频或主动分享都先看过再推荐：先发QQ卡片再发HDS推荐话；眼镜插件可让本人分享视频先收到HDS开场，随后读取、生成预回复、随机等待或追问提前发送。\n\n## 最新更新0.8.4-beta.1\n基于0.8.3分工版，保留推荐、预看与B站交接流程；后台挑选、感想和判断与其他Atri插件共用模型通道，前台/暂停/原生分段优先，排队后刷新对话，超时不强行调用模型。配套eyes0.6.1-beta.1仅更新包版本与兼容声明；原有账本、登录、预备视频和预算保留，不清库、不重建故事、不清人设演化。\n\n## 0.8.3\n和浏览器/搜索插件分工：HDS想用浏览器打开或搜索B站视频时拦下来，改交给观看任务（第二台看画面+声音），看完记入已看并可成为预备视频；本人发B站链接、观看/要视频期间关闭HDS浏览。消息里的B站视频链接不再直接删掉：真实视频改成QQ卡片发出（对方自己分享的、最近发过的、读不到的只去掉链接）。其他插件可调用 ctx.atriBiliApi.videoRef()/handoff()。\n\n## 0.8.2\n“现在/马上/能不能/试试/一下”等不再当作搜索词（“你现在把视频发我”改用兴趣词）；要视频时原则上一定挑一个，预看通常也挑一个，减少“都没选”。\n\n## 0.8.1\n修复：兴趣词“mad,动漫剪辑,coser”改为每次随机取一个词、随机翻1–3页搜索，不再整串搜同一页；读过的视频不再排除（只排除已分享过的），没读过的优先，解决“未看过0条/no-readable-unseen-video”。要视频静默回合带一句简短剧本，避免HDS报“模型调用失败（no usable script）”。\n\n## 0.8.0\n要视频改为插件挑选：说“发个视频给我”“你把视频发我”“再来一个”时，插件读5条候选→HDS按人设挑一个（都不想发就说最近没看到好看的）→看一遍（第二台画面+声音，未开启用文字资料）→先发QQ卡片、再发她写的推荐话，不发链接；挑/看期间聊天照常，问进度她会说还在找，说“算了”取消。剧情写到她在刷B站时，后台预看4条、挑一个存为预备视频（每日3次、间隔120分钟、保留48小时）；之后要视频直接用，或在HDS允许主动联系的推进回合由她主动分享。HDS消息里零散的视频链接会被去掉。新命令 /bili prep、/bili drop。\n\n## 0.7.8\n要视频更连贯：要视频后10分钟内说“再发一次”“挑好了吗”“视频呢”等按同一请求处理；候选没读好时，读好后（askDeferSec，默认120秒内、期间你没再发消息）由HDS决定是否补发；手上没视频时不会再说“看这个”。Atri自己分享卡片后也会自己点开看（第二台画面+声音），随机等待30–120秒再补一段感想（selfWatchEnabled）。\n\n## 0.7.7\n消息处理优化：要视频时候选最多等4秒（askWaitSec），超时先由HDS自然回应、后台读好的下次直接用；自动选片不在HDS回合里等网络，只用后台读好的候选；观看任务生成与投递前让位HDS正在处理的回合，忙碌时等待而不丢草稿。\n\n## 0.7.6\n观看开场随机化与多样化：配合眼镜0.5.3，约70%先回一句、30%已读不回直接去看；开场由HDS按随机说法方向、当下状态生成，避免与最近开场重复，可对标题反应或只发表情包；“等会看”类开场等待更久，不回时读取失败会较快说明。\n\n## 0.7.5\n看视频同时听声音：第二台抽帧并截取开头音频，由第二台按自己配置的线路顺序一起理解画面和声音（如a6api gemini-3.8-flash经主服务器代理，失败再用DeepSeek只看画面）。\n\n## 0.7.4\n可选“04 第二台画面抽帧”：看本人分享的视频时，请第二台服务器（WireGuard内网）抽6帧并用三条识图线路依次尝试，结果作为“静止画面”资料附给HDS；失败或超时只用文字资料。默认关闭。\n\n## 0.7.3\n本人私聊要视频时（如“有没有好看的视频发我看看”），先读取候选再交给HDS：发不发由HDS按剧本状态与人设决定；发的话先发QQ视频卡片，停顿2–5秒后再按HDS原有分段发她的话；不发就按人设回应。保留0.7.2观看节奏。无站内写操作、Puppeteer或真实音视频播放；保留原会话、旧数据与主动联系门控。";
exports.apply = (ctx, c) => {
  const root = path.resolve(ctx.baseDir || process.cwd()),
    instances = (globalThis[Symbol.for("atri-bilibili.api-instances")] ||=
      new Map());
  if (instances.has(root))
    throw new Error("同一工程只能启用一个atri-bilibili实例");
  const instance = {};
  instances.set(root, instance);
  let disposed = false,
    readLock = Promise.resolve(),
    qr = null,
    commandBusy = false,
    askBusy = false,
    lastAsk = null;
  const VERSION = require("./package.json").version;
  const logger = (() => { try { return ctx.logger("atri-bilibili"); } catch { return { info() {}, warn() {} }; } })();
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
  // Reads queue one at a time (ask, background prep and owner shares may overlap).
  function read(value) {
    const run = readLock.then(() => readNow(value));
    readLock = run.catch(() => {});
    return run;
  }
  async function readNow(value) {
    if (!active()) throw new Fault("execution-paused");
    {
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
    }
  }
  async function candidates(query, limit = c.candidateLimit) {
    if (!active()) throw new Fault("execution-paused");
    if (
      /^(?:BV1[A-Za-z0-9]{9}|https:\/\/www\.bilibili\.com\/video\/BV1[A-Za-z0-9]{9}\/?|https:\/\/b23\.tv\/[A-Za-z0-9]+)$/.test(
        query || "",
      )
    )
      return [await read(query)];
    // 0.8.0: interest words like "mad,动漫剪辑,coser" are searched one at a time, on a random
    // page, so the same 8 results do not come back every time. Only videos already shared with
    // the owner are excluded; never-read ones come first, older reads after (watched ones reuse notes).
    const want = Math.max(1, Math.min(8, Number(limit) || 1)),
      words = String(query || "").split(/[,，、|;；]+/).map((x) => x.trim()).filter(Boolean),
      shuffled = words.map((w) => [Math.random(), w]).sort((x, y) => x[0] - y[0]).map((x) => x[1]),
      page = () => 1 + Math.floor(Math.random() * 3),
      tries = words.length
        ? [...shuffled.slice(0, 2).map((w) => [w, page()]), [shuffled[0], 1]]
        : [[null, page()], [null, 1]];
    const shared = new Set(journal.data.shares.filter((x) => x.status === "accepted" && Date.now() - x.at < c.rewatchDays * 86400000).map((x) => x.bvid)),
      readAt = new Map(journal.data.reads.filter((v) => Date.now() - v.at < c.rewatchDays * 86400000).map((v) => [v.bvid, v.at])),
      pool = [], seen = new Set(), items = [];
    let total = 0, lastError = null, used = [];
    for (const [word, pg] of tries) {
      if (pool.length >= want * 2) break;
      let rows;
      try { rows = word ? await api.search(word, pg) : await api.popular(pg); }
      catch (e) { lastError = e; logger.warn("候选%s失败「%s」第%d页 [%s]", word ? "搜索" : "热门", word || "", pg, e instanceof Fault ? e.code : "local-error"); if (!active()) throw e; continue; }
      used.push((word || "热门") + "#" + pg);
      total += rows.length;
      for (const v of rows) if (/^BV1[A-Za-z0-9]{9}$/.test(v.bvid) && !seen.has(v.bvid) && !shared.has(v.bvid)) { seen.add(v.bvid); pool.push(v); }
    }
    if (!used.length && lastError) throw lastError;
    const order = pool.map((v, i) => [readAt.has(v.bvid) ? 1 : 0, readAt.get(v.bvid) || 0, Math.random(), v]).sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]).map((x) => x[3]);
    logger.info("候选：%s 共%d条，可选%d条（未读过%d条）", used.join("、"), total, pool.length, pool.filter((v) => !readAt.has(v.bvid)).length);
    for (const v of order.slice(0, want)) {
      try {
        items.push(await read(v.bvid));
      } catch (e) {
        if (!active()) throw e;
        logger.warn("候选读取失败：%s [%s]", v.bvid, e instanceof Fault ? e.code : "local-error");
      }
    }
    if (!items.length) throw new Fault("no-readable-unseen-video");
    return items;
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
    // Read-only: same candidate reader the ask/prep tasks use (diagnostics and tests).
    candidates(query, limit) { return candidates(query, limit); }
    // 0.8.3 for search/browser plugins: is this a Bilibili video link? → BV/short link, else null.
    videoRef(text) { const r = require("./hds").videoRefs(text); return r.length ? r[0].ref : null; }
    // Hand a Bilibili video link (or a B站 search phrase) to the watch task instead of opening it in
    // a browser. Result goes into the watched library / prepared slot; returns a short status text.
    handoff(input, why) { return bridge.handoff(input, why || "其他插件"); }
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
  const bridge = createBridge(ctx, c, {
    journal, active, candidates, readIncoming: readShared, readVideo: read,
    watch: (rec) => framed(rec, true),
    getBot: () => (ctx.bots || []).find((b) => b.platform === c.platform && String(b.selfId) === c.selfId) || null,
  });
  // Explicit "send me a video" requests: the plugin picks/watches/delivers; HDS writes every word.
  ctx.middleware(async (s, next) => {
    if (!allowed(s)) return next();
    const raw = String(s.content || "").trim(),
      elements = s.elements || h.parse(raw);
    const textOnly = !!raw && !elements.some((e) => e.type !== "text");
    const text = textOnly ? elements.map((e) => e.attrs?.content || "").join("") : "";
    bridge.ownerMessage(text);
    if (c.askEnabled === false || !active() || !bridge.ready || askBusy || !textOnly) return next();
    // While an ask is running every message goes to HDS as normal chat (it knows the task is running).
    if (bridge.askLive()) return next();
    let ask = askVideo(text), query;
    if (ask) query = ask.query || c.discoveryKeyword;
    // Within 10 minutes of an ask, "再发一个/再来一个" starts another ask with the same topic.
    else if (lastAsk && Date.now() - lastAsk.at < 10 * 60000 && askAgain(text)) query = lastAsk.query;
    else return next();
    lastAsk = { query, at: Date.now() };
    askBusy = true;
    try {
      const tag = await bridge.request(s, query, "ask");
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
    "只在本人私聊、消息开头精确输入：\n/bili pick [兴趣词]：同“发个视频给我”：读3–5个候选→HDS挑一个→看完→先发卡片再发推荐话\n（也可以直接说“有没有好看的视频发我看看”“把视频发我”“发个猫猫视频”）\n/bili prep：立即后台预看一轮（测试用）\n/bili drop：清空预备视频\n/bili read BV号：只查看API资料\n/bili search 关键词：只搜索\n/bili status：状态\n/bili pause / /bili resume：暂停/恢复\n/bili login / /bili login-check：官方扫码登录\n/bili account：核对账号\n/bili session：本地脱敏会话状态\n/bili prepare：准备缺失的官方设备标识\n/bili cancel-login / /bili logout\n/bili history：最近卡片结果\n不再支持旧bili.interact、确认、评论、艾特或自然语言操作匹配。";
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
    if (op === "prep") return h.escape(bridge.prep());
    if (op === "drop") return h.escape(bridge.dropPrepared());
    if (["help", "status", "session", "pause", "cancel-login"].includes(op)) {
      if (op === "help") return h.escape(help);
      if (op === "status")
        return h.escape(
          `主插件${VERSION}；第二台看视频：${await senses.health()}\n`+`只读API；无站内写操作/独立模型\nHDS：${bridge.status()}\n暂停：${journal.data.paused}；本地状态故障：${journal.fault}\n主动分享预备视频：${c.autoEnabled ? "开启（遵循HDS主动联系许可）" : "关闭"}；剧情预看：${c.prepEnabled === false ? "关闭" : "开启"}\n卡片：QQ生成的B站小程序卡片；需send_pb；有回执不代表客户端展示\n读取：${journal.data.readDay?.count || 0}；日上限：${c.readDailyLimit || "不限"}\n管理命令必须以 /bili 开头；本人分享的视频由眼镜插件交给观看任务。`,
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
        const out = h.escape(
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
        bridge.exempt(out);
        return out;
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
