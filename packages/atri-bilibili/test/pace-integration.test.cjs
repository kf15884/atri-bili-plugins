'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {App,h}=require('koishi'),HTTP=require('@koishijs/plugin-http').default,SQLite=require('@koishijs/plugin-database-sqlite').default,HDS=require('koishi-plugin-hds-interlude'),main=require('..'),eyes=require('../../atri-bili-eyes'),{Api}=require('../api');
const V='BV1Yw7M6RERb',ACK='我去看看，等我一下。',BODY='这个分镜很细致。<sep/>我喜欢这里的节奏。';
async function until(fn){for(let n=0;n<200;n++){if(await fn())return;await new Promise(r=>setTimeout(r,5));}assert.fail('state not reached')}
for(const order of ['bili-first','hds-first'])for(const mode of ['timer','question-ready','question-generating'])
test(`real HDS paced lifecycle ${order} ${mode}: confirmed ack -> draft only -> one commit/send`,{timeout:20000},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bili072-hds-')),app=new App();app.baseDir=dir;
 let middleware,commands;const om=app.middleware.bind(app);app.middleware=(fn,...args)=>{if(fn.toString().includes('prepareShared'))middleware=fn;if(fn.toString().includes('上一条B站命令'))commands=fn;return om(fn,...args)};
 app.plugin(HTTP,{});app.plugin(SQLite,{path:path.join(dir,'koishi.db')});
 const mc=main.Config({targetUserId:'1000000001',selfId:'1000000002',autoEnabled:false});
 const hc=HDS.Config({storyDefaults:{characterName:'Atri',characterProfile:'原人设不修改',world:'原世界不修改'},runtime:{autoAdvanceEnabled:false,allowProactiveMessages:false,splitReplyMessages:true,messageSeparator:'<sep/>'},model:{providers:[]},memory:{enabled:false},onebot:{enabled:false},logging:{logScriptPreview:false}});
 const bp=()=>{app.plugin(main,mc);app.plugin(eyes,eyes.Config({waitMinSec:mode==='timer'?0:60,waitMaxSec:mode==='timer'?0:60}))},hp=()=>app.plugin(HDS,hc);
 if(order==='bili-first'){bp();hp()}else{hp();bp()}
 let release;const gate=new Promise(r=>release=r);
 t.after(async()=>{release();await app.stop();fs.rmSync(dir,{recursive:true,force:true})});
 await app.start();await new Promise(r=>setTimeout(r,50));
 const svc=app.interlude,session={platform:'onebot',selfId:'1000000002',userId:'1000000001',channelId:'private:1000000001',isDirect:true,username:'unit'};
 const story=await svc.createStory(session),p=await svc.ensureParticipant(story,session),setting=JSON.stringify(story.setting);
 const wrapped=svc.getNarrator(),base=Object.getPrototypeOf(wrapped),oldDecide=base.decide,oldNote=Api.prototype.note,oldSend=svc.sendOutgoingMessages;
 let reads=0,drafts=0,modelCalls=0,observed,transport=[];
 Api.prototype.note=async()=>{reads++;return {bvid:V,note:'实际字幕：作者用分镜来控制动画的节奏。',detail:{bvid:V}}};
 base.decide=async r=>{modelCalls++;observed=r;if(r.story.setting.world.includes('工具尚未开始读取'))return {script:'Atri给对方发消息说：“'+ACK+'”',interaction:{reply:{mode:'immediate',content:ACK}}};drafts++;await gate;return {script:'Atri给对方发消息说：“这个分镜很细致。我喜欢这里的节奏。”',interaction:{reply:{mode:'immediate',content:BODY}},crossConversationActions:[{participantId:'other',mode:'immediate',content:'must not send'}],memoryUpdates:[{fake:true}]}};
 svc.sendOutgoingMessages=async(s,m,p,se,cancel)=>{const accepted=m.filter(x=>!cancel?.(p));transport.push(...accepted.map(x=>x.content));return accepted};
 t.after(()=>{base.decide=oldDecide;Api.prototype.note=oldNote;svc.sendOutgoingMessages=oldSend});
 const value=mode==='timer'?V:mode==='question-ready'?h('json',{data:JSON.stringify({meta:{detail_1:{appid:'1109937557',qqdocurl:'https://www.bilibili.com/video/'+V+'/'}}})}).toString():'https://www.bilibili.com/video/'+V+'/';
 const source={...session,messageId:'video1',content:value,elements:h.parse(value)};let forward=0;
 await middleware(source,()=>forward++);assert.equal(forward,1);assert.match(source.content,/atri-bili-watch/);assert.equal(reads,0);
 const now=new Date();const entry=await svc.appendEntry(story.id,{kind:'user-message',actor:'user',content:source.content,occurredAt:now.toISOString()},now,p.id);
 const request={story,participant:p,participants:[p],phase:'user-message',userMessage:source.content,from:now,now,recentEntries:[entry],webContext:[],writingOptions:{messageSeparator:'<sep/>',splitReplyMessages:true,browserMode:'disabled'}};
 const ack=await svc.getNarrator().decide(request);assert.equal(ack.interaction.reply.content,ACK);assert.equal(reads,0);
 const persisted=await svc.serial(story.id,()=>svc.persistDecision(story,p,ack,now,now,true,'user-message',[]));
 assert.equal(reads,0);assert.equal(persisted.messages.length,1);
 await svc.deliverOutgoingMessages(story,persisted.messages,p);assert.deepEqual(transport,[ACK]);
 await until(()=>drafts===1);assert.equal(reads,1);assert.match(observed.story.setting.world,/实际字幕/);
 const entriesBefore=await svc.dbGet('interlude_script_entry',{storyId:story.id});assert.equal(entriesBefore.filter(x=>x.kind==='script'&&x.content.includes('这个分镜很细致')).length,0,'draft has no persisted speech/memory/actions');
 if(mode==='question-generating'){
   const q={...session,messageId:'q',content:'看完了吗',elements:h.parse('看完了吗')};let next=0;await middleware(q,()=>next++);assert.equal(next,0);assert.deepEqual(transport,[ACK]);release();
 }else{release();if(mode==='question-ready'){
   await until(()=>app.atriBiliApi.pacedReady()&&JSON.parse(fs.readFileSync(path.join(dir,'data/atri-bilibili/watch-state-v2.json'),'utf8')).viewTasks.at(-1).status==='waiting');
   assert.deepEqual(transport,[ACK]);let next=0;await middleware({...session,messageId:'q',content:'这个视频怎么样',elements:h.parse('这个视频怎么样')},()=>next++);assert.equal(next,0);
 }}
 await until(()=>JSON.parse(fs.readFileSync(path.join(dir,'data/atri-bilibili/watch-state-v2.json'),'utf8')).viewTasks.at(-1).status==='sent');
 assert.deepEqual(transport.slice(0,2),[ACK,'这个分镜很细致。']);assert.equal(drafts,1);assert.equal(modelCalls,2);assert.equal(reads,1);
 const after=await svc.dbGet('interlude_script_entry',{storyId:story.id});assert.equal(after.filter(x=>x.kind==='script'&&x.content.includes('这个分镜很细致')).length,1);assert.equal(after.filter(x=>x.kind==='character-message'&&x.content==='这个分镜很细致。').length,1);
 assert.equal(JSON.stringify((await svc.getStory(story.id)).setting),setting);
 assert.equal(hc.runtime.allowProactiveMessages,false,'user-request continuation does not enable proactive setting');
 let next=0;await middleware({...session,messageId:'normal',content:'今天吃什么',elements:h.parse('今天吃什么')},()=>next++);assert.equal(next,1);
 const rows=JSON.parse(fs.readFileSync(path.join(dir,'data/atri-bilibili/watch-state-v2.json'),'utf8')).viewTasks;assert.equal(rows.length,1);assert.equal(rows[0].status,'sent');assert.equal(JSON.stringify(rows).includes(BODY),false,'draft not persisted in plugin ledger');
});
