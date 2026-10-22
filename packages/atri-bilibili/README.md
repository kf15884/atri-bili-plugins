# Atri Bilibili 0.7.3

0.7.3新增“要视频”：本人私聊说“有没有好看的视频发我看看”“发个猫猫视频”等，插件先读取候选交给HDS；发不发由HDS按剧本状态与人设决定。发则先发QQ视频卡片，停顿cardGapMinSec–cardGapMaxSec秒（默认2–5）后按HDS原分段发她的话；不发就按人设回应、不放链接。askEnabled可关闭。

## 功能简介

只读B站API、真实HDS叙事桥接、QQ原生小程序推荐。配合眼镜0.5.2，可在本人分享视频时先由HDS回应，确认开场送达后读取并生成预回复，再随机等待或追问提前发。原主动推荐和/bili pick不改为入站观看倒计时。

## 最新更新

0.7.2新增观看任务pace.js。开场绑定原输入和HDS已确认剧本；草稿仅内存，正式投递才进入HDS持久化/发送链路。保留人设、分段、权限、暂停、会话和旧数据；互斥发送、超时、任务替换和重启不重放。无独立模型、站内写操作或真实音视频播放。部署、参数、限制和测试见根README。

## Atri 子项目与 HDS 的关系

本项目是 **Atri 项目的子项目**，属于非官方扩展，不是独立聊天核心，也不属于 HDS 官方发行。

- [HDS-Interlude](https://github.com/ISEKAI-MomoiCore/HDS-Interlude) 是剧情、人设、关系、记忆和叙事发送链路的基础；各插件只在各自职责范围内接入，不打包或替代 HDS 核心。HDS 自身许可保持不变。
- [Atri Bili](https://github.com/kf15884/atri-bili-plugins)：只读视频资料、HDS 观看节奏和 QQ 卡片。
- [Atri Album](https://github.com/kf15884/atri-album)：剧情拍照、异步生成、看照片与相册回忆。
- [Atri Journal Dreams](https://github.com/kf15884/atri-journal-dreams)：按剧情主要睡眠生成私有日记与梦境。
- [旧 Atri Diary](https://github.com/kf15884/koishi-plugin-atri-diary) 是另一个包名与工作流；本次不覆盖它，也不自动迁移数据。
