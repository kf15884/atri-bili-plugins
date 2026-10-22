# 0.8.3分工版增量适配

- 输入为用户提供的Atri_Bili_API_0.8.3_分工版.zip，主插件0.8.3、eyes0.6.0；不是从旧0.7.8/0.7.9回填整文件。
- 最终主插件0.8.4-beta.1，eyes0.6.1-beta.1。眼镜JS与输入逐字节一致，只更新版本/peer兼容声明及README；主插件hds.js与输入逐字节一致，保留B站浏览交接、链接转卡和主人视频不回卡逻辑。
- 新增background.js；recommend.js的后台挑选/判断/润色进入共用模型通道，超时不强行调用；pace.js的感想生成与投递检查主叙事、暂停、原生分段，并保留投递单次抢占保护。排队后重新读取近期对话。
- config.js移除个人内网服务默认地址。启用framesEnabled时必须显式填写原framesUrl；不自动重写配置。
- index.js仅更新Console说明。保留原189项测试，添加6项协调/取消/超时边界测试；旧断言仅适配版本、显式地址及测试宿主方法。忙碌用例改为手动投递，避免零延迟自动发送抢过等待状态断言，不放宽忙碌失败条件。
- 照片库、日记、Search与可选HDS源码相对Beta1逐字节不变。原生产目录、数据库、人设、演化、登录、观看库与预备视频未导入本地工程。
- 安装仍仅主服务器；默认五个Atri插件，HDS可选，第二台不升级。替代上一份整合Beta1，不再使用其中的Bili0.7.9-beta.1。

## 相对输入的变更文件

- `packages/atri-bili-eyes/README.md`
- `packages/atri-bili-eyes/package.json`
- `packages/atri-bilibili/README.md`
- `packages/atri-bilibili/background.js`
- `packages/atri-bilibili/config.js`
- `packages/atri-bilibili/index.js`
- `packages/atri-bilibili/pace.js`
- `packages/atri-bilibili/package.json`
- `packages/atri-bilibili/recommend.js`
- `packages/atri-bilibili/test/background-084.test.cjs`
- `packages/atri-bilibili/test/hds-integration.test.cjs`
- `packages/atri-bilibili/test/pace-ack.test.cjs`
- `packages/atri-bilibili/test/pace-integration.test.cjs`
- `packages/atri-bilibili/test/pace.test.cjs`
- `packages/atri-bilibili/test/senses.test.cjs`
- `packages/atri-bilibili/test/watch.test.cjs`
