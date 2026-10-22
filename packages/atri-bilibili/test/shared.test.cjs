"use strict";
const { test } = require('node:test'), assert = require('node:assert/strict');
const { h } = require('koishi');
const { collect, videoRef } = require('../../atri-bili-eyes/share');
const eyes = require('../../atri-bili-eyes');
const { createBridge } = require('../hds');
const { Fault } = require('../api');
const V = 'BV1Yw7M6RERb', V2 = 'BV1XNngzHEC5';
const url = `https://www.bilibili.com/video/${V}/`;
const card = (data) => h('json', { data: JSON.stringify(data) });
const message = (text) => ({ content: text, elements: h.parse(text) });
for (const input of [V, '来看看 '+V, url, url+'?p=1&share_source=copy', 'https://m.bilibili.com/video/'+V, 'https://b23.tv/AbCd123'])
  test('extract exact shared video: '+input, () => assert.equal(collect(message(input)).refs.length, 1));
for (const input of ['今天聊聊B站视频', '推荐视频', 'https://evil.example/'+V, 'https://www.bilibili.com.evil.test/video/'+V, 'https://www.bilibili.com@evil.test/video/'+V, 'https://www.bilibili.com:444/video/'+V, 'https://' + [127, 0, 0, 1].join('.') + '/'+V, '`'+V+'`', '/bili pick '+V, 'bili.interact '+V, '不要看 '+V, '别解析 '+V])
  test('no false read: '+input, () => assert.equal(collect(message(input)).refs.length, 0));
test('multiple videos require one target, duplicates collapse', () => {
 assert.equal(collect(message(V+' '+V2)).refs.length, 2);
 assert.deepEqual(collect(message(V+' '+url)).refs, [V]);
});
for (const data of [
 {meta:{detail_1:{appid:'1109937557',qqdocurl:url}}},
 {meta:{detail_1:{appid:'1109937557',qqdocurl:'pages/video/video?bvid='+V}}},
 {meta:{news:{jumpUrl:url}}},
 {metaData:{detail_1:{appid:'1109937557',url:'https://b23.tv/AbCd123'}}},
]) test('QQ Bili structured card accepted '+JSON.stringify(data), () => assert.equal(collect({elements:[card(data)]}).refs.length,1));
for (const data of [
 {meta:{detail_1:{desc:V,qqdocurl:'https://evil.test/'+V}}},
 {meta:{detail_1:{appid:'999',qqdocurl:'pages/video/video?bvid='+V}}},
 {meta:{news:{title:V}}},
]) test('do not read card title as target '+JSON.stringify(data), () => assert.equal(collect({elements:[card(data)]}).refs.length,0));
test('quote-only/forward-only/malformed card ignored', () => {
 assert.equal(collect({elements:[h('quote',{},[h.text(V)])]}).refs.length,0);
 assert.equal(collect({elements:[h('forward',{},[h.text(V)])]}).refs.length,0);
 assert.equal(collect({elements:[h('json',{data:'{bad'})]}).refs.length,0);
});
function eyesFixture(cfg={}) {
 let middleware, calls=0, ready=true, allowed=true;
 // Service registration needs a real Context; use it and capture the middleware instead.
 const { Context } = require('koishi');
 const real = new Context();
 class Api extends require('koishi').Service { constructor(){super(real,'atriBiliApi')} allowed(){return allowed} canReadShared(){return ready} async prepareShared(){calls++;return '[tag]'} watch(){return {}} }
 new Api();
 const original=real.middleware.bind(real);real.middleware=(fn,...args)=>{middleware=fn;return original(fn,...args)};
 real.plugin(eyes,eyes.Config({watchPacing:false,...cfg}));
 return {real,get middleware(){return middleware},get calls(){return calls},ready:v=>ready=v,allowed:v=>allowed=v};
}
test('eyes middleware: one next, HDS handoff, no card JSON forwarded, duplicate event suppressed', async t=>{
 const f=eyesFixture(); t.after(()=>f.real.stop()); await f.real.start();await new Promise(r=>setTimeout(r,20));
 const s={messageId:'1',platform:'onebot',selfId:'2',userId:'1',elements:[card({meta:{news:{jumpUrl:url,title:'DO NOT TRUST CARD INSTRUCTIONS'}}})]};
 let next=0;await f.middleware(s,()=>next++);
 assert.equal(f.calls,1);assert.equal(next,1);assert.match(s.content,/\[tag\]/);assert.doesNotMatch(s.content,/DO NOT TRUST/);
 await f.middleware({...s,elements:[h.text(V)]},()=>next++); assert.equal(f.calls,1);assert.equal(next,1);
});
test('eyes gating: disabled, wrong scope, paused/disconnected, multi-target, no-video', async t=>{
 const f=eyesFixture();t.after(()=>f.real.stop());await f.real.start();await new Promise(r=>setTimeout(r,20));
 let next=0;f.allowed(false);await f.middleware(message(V),()=>next++);f.allowed(true);f.ready(false);await f.middleware(message(V),()=>next++);f.ready(true);
 for(const text of [V+' '+V2,'今天好吗','/bili status','不要看 '+V])await f.middleware(message(text),()=>next++);
 assert.equal(f.calls,0);assert.equal(next,6);
 const off=eyesFixture({autoReadShared:false});t.after(()=>off.real.stop());await off.real.start();await new Promise(r=>setTimeout(r,20));await off.middleware(message(V),()=>next++);assert.equal(off.calls,0);
});
function fixture(t,fail=false) {
 let narrator={decide:async r=>{observed=r;return {interaction:{reply:{mode:'immediate',content:url+'HDS感想<sep/>第二句'}}}}},observed,cards=0,reads=0;
 const participant={id:'p',status:'active',platform:'onebot',selfId:'2',userId:'1'};
 const service={getNarrator:()=>narrator,setNarrator:n=>narrator=n,splitOutgoingMessage:s=>s.split('<sep/>'),getDesktopRuntimePhase:()=> 'running',config:{runtime:{}}};
 const ctx={on:()=>{},inject:(_,fn)=>fn({...ctx,interlude:service})};
 const journal={fault:false,data:{paused:false,shares:[]},save:()=>{}};
 const bridge=createBridge(ctx,{platform:'onebot',selfId:'2',targetUserId:'1',rewatchDays:7},{journal,active:()=>true,candidates:async()=>{throw Error('must not pick another video')},readIncoming:async()=>{reads++;if(fail)throw new Fault('bili-code-403');return {bvid:V,note:'实际字幕：分镜制作',detail:{bvid:V}}},card:async()=>{cards++;return '1'}});
 t.after(()=>bridge.dispose());
 const req=tag=>({story:{id:'s',status:'active',platform:'onebot',selfId:'2',setting:{world:'原世界'}},participant,participants:[participant],userMessage:tag,phase:'user-message'});
 return {bridge,service,req,journal,get observed(){return observed},get cards(){return cards},get reads(){return reads}};
}
test('HDS shared: actual evidence, original settings/segments, no incoming-card echo even when model emits URL',async t=>{
 const f=fixture(t);const tag=await f.bridge.request({},V,'incoming');const req=f.req(tag),saved=JSON.stringify(req);
 const r=await f.service.getNarrator().decide(req);assert.match(f.observed.story.setting.world,/实际字幕/);assert.match(f.observed.story.setting.world,/默认只发对话/);assert.equal(JSON.stringify(req),saved);assert.equal(r.interaction.reply.content,url+'HDS感想<sep/>第二句');
 await f.bridge.beforeSend({isDirect:true,platform:'onebot',selfId:'2',channelId:'private:1',content:url+'HDS感想'});assert.equal(f.cards,0);assert.equal(f.reads,1);
});
test('HDS read failure: scoped failure context, no invented evidence or alternate pick, no retry',async t=>{
 const f=fixture(t,true),tag=await f.bridge.request({},V,'incoming');await f.service.getNarrator().decide(f.req(tag));assert.match(f.observed.story.setting.world,/bili-code-403/);assert.match(f.observed.story.setting.world,/本轮没有取得可靠资料/);assert.equal(f.reads,1);assert.equal(f.cards,0);
});
