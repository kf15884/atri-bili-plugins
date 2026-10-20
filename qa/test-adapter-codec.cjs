'use strict'
const {test}=require('node:test'),assert=require('node:assert/strict'),{h}=require('koishi')
const {adapterHarness}=require('./adapter-harness.cjs')
const {createBridge}=require('koishi-plugin-atri-bilibili/chat-cards')
const {normalizeReceiptIds}=require('koishi-plugin-atri-bilibili/independent')
const fixture=require('koishi-plugin-atri-bilibili/test/miniapp-fixture.json')
const config={platform:'onebot',selfId:'1000000002',targetUserId:'1000000001',workflow:'independent'}
function bridgeHarness(t,options={}){const events={};const ctx={on(e,f){events[e]=f},middleware(){}};const a=adapterHarness({beforeSend:s=>events['before-send']?.(s),...options});let prepares=0;a.bot.internal._get=async(action)=>{assert.equal(action,'send_pb');prepares++;return fixture.response};const bridge=createBridge(ctx,config,{bili:{detail:async()=>fixture.video},allowed:()=>true});t.after(()=>events.dispose());return {a,bridge,prepares:()=>prepares}}
test('真实OneBot6.9.5复现：旧json元素被忽略且没有请求/回执',async()=>{const a=adapterHarness();assert.deepEqual(await a.encode([h('json',{data:'{"app":"test"}'})]),[]);assert.equal(a.calls.length,0)})
test('真实OneBot6.9.5：原生onebot:json生成标准JSON消息及负数回执',async()=>{const a=adapterHarness(),data='{"app":"test"}';const ids=await a.send([h('onebot:json',{data})]);assert.deepEqual(ids,['-124']);assert.deepEqual(a.calls,[{id:'1000000001',message:[{type:'json',data:{data}}]}])})
test('实际bridge.prepare输出通过真实编码器，不再静默丢弃卡片',async t=>{const f=bridgeHarness(t);const card=await f.bridge.prepare(f.a.bot,fixture.video.bvid);assert.equal(card.type,'onebot:json');assert.deepEqual(await f.a.send([card]),['-124']);assert.equal(f.prepares(),1);assert.equal(f.a.calls.length,1);const parsed=JSON.parse(f.a.calls[0].message[0].data.data);assert.equal(parsed.meta.detail_1.appid,'1109937557');assert.equal(parsed.meta.detail_1.qqdocurl,'https://www.bilibili.com/video/'+fixture.video.bvid)})
test('普通HDS视频链接经before-send生成的卡片同样通过真实编码器',async t=>{const f=bridgeHarness(t);const ids=await f.a.send([h.text('看看这个 https://www.bilibili.com/video/'+fixture.video.bvid)]);assert.equal(ids.length,2);assert.deepEqual(f.a.calls.map(c=>c.message[0].type),['text','json']);assert.equal(f.prepares(),1)})
test('卡片真实投递拒绝不在编码层重试',async t=>{const f=bridgeHarness(t,{failCard:true});const card=await f.bridge.prepare(f.a.bot,fixture.video.bvid);await assert.rejects(()=>f.a.send([card]));assert.equal(f.a.calls.length,1);assert.equal(f.prepares(),1)})
test('真实适配器把缺失编号转成undefined字符串，插件仍应拒绝',async()=>{const a=adapterHarness({omitId:true});const ids=await a.send([h('onebot:json',{data:'{}'})]);assert.deepEqual(ids,['undefined']);assert.deepEqual(normalizeReceiptIds(ids),[])})
