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
    askEnabled: Schema.boolean()
      .default(true)
      .description("本人私聊要视频（“发个视频给我”“你把视频发我”“再来一个”等）时由插件挑选：读几条候选→HDS按人设挑一个→看一遍→先发QQ卡片再发她写的推荐话；说“算了/不用了”取消"),
    askCandidates: Schema.natural()
      .min(3)
      .max(8)
      .default(5)
      .description("要视频时读取的候选数（文字资料）"),
    discoveryKeyword: Schema.string()
      .default("")
      .description("兴趣搜索词；留空用热门；要视频时对方指定了内容就用对方的"),
    prepEnabled: Schema.boolean()
      .default(true)
      .description("剧情里写到Atri在刷B站/看视频时，后台读几条候选、全部看一遍，挑一个存为“预备视频”；本身不发消息"),
    prepCandidates: Schema.natural()
      .min(2)
      .max(5)
      .default(4)
      .description("每次预看读取并观看的候选数"),
    intervalMinutes: Schema.natural()
      .min(30)
      .default(120)
      .description("两次预看的最小间隔分钟"),
    prepDailyLimit: Schema.natural()
      .max(24)
      .default(3)
      .description("每日预看次数上限；0即不预看"),
    preparedHours: Schema.natural()
      .min(1)
      .max(240)
      .default(48)
      .description("预备视频保留小时数，过期作废"),
    preparedReuseMinutes: Schema.natural()
      .max(1440)
      .default(30)
      .description("要视频时预备视频的推荐话在这么多分钟内直接用，更久则让HDS按现在的状态重写"),
    autoEnabled: Schema.boolean()
      .default(true)
      .description("手上有预备视频时，在HDS后台生活推进回合里告诉HDS可以主动分享；仍需HDS允许主动联系，免打扰时段不提供"),
    candidateLimit: Schema.natural()
      .min(1)
      .max(10)
      .default(2)
      .description("/bili search 等命令默认读取的条数"),
    rewatchDays: Schema.natural()
      .min(1)
      .default(7)
      .description("最近已分享过的视频多少天内不再推荐"),
    linkToCard: Schema.boolean()
      .default(true)
      .description("HDS或其他插件私聊消息里的B站视频链接改发QQ卡片（关闭则只去掉链接）；对方分享的、最近发过的不回发"),
    browserHandoff: Schema.boolean()
      .default(true)
      .description("HDS想用浏览器打开/搜索B站时改交给观看任务；本人发B站链接、观看或要视频期间关闭HDS浏览"),
    handoffDailyLimit: Schema.natural()
      .max(24)
      .default(6)
      .description("每天最多交接几次浏览器想看的B站视频"),
    timezone: Schema.string().default("Asia/Shanghai"),
    quietStart: Schema.natural().max(23).default(23),
    quietEnd: Schema.natural()
      .max(23)
      .default(8)
      .description("后台免打扰结束小时；起止相同不限制"),
    selfWatchEnabled: Schema.boolean()
      .default(false)
      .description("（旧功能，默认关闭）主动分享卡片后再单独补一段感想；0.8.0起推荐前已经看过，一般不需要"),
    selfWatchWaitMinSec: Schema.natural()
      .max(600)
      .default(30)
      .description("旧功能：补发感想的最短随机等待秒数"),
    selfWatchWaitMaxSec: Schema.natural()
      .max(600)
      .default(120)
      .description("旧功能：补发感想的最长随机等待秒数"),
    cardGapMinSec: Schema.natural()
      .max(30)
      .default(2)
      .description("卡片发出后到HDS正文的最短停顿秒数"),
    cardGapMaxSec: Schema.natural()
      .max(30)
      .default(5)
      .description("卡片发出后到HDS正文的最长停顿秒数；起止颠倒时自动排序"),
  }).description("03 要视频、预备视频与QQ卡片"),
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
      Schema.const("all").description("（旧选项，0.8.0起推荐/预看总会观看）"),
    ]).default("shared"),
    framesWaitSec: Schema.natural()
      .min(20)
      .max(400)
      .default(180)
      .description("整次看视频最多等待秒数（取材+理解）；超时只带文字资料。开启后建议眼镜 taskTimeoutSec 调到300"),
  }).description("04 第二台看视频（画面+声音）"),
]);
