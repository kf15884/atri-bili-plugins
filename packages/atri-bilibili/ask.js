"use strict";
// Recognise only an explicit private request for Atri to send a video. Pure and bounded.
const VERB = "(?:有没有|有木有|有啥|有什么|来(?:点|个|几个|一个|些)|整(?:点|个|几个)|找(?:点|个|一个|几个)|推荐|推(?:个|一个|点|几个)|分享(?:个|一个|点|几个)?|发(?:个|一个|点|几个|些|我|给我)|丢(?:个|一个|我)|甩(?:个|一个|我)|安利)";
const ASK = new RegExp(VERB + "([^。！？!?\\n]{0,16}?)(?:视频|片子|[Bb]站)");
const SKIP = /https?:|BV1[A-Za-z0-9]{9}|```|\/bili|[<>]/i;
const NEG = /不要|别发|别推|不用|不需要|算了|不想看|没空看/;
const OTHER = /(?<![给发帮])我(?:发|分享|推荐|给你|转)|(?:你|刚才|上次|之前|那个|这个|这条)(?:发|分享|推荐)?的视频|视频.{0,6}(?:看了没|看完|怎么样|讲了|内容|好看吗)/;
function askVideo(text) {
  text = String(text || "").trim();
  if (!text || text.length > 60 || SKIP.test(text) || NEG.test(text) || OTHER.test(text)) return null;
  const m = ASK.exec(text) || /[Bb]站(?:上)?(?:有没有|有什么|有啥)()(?:好看|有趣|好玩|有意思)?/.exec(text);
  if (!m) return null;
  const query = m[1]
    .replace(/关于|有关|相关|什么|啥|好看|有趣|好玩|有意思|新的|最近|一些|几个|一个|给我|发我|给你|看看|我|你|的|个|点|些|呀|啊|吧|呢|[，,、\s~～]/g, "")
    .slice(0, 12);
  return { query };
}
module.exports = { askVideo };
