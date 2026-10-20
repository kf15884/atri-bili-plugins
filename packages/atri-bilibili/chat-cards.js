'use strict'
const {h}=require('koishi')
const {onebot}=require('./cards')
const {buildMiniAppRequest,parseMiniAppResponse}=require('./miniapp')
const shares=require('./share')
const BV=/BV1[0-9A-Za-z]{9}(?![0-9A-Za-z])/g
function outboundScope(s,c){return s && s.platform===c.platform && (!c.selfId || String(s.selfId)===String(c.selfId)) && !s.guildId && !s.event?.guild?.id && (s.isDirect!==false) && [String(c.targetUserId),'private:'+c.targetUserId].includes(String(s.channelId))}
function requestText(text){if(/不要|不用|不需要|不想|别发|别给|别再|别推荐|停止|暂停/.test(text))return false;return /(?:发|给|分享|推荐|要|找|返回|链接|卡片).{0,16}(?:B站|b站|哔哩|视频)|(?:B站|b站|哔哩|视频).{0,16}(?:发我|给我|链接|卡片|推荐)/i.test(text)}
function createBridge(ctx,config,{bili,allowed,autonomy=()=>null}){
  const pending=new Map(), timers=new Set(), forwarded=new Map();let disposed=false
  // Videos the user forwarded recently: HDS may talk about them, but they are
  // never turned back into a card unless the user explicitly asks for one.
  const FORWARD_TTL=2*3600*1000
  const remember=id=>{if(!id)return;forwarded.set(id,Date.now()+FORWARD_TTL);if(forwarded.size>50)forwarded.delete(forwarded.keys().next().value)}
  const isForwarded=id=>{const t=forwarded.get(id);if(t && t<Date.now()){forwarded.delete(id);return false}return !!t}
  const key=s=>`${s.platform}:${s.selfId}:${s.userId || s.channelId}`
  async function audit(s,content,metadata={}){try{const svc=ctx.interlude;if(!svc || typeof svc.findStory!=='function')return;const story=await svc.findStory(s);if(!story)return;const p=await svc.findParticipant(s,story);if(!p)return;await svc.serial(story.id,()=>svc.appendEntry(story.id,{kind:'web-observation',actor:'system',content,metadata:{source:'atri-bilibili-card-bridge',...metadata}},new Date(),p.id))}catch{/* do not log private content */}}
  async function rawPrepare(bot,bvid){const c=await bili.detail(bvid);const r=await onebot(bot,'send_pb',buildMiniAppRequest(c,config));// OneBot 6.9.5 encodes only onebot:json; bare json is silently skipped.
    return h('onebot:json',{data:JSON.stringify(parseMiniAppResponse(r?.data ?? r))})}
  async function prepare(bot,bvid){let timer;try{return await Promise.race([rawPrepare(bot,bvid),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('card-prepare-timeout')),10000)})])}finally{clearTimeout(timer)}}
  const resolveShort=raw=>shares.resolveShort(raw)
  async function transform(elements,bot,{requested=true}={}){let budget=3;async function walk(nodes){const out=[];for(const node of nodes){if(node.type==='text' && budget>0){const text=String(node.attrs?.content || '');const found=text.match(BV)||[]
      for(const short of (text.match(/https:\/\/b23\.tv\/[A-Za-z0-9]{3,40}/g)||[]).slice(0,budget)){if(!requested && isForwarded('short:'+short.slice(15)))continue;try{const id=await resolveShort(short);if(id)found.push(id)}catch{}}
      const ids=[...new Set(found)].filter(id=>requested || !isForwarded(id)).slice(0,budget);budget-=ids.length
      if(ids.length){out.push(node);for(const id of ids){try{out.push(await prepare(bot,id))}catch{ // Preserve original URL / BV if card generation fails; never drop the reply.
        if(!text.includes('https://www.bilibili.com/video/'+id))out.push(h.text('\nhttps://www.bilibili.com/video/'+id))
      }}continue}}
    if(!['json','onebot:json'].includes(node.type) && node.children?.length)node.children=await walk(node.children);out.push(node)}return out}return walk(elements)}
  ctx.on('before-send',async session=>{if(disposed || config.chatCardBridge===false || !outboundScope(session,config))return
    const elements=session.elements || [];if(!/BV1[0-9A-Za-z]{9}|https:\/\/b23\.tv\//.test(elements.map(String).join('')))return
    let requested=false
    for(const [k,r] of pending)if(r.session.platform===session.platform && String(r.session.selfId)===String(session.selfId) && String(r.session.userId)===String(config.targetUserId)){r.fulfilled=true;requested=true;pending.delete(k)}
    session.elements=await transform(elements,session.bot,{requested})
  })
  ctx.middleware?.(async(session,next)=>{if(allowed(session)){const info=shares.collect(session);for(const id of info.bvids)remember(id);for(const sh of info.shorts){remember('short:'+sh);shares.resolveShort(sh).then(remember,()=>{})}}
    if(config.workflow==='independent')return next();const text=shares.textOf(session.elements||[]) || (session.elements?.length?'':String(session.content||''));if(allowed(session))pending.delete(key(session));if(!allowed(session) || /^\s*(?:bili\b|eyes\b|interlude\b|看视频)/i.test(text) || !requestText(text))return next()
    const k=key(session), rec={session,at:Date.now(),fulfilled:false};pending.set(k,rec)
    // HDS remains the owner of ordinary replies. A bounded, user-requested
    // fallback reports failure instead of silently returning nothing.
    const timer=setTimeout(async()=>{timers.delete(timer);if(disposed || pending.get(k)!==rec || rec.fulfilled)return
      const ids=[...new Set(text.match(BV)||[])];let journal=[];try{journal=await autonomy()?.journal?.() || []}catch{}
      let ownerId=''
      try{const svc=ctx.interlude;const st=await svc?.findStory(session);const p=st && await svc.findParticipant(session,st);ownerId=p?.id || ''}catch{}
      const bvid=ids[0] || journal.find(r=>r.bvid && (!r.participantId || r.participantId===ownerId))?.bvid
      if(disposed || pending.get(k)!==rec || rec.fulfilled)return;pending.delete(k)
      try{if(bvid){await session.send([h.text('你要的视频：\nhttps://www.bilibili.com/video/'+bvid)]);await audit(session,`应用户索要视频，已通过 QQ 发出 ${bvid}；卡片是否显示需用户确认。`,{bvid,status:'sent'})}
        else {await session.send('这次还没有选定可返回的视频，不能把搜索候选说成已经看过。可用 bili.history 查看选片进度，或直接给我 BV 号。');await audit(session,'用户索要视频，但尚无已确认选片，已如实告知。',{status:'no-video'})}
      }catch{await audit(session,'应用户索要视频的投递未得到成功回执，未自动重复发送。',{status:'unknown'})}
    },45000);timer.unref?.();timers.add(timer);return next()
  },true)
  ctx.on('dispose',()=>{disposed=true;for(const t of timers)clearTimeout(t);pending.clear()})
  return {transform,prepare,isForwarded}
}
module.exports={createBridge,outboundScope,requestText}
