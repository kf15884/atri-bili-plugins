# koishi-plugin-atri-bili-eyes 0.3.0

读取视频元信息、字幕样本、热门评论和弹幕时间线，区分正文与网友讨论，返回可用性和来源时间。

服务：`ctx.atriBiliEyes.watch`、`ctx.atriBiliEyes.readDiscussion`。命令：`看视频`、`eyes.status`、`eyes.clear`。

可选 `deepEnabled`：使用部署者已有 yt-dlp/ffprobe/ffmpeg 和显式配置的视觉 API 抽样分析画面。默认关闭，不下载执行工具、不进行全片连续播放或音轨转写。缓存按账号隔离；本源码库不包含任何缓存。

Cookie 留空可在进程内借用主插件账号。眼镜本身不执行点赞、投币、关注、评论、动态或 B 站播放历史写入。详见根目录功能表。
