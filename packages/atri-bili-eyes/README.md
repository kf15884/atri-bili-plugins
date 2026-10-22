# Atri Bili Eyes 0.5.2

## 功能简介

本人私聊分享B站视频链接、BV或QQ JSON卡片后，HDS先按原人设回应准备去看看；开场回执确认后才读视频资料。HDS基于资料生成内存预回复，默认随机等待30–90秒；追问可提前发送，未就绪的追问静默合并为就绪后立即发送。默认不重复回卡，无独立模型或站内写入，并非真实音视频播放。

## 最新更新

0.5.2新增watchPacing=true、waitMinSec=30、waitMaxSec=90、taskTimeoutSec=180。倒计时从预回复就绪后开始。关闭watchPacing恢复即时读取后回复；autoReadShared=false关闭自动分享识别。

依赖主插件0.7.2与HDS rc57兼容接口。仅本人私聊，群聊、其他人、代码/引用/合并转发、旧命令、无目标聊天不读。多视频不猜一个；同视频合并，新视频替换旧任务，取消/重启不重放。关联追问不另开HDS回合，其他聊天正常；复杂隐含追问不保证识别。

原atriBiliEyes.watch/readDiscussion服务保留。全部管理指令、安装和验收见根README，不能将/bili发在SSH。只用已授权的HDS模型，不另填Key/人设；保护会话与旧数据。

## Atri 子项目与 HDS 的关系

本项目是 **Atri 项目的子项目**，属于非官方扩展，不是独立聊天核心，也不属于 HDS 官方发行。

- [HDS-Interlude](https://github.com/ISEKAI-MomoiCore/HDS-Interlude) 是剧情、人设、关系、记忆和叙事发送链路的基础；各插件只在各自职责范围内接入，不打包或替代 HDS 核心。HDS 自身许可保持不变。
- [Atri Bili](https://github.com/kf15884/atri-bili-plugins)：只读视频资料、HDS 观看节奏和 QQ 卡片。
- [Atri Album](https://github.com/kf15884/atri-album)：剧情拍照、异步生成、看照片与相册回忆。
- [Atri Journal Dreams](https://github.com/kf15884/atri-journal-dreams)：按剧情主要睡眠生成私有日记与梦境。
- [旧 Atri Diary](https://github.com/kf15884/koishi-plugin-atri-diary) 是另一个包名与工作流；本次不覆盖它，也不自动迁移数据。
