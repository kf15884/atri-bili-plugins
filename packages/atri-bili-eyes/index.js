"use strict";
const { Service, Schema, h } = require("koishi");
const { collect } = require('./share');
exports.name = "atri-bili-eyes";
exports.inject = ["atriBiliApi"];
exports.Config = Schema.object({
  autoReadShared: Schema.boolean().default(true).description('本人私聊分享视频链接、BV或B站QQ卡片时交给HDS；不回发卡片'),
  watchPacing: Schema.boolean().default(true).description('先由HDS回应去看看，回执后读取并生成预回复；追问提前发送，否则随机等待结束发送'),
  waitMinSec: Schema.natural().max(600).default(30).description('预回复生成后的最短等待秒数；起止颠倒时自动排序'),
  waitMaxSec: Schema.natural().max(600).default(90).description('预回复生成后的最长等待秒数；并非真实播放进度'),
  taskTimeoutSec: Schema.natural().min(30).max(600).default(180).description('开场确认上限，以及读取+预回复生成的合计上限（分别计时）；不含随机等待'),
});
exports.usage = '## 功能简介\n本人私聊分享B站视频，HDS先回应准备去看看；实际回执后读取资料、按原人设生成预回复。预回复就绪后随机等待，相关追问可提前发送，未就绪的追问合并后静默等待完成。默认不回卡。\n\n## 最新更新0.5.2\n新增可配置观看节奏、30–90秒随机等待、单任务与追问合并、私有状态和重启不重放；所有角色文本经HDS生成和原发送链路。关闭watchPacing恢复即时读取回复。需主插件0.7.2及HDS rc57兼容接口；无站内写入或真实音视频播放。';
exports.apply = (ctx, c) => {
  class Eyes extends Service {
    constructor() { super(ctx, "atriBiliEyes"); }
    watch(v) { return ctx.atriBiliApi.watch(v); }
    readDiscussion(v) { return this.watch(v); }
  }
  new Eyes();
  const seen = new Map();
  let busy = false;
  ctx.middleware(async (s, next) => {
    const api = ctx.atriBiliApi;
    if (c.autoReadShared === false || !api.allowed(s) || !api.canReadShared?.()) return next();
    const info = collect({ ...s, elements: s.elements || h.parse(String(s.content || "")) });
    const key = s.messageId ? `${s.platform}:${s.selfId}:${s.userId}:${s.messageId}` : null;
    const now = Date.now();
    for (const [id, at] of seen) if (now - at > 600000) seen.delete(id);
    if (key && seen.has(key)) return;
    const remember = () => { if (key) { if (seen.size >= 200) seen.delete(seen.keys().next().value); seen.set(key, now); } };
    if (!info.refs.length && c.watchPacing !== false && await api.followPaced?.(s, info.text)) { remember(); return; }
    if (info.ignored || info.refs.length !== 1 || busy) return next();
    if (c.watchPacing !== false && !api.pacedReady?.()) return next();
    remember();busy = true;
    try {
      if (c.watchPacing !== false) {
        // Never fall back to read-first when a paced acknowledgement cannot be verified.
        const result = api.beginPaced(s, info.refs[0], c);
        if (result.handled) return;
        s.content = h.escape(`${result.tag}\n本人分享的B站视频：${info.refs[0]}\n${info.text || '请看看这个视频。'}`);
      } else {
        const tag = await api.prepareShared(s, info.refs[0]);
        s.content = h.escape(`${tag}\n本人分享的B站视频：${info.refs[0]}\n${info.text || '请结合实际取得的视频资料，按你原本的人设和HDS格式跟我聊聊。'}`);
      }
      s.elements = h.parse(s.content);
    } catch {
      // No personality-free fallback, no invented viewing and no unverified send.
    } finally { busy = false; }
    return next();
  }, true);
  ctx.on('dispose', () => { seen.clear();ctx.atriBiliApi?.cancelPaced?.('eyes-disposed'); });
};
