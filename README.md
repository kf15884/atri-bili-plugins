# atri-bili-plugins 0.8.4-beta.1

Atri子项目，配合[HDS-Interlude](https://github.com/ISEKAI-MomoiCore/HDS-Interlude)的人设、故事、记忆和原生投递；不是HDS官方，不另建人格。

## 本次更新

以用户最新0.8.3分工版增量适配：保留挑选→观看→卡片→推荐话、预备视频及B站浏览交接；后台模型统一让位，排队后刷新对话。配套eyes0.6.1-beta.1基于0.6.0，运行JS不变，仅更新版本与Beta兼容声明。原189项回归及新增6项，195项分别在旧固定rc57与重建rc57通过。

## 安装与安全边界

这是可选Pre-release，保留原默认分支、稳定版本和旧Release，不执行npm发布。独立tgz供有经验的维护者使用；推荐从[Bili本次Release](https://github.com/kf15884/atri-bili-plugins/releases/tag/v0.8.4-beta.1)下载完整`Atri_Pipeline_Optimization_Beta_2.zip`，按包内README及统一安装器操作。不要从本仓库抽取统一安装器单独运行，它依赖完整六个运行包和数据校验脚本。

- 只操作主服务器，第二台服务不更新。默认五个Atri插件，可选HDS官方源码重建包；后者不是上游官方发布，保留AGPL-3.0和对应源码。Atri插件自身沿用MIT。
- 照片库albumUrl需显式填写；Bili启用framesEnabled时framesUrl需显式填写；不要依赖旧版个人地址默认值。Token/Cookie沿用私有配置，不贴到聊天。
- 日记selfRecallRedecide建议关闭，recallBudget建议3200；已有显式true不会自动覆盖。
- 保留原插件实例，不清库、不重建故事、不清除overlay/人设演化，不重复追加功能开通人设。安装前停服备份及一致性校验；失败回退依赖，不用旧数据库覆盖新聊天。
- 用户已提供整合包安装成功与启动前数据一致性回执；Console加载、真实QQ投递、完整照片与睡眠周期仍待验收。不要为了公开发布重复安装。
- 模型、B站、QQ与搜索返回采用测试替身；本地通过不等于生产联网验收。共享协调与组合12项、五种升级/回退模拟通过，详见VALIDATION.md及JSON报告。

## 源码测试

依赖Koishi4.18.11/SQLite4.7.0/HTTP0.6.3及已授权固定HDS rc57运行包。rc57并非公共npm可直接安装的版本；不要用npm latest替代或宣称远程CI已通过。真实HDS集成测试需本地具备对应依赖，可用`ATRI_HDS_MODULE`指定固定运行文件（具体测试入口以源码为准）。Bili新增协调测试在独立源码树使用qa下逐字节相同的协调器副本，仅调整测试导入路径，不改变运行tgz。

源码ZIP、运行tgz与SHA256SUMS见本Release。公开包不含生产数据、账号、Key、Token、Cookie、参考图或私有备份；已知个人地址清理，合成测试夹具不代表用户账号。
