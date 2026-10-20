'use strict'
// Incoming video-share parsing. Pure and network-free except resolveShort,
// which follows exactly one b23.tv redirect to an official video URL.
const BV=/BV1[0-9A-Za-z]{9}(?![0-9A-Za-z])/g
const SHORT=/https?:\/\/b23\.tv\/([A-Za-z0-9]{3,40})/g
const BILI_APPID='1109937557'
function walkJson(value,out,depth=0){
  if(out.length>=200 || depth>8)return
  if(typeof value==='string'){out.push(value.slice(0,2000));return}
  if(Array.isArray(value)){for(const v of value)walkJson(v,out,depth+1);return}
  if(value && typeof value==='object')for(const v of Object.values(value))walkJson(v,out,depth+1)
}
function parseCard(raw){
  let data;try{data=typeof raw==='string'?JSON.parse(raw):raw}catch{return null}
  if(!data || typeof data!=='object')return null
  const strings=[];walkJson(data,strings)
  const d=data.meta?.detail_1, n=data.meta?.news
  const bili=String(d?.appid||'')===BILI_APPID || strings.some(s=>/bilibili\.com|b23\.tv|哔哩哔哩/.test(s))
  const title=String((d && String(d.appid||'')===BILI_APPID?d.desc:'') || n?.title || d?.desc || '').replace(/\s+/g,' ').trim().slice(0,160)
  return {bili,strings,title}
}
function textOf(elements){
  // Only real text nodes; JSON/XML card payloads never count as user wording.
  const out=[];(function walk(nodes){for(const node of nodes||[]){if(!node)continue;if(node.type==='text')out.push(String(node.attrs?.content||''));else if(!['json','onebot:json','xml'].includes(node.type))walk(node.children)}})(elements)
  return out.join('').trim()
}
function collect(session){
  const elements=Array.isArray(session?.elements)?session.elements:[]
  const text=elements.length?textOf(elements):String(session?.content||'').replace(/<[^>]*>/g,'').trim()
  const sources=[text], cards=[]
  ;(function walk(nodes){for(const node of nodes||[]){if(!node)continue;if(['json','onebot:json'].includes(node.type)){const c=parseCard(node.attrs?.data);if(c){cards.push(c);if(c.bili)sources.push(...c.strings)}}else walk(node.children)}})(elements)
  const joined=sources.join('\n')
  const bvids=[...new Set(joined.match(BV)||[])].slice(0,3)
  const shorts=[...new Set([...joined.matchAll(SHORT)].map(m=>m[1]))].slice(0,3)
  const card=cards.find(c=>c.bili)
  return {text,bvids,shorts,card:!!card,title:card?.title||'',shared:!!(bvids.length || shorts.length || card)}
}
async function resolveShort(raw){
  let u;try{u=new URL(/^https?:\/\//.test(raw)?raw:'https://b23.tv/'+raw)}catch{return ''}
  if(u.hostname!=='b23.tv' || u.port || u.username || u.password || !/^\/[A-Za-z0-9]{3,40}$/.test(u.pathname))return ''
  // Share tracking query parameters are dropped; never follow a second hop.
  const r=await fetch('https://b23.tv'+u.pathname,{method:'HEAD',redirect:'manual',signal:AbortSignal.timeout(5000)})
  if(![301,302,303,307,308].includes(r.status))return ''
  let to;try{to=new URL(r.headers.get('location'),'https://b23.tv')}catch{return ''}
  if(to.protocol!=='https:' || !['www.bilibili.com','bilibili.com','m.bilibili.com'].includes(to.hostname) || to.port || to.username || to.password)return ''
  return /^\/video\/(BV1[0-9A-Za-z]{9})\/?$/.exec(to.pathname)?.[1] || ''
}
async function inspect(session,{resolve=resolveShort}={}){
  const info=collect(session);let bvid=info.bvids[0]||''
  for(const s of info.shorts){if(bvid)break;try{bvid=await resolve(s)}catch{}}
  return {...info,bvid}
}
// The user explicitly asks to get the video card/link back.
function wantsCard(text){
  text=String(text||'')
  if(/不要|不用|不需要|别发|别给|别回|无需/.test(text))return false
  return /(?:发|给|回|返回|分享|转|甩)(?:我|给我|一下|过来|回来)?.{0,8}(?:卡片|链接|小程序|地址)|(?:卡片|链接|小程序|地址).{0,6}(?:发我|给我|发一下|发过来|发回来)|(?:把|将)(?:这个|那个|刚才|上面)?的?视频.{0,6}(?:发|给)(?:我|回来|过来)/.test(text)
}
// Independent-mode private-message routing.
//  - forwarded/pasted video  -> comment only (card only if explicitly asked)
//  - asking her for a video  -> she picks one and sends the card
//  - everything else         -> HDS ordinary chat
async function route(session,{independent,send,resolve}={}){
  const info=collect(session), content=info.text
  if(/^(?:bili\b|eyes\b|interlude\b|看视频)/i.test(content))return {handled:false,command:true,text:content}
  const negative=/不要|不用|不需要|别发|别给|别推荐|停止|暂停/.test(content)
  const missing=()=>send('独立执行器尚未连接 HDS、眼镜或数据库。')
  if(info.shared && !negative){
    if(!independent){await missing();return {handled:true,kind:'unavailable'}}
    const found=await inspect(session,resolve?{resolve}:undefined)
    // Never let the planner pick a different video for an unresolved share.
    if(!found.bvid){await send('这个分享我没认出是哪个视频 发BV号给我吧');return {handled:true,kind:'unresolved-share'}}
    const request=(info.card?'我转发了一个B站视频给你'+(found.title?'：'+found.title:'')+' '+found.bvid:'')+(content?(info.card?'\n我说：':'')+content:'')
    const result=await independent.run(session,request || found.bvid,{bvid:found.bvid,shared:true,card:wantsCard(content)})
    if(result)await send(result);return {handled:true,kind:'shared',bvid:found.bvid}
  }
  const requested=!negative && (/B站|b站|哔哩/i.test(content) || /推荐.{0,12}视频|视频.{0,12}(?:链接|卡片|发给我)/.test(content))
  if(requested){if(!independent){await missing();return {handled:true,kind:'unavailable'}};const result=await independent.run(session,content);if(result)await send(result);return {handled:true,kind:'requested'}}
  return {handled:false,text:content}
}
module.exports={route,collect,inspect,resolveShort,wantsCard,parseCard,textOf,BILI_APPID}
