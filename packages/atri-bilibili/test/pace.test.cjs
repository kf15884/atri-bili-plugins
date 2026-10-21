'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Pace,isFollowup,settings,dialogue}=require('../pace');
const {Fault}=require('../api');
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(t,{clock,wait=60,readFail=false,draftBlock=false,ack=true,sendFail=false}={}) {
 let reads=0,generates=0,commits=0,sends=0,saved=0,paused=false,generation='g',allow=true,release;
 const draftPromise=new Promise(r=>release=r);
 const entries=new Map(),p={id:'p',storyId:'s',platform:'onebot',selfId:'2',userId:'1',status:'active'},story={id:'s',status:'active',platform:'onebot',selfId:'2',setting:{world:'原世界'}};
 const body='这个分镜挺有意思。<sep/>细节也很细致。';
 const base={decide:async r=>{generates++;if(draftBlock)await draftPromise;return {script:'Atri说：“'+body+'”',interaction:{reply:{mode:'immediate',content:body}},memoryUpdates:[{fake:true}],crossConversationActions:[{participantId:'other',mode:'immediate',content:'bad'}]}}};
 const service={splitOutgoingMessage:s=>s.split('<sep/>'),confirmOutgoingDeliveries(){},persistDecision:async(story,p,d)=>{commits++;assert.equal(d.memoryUpdates,undefined);assert.equal(d.crossConversationActions,undefined);return {messages:[{participantId:p.id,content:d.interaction.reply.content}]}},deliverOutgoingMessages:async(story,m,p,session,cancel)=>{if(cancel())return [];sends++;return sendFail?[]:m},serial:async(_,fn)=>fn(),getStory:async()=>story,getParticipant:async()=>p,dbGet:async(table,q)=>entries.has(q.id)?[entries.get(q.id)]:[],recentEntriesForPrompt:async()=>[],taskGeneration:()=>generation,taskGenerationCurrent:(id,g)=>g===generation&&!paused,canHandleStory:()=>allow,canHandleParticipant:()=>allow,appendEntry:async()=>{},recordIncomingMessage:async()=>{},hasPendingNarrative:()=>false};
 const journal={data:{viewTasks:[]},save:()=>saved++};
 const pace=new Pace({journal,active:()=>!paused,read:async()=>{reads++;if(readFail)throw new Fault('bili-code-403');return {bvid:'BV1Yw7M6RERb',note:'真实字幕'}},getService:()=>service,getBase:()=>base,allowed:()=>true,clock});
 t.after(()=>pace.dispose());
 function bind(){const j=pace.job;entries.set('source',{id:'source'});const r={story,p,participant:p,recentEntries:[{id:'source',participantId:'p',kind:'user-message',content:'[atri-bili-watch:'+j.id+']'}]};pace.ackRequest(j,r);const d=pace.ackResult(j,{script:'Atri发消息说：“去看看。”',interaction:{reply:{mode:'immediate',content:'去看看。<sep/>second'}}});assert.equal(d.interaction.reply.content,'去看看。');entries.set('script',{id:'script',content:j.ackScript});entries.set('ack',{id:'ack'});return j;}
 async function confirm(){const j=pace.job;await pace.confirmed(story,[{id:'ack',kind:'character-message',participantId:'p',content:j.ackBody,metadata:{scriptEntryId:'script'}}]);}
 const open=()=>pace.open({},'BV1Yw7M6RERb',{waitMinSec:wait,waitMaxSec:wait,taskTimeoutSec:30});
 return {pace,open,bind,confirm,service,entries,release,body,get reads(){return reads},get generates(){return generates},get commits(){return commits},get sends(){return sends},pause:()=>paused=true,reset:()=>generation='new',deny:()=>allow=false,journal};
}
async function waitFor(fn){for(let i=0;i<100&&!fn();i++)await new Promise(r=>setTimeout(r,2));assert.ok(fn(),'condition reached');}
for(const x of ['看完了吗','怎么样了','这个视频怎么样','视频讲了什么','这个你看看','你看一下','看完没','有什么感想','你看完了没','这个视频里的女主是谁','你觉得这个视频的剪辑怎么样','你看看这个视频','这个视频你看看','看完说说感想'])
 test('recognize pending video question '+x,()=>assert.equal(isFollowup(x),true));
for(const x of ['今天吃什么','你怎么看这个工作','这个电影怎么样','看看天气','/bili status','不要看 BV1Yw7M6RERb','我觉得今天的天空挺好看的','你好','帮我给这个视频点赞','这个视频评论怎么发'])
 test('unrelated chat not swallowed '+x,()=>assert.equal(isFollowup(x),false));
test('bounded sorted random settings',()=>{assert.deepEqual(settings({waitMinSec:90,waitMaxSec:30,taskTimeoutSec:1}),{min:30,max:90,timeout:30});assert.equal(settings({waitMaxSec:90000}).max,600)});
test('HDS projection strips actions and first ack bubble only',()=>{const s={splitOutgoingMessage:v=>v.split('|')};const out=dialogue({script:'x',interaction:{reply:{mode:'immediate',content:'one|two'}},crossConversationActions:[1]},s,true);assert.equal(out.interaction.reply.content,'one');assert.equal(out.crossConversationActions,undefined)});
test('opening and drafting ack do not read until matching confirmed HDS delivery',async t=>{
 const f=fixture(t);f.open();assert.equal(f.reads,0);f.bind();assert.equal(f.reads,0);
 await f.pace.confirmed({id:'wrong'},[]);assert.equal(f.reads,0);await f.confirm();await waitFor(()=>f.pace.job.status==='waiting');assert.equal(f.reads,1);assert.equal(f.commits,0);assert.equal(f.sends,0);
});
test('no confirmed matching script means no read',async t=>{const f=fixture(t);f.open();f.bind();f.entries.set('script',{content:'different HDS reply'});await f.confirm();await tick();assert.equal(f.reads,0);assert.equal(f.pace.job.status,'receipt')});
test('waiting followup sends original draft once; no extra model',async t=>{
 const f=fixture(t);f.open();f.bind();await f.confirm();await waitFor(()=>f.pace.job.status==='waiting');assert.equal(await f.pace.follow({messageId:'q'},'看完了吗'),true);await waitFor(()=>f.pace.job.status==='sent');assert.equal(f.reads,1);assert.equal(f.generates,1);assert.equal(f.sends,1);assert.equal(f.commits,1);assert.equal(await f.pace.follow({},'看完了吗'),false);
});
test('question before draft ready is silent, remembers urgency and sends on generation',async t=>{
 const f=fixture(t,{draftBlock:true});f.open();f.bind();await f.confirm();await waitFor(()=>f.pace.job.status==='generating');assert.equal(await f.pace.follow({},'怎么样了'),true);assert.equal(f.sends,0);assert.equal(f.commits,0);f.release();await waitFor(()=>f.pace.job.status==='sent');assert.equal(f.generates,1);assert.equal(f.sends,1);
});
test('question before ack receipt is silent and honored after read',async t=>{const f=fixture(t);f.open();assert.equal(await f.pace.follow({},'这个你看看'),true);f.bind();assert.equal(f.reads,0);await f.confirm();await waitFor(()=>f.pace.job.status==='sent');assert.equal(f.sends,1)});
test('timer sends with no question, one model draft, no premature commit',async t=>{const f=fixture(t,{wait:0});f.open();f.bind();await f.confirm();await waitFor(()=>f.pace.job.status==='sent');assert.equal(f.sends,1);assert.equal(f.commits,1);assert.equal(f.generates,1)});
test('timer and simultaneous questions claim only one send',async t=>{const f=fixture(t,{wait:1});f.open();f.bind();await f.confirm();await waitFor(()=>f.pace.job.status==='waiting');await Promise.all([f.pace.deliver(f.pace.job),f.pace.deliver(f.pace.job),f.pace.follow({},'怎么样了')]);await waitFor(()=>f.pace.job.status==='sent');assert.equal(f.sends,1);assert.equal(f.commits,1)});
test('new video cancels old draft; late result cannot send',async t=>{const f=fixture(t,{draftBlock:true});f.open();f.bind();await f.confirm();await waitFor(()=>f.pace.job.status==='generating');const old=f.pace.job;f.pace.open({},'BV1XNngzHEC5',{});f.release();await tick();await tick();assert.equal(old.status,'cancelled');assert.equal(f.sends,0);assert.equal(f.pace.job.status,'ack')});
test('same video repeat merges instead of acknowledgement/model repeat',async t=>{const f=fixture(t);const a=f.open();const b=f.open();assert.equal(b.handled,true);assert.equal(f.pace.job.urgent,true);assert.equal(f.journal.data.viewTasks.length,1);assert.equal(f.reads,0)});
for(const mode of ['pause','reset','source-delete','deny'])test('cancels unsafe pending send: '+mode,async t=>{const f=fixture(t);f.open();f.bind();await f.confirm();await waitFor(()=>f.pace.job.status==='waiting');if(mode==='pause')f.pause();if(mode==='reset')f.reset();if(mode==='source-delete')f.entries.delete('source');if(mode==='deny')f.deny();await f.pace.deliver(f.pace.job);assert.equal(f.sends,0)});
test('read failure generates one honest HDS failure draft without retry',async t=>{const f=fixture(t,{readFail:true,wait:0});let observed;const original=f.service.recentEntriesForPrompt;f.open();f.bind();await f.confirm();await waitFor(()=>f.pace.job.status==='sent');assert.equal(f.reads,1);assert.equal(f.generates,1);assert.equal(f.sends,1)});
test('unconfirmed final delivery is unknown and never automatically replayed',async t=>{const f=fixture(t,{wait:0,sendFail:true});f.open();f.bind();await f.confirm();await waitFor(()=>f.pace.job.status==='unknown');await f.pace.deliver(f.pace.job);assert.equal(f.sends,1)});
test('restart cancels in-memory drafts and marks inflight unknown without replay',t=>{const journal={data:{viewTasks:[{status:'waiting'},{status:'sending'},{status:'sent'}]},save(){}};const p=new Pace({journal,active:()=>true});assert.deepEqual(journal.data.viewTasks.map(v=>v.status),['cancelled','unknown','sent']);assert.equal(p.job,null);p.dispose()});
test('task timeout invalidates late model draft; no timers revive it',async t=>{
 const timers=[];let now=0;const f=fixture(t,{draftBlock:true,clock:{now:()=>now,set:(fn,ms)=>{const t={fn,ms};timers.push(t);return t},clear:t=>t.cancelled=true,random:a=>a}});f.open();f.bind();await f.confirm();const start=timers.find(t=>t.ms===0);start.fn();await waitFor(()=>f.pace.job.status==='generating');const timeout=timers.find(t=>t.ms===30000&&!t.cancelled);timeout.fn();await tick();assert.equal(f.pace.job.status,'failed');f.release();await tick();assert.equal(f.sends,0);
});
test('old acknowledgement completing after replacement cannot cancel the new task',async t=>{
 const {createBridge}=require('../hds');
 let release, narrator={decide:async()=>{await new Promise(r=>release=r);return {script:'她说：“我去看看。”',interaction:{reply:{mode:'immediate',content:'我去看看。'}}}}};
 const participant={id:'p',status:'active',platform:'onebot',selfId:'2',userId:'1'};
 const service={getNarrator:()=>narrator,setNarrator:n=>narrator=n,splitOutgoingMessage:s=>[s],getDesktopRuntimePhase:()=> 'running',confirmOutgoingDeliveries:async()=>[],persistDecision(){},deliverOutgoingMessages(){},serial(){},getStory(){},getParticipant(){},dbGet(){},recentEntriesForPrompt(){},taskGeneration:()=> 'g',taskGenerationCurrent:()=>true,canHandleStory:()=>true,canHandleParticipant:()=>true};
 const ctx={on(){},inject:(_,fn)=>fn({...ctx,interlude:service})},journal={fault:false,data:{paused:false,shares:[]},save(){}};
 const bridge=createBridge(ctx,{platform:'onebot',selfId:'2',targetUserId:'1'},{journal,active:()=>true,readIncoming:async()=>assert.fail('no receipt no read'),candidates:async()=>[]});t.after(()=>bridge.dispose());
 const first=bridge.beginPaced({},'BV1Yw7M6RERb',{});const req={story:{id:'s',status:'active',platform:'onebot',selfId:'2',setting:{world:'original'}},participant,userMessage:first.tag,recentEntries:[]};
 const pending=service.getNarrator().decide(req);await tick();bridge.beginPaced({},'BV1XNngzHEC5',{});release();await pending;
 assert.equal(journal.data.viewTasks[0].status,'cancelled');assert.equal(journal.data.viewTasks[1].status,'ack');
});
