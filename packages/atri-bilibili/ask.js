"use strict";
// Recognise only an explicit private request for Atri to send a video. Pure and bounded.
const VERB = "(?:有没有|有木有|有啥|有什么|来(?:点|个|几个|一个|些)|整(?:点|个|几个)|找(?:点|个|一个|几个)|推荐|推(?:个|一个|点|几个)|分享(?:个|一个|点|几个)?|发(?:个|一个|点|几个|些|我|给我)|丢(?:个|一个|我)|甩(?:个|一个|我)|安利)";
const ASK = new RegExp(VERB + "([^。！？!?\\n]{0,16}?)(?:视频|片子|[Bb]站)");
// "把视频发我" / "视频发我看看" / "发我个视频" / "给我发个视频"
const ASK2 = /(?:^|[你就快先那])(?:把|将)?(?:(?:个|一个|几个|点)?([^。！？!?\n]{0,10}?)(?:视频|片子))(?:发|丢|甩|分享|推)(?:给)?我|(?:给我|跟我)(?:发|分享|推荐|推|丢|甩)(?:个|一个|点|几个|些)?([^。！？!?\n]{0,10}?)(?:视频|片子)/;
const SKIP = /https?:|BV1[A-Za-z0-9]{9}|```|\/bili|[<>]/i;
const NEG = /不要|别发|别推|不用|不需要|算了|不想看|没空看/;
const OTHER = /(?<![给发帮])我(?:发|分享|推荐|给你|转)|(?:你|刚才|上次|之前|那个|这个|这条)(?:发|分享|推荐)?的视频|视频.{0,6}(?:看了没|看完|怎么样|讲了|内容|好看吗)/;
// Time/politeness words are not topics ("你现在把视频发我" must not search 「现在」).
const FILLER = /现在|马上|立刻|立即|赶紧|赶快|快点|一下|今天|今晚|晚上|刚才|刚刚|随便|随手|能不能|可不可以|可以|试试|帮忙|帮我|麻烦|一条|一部|一会儿?|等下|顺便|还是|就是|要不/g;
const EDGE = /^[先再就也还都要想去让请帮给条部吗嘛呗哦喔嗯了]+|[先再就也还都要想去让请帮给条部吗嘛呗哦喔嗯了]+$/g;
function askVideo(text) {
  text = String(text || "").trim();
  if (!text || text.length > 60 || SKIP.test(text) || NEG.test(text) || OTHER.test(text)) return null;
  let m = ASK.exec(text) || /[Bb]站(?:上)?(?:有没有|有什么|有啥)()(?:好看|有趣|好玩|有意思)?/.exec(text);
  if (!m) { const k = ASK2.exec(text); if (k) m = [k[0], k[1] || k[2] || ""]; }
  if (!m) return null;
  const query = String(m[1] || "")
    .replace(/把|将|那|这|关于|有关|相关|什么|啥|好看|有趣|好玩|有意思|新的|最近|平时|一些|几个|一个|给我|发我|给你|看看|在看|在刷|刷到|刷的|看过|看的|收藏|喜欢|觉得|我|你|的|个|点|些|呀|啊|吧|呢|看|刷|[，,、\s~～]/g, "")
    .replace(FILLER, "")
    .replace(EDGE, "")
    .slice(0, 12);
  return { query };
}
// Short follow-ups that only make sense right after an ask ("再发一次", "挑好了吗", "视频呢").
const FOLLOW = /再(?:试|发|来|找|给)|发(?:给我|我|过来|来|了(?:吗|没|么))|(?:卡片|链接)|(?:挑|找|选)(?:好|到)?了?(?:吗|没|么)|(?:视频|片子)呢|还没(?:发|好|找)|怎么(?:还)?没(?:发|动静)|(?:好了|找到了)(?:吗|没|么)/;
function askFollowup(text) {
  text = String(text || "").trim();
  if (!text || text.length > 24 || SKIP.test(text) || NEG.test(text) || OTHER.test(text)) return false;
  return FOLLOW.test(text);
}
// Video/card talk in a turn that has no video in hand: HDS must not pretend it sent one.
// "再发一个/再来一个/换一个": another ask with the same topic, right after one finished.
const AGAIN = /^(?:那|你)?(?:再(?:发|来|找|给|推|整)(?:我)?(?:一?个|一条|一次|几个|点)?|换(?:一?个|一条))(?:视频|呗|吧|嘛|啊|呀|看看|试试)?[\s，,。.!！?？~～]*$/;
function askAgain(text) {
  text = String(text || "").trim();
  return !!text && text.length <= 16 && !NEG.test(text) && AGAIN.test(text);
}
const VIDEOISH = /视频|片子|卡片|[Bb]站|链接|发了(?:吗|没|么)|看这个|发过来|发给我|再发|挑好|找到了/;
module.exports = { askVideo, askFollowup, askAgain, VIDEOISH };
