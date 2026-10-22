"use strict";
const { Schema } = require("koishi");
module.exports = Schema.intersect([
  Schema.object({
    targetUserId: Schema.string()
      .default("")
      .description("本人QQ号；留空不启用"),
    selfId: Schema.string().default("").description("机器人QQ号；留空不启用"),
    platform: Schema.const("onebot").default("onebot"),
    cookie: Schema.string()
      .role("secret")
      .default("")
      .description("可选；留空可官方扫码；只发固定B站API域"),
    accountUid: Schema.string()
      .default("")
      .description("可选：核对扫码登录的B站UID；不用于互动"),
  }).description("01 私聊范围与可选登录"),
  Schema.object({
    subtitles: Schema.boolean()
      .default(true)
      .description("读取可用字幕；不绕过登录或权限限制"),
    danmaku: Schema.boolean()
      .default(false)
      .description("可选弹幕样本；不是视频正文"),
    timeoutSec: Schema.natural().min(5).max(60).default(20),
    cacheMinutes: Schema.natural().max(120).default(15),
    readDailyLimit: Schema.natural()
      .default(0)
      .description("每日API资料读取次数；0不限，失败计数"),
  }).description("02 只读API资料"),
  Schema.object({
    autoEnabled: Schema.boolean()
      .default(true)
      .description(
        "在HDS自身的后台生活推进中提供候选；不单独定时发消息，仍需HDS允许主动联系",
      ),
    intervalMinutes: Schema.natural()
      .min(30)
      .default(120)
      .description("后台选片最小间隔分钟；失败也进入冷却"),
    discoveryKeyword: Schema.string()
      .default("")
      .description("兴趣搜索词；留空用热门；最终由HDS筛选"),
    candidateLimit: Schema.natural()
      .min(1)
      .max(3)
      .default(2)
      .description("每次最多读取的候选数"),
    rewatchDays: Schema.natural()
      .min(1)
      .default(7)
      .description("不重复选取最近已读候选的天数"),
    timezone: Schema.string().default("Asia/Shanghai"),
    quietStart: Schema.natural().max(23).default(23),
    quietEnd: Schema.natural()
      .max(23)
      .default(8)
      .description("后台免打扰结束小时；起止相同不限制"),
    askEnabled: Schema.boolean()
      .default(true)
      .description("本人私聊要视频（如“有没有好看的视频发我”）时读取候选交给HDS；发不发由HDS按剧本状态决定"),
    askWaitSec: Schema.natural()
      .max(20)
      .default(4)
      .description("要视频时最多等候选读取的秒数；超时这一轮先由HDS自然回应，读取在后台继续，下次要视频直接用"),
    candidatePoolMinutes: Schema.natural()
      .min(1)
      .max(240)
      .default(60)
      .description("后台读好的候选保留分钟数；自动选片只使用已读好的候选，不在HDS回合里等网络"),
    askDeferSec: Schema.natural()
      .max(600)
      .default(120)
      .description("要视频时候选没读好：读好后多少秒内仍可由HDS决定补发（期间本人再发任何消息就取消）；0关闭补发"),
    selfWatchEnabled: Schema.boolean()
      .default(true)
      .description("Atri自己分享卡片后也自己点开看（第二台画面+声音，未开启则只用文字资料），随后补一段感想；不打断正在看的本人分享"),
    selfWatchWaitMinSec: Schema.natural()
      .max(600)
      .default(30)
      .description("自己看完后到补发感想的最短随机等待秒数；追问“看了没”等会提前发"),
    selfWatchWaitMaxSec: Schema.natural()
      .max(600)
      .default(120)
      .description("自己看完后到补发感想的最长随机等待秒数"),
    cardGapMinSec: Schema.natural()
      .max(30)
      .default(2)
      .description("卡片发出后到HDS正文的最短停顿秒数"),
    cardGapMaxSec: Schema.natural()
      .max(30)
      .default(5)
      .description("卡片发出后到HDS正文的最长停顿秒数；起止颠倒时自动排序"),
  }).description("03 HDS自主选片与QQ卡片"),
  Schema.object({
    framesEnabled: Schema.boolean()
      .default(false)
      .description("看视频时请第二台服务器抽帧并截取开头声音，画面和声音一起理解"),
    framesUrl: Schema.string()
      .default("")
      .description("第二台地址；只走WireGuard内网，不要填公网"),
    framesToken: Schema.string()
      .role("secret")
      .default("")
      .description("第二台 /etc/atri-senses/config.json 里的 token"),
    framesScope: Schema.union([
      Schema.const("shared").description("只抽本人分享的视频"),
      Schema.const("all").description("本人分享 + 自主选片候选"),
    ]).default("shared"),
    framesWaitSec: Schema.natural()
      .min(20)
      .max(400)
      .default(180)
      .description("整次看视频最多等待秒数（取材+理解）；超时只带文字资料。开启后建议眼镜 taskTimeoutSec 调到300"),
  }).description("04 第二台看视频（画面+声音）"),
]);
