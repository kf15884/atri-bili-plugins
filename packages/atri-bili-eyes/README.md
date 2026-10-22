# Atri Bili Eyes 0.6.1-beta.1

0.6.1-beta.1：基于0.6.0，运行源码不变，仅更新包版本与peerDependencies以明确兼容0.8.4-beta.1；仍是Atri子项目，复用HDS原叙事与记忆。

## 功能简介

本人私聊分享B站视频链接、BV或QQ JSON卡片后，HDS先按原人设回应准备去看看；开场回执确认后才读视频资料。HDS基于资料生成内存预回复，默认随机等待30–90秒；追问可提前发送，未就绪的追问静默合并为就绪后立即发送。默认不重复回卡，无独立模型或站内写入，并非真实音视频播放。

## 最新更新

0.5.2新增watchPacing=true、waitMinSec=30、waitMaxSec=90、taskTimeoutSec=180。倒计时从预回复就绪后开始。关闭watchPacing恢复即时读取后回复；autoReadShared=false关闭自动分享识别。

依赖主插件0.8.x（含0.8.4-beta.1）与HDS rc57兼容接口。仅本人私聊，群聊、其他人、代码/引用/合并转发、旧命令、无目标聊天不读。多视频不猜一个；同视频合并，新视频替换旧任务，取消/重启不重放。关联追问不另开HDS回合，其他聊天正常；复杂隐含追问不保证识别。

原atriBiliEyes.watch/readDiscussion服务保留。全部管理指令、安装和验收见根README，不能将/bili发在SSH。只用已授权的HDS模型，不另填Key/人设；保护会话与旧数据。
