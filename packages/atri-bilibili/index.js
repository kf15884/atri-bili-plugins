'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { Schema, h, Service } = require('koishi')
const { createCardSender } = require('./cards')
const { createAutonomy } = require('./autonomy')

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const MIXIN_TAB = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52]
// 主分区名 -> 排行榜 rid
const ZONES = { 动画: 1, 音乐: 3, 舞蹈: 129, 游戏: 4, 知识: 36, 科技: 188, 运动: 234, 汽车: 223, 生活: 160, 美食: 211, 动物圈: 217, 鬼畜: 119, 时尚: 155, 娱乐: 5, 影视: 181 }
const ERR = { '-101': '账号未登录（Cookie 无效或已过期）', '-111': 'csrf 校验失败（Cookie 里缺 bili_jct）', '-352': '触发 B 站风控，稍后再试或降低频率', '-412': '请求被 B 站拦截，稍后再试', '-799': '请求过于频繁' }

exports.name = 'atri-bilibili'
exports.inject={optional:['interlude','database']}
exports.usage = '0.5.4：移除DS专用搜索/抓取及Key配置；公开网页由服务器读取、复用独立API解读，视频默认一句综合感想加卡片。0.5.3：卡片使用OneBot适配器原生onebot:json元素，修复文字成功但卡片无回执；未知投递不自动重发。0.5.2：修复否定句误拦截，证据不符最多重写一次，明确请求可降级为资料说明并单独附视频，实时保存失败状态。0.5.1：修复HDS分隔符/分条/打字间隔，推荐成功单独发送本轮QQ视频卡片。0.5.0：新增独立 API 执行模式，可使用非官方自定义 HTTPS 接口；明确授权后读取 HDS 人设和本人剧情，实际视频资料与回复回写 HDS。独立模式仅读取和推荐，不自动执行账号写操作；原 HDS 模式与开关保留。0.4.0：扫码/Cookie账号、HDS后台自主选片、真实资料入剧本、私聊视频转卡片。新增写操作默认关闭且默认真人确认；投币/三连/删动态始终确认。原公开评论及历史开关保留。眼镜0.3.0可选抽帧，不伪造完播，不保证@通知送达。配置见升级包《配置与使用.md》。'

exports.Config = Schema.intersect([
  Schema.object({
    apiShareHdsContext: Schema.boolean().default(false).description('允许将 HDS 人设、本人关系和近期剧情发送给下方自定义模型服务商；不含模型Key或B站Cookie'),
    apiContextEntries: Schema.natural().min(1).max(20).default(12).description('独立 API 最多读取本人近期剧情条数'),
    apiDailyLimit: Schema.natural().min(1).max(30).default(6).description('每天最多独立执行几轮；每轮通常最多3次，回复校验修正时最多4次模型请求，失败也计数'),
    apiBackground: Schema.boolean().default(false).description('普通私聊后30秒额外触发独立选片；会发送主动分享，仍需HDS允许主动消息并遵守免打扰'),
    apiBackgroundCooldownMinutes: Schema.natural().min(15).max(1440).default(60).description('普通聊天触发后台推荐的最小间隔（分钟）'),
  }).description('独立 API 执行模式 0.5.0'),
  Schema.object({
    chatCardBridge: Schema.boolean().default(true).description('私聊中的 B 站 BV/链接统一尝试转成 QQ 小程序卡片，失败保留链接'),
    backgroundContinuation: Schema.boolean().default(true).description('用户消息后，允许 HDS 在后台继续选片；仍需原自动生活推进开启'),
    backgroundDailyLimit: Schema.natural().min(1).max(12).default(6).description('每天最多额外后台选片/感想回合，消耗主叙事模型额度'),
    writeMode: Schema.union(['confirm','auto']).default('confirm').description('新增账号操作：默认真实用户确认；投币/三连/删动态始终确认'),
    allowLike: Schema.boolean().default(false).description('允许点赞/取消点赞'),
    allowCoin: Schema.boolean().default(false).description('允许投币，始终需真人确认'),
    allowTriple: Schema.boolean().default(false).description('允许三连；同时需允许赞/币/收藏，最多消耗2币'),
    allowFavorite: Schema.boolean().default(false).description('允许收藏/取消收藏，仅本账号收藏夹'),
    allowFollow: Schema.boolean().default(false).description('允许关注'),
    allowUnfollow: Schema.boolean().default(false).description('允许取关'),
    allowDynamic: Schema.boolean().default(false).description('允许按人设发一条公开文字动态'),
    allowDeleteDynamic: Schema.boolean().default(false).description('只允许删除插件记录为本账号创建的动态，始终确认'),
    accountWriteDailyLimit: Schema.natural().min(1).max(20).default(5).description('新增账号写操作每天尝试上限，失败也计数'),
    accountWriteCooldownSec: Schema.natural().min(10).default(60).description('新增写操作间隔，秒'),
    coinDailyLimit: Schema.natural().min(0).max(5).default(2).description('每日最多投币数，未知结果同样占用预算'),
  }).description('账号与后台扩展 0.4.0（公开评论开关仍沿用原设置）'),
  Schema.object({
    workflow: Schema.union([
      Schema.const('independent').description('独立 API 执行：读取 HDS 人设/剧情，自行选片读取，发卡片并写回记忆'),
      Schema.const('hds').description('HDS 自主观看（默认）：角色决定，实际资料入剧本，由 HDS 决定是否聊天提起'),
      Schema.const('legacy').description('旧版：独立挑选模型定时推荐并直接发送'),
    ]).default('hds').description('工作方式；需要独立API时选择 independent，原默认 hds 不自动更改'),
    timezone: Schema.string().default('Asia/Shanghai').description('自主观看计数与免打扰时区'),
    watchCooldownMinutes: Schema.natural().min(1).default(30).description('自主读取两个视频的最小间隔（分钟）'),
    discoveryCooldownMinutes: Schema.natural().min(1).default(30).description('自主查找候选的最小间隔（分钟）'),
    discoveryDailyLimit: Schema.natural().default(6).description('每天最多自主找视频几次，0 为不限'),
    intentTtlHours: Schema.natural().min(1).max(24).default(6).description('观看想法等待多久后失效（小时），避免执行过时计划'),
    rewatchDays: Schema.natural().min(1).default(7).description('多少天内不重复读取同一个视频'),
    journalLimit: Schema.natural().min(30).max(1000).default(300).description('本地保留多少条读取日志；HDS 剧本仍按原策略保存'),
    accountHistoryMode: Schema.union([
      Schema.const('local-only').description('只记 HDS 剧本和本地读取日志（默认）'),
      Schema.const('record-open').description('额外向 B 站记录 0 秒入口；不覆盖已有播放进度，不伪造播放时长'),
    ]).default('local-only').description('观看记录的范围；0 秒入口不代表真实播放或完整观看'),
  }).description('自主观看'),
  Schema.object({
    publicCommentsEnabled: Schema.boolean().default(false).description('允许她自主公开留言并@固定用户（真实账号写入）；每次仍须由 HDS 剧本提出，不是每看必发'),
    mentionUserUid: Schema.string().default('').description('仅此用户可被@：你的 B 站 UID，不是 QQ；昵称由接口核对，不交给模型选择'),
    commentDailyLimit: Schema.natural().min(1).max(5).default(2).description('每日最多尝试几次公开留言（失败也计入）；同视频同账号只尝试一次'),
    commentCooldownMinutes: Schema.natural().min(15).default(60).description('公开留言最小间隔（分钟），遇风控或验证要求会暂停'),
    commentMaxChars: Schema.natural().min(10).max(180).default(100).description('公开留言正文最多多少字；一句话，@由程序附加，不包含私人信息或外链'),
  }).description('公开评论（请先确认账号和@对象）'),
  Schema.object({
    webReadEnabled: Schema.boolean().default(false).description('服务器读取公开HTTPS网页，复用下方独立API解读；无独立搜索引擎，不需要DS Key'),
    webReadDailyLimit: Schema.natural().min(1).max(12).default(4).description('每天网页读取尝试上限，失败也计数；HDS后台仍有10分钟冷却'),
    videoMaterial: Schema.union([
      Schema.const('meta-discussion').description('仅标题、简介、标签等元信息 + 弹幕 + 热门评论（默认）'),
      Schema.const('all').description('另外使用眼镜取得的字幕与画面抽样（旧行为）'),
    ]).default('meta-discussion').description('独立模式下 Atri 形成回复思路所用的视频资料'),
    singleSummaryReply: Schema.boolean().default(true).description('综合成一次简短感想，不按标题/字幕/评论/弹幕分别回答；分条、标点与语气完全按HDS回复格式。卡片只在主动推荐或你索要时发，转发视频只评论'),
  }).description('公开网页读取与综合回复（复用独立 API）'),
  Schema.object({
    targetUserId: Schema.string().default('').description('聊天对象与管理 QQ（自主模式的私聊范围；旧模式的推荐接收人）'),
    selfId: Schema.string().default('').description('用于发送的机器人 QQ 号'),
    platform: Schema.string().default('onebot').description('机器人平台'),
    cardMode: Schema.union([
      Schema.const('ark').description('自动：NapCat 小程序 / LLBot 文字链接与封面'),
      Schema.const('miniapp').description('QQ 生成的 B 站小程序卡片（LLBot/PMHQ，需先试发确认）'),
      Schema.const('share').description('实验网页卡片（QQ 可能无法展示，建议使用链接）'),
      Schema.const('link').description('文字链接 + 封面图'),
    ]).default('ark').description('视频的发送形式'),
    cardJumpPath: Schema.string().default('pages/video/video?bvid={bvid}').description('卡片小程序跳转路径，{bvid} 会被替换（一般不用改）'),
    sendCover: Schema.boolean().default(true).description('链接形式时附带封面图'),
    order: Schema.union([
      Schema.const('textFirst').description('先发推荐的话，再发视频'),
      Schema.const('videoFirst').description('先发视频，再发推荐的话'),
    ]).default('textFirst').description('发送顺序'),
    splitBubbles: Schema.boolean().default(true).description('推荐的话按句拆成 1～3 条消息分开发，更像真人聊天'),
    bubbleDelay: Schema.natural().default(1500).description('每条消息之间的间隔（毫秒，会随机浮动）'),
  }).description('发送'),
  Schema.object({
    cookie: Schema.string().role('secret').default('').description('B 站小号 Cookie，至少包含 SESSDATA、bili_jct、buvid3、DedeUserID，用分号分隔'),
    sources: Schema.array(Schema.union([
      Schema.const('recommend').description('首页推荐（需登录）'),
      Schema.const('ranking').description('所选分区排行榜'),
      Schema.const('dynamic').description('关注的 UP 主新视频（需登录）'),
      Schema.const('search').description('按关键词搜索'),
    ])).role('checkbox').default(['recommend', 'ranking']).description('从哪里找视频'),
    categories: Schema.array(Schema.union(Object.keys(ZONES))).role('checkbox').default(['游戏', '知识', '动画']).description('感兴趣的视频类型（分区）'),
    strictCategory: Schema.boolean().default(false).description('严格模式：只推荐属于所选分区的视频（否则分区只作为喜好参考）'),
    interests: Schema.array(String).default([]).description('补充喜好，例如“猫”“独立游戏”“天文科普”'),
    keywords: Schema.array(String).default([]).description('搜索关键词（启用“按关键词搜索”时使用，每轮随机取 2 个）'),
    blockWords: Schema.array(String).default([]).description('屏蔽词，标题/标签/简介含有则跳过'),
    minDuration: Schema.natural().default(60).description('最短时长（秒）'),
    maxDuration: Schema.natural().default(1800).description('最长时长（秒），0 为不限'),
    minViews: Schema.natural().default(0).description('最低播放量'),
    maxAgeDays: Schema.natural().default(60).description('只看多少天内发布的视频，0 为不限'),
    candidates: Schema.natural().min(5).max(40).default(16).description('每轮交给角色挑选的候选数量'),
    fetchSubtitle: Schema.boolean().default(false).description('读取字幕片段帮助理解内容（需登录，会多请求几次）'),
    reportWatch: Schema.boolean().default(false).description('仅旧模式：只记 0 秒入口且保护已有播放进度；自主模式请用“观看记录的范围”，不会伪造播放时长'),
  }).description('B 站'),
  Schema.object({
    auto: Schema.boolean().default(true).description('自动执行（自主模式：执行角色已提交的观看意图；旧模式：定时推荐）'),
    intervalMinutes: Schema.natural().min(15).default(180).description('仅旧模式：定时推荐间隔（分钟）；自主模式只在 HDS 提出意图后执行'),
    jitterMinutes: Schema.natural().default(30).description('随机浮动（分钟），避免太规律'),
    perRound: Schema.natural().min(1).max(5).default(1).description('每轮最多推荐几条'),
    dailyLimit: Schema.natural().default(3).description('每日上限（自主模式：读取尝试次数，含失败；旧模式：自动推荐次数），0 为不限'),
    quietStart: Schema.natural().max(23).default(0).description('免打扰开始（点）'),
    quietEnd: Schema.natural().max(23).default(9).description('免打扰结束（点）；与开始相同则不启用'),
  }).description('频率'),
  Schema.object({
    useModel: Schema.boolean().default(true).description('用模型挑选并写推荐语（关闭则按规则挑选）'),
    protocol: Schema.union(['chat-completions', 'anthropic-messages']).default('chat-completions').description('接口协议'),
    endpoint: Schema.string().default('').description('完整请求地址，例如 https://服务商域名/v1/chat/completions；独立模式支持非官方自定义兼容接口，不自动拼接路径'),
    apiKey: Schema.string().role('secret').default(''),
    model: Schema.string().default('').description('模型 ID'),
    proxy: Schema.string().default('').description('模型请求代理，例如 http://127.0.0.1:7890；留空直连'),
    temperature: Schema.number().min(0).max(2).default(0.9),
    persona: Schema.string().role('textarea').default('你是 Atri，正在用自己的 B 站账号随便刷视频。你会挑自己真心觉得有意思、想分享给对方的视频，然后像平时私聊一样，用自己的口吻发给对方。').description('挑选时的角色设定（仅legacy使用；independent直接读取HDS，不用此处覆盖人设）'),
  }).description('独立 API / 旧模式模型（independent与legacy使用；hds不使用）'),
  Schema.object({
    pickAck: Schema.boolean().default(true).description('手动 bili.pick 时先回一句“我去刷一会儿”'),
    pickReply: Schema.union([
      Schema.const('failures').description('只在失败或没挑到时提示'),
      Schema.const('silent').description('完全不提示，只写后端日志'),
      Schema.const('all').description('总是提示（含“查阅了 N 条候选”）'),
    ]).default('failures').description('手动 bili.pick 的运行结果怎么显示'),
    debug: Schema.boolean().default(false).description('输出详细日志'),
  }).description('提示与调试'),
])

// ---------- 工具 ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a }
const stripHtml = (s = '') => String(s).replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'")
const https = (u = '') => (u.startsWith('//') ? 'https:' + u : u.replace(/^http:/, 'https:'))
const cut = (s = '', n) => { s = String(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s }
function parseDuration(d) {
  if (typeof d === 'number') return d
  if (!d) return 0
  return String(d).split(':').reduce((t, x) => t * 60 + (parseInt(x, 10) || 0), 0)
}
function fmtDuration(s) {
  s = Math.round(s || 0); const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60
  const p = (n) => String(n).padStart(2, '0')
  return hh ? `${hh}:${p(mm)}:${p(ss)}` : `${mm}:${p(ss)}`
}
function fmtCount(n) { n = Number(n) || 0; return n >= 1e4 ? (n / 1e4).toFixed(1) + '万' : String(n) }
function localDate(d = new Date()) { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` }
function inQuiet(cfg, d = new Date()) {
  const a = cfg.quietStart, b = cfg.quietEnd, hr = d.getHours()
  if (a === b) return false
  return a < b ? hr >= a && hr < b : hr >= a || hr < b
}
class BiliError extends Error {
  constructor(code, msg) { super(ERR[String(code)] || `B 站返回 ${code}：${msg}`); this.code = code }
}

// ---------- B 站客户端 ----------
class Bili {
  constructor(getCookie, log) { this.getCookie = getCookie; this.log = log; this.mixin = null; this.mixinAt = 0 }
  cookieValue(name) { const m = new RegExp('(?:^|;\\s*)' + name + '=([^;]*)').exec(this.getCookie() || ''); return m ? m[1].trim() : '' }
  headers(extra) {
    const hd = { 'User-Agent': UA, Referer: 'https://www.bilibili.com/', Origin: 'https://www.bilibili.com', Accept: 'application/json, text/plain, */*' }
    const c = (this.getCookie() || '').trim(); if (c) hd.Cookie = c
    return Object.assign(hd, extra)
  }
  async raw(url, params) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    const res = await fetch(url + qs, { headers: this.headers(), redirect: 'error', signal: AbortSignal.timeout(15000) })
    const text = await res.text()
    let json; try { json = JSON.parse(text) } catch { throw new Error(`B 站返回非 JSON（HTTP ${res.status}）`) }
    return json
  }
  async get(url, params = {}, wbi = false) {
    const p = wbi ? await this.sign(params) : params
    const json = await this.raw(url, p)
    if (json.code !== 0) throw new BiliError(json.code, json.message)
    return json.data
  }
  async getMixinKey() {
    if (this.mixin && Date.now() - this.mixinAt < 6 * 3600e3) return this.mixin
    const json = await this.raw('https://api.bilibili.com/x/web-interface/nav')
    const img = json?.data?.wbi_img
    if (!img) throw new Error('无法获取 wbi 签名参数')
    const key = (u) => u.slice(u.lastIndexOf('/') + 1).split('.')[0]
    const orig = key(img.img_url) + key(img.sub_url)
    this.mixin = MIXIN_TAB.map((i) => orig[i]).join('').slice(0, 32)
    this.mixinAt = Date.now()
    return this.mixin
  }
  async sign(params) {
    const mixin = await this.getMixinKey()
    const p = { ...params, wts: Math.round(Date.now() / 1000) }
    const query = Object.keys(p).sort().map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(p[k]).replace(/[!'()*]/g, ''))}`).join('&')
    return { ...Object.fromEntries(Object.keys(p).sort().map((k) => [k, String(p[k]).replace(/[!'()*]/g, '')])), w_rid: crypto.createHash('md5').update(query + mixin).digest('hex') }
  }
  async nav() {
    const json = await this.raw('https://api.bilibili.com/x/web-interface/nav')
    const d = json.data || {}
    return { isLogin: !!d.isLogin, uname: d.uname, mid: d.mid, code: json.code }
  }
  async recommend(n, idx) {
    const d = await this.get('https://api.bilibili.com/x/web-interface/wbi/index/top/feed/rcmd', { web_location: 1430650, feed_version: 'V8', homepage_ver: 1, fresh_type: 4, ps: n, fresh_idx: idx, fresh_idx_1h: idx, brush: idx }, true)
    return (d.item || []).filter((x) => x.goto === 'av' && x.bvid).map((x) => ({
      bvid: x.bvid, title: x.title, up: x.owner?.name, pic: x.pic, duration: x.duration, pubdate: x.pubdate,
      views: x.stat?.view, reason: x.rcmd_reason?.content || '', source: '首页推荐',
    }))
  }
  async ranking(zone) {
    const d = await this.get('https://api.bilibili.com/x/web-interface/ranking/v2', { rid: ZONES[zone], type: 'all', web_location: 333.934 }, true)
    return (d.list || []).map((x) => ({
      bvid: x.bvid, title: x.title, up: x.owner?.name, pic: x.pic, duration: x.duration, pubdate: x.pubdate,
      views: x.stat?.view, zone: x.tname, source: `${zone}区排行`,
    }))
  }
  async dynamics() {
    const d = await this.get('https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/all', { type: 'video', page: 1, timezone_offset: -480 })
    return (d.items || []).map((it) => {
      const a = it.modules?.module_dynamic?.major?.archive
      if (!a?.bvid) return null
      return { bvid: a.bvid, title: a.title, up: it.modules?.module_author?.name, pic: a.cover, duration: parseDuration(a.duration_text), pubdate: it.modules?.module_author?.pub_ts, views: parseInt(String(a.stat?.play).replace(/\D/g, ''), 10) || 0, source: '关注动态' }
    }).filter(Boolean)
  }
  async search(keyword) {
    const d = await this.get('https://api.bilibili.com/x/web-interface/wbi/search/type', { search_type: 'video', keyword, order: 'totalrank', page: 1 }, true)
    return (d.result || []).filter((x) => x.bvid).map((x) => ({
      bvid: x.bvid, title: stripHtml(x.title), up: x.author, pic: x.pic, duration: parseDuration(x.duration), pubdate: x.pubdate,
      views: x.play, zone: x.typename, source: `搜索“${keyword}”`,
    }))
  }
  async detail(bvid) {
    const d = await this.get('https://api.bilibili.com/x/web-interface/view/detail', { bvid })
    const v = d.View || {}
    return {
      bvid: v.bvid || bvid, upUid:String(v.owner?.mid || ''), aid: v.aid, cid: v.cid, title: v.title, desc: v.desc, zone: v.tname_v2 || v.tname, zoneTid: v.tid, up: v.owner?.name, pic: v.pic,
      duration: v.duration, pubdate: v.pubdate, views: v.stat?.view, likes: v.stat?.like, tags: (d.Tags || []).map((t) => t.tag_name).filter(Boolean),
    }
  }
  async subtitle(bvid, cid) {
    const d = await this.get('https://api.bilibili.com/x/player/wbi/v2', { bvid, cid }, true)
    const subs = d?.subtitle?.subtitles || []
    const s = subs.find((x) => /zh/.test(x.lan)) || subs[0]
    if (!s?.subtitle_url) return ''
    const target = new URL(https(s.subtitle_url))
    if (target.protocol !== 'https:' || target.username || target.password || target.port
      || !['bilibili.com', 'hdslb.com', 'biliapi.net'].some(domain => target.hostname === domain || target.hostname.endsWith('.' + domain))) throw Error('字幕地址未通过安全校验')
    const res = await fetch(target.href, { headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/' }, redirect: 'error', signal: AbortSignal.timeout(15000) })
    if (!res.ok) throw Error('字幕读取失败')
    const j = await res.json()
    return cut((j.body || []).map((x) => x.content).join(' '), 500)
  }
}

// ---------- 模型 ----------
async function callModel(cfg, system, user) {
  if (!cfg.endpoint || !cfg.model) throw new Error('未填写模型地址或模型 ID')
  let doFetch = fetch, dispatcher
  if (cfg.proxy) {
    try { const u = require('undici'); doFetch = u.fetch; dispatcher = new u.ProxyAgent(cfg.proxy) } catch { throw new Error('配置了代理，但找不到 undici 依赖') }
  }
  let headers, body
  if (cfg.protocol === 'anthropic-messages') {
    headers = { 'Content-Type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' }
    body = { model: cfg.model, max_tokens: 1024, temperature: cfg.temperature, system, messages: [{ role: 'user', content: user }] }
  } else {
    headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` }
    body = { model: cfg.model, temperature: cfg.temperature, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }
  }
  const res = await doFetch(cfg.endpoint, { method: 'POST', headers, body: JSON.stringify(body), dispatcher, signal: AbortSignal.timeout(90000) })
  const text = await res.text()
  if (!res.ok) throw new Error(`模型 HTTP ${res.status}：${cut(text, 200)}`)
  const j = JSON.parse(text)
  if (cfg.protocol === 'anthropic-messages') return (j.content || []).filter((x) => x.type === 'text').map((x) => x.text).join('')
  const c = j.choices?.[0]?.message?.content
  return Array.isArray(c) ? c.map((x) => x.text || '').join('') : String(c || '')
}

function extractJson(text) {
  const s = text.replace(/```(?:json)?/gi, '')
  const a = s.indexOf('{'), b = s.lastIndexOf('}')
  if (a < 0 || b <= a) throw new Error('模型没有返回 JSON')
  return JSON.parse(s.slice(a, b + 1))
}

// ---------- 插件 ----------
exports.apply = (ctx, config) => {
  const logger = ctx.logger('atri-bilibili')
  const instances = globalThis[Symbol.for('atri-bilibili.active-projects')] ||= new Map()
  const projectKey = path.resolve(ctx.baseDir || process.cwd()), instance = {}
  if (instances.has(projectKey)) { logger.warn('同一工程只能启用一个 atri-bilibili 实例，重复实例未启动'); return }
  instances.set(projectKey, instance)
  ctx.on('dispose', () => { if (instances.get(projectKey) === instance) instances.delete(projectKey) })
  const debug = (...a) => config.debug && logger.info(...a)
  const {createVault,createManager}=require('./account')
  const manualConfig=config
  const vault=createVault(path.join(ctx.baseDir || process.cwd(),'data','atri-bilibili','account-session.json'),()=>manualConfig.cookie || '')
  config={...config};Object.defineProperty(config,'cookie',{get:()=>vault.cookie(),enumerable:true})
  class AccountService extends Service { constructor(){super(ctx,'atriBiliAccount')} getCookie(){return vault.cookie()} }
  if(typeof ctx.provide==='function')new AccountService()
  ctx.on('dispose',()=>vault.dispose())
  const bili = new Bili(() => config.cookie, logger)
  const dir = path.join(ctx.baseDir || process.cwd(), 'data', 'atri-bilibili')
  const file = path.join(dir, 'state.json')
  let state = { sent: {}, daily: { date: '', count: 0 }, paused: false, lastRun: 0, lastResult: '', feedIdx: 1 }
  let persistenceFault = false
  try {
    const loaded = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!loaded || typeof loaded !== 'object' || Array.isArray(loaded)
      || loaded.autonomy && (typeof loaded.autonomy !== 'object' || Array.isArray(loaded.autonomy))
      || loaded.autonomy?.effectLedger && (typeof loaded.autonomy.effectLedger !== 'object' || Array.isArray(loaded.autonomy.effectLedger))) throw Error('invalid-state')
    if (loaded.autonomy?.effectLedger && Object.values(loaded.autonomy.effectLedger).some(entry => !entry
      || typeof entry !== 'object' || !['comment', 'history'].includes(entry.kind) || !entry.jobId || !entry.accountUid
      || !/^BV1[0-9A-Za-z]{9}$/.test(entry.bvid) || !['reserved', 'submitting', 'accepted', 'accepted-open-only',
        'skipped-preserve-progress', 'unknown', 'cancelled', 'rejected'].includes(entry.status))) throw Error('invalid-write-ledger')
    state = Object.assign(state, loaded)
  } catch (error) {
    if (error.code !== 'ENOENT') {
      persistenceFault = true; state.paused = true; state.persistenceFault = true
      logger.warn('状态文件无法安全读取，已停止自动执行且不会覆盖原文件；请保留防重复记录并在服务器本地检查')
    }
  }
  const save = () => {
    if (persistenceFault) return false
    try {
      const cutoff = Date.now() - 120 * 86400e3
      for (const [k, t] of Object.entries(state.sent)) if (t < cutoff) delete state.sent[k]
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
      const descriptor = fs.openSync(file + '.tmp', 'w', 0o600)
      try { fs.writeFileSync(descriptor, JSON.stringify(state)); fs.fchmodSync(descriptor, 0o600); fs.fsyncSync(descriptor) }
      finally { fs.closeSync(descriptor) }
      fs.renameSync(file + '.tmp', file)
      const directory = fs.openSync(dir, 'r')
      try { fs.fsyncSync(directory) } finally { fs.closeSync(directory) }
      return true
    } catch (e) { logger.warn('保存状态失败：%s', e.code || '文件写入错误'); return false }
  }
  let accountManager
  try {accountManager=createManager({config,bili,state,save,service:()=>ctx.interlude})}
  catch {persistenceFault=true;state.persistenceFault=true;state.paused=true;logger.warn('账号操作账本无法安全读取，全部自动执行已关闭')}
  ctx.on('dispose',()=>accountManager?.dispose())
  const todayCount = () => (state.daily.date === localDate() ? state.daily.count : 0)
  let running = false

  function passes(c) {
    const now = Date.now() / 1000
    if (config.minDuration && c.duration && c.duration < config.minDuration) return false
    if (config.maxDuration && c.duration > config.maxDuration) return false
    if (config.minViews && c.views != null && c.views < config.minViews) return false
    if (config.maxAgeDays && c.pubdate && now - c.pubdate > config.maxAgeDays * 86400) return false
    const text = [c.title, c.desc, ...(c.tags || [])].join(' ')
    if (config.blockWords.some((w) => w && text.includes(w))) return false
    return true
  }

  async function gather(errors) {
    const list = []
    const need = config.cookie ? [] : ['recommend', 'dynamic'].filter((s) => config.sources.includes(s))
    if (need.length) errors.push('首页推荐/关注动态需要填写 Cookie')
    const tasks = []
    if (config.cookie && config.sources.includes('recommend')) {
      tasks.push(['首页推荐', async () => { const idx = state.feedIdx = (state.feedIdx % 50) + 1; return [...await bili.recommend(12, idx), ...await sleep(600).then(() => bili.recommend(12, idx + 1))] }])
    }
    if (config.sources.includes('ranking')) {
      for (const z of shuffle(config.categories).slice(0, 3)) tasks.push([`${z}区排行`, async () => shuffle((await bili.ranking(z)).slice(0, 40)).slice(0, 10)])
    }
    if (config.cookie && config.sources.includes('dynamic')) tasks.push(['关注动态', () => bili.dynamics()])
    if (config.sources.includes('search')) {
      for (const k of shuffle(config.keywords.filter(Boolean)).slice(0, 2)) tasks.push([`搜索${k}`, async () => (await bili.search(k)).slice(0, 10)])
    }
    for (const [label, fn] of tasks) {
      try { const r = await fn(); debug('%s：%d 条', label, r.length); list.push(...r) } catch (e) { errors.push(`${label}：${e.message}`); logger.warn('%s 获取失败：%s', label, e.message) }
      await sleep(500 + Math.random() * 700)
    }
    const seen = new Set()
    return list.filter((c) => c.bvid && !state.sent[c.bvid] && !seen.has(c.bvid) && seen.add(c.bvid) && passes(c))
  }

  async function enrich(list, errors, readSubtitle = true) {
    const out = []
    for (const c of shuffle(list)) {
      if (out.length >= config.candidates) break
      try {
        const d = await bili.detail(c.bvid)
        const full = { ...c, ...Object.fromEntries(Object.entries(d).filter(([, v]) => v != null && v !== '')) }
        if (!passes(full)) continue
        if (config.strictCategory && !c.source.endsWith('区排行') && !config.categories.some((z) => (full.zone || '').includes(z))) {
          // 子分区名不一定含主分区名，交给模型判断，这里只做宽松过滤
          full.categoryUncertain = true
        }
        out.push(full)
      } catch (e) { if (e.code === -352 || e.code === -412) { errors.push(e.message); break } debug('详情 %s 失败：%s', c.bvid, e.message) }
      await sleep(300 + Math.random() * 500)
    }
    if (readSubtitle && config.fetchSubtitle && config.cookie) {
      for (const c of out.slice(0, 8)) {
        try { c.subtitle = await bili.subtitle(c.bvid, c.cid) } catch (e) { debug('字幕 %s 失败：%s', c.bvid, e.message) }
        await sleep(300)
      }
    }
    return out
  }

  async function choose(cands, k) {
    if (!config.useModel) {
      const words = [...config.categories, ...config.interests, ...config.keywords].filter(Boolean)
      const score = (c) => words.filter((w) => [c.title, c.zone, c.desc, ...(c.tags || [])].join(' ').includes(w)).length * 3 + Math.log10((c.views || 0) + 10) + Math.random()
      return cands.filter((c) => !config.strictCategory || !c.categoryUncertain).sort((a, b) => score(b) - score(a)).slice(0, k).map((c) => ({ c, messages: ['刷到一个感觉你会喜欢的～'] }))
    }
    const system = `${config.persona}

现在你在刷 B 站。下面是你刷到的一批视频信息。请站在你自己的角色立场挑选：
- 最多挑 ${k} 个你自己真的感兴趣、想分享给对方的视频；都不喜欢就一个也不选。
- 你偏好的视频类型：${config.categories.join('、') || '不限'}${config.strictCategory ? '（只能选这些类型的视频）' : '（作为参考，可以偶尔例外）'}。
- 补充喜好：${config.interests.join('、') || '无'}。
- 推荐的话用你平时私聊的口吻，只根据已取得的标题、简介和字幕片段自然地说为什么想发给对方；${config.splitBubbles ? '拆成 1～3 条短消息（像连发几条私聊），每条不超过 40 字' : '写成一条，不超过 80 字'}；不要写链接、不要编造未读取的细节，不要冒称完整播放过画面或声音。
只输出 JSON，不要其他文字：{"picks":[{"bvid":"BV...","messages":["第一条","第二条"]}]}`
    const lines = cands.map((c) => JSON.stringify({
      bvid: c.bvid, 标题: c.title, UP: c.up, 分区: c.zone, 标签: (c.tags || []).slice(0, 8), 时长: fmtDuration(c.duration), 播放: fmtCount(c.views),
      简介: cut(c.desc || '', 120), 推荐理由: c.reason || undefined, 字幕片段: c.subtitle ? cut(c.subtitle, 300) : undefined, 来源: c.source,
    }))
    const text = await callModel(config, system, lines.join('\n'))
    debug('模型返回：%s', cut(text, 500))
    const j = extractJson(text)
    const map = new Map(cands.map((c) => [c.bvid, c]))
    return (j.picks || []).filter((p) => map.has(p.bvid)).slice(0, k).map((p) => {
      let msgs = Array.isArray(p.messages) ? p.messages : [p.message || '']
      msgs = msgs.map((x) => cut(String(x || ''), 120)).filter(Boolean)
      if (!config.splitBubbles) msgs = [msgs.join(' ')]
      return { c: map.get(p.bvid), messages: msgs.slice(0, 3) }
    })
  }

  function findBot() {
    return ctx.bots.find((b) => b.platform === config.platform && (!config.selfId || String(b.selfId) === String(config.selfId)))
  }

  // No standalone selection model or direct message sender participates in
  // this mode. HDS itself chooses from real, bounded candidate observations.
  let autonomy, independent
  if (config.workflow === 'hds' && typeof ctx.inject === 'function') {
    ctx.inject(['interlude', 'atriBiliEyes', 'database'], child => {
      autonomy = createAutonomy(child, config, {
        state, bili, accountManager,
        save: () => { if (!save()) throw Error('state-persistence-failed') },
        validateVideo: async bvid => passes(await bili.detail(bvid)),
        discover: async query => {
          const errors = []
          const pool = query ? (await bili.search(query)).filter(passes) : await gather(errors)
          const watched = state.autonomy?.watched || {}
          const candidates = pool.filter(c => /^BV1[0-9A-Za-z]{9}$/.test(c.bvid || '')
            && !state.sent[c.bvid] && (!watched[`${c.bvid}#1`] || Date.now() - watched[`${c.bvid}#1`] >= config.rewatchDays * 86400e3))
          return enrich(candidates, errors, false)
        },
      })
      const current = autonomy
      child.on('dispose', () => { current.dispose(); if (autonomy === current) autonomy = undefined })
    })
  }

  const cardSender = createCardSender({
    onBackendSelected: () => logger.info('当前协议端改用文字链接与封面：普通网页卡片未通过 QQ 展示验证'),
  })
  async function sendArkCard(bot, c, sendConfig = config) {
    return cardSender.send(bot, c, sendConfig)
  }

  async function sendLink(bot, c) {
    const info = `【${c.title}】\nUP：${c.up || '未知'}｜${fmtDuration(c.duration)}｜${fmtCount(c.views)}播放\nhttps://www.bilibili.com/video/${c.bvid}`
    const content = [h.text(info)]
    if (config.sendCover && c.pic) content.push(h.image(https(c.pic)))
    await bot.sendPrivateMessage(config.targetUserId, content)
  }

  async function sendVideo(bot, c, sendConfig = config) {
    let error
    if (sendConfig.cardMode === 'ark' || sendConfig.cardMode === 'share' || sendConfig.cardMode === 'miniapp') {
      try {
        const mode = await sendArkCard(bot, c, sendConfig)
        if (mode !== 'link') return { mode }
      } catch (e) { error = e; logger.warn('发送视频卡片失败，改发链接：%s', e.message) }
    }
    await sendLink(bot, c)
    return { mode: 'link', error }
  }

  const pause = () => sleep(config.bubbleDelay * (0.7 + Math.random() * 0.6))

  async function deliver({ c, messages }) {
    const bot = findBot()
    if (!bot) throw new Error('找不到在线的机器人')
    const sendTexts = async () => {
      for (let i = 0; i < messages.length; i++) {
        if (i) await pause()
        await bot.sendPrivateMessage(config.targetUserId, [h.text(messages[i])])
      }
    }
    if (config.order === 'videoFirst') { await sendVideo(bot, c); if (messages.length) { await pause(); await sendTexts() } }
    else { if (messages.length) { await sendTexts(); await pause() } await sendVideo(bot, c) }
  }

  async function runRound(manual = false) {
    if (running) return '我还在刷上一轮，稍等一下～'
    running = true
    const errors = []
    try {
      const k = manual ? config.perRound : Math.min(config.perRound, config.dailyLimit ? config.dailyLimit - todayCount() : config.perRound)
      if (k <= 0) return '今天推荐次数已达上限'
      const pool = await gather(errors)
      debug('初筛后候选 %d 条', pool.length)
      if (!pool.length) return `没刷到合适的新视频${errors.length ? '：' + errors.join('；') : ''}`
      const cands = await enrich(pool, errors)
      if (!cands.length) return `候选都被过滤掉了${errors.length ? '：' + errors.join('；') : ''}`
      const picks = await choose(cands, k)
      if (!picks.length) return `刷了 ${cands.length} 个视频，这次没有特别想分享的`
      let sent = 0
      for (const p of picks) {
        await deliver(p)
        state.sent[p.c.bvid] = Date.now(); sent++
        if (state.daily.date !== localDate()) state.daily = { date: localDate(), count: 0 }
        state.daily.count++
        save()
        if (config.reportWatch && config.cookie && p.c.aid && p.c.cid) {
          try {
            const { createAccountClient, fingerprint } = require('./social'), cookie = config.cookie
            await createAccountClient(bili).openHistory({ bvid: p.c.bvid, aid: p.c.aid, cid: p.c.cid, cookie,
              beforeSend: async () => config.workflow === 'legacy' && config.reportWatch && !state.paused && fingerprint(config.cookie) === fingerprint(cookie) })
          } catch { logger.warn('旧模式入口记录未完成；未上报任何虚构播放时长') }
        }
        await sleep(1500)
      }
      logger.info('本轮查阅了 %d 条候选，推荐 %d 条', cands.length, sent)
      return `查阅了 ${cands.length} 条候选，推荐了 ${sent} 条`
    } catch (e) {
      logger.warn('本轮失败：%s', e.message)
      return `出错了：${e.message}`
    } finally {
      running = false
      state.lastRun = Date.now(); save()
    }
  }

  // ---------- 定时 ----------
  let timer
  function schedule(firstDelayMs) {
    const delay = firstDelayMs ?? (config.intervalMinutes + (Math.random() * 2 - 1) * config.jitterMinutes) * 60e3
    timer?.()
    timer = ctx.setTimeout(async () => {
      try {
        if (config.workflow === 'legacy' && config.auto && !state.paused && !inQuiet(config) && findBot()) {
          state.lastResult = await runRound(false); logger.info('自动推荐：%s', state.lastResult); save()
        } else debug('跳过本轮（暂停/免打扰/机器人离线）')
      } finally { schedule() }
    }, Math.max(delay, 60e3))
  }
  ctx.on('ready', () => { if (config.workflow === 'legacy' && config.auto) schedule(5 * 60e3) })

  // ---------- 指令（仅接收人可用）----------
  const allowed = (s) => s && s.isDirect !== false && String(s.userId) === String(config.targetUserId)
    && (!s.platform || s.platform === config.platform) && (!s.selfId || !config.selfId || String(s.selfId) === String(config.selfId))
  const bridge=require('./chat-cards').createBridge(ctx,config,{bili,allowed,autonomy:()=>independent || autonomy})
  if(config.workflow==='independent')ctx.inject(['interlude','atriBiliEyes','database'],child=>{
    const version=require(require.resolve('koishi-plugin-hds-interlude/package.json',{paths:[ctx.baseDir || process.cwd(),__dirname]})).version
    if(version!=='1.0.1-rc57'){logger.warn('独立API仅适配HDS 1.0.1-rc57，未启动');return}
    independent=require('./independent').createIndependent(child,config,{state,save,bili,allowed,bridge,
      discover:async query=>{const errors=[];return (query?(await bili.search(query)).filter(passes):await gather(errors)).slice(0,16)} })
    const current=independent
    child.on('dispose',()=>{current.dispose();if(independent===current)independent=undefined})
  })
  ctx.command('bili.run <request:text>','用独立API参考HDS人设执行选片、读取和推荐').action(async({session},request)=>{
    if(!allowed(session))return
    if(config.workflow!=='independent')return '请在原插件的工作方式中选择 independent，并单独填写模型接口。'
    if(!independent)return '独立执行器尚未连接 HDS、眼镜或数据库。'
    return independent.run(session,request || '按你当前的兴趣推荐一个B站视频')
  })
  ctx.command('bili.web <url:string> [question:text]','读取公开网页，用原独立API参考HDS人设综合回复').action(async({session},url,question)=>{
    if(!allowed(session))return
    if(config.workflow!=='independent')return 'bili.web 请使用原实例的 independent 工作方式；HDS模式可用已有来源的bili-fetch意图。'
    if(!independent)return '独立执行器尚未连接 HDS、眼镜或数据库。'
    if(!url)return '用法：bili.web https://公开网页地址 想了解的问题'
    return independent.run(session,'读取网页 '+url+' '+(question||'综合说说你的看法'),{webUrl:url})
  })
  ctx.middleware?.(async(session,next)=>{
    if(config.workflow!=='independent' || !allowed(session) || !session.isDirect || session.guildId)return next()
    const routed=await require('./share').route(session,{independent,send:text=>session.send(h.text(text))})
    if(routed.handled)return
    if(routed.command)return next()
    const content=routed.text
    independent?.interrupt();const result=await next();independent?.schedule(session,content);return result
  },true)
  let qrTimer, qrBusy=false, qrGeneration=0
  ctx.on('dispose',()=>{qrGeneration++;clearInterval(qrTimer)})
  ctx.command('bili.login','生成 B 站官方扫码登录二维码；仅发给配置的本人私聊').action(async({session})=>{
    if(!allowed(session) || !session.isDirect || session.guildId)return
    if(qrBusy)return '已有二维码正在确认，请先等待或使用 bili.login.cancel'
    const generation=++qrGeneration
    try{qrBusy=true;const url=await vault.begin();if(generation!==qrGeneration)return;const qr=require('./qrcode')(0,'M');qr.addData(url);qr.make()
      await session.send([h.text('请用 B 站 App 扫码并在手机确认，3 分钟有效。仅登录机器人账号，不会自动执行写操作。'),h.image(qr.createDataURL(6,24),'image/gif')])
      if(generation!==qrGeneration)return
      qrTimer=setInterval(async()=>{if(generation!==qrGeneration || qrBusy==='polling')return;qrBusy='polling';try{const status=await vault.poll();if(generation!==qrGeneration)return;if(['logged-in','expired','cancelled'].includes(status)){clearInterval(qrTimer);qrBusy=false;await session.send(status==='logged-in'?'B 站扫码登录已保存到服务器私密文件。请发 bili.check 核对实际账号。':'本次扫码已失效或取消。')}else qrBusy=true}catch{if(generation!==qrGeneration)return;clearInterval(qrTimer);qrBusy=false;await session.send('扫码未完成，未公开任何凭据；若触发风控请在手机处理后重新登录。').catch(()=>{})}},3000)
      qrTimer.unref?.();return
    }catch{if(generation!==qrGeneration)return;qrBusy=false;return '无法生成扫码登录；已有 Cookie 时请先在 Console 核对，勿将 Cookie 发到聊天。'}
  })
  ctx.command('bili.login.cancel','取消二维码会话，不退出已有账号').action(({session})=>{if(!allowed(session))return;qrGeneration++;clearInterval(qrTimer);qrBusy=false;vault.dispose();return '已取消本次扫码'})
  ctx.command('bili.logout','清除扫码会话；手填 Cookie 需在 Console 清除').action(({session})=>{if(!allowed(session))return;qrGeneration++;clearInterval(qrTimer);qrBusy=false;vault.clear();return '已清除服务器上的扫码凭据；如果仍有手填 Cookie，请在 Console 清除。未调用平台全端退出。'})
  ctx.command('bili.account','账号状态与新增账号操作审计').action(async({session})=>{if(!allowed(session))return;try{const n=await bili.nav();return `登录：${!!n.isLogin}；${n.uname || ''} UID ${n.mid || ''}\n新增写操作模式：${config.writeMode}（各开关独立）\n已开能力：${Object.entries(require('./account').FLAGS).filter(([op,flag])=>config[flag]).map(([op])=>op).join('、') || '无'}\n`+(accountManager?.entries().slice(-5).map(e=>accountManager.summary(e)).join('\n\n')||'尚无账号写操作')}catch{return '账号检查未完成；未输出远端响应或凭据'}})
  ctx.command('bili.folders','查询本账号收藏夹编号').action(async({session})=>{if(!allowed(session))return;try{const n=await bili.nav();if(!n.isLogin)return '账号未登录';const d=await bili.get('https://api.bilibili.com/x/v3/fav/folder/created/list-all',{up_mid:n.mid,type:2});return (d.list||[]).slice(0,30).map(f=>`${f.id}：${f.title}`).join('\n') || '没有可用收藏夹'}catch{return '未能查询收藏夹'}})
  ctx.command('bili.confirm <token:string>','确认一条 HDS 人设提出的账号操作；20分钟内有效').action(async({session},token)=>{if(!allowed(session))return;if(config.workflow==='independent')return '独立API模式不执行账号写操作。原提案需在HDS模式下重新核对来源和有效期，未在此处批准或发送。';try{const e=accountManager.confirm(token);await autonomy?.drain?.();return accountManager.summary(e)}catch{return '确认失败、已过期或功能未连接；不会自动重试未知结果'}})
  ctx.command('bili.cancel <token:string>','取消一条待执行的账号操作').action(({session},token)=>{if(!allowed(session))return;const e=accountManager?.cancel(token);return e?accountManager.summary(e):'未找到这条操作'})
  ctx.command('bili', 'B 站自主观看与视频工具')
  ctx.command('bili.check', '检查 B 站登录状态').action(async ({ session }) => {
    if (!allowed(session)) return
    try { const n = await bili.nav(); return n.isLogin ? `B 站已登录：${n.uname}（UID ${n.mid || '未返回'}）` : '没有登录 B 站（Cookie 无效或已过期）' } catch (e) { return `检查失败：${e.message}` }
  })
  ctx.command('bili.target', '只读核对公开留言的固定@对象，不发布评论').action(async ({ session }) => {
    if (!allowed(session)) return
    const { uid, createAccountClient } = require('./social')
    if (!uid(config.mentionUserUid)) return '尚未配置真实的 B 站 @UID；不能用 QQ 号代替'
    try {
      const user = await createAccountClient(bili).mention(config.mentionUserUid)
      return `固定@对象：${user.name}（B 站 UID ${user.mid}）\nhttps://space.bilibili.com/${user.mid}\n请先确认这是你本人，再在 Console 开启公开评论；本指令未发送留言`
    } catch { return '无法核对固定@对象，未发送留言；请确认 UID、登录与平台可用性' }
  })
  ctx.command('bili.pick', '现在去刷一轮').action(async ({ session }) => {
    if (!allowed(session)) return
    if (config.workflow === 'independent') return independent ? independent.run(session,'按你的人设和最近剧情选一个你感兴趣的B站视频并推荐') : '独立执行器等待HDS/眼镜/数据库'
    if (config.workflow === 'hds') return '现在是 HDS 自主观看模式：不再强制挑选或直接推荐。请正常聊天，或等待 HDS 的生活推进，由她自己决定想看什么。用 bili.status 查看连接，用 bili.history 查看意图与剧本写入结果。'
    if (config.pickAck) await session.send('好，我去刷一会儿 B 站～')
    const result = await runRound(true)
    logger.info('bili.pick：%s', result)
    if (config.pickReply === 'all') return result
    if (config.pickReply === 'failures' && !/^看了 \d+ 个视频，推荐了 [1-9]/.test(result)) return result
  })
  ctx.command('bili.card <bvid:string> [mode:string]', '测试视频发送形式，可加 miniapp 单次试发小程序卡片').action(async ({ session }, bvid, mode) => {
    if (!allowed(session)) return
    if (!/^BV[0-9A-Za-z]{10}$/.test(bvid || '')) return '用法：bili.card BV号'
    if (mode && !['miniapp', 'link'].includes(mode)) return '试发形式仅支持 miniapp 或 link；不填时使用当前配置'
    try {
      const bot = findBot(); if (!bot) return '找不到在线的机器人'
      const d = await bili.detail(bvid)
      const result = await sendVideo(bot, { bvid, ...d }, mode ? { ...config, cardMode: mode } : config)
      logger.info('bili.card：发送请求已完成（%s）%s；QQ 展示效果需接收端确认', result.mode, bvid)
      if (result.error) return `卡片发送失败，已改发链接：${result.error.message}`
    } catch (e) { return `出错了：${e.message}` }
  })
  ctx.command('bili.status', '查看推荐状态').action(({ session }) => {
    if (!allowed(session)) return
    if (persistenceFault) return '原状态文件或防重复账本无法安全读取；自动执行已关闭，原文件未被覆盖。请在服务器本地检查并保留账本，不要删文件重置'
    if(config.workflow==='independent')return independent?.status() || '独立执行器尚未连接 HDS、眼镜或数据库'
    const last = state.lastRun ? new Date(state.lastRun).toLocaleString('zh-CN', { hour12: false }) : '无'
    if (config.workflow === 'hds') return [
      `工作方式：HDS 自主观看；自动执行：${!config.auto ? '关闭' : state.paused ? '已暂停' : '开启'}`,
      autonomy?.status() || '等待 HDS、B 站眼镜 0.2.0 和数据库服务，请确认三个插件均已启用',
      `原推荐历史保留：${Object.keys(state.sent).length} 条`,
      '不直接发推荐，不改 HDS 自动推进/主动消息开关；后台选片仍需原自动推进开启；账号写操作及确认见 bili.account。',
    ].join('\n')
    return [`工作方式：旧版定时推荐`, `自动推荐：${config.auto ? (state.paused ? '已暂停' : '开启') : '关闭'}`, `今天已推荐：${todayCount()}${config.dailyLimit ? '/' + config.dailyLimit : ''}`, `累计推荐：${Object.keys(state.sent).length}`, `上次运行：${last}`, state.lastResult ? `上次结果：${state.lastResult}` : ''].filter(Boolean).join('\n')
  })
  ctx.command('bili.history', '查看最近的自主观看意图和执行结果').action(({ session }) => {
    if (!allowed(session)) return
    if(config.workflow==='independent')return independent?.history() || '独立执行器未连接'
    const jobs = (state.autonomy?.jobs || []).slice(-5).reverse()
    return jobs.length ? jobs.map(job => `${job.action} ${job.bvid || job.query || '刷首页'}：${job.status}\n想法：${cut(job.purpose, 100)}\n${job.result || '等待执行，不能当成已经完成'}`).join('\n\n') : '还没有 HDS 提出的自主观看意图'
  })
  ctx.command('bili.watched', '查看最近实际读取过的视频和讨论/留言状态').action(async ({ session }) => {
    if (!allowed(session)) return
    const records = await (independent || autonomy)?.journal?.() || []
    return records.length ? records.map(item => `${new Date(item.readAt).toLocaleString('zh-CN', { hour12: false })} ${item.bvid} P${item.p}\n${cut(item.title, 90)}\n字幕${item.got.subtitle ? '有' : '无'}／弹幕${item.got.danmaku ? '有' : '无'}／评论${item.got.comments ? '有' : '无'}；HDS #${item.evidenceId}\n账号记录：${item.accountHistoryStatus}；留言：${item.commentStatus}${item.commentRpid ? ' #' + item.commentRpid : ''}`).join('\n\n') : '暂无仍存在于 HDS 的实际读取记录；未从缓存恢复已删除的剧本'
  })
  ctx.command('bili.effects', '查看账号公开写入审计，不代表消息或@通知已送达').action(({ session }) => {
    if (!allowed(session)) return
    const entries = Object.values(state.autonomy?.effectLedger || {}).slice(-5).reverse()
    return entries.length ? entries.map(item => `${item.kind} ${item.bvid}：${item.status}${item.rpid ? '；评论 #' + item.rpid : ''}\n账号 UID ${item.accountUid}${item.mentionUid ? '；@目标 UID ' + item.mentionUid : ''}\n公开可见/通知是否送达仍需在 B 站核实；不自动重发。`).join('\n\n') : '还没有账号写入尝试；读取日志用 bili.watched'
  })
  ctx.command('bili.comments.pause', '暂停她的公开留言，不停止只读观看').action(({ session }) => {
    if (!allowed(session)) return
    state.autonomy ||= {}; state.autonomy.commentsPaused = true
    return save() ? '已暂停公开留言；仍可读取和形成观点，不删除防重复记录' : '状态保存失败，请先停用插件检查磁盘'
  })
  ctx.command('bili.comments.resume', '已在平台核实后恢复公开留言；不重试旧的未知结果').action(async ({ session }) => {
    if (!allowed(session)) return
    if(config.workflow==='independent')return '独立API模式仅读取、解读和推荐，不运行公开留言；原留言开关保留但本模式不执行。'
    if (persistenceFault) return '状态文件无法安全读取，未恢复；请保留防重复记录并在服务器本地检查'
    const { uid, cookieValue } = require('./social')
    if (!config.publicCommentsEnabled || !uid(config.mentionUserUid)) return '请先在 Console 明确开启公开留言并填写真实的 B 站 @UID'
    try {
      const nav = await bili.nav()
      if (!nav.isLogin || !uid(nav.mid) || uid(cookieValue(config.cookie, 'DedeUserID')) !== uid(nav.mid)) return '账号身份未核对通过，未恢复'
      state.autonomy ||= {}; state.autonomy.commentsPaused = false; delete state.autonomy.commentBlocked
      return save() ? '已恢复新留言意图的执行；请确保已在 B 站处理平台验证。旧的失败/未知写入不会重发' : '状态保存失败，未确认恢复'
    } catch { return '登录检查未完成，未恢复公开留言' }
  })
  ctx.command('bili.pause', '暂停自动执行').action(({ session }) => { if (!allowed(session)) return; state.paused = true; save(); return config.workflow === 'hds' ? '已暂停执行自主观看意图，不删除剧本或已有观看记录' : '好，先不给你发视频了' })
  ctx.command('bili.resume', '恢复自动执行').action(({ session }) => { if (!allowed(session)) return; if (persistenceFault) return '状态文件无法安全读取，未恢复；不要删除防重复账本'; state.paused = false; save(); return config.workflow === 'hds' ? '已恢复自主观看；是否看视频和是否分享仍由 HDS 决定' : '好，刷到好看的再发你' })
}

exports._internal = { Bili, parseDuration, fmtDuration, inQuiet, extractJson, ZONES }
