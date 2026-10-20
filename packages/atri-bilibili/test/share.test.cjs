'use strict'
const {test}=require('node:test'),assert=require('node:assert/strict'),{h}=require('koishi')
const {collect,inspect,route,wantsCard,resolveShort}=require('../share')
const {createBridge}=require('../chat-cards')
const BV='BV1ZKJb68EjZ'
const mini=JSON.stringify({app:'com.tencent.miniapp_01',meta:{detail_1:{appid:'1109937557',title:'哔哩哔哩',desc:'猫猫合集',qqdocurl:'https://b23.tv/AbCd12?share_medium=android&share_source=qq'}}})
const news=JSON.stringify({app:'com.tencent.structmsg',meta:{news:{title:'猫猫合集',tag:'哔哩哔哩',jumpUrl:'https://www.bilibili.com/video/'+BV+'?share_source=qq'}}})
const sess=elements=>({elements,content:elements.map(String).join('')})
test('QQ小程序转发解析出短链与标题，JSON不算用户文字',()=>{const i=collect(sess([h('json',{data:mini})]));assert.equal(i.shared,true);assert.equal(i.card,true);assert.deepEqual(i.shorts,['AbCd12']);assert.equal(i.title,'猫猫合集');assert.equal(i.text,'')})
test('结构化分享链接直接取BV',()=>{const i=collect(sess([h('json',{data:news}),h.text('你看看')]));assert.deepEqual(i.bvids,[BV]);assert.equal(i.text,'你看看')})
test('非B站JSON卡片不当作视频分享',()=>{const i=collect(sess([h('json',{data:JSON.stringify({app:'com.tencent.music',meta:{music:{jumpUrl:'https://y.qq.com/x'}}})})]));assert.equal(i.shared,false)})
test('普通求推荐不是分享',()=>{assert.equal(collect(sess([h.text('推荐个B站视频给我')])).shared,false)})
test('索要卡片识别与否定',()=>{for(const t of ['卡片发我','把链接发给我','把这个视频发给我','回我个小程序卡片'])assert.ok(wantsCard(t),t);for(const t of ['看看这个','你觉得怎么样','不要发卡片','别回链接'])assert.ok(!wantsCard(t),t)})
test('短链解析丢弃跟踪参数、只跟一跳且只认官方视频页',async t=>{const old=global.fetch;t.after(()=>global.fetch=old);global.fetch=async(u,o)=>{assert.equal(u,'https://b23.tv/AbCd12');assert.equal(o.redirect,'manual');assert.equal(o.headers,undefined);return {status:302,headers:{get:()=>'https://m.bilibili.com/video/'+BV+'?p=1'}}};assert.equal(await resolveShort('https://b23.tv/AbCd12?share_source=qq'),BV);global.fetch=async()=>({status:302,headers:{get:()=>'https://evil.example/video/'+BV}});assert.equal(await resolveShort('AbCd12'),'');assert.equal(await resolveShort('https://evil.example/AbCd12'),'')})
function exec(){const calls=[];return {calls,run:async(s,input,opts)=>{calls.push({input,opts});return ''}}}
test('独立模式：转发小程序只评论，带分享BV，不让选片换视频',async()=>{const ind=exec(),sent=[];const r=await route(sess([h('json',{data:mini})]),{independent:ind,send:t=>sent.push(t),resolve:async c=>{assert.equal(c,'AbCd12');return BV}});assert.equal(r.kind,'shared');assert.equal(ind.calls[0].opts.bvid,BV);assert.equal(ind.calls[0].opts.shared,true);assert.equal(ind.calls[0].opts.card,false);assert.match(ind.calls[0].input,/转发了一个B站视频给你：猫猫合集/);assert.equal(sent.length,0)})
test('独立模式：转发并要卡片才带card=true',async()=>{const ind=exec();await route(sess([h('json',{data:news}),h.text('卡片发我')]),{independent:ind,send:()=>{}});assert.equal(ind.calls[0].opts.card,true)})
test('独立模式：短链解析失败如实说，不调用执行器',async()=>{const ind=exec(),sent=[];const r=await route(sess([h('json',{data:mini})]),{independent:ind,send:t=>sent.push(t),resolve:async()=>''});assert.equal(r.kind,'unresolved-share');assert.equal(ind.calls.length,0);assert.equal(sent.length,1)})
test('独立模式：求推荐走选片（无分享BV），普通聊天和指令交给HDS',async()=>{const ind=exec();assert.equal((await route(sess([h.text('推荐个B站视频给我')]),{independent:ind,send:()=>{}})).kind,'requested');assert.equal(ind.calls[0].opts,undefined);assert.equal((await route(sess([h.text('今天好累')]),{independent:ind,send:()=>{}})).handled,false);assert.equal((await route(sess([h.text('bili.history')]),{independent:ind,send:()=>{}})).command,true)})
test('独立模式：贴BV文字也按分享只评论',async()=>{const ind=exec();await route(sess([h.text('看看 '+BV)]),{independent:ind,send:()=>{}});assert.equal(ind.calls[0].opts.shared,true);assert.equal(ind.calls[0].opts.card,false)})
// HDS-mode bridge: forwarded video is not carded back unless requested.
const config={platform:'onebot',selfId:'1000000002',targetUserId:'1000000001'}
function bridge(t){const events={},calls=[];const ctx={on(e,f){events[e]=f},middleware(f){events.middleware=f}};const bot={internal:{async _get(action){calls.push(action);return require('./miniapp-fixture.json').response}}};const b=createBridge(ctx,{...config,workflow:'hds'},{bili:{detail:async()=>({bvid:BV,title:'t',pic:'https://i0.hdslb.com/a.jpg'})},allowed:s=>s.userId===config.targetUserId});t.after(()=>events.dispose());return {events,calls,bot,b}}
const incoming=elements=>({...sess(elements),userId:config.targetUserId,platform:'onebot',selfId:config.selfId,isDirect:true,send:async()=>{}})
const outgoing=(f,text)=>({platform:'onebot',selfId:config.selfId,channelId:'private:'+config.targetUserId,bot:f.bot,elements:[h.text(text)]})
test('HDS模式：用户转发的视频，Atri回复提到同一BV不回发卡片',async t=>{const f=bridge(t);await f.events.middleware(incoming([h('json',{data:news})]),async()=>{});const s=outgoing(f,'这个我看了 '+BV);await f.events['before-send'](s);assert.equal(s.elements.length,1);assert.equal(f.calls.length,0)})
test('HDS模式：未转发过的视频（主动推荐）照常变卡片',async t=>{const f=bridge(t);const s=outgoing(f,'给你看这个 '+BV);await f.events['before-send'](s);assert.equal(s.elements.at(-1).type,'onebot:json')})
test('HDS模式：转发后明确索要，回复变卡片',async t=>{t.mock.timers.enable({apis:['setTimeout']});const f=bridge(t);await f.events.middleware(incoming([h('json',{data:news})]),async()=>{});await f.events.middleware(incoming([h.text('把这个视频链接发给我')]),async()=>{});const s=outgoing(f,BV);await f.events['before-send'](s);assert.equal(s.elements.at(-1).type,'onebot:json')})
