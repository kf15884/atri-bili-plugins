# Atri Bili 双插件库

**双插件、单仓库**：用于 HDS 联动的 B 站功能扩展，不会把两个插件合并成一个运行实例。

## 上游与许可

本项目基于 [HDS-Interlude](https://github.com/ISEKAI-MomoiCore/HDS-Interlude) 的扩展接口开发，是**非官方插件**，不代表 HDS 作者或项目官方。感谢 HDS 作者提供框架与扩展支持。

经发布者确认，已取得 HDS 作者允许，本仓库两个插件以 [MIT](LICENSE) 发布。该许可不改变 HDS-Interlude 自身的 AGPL-3.0 许可，也不授予对上游名称或标识的额外权利。第三方组件详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 当前组成

| 插件 / 模块 | 版本 | 职责 |
| --- | --- | --- |
| `koishi-plugin-atri-bilibili` | 0.5.6 干净分发版 | 账号、候选、选片、独立 API、HDS 桥接、回复、卡片和写操作审计 |
| `koishi-plugin-atri-bili-eyes` | 0.3.0 | 视频元信息、字幕、评论、弹幕、可选画面抽样和资料缓存 |
| account / social | 随主插件 | 扫码/Cookie 登录、账号状态；按开关执行互动并记录结果 |
| independent / autonomy | 随主插件 | 独立 API 执行器 / 原 HDS 意图执行器 |
| cards / miniapp / chat-cards | 随主插件 | QQ 原生小程序卡片生成、对话视频转卡片、失败链接回退 |
| share | 随主插件 | 识别你转发的 QQ 小程序/分享卡片、b23 短链、B站链接和 BV |
| research | 随主插件 | 公开网页读取（服务器实际取得后交给现有独立 API） |

后几行是主插件内部模块，**不是额外需要安装的插件**。HDS 核心、QQ 协议端和其他表情/回忆插件不在本库。

## 当前行为（0.5.6）

- **卡片策略**：Atri 主动推荐、你向她要视频（她自己选片）时，回复后单独发一张 QQ 原生卡片。你转发视频给她时只评论，不回发卡片或链接；转发时明确说“卡片发我/把链接发给我”才发。`bili.card` 手动测试照旧。HDS 模式的卡片桥同样不把 2 小时内你转发过的视频转回卡片。
- **回复格式**：正文只按 HDS 分隔符设置分条，标点、空格、语气保持模型原样，逐条使用 HDS 打字时延；模型参照 HDS 规则和 Atri 近期真实消息的格式习惯。万一需要固定降级句，也按近期消息的空格/句尾习惯改写。
- **视频资料**：`videoMaterial` 默认 `meta-discussion`，只用标题、简介、标签等元信息加弹幕和热门评论形成回复思路；字幕与画面抽样不交给模型、不写入记忆。设为 `all` 恢复旧行为。
- **综合感想**：`singleSummaryReply` 默认开启，把资料放在一起说一次简短感想，不按来源逐项回答；只约束内容，不改格式。
- **公开网页**：`webReadEnabled` 默认关闭；开启后 `bili.web <网址>` 由服务器读取公开 HTTPS 页面，再用现有独立 API 解读。只读你给的网址，不是搜索引擎；不跟随跳转、不带 Cookie/Key、限大小与时长。旧 DeepSeek 专用搜索已移除。
- **稳健性**：模型 JSON 容忍思考块/代码块/前言；证据校验最多修正一次；降级原因写进 `bili.history`；未知投递不重发；源剧情删除、暂停、取消、账号变化即停止。
- **独立 API**：支持 OpenAI Chat Completions / Anthropic Messages 兼容的完整 HTTPS 地址；需显式授权共享限定的 HDS 人设、本人关系和近期剧情。
- **剧情记忆**：通过 HDS 接口保存请求、实际读取、模型感想和实际发送结果；不直接改 SQL 或清库。
- **账号互动**：点赞/取消赞、投币、三连、收藏/取消收藏、关注/取关、公开评论、发文字动态/删除本插件创建的动态。各写开关默认关闭；投币、三连、删动态始终需本人确认。**independent 模式不执行公开写操作**。
- 搜索候选不等于已看；读取是文字资料（及可选画面抽样），不是全片播放或伪造完播。独立模式不写 B 站播放历史。

## 目录

```
packages/atri-bilibili/   主插件源码及单元测试
packages/atri-bili-eyes/  眼镜源码及单元测试
qa/                      HDS/SQLite 联动、OneBot 编码器测试与网络拦截
scripts/                 打包、干净库检查
docs/                    配置、更新记录、模块索引、排查、清理范围、验证说明
dist/                    运行 npm run pack 后生成，不入 Git
```

## 开发与打包

要求 Node >=20（验证环境 Node 24），兼容基线 Koishi 4.18.11 / HDS 1.0.1-rc57 / OneBot 适配器 6.9.5。

```bash
npm install --ignore-scripts --no-audit --no-fund
npm test
npm run check:clean
npm run pack
```

本库不含 node_modules 或 HDS 包；依赖未附统一锁文件，首次解析结果需自行审查。`npm test` 使用 mock/临时目录，不访问真实账号。`npm run pack` 生成两个本地 tgz；安装仍在原 Koishi 工程中进行，保留原实例与配置。本库不附服务器升级/回退脚本。

## 数据与安全

不含运行 data、数据库、观看/评论/动态记录、聊天、人设剧情、Cookie、API Key、二维码会话、日志、备份或服务器访问配置。主插件 targetUserId、selfId 默认清空；测试使用虚构 ID 与公共示例视频。

**只整理交付副本，未操作任何云服务器或 HDS 数据。** 不要为了“清理”删除生产防重复账本。

## 发布与测试范围

- 安装包在仓库 Releases 中提供；`dist/` 不提交到 Git。下载后可用 Release 附件 `SHA256SUMS` 校验。
- GitHub Actions 执行单元测试、文件范围检查与打包；不会连接真实 B 站账号或生产 HDS。
- `npm run test:integration` 另需 HDS、SQLite、HTTP 与 OneBot 适配器测试依赖，未纳入默认 CI。
- 本次 GitHub 发布不包含 npm 市场发布，不会向 Koishi 市场自动上架。
