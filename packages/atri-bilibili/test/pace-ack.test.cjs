'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Pace,ackSettings,explicitAsk,similar}=require('../pace');
const {cardTitle,collect}=require('../../atri-bili-eyes/share');
const {h}=require('koishi');
async function waitFor(fn){for(let i=0;i<200&&!fn();i++)await new Promise(r=>setTimeout(r,2));assert.ok(fn(),'condition reached');}
function fixture(t,{rolls=[],pick=(a,b)=>a,ackReply='去看看。',catalog=null}={}) {
 let reads=0,sends=0;const seen=[],sent=[];
 const entries=new Map(),p={id:'p',storyId:'s',platform:'onebot',selfId:'2',userId:'1',status:'active'},story={id:'s',status:'active',platform:'onebot',selfId:'2',setting:{world:'原世界'}};
 const body='看完了，这个分镜挺有意思。';
 const base={decide:async r=>{seen.push(r);return {script:'Atri说：“'+body+'”',interaction:{reply:{mode:'immediate',content:body}}}}};
 const platform=[];
 const service={splitOutgoingMessage:s=>s.split('<sep/>'),confirmOutgoingDeliveries(){},persistDecision:async(story,p,d)=>({messages:[{participantId:p.id,content:d.interaction.reply.content}]}),deliverOutgoingMessages:async(story,m)=>{sends++;sent.push(...m.map(x=>x.content));return m},serial:async(_,fn)=>fn(),getStory:async()=>story,getParticipant:async()=>p,dbGet:async(table,q)=>q.kind?platform:(entries.has(q.id)?[entries.get(q.id)]:[]),recentEntriesForPrompt:async()=>[],taskGeneration:()=>'g',taskGenerationCurrent:()=>true,canHandleStory:()=>true,canHandleParticipant:()=>true,appendEntry:async()=>{},recordIncomingMessage:async()=>{},hasPendingNarrative:()=>false};
 const journal={data:{viewTasks:[]},save:()=>{}};
 let i=0;
 const pace=new Pace({journal,active:()=>true,read:async()=>{reads++;return {bvid:'BV1Yw7M6RERb',note:'真实字幕'}},getService:()=>service,getBase:()=>base,allowed:()=>true,clock:{random01:()=>rolls.length?rolls[Math.min(i++,rolls.length-1)]:0.5,random:pick,skipDelayMs:0}});
 t.after(()=>pace.dispose());
 const request=()=>{const j=pace.job;entries.set('source',{id:'source'});return {story,p,participant:p,stickerCatalog:catalog||undefined,recentEntries:[{id:'source',participantId:'p',kind:'user-message',content:'[atri-bili-watch:'+j.id+']'}]}};
 const open=(opts={})=>pace.open({},'BV'+Math.random().toString(36).slice(2,12).padEnd(10,'x'),{waitMinSec:0,waitMaxSec:0,taskTimeoutSec:30,ackProbability:0.7,...opts});
 const replies=Array.isArray(ackReply)?ackReply:[ackReply];let k=0;
 const ackDecide=async r=>{seen.push(r);const c=replies[Math.min(k++,replies.length-1)];return catalog?{script:'Atri回了一个表情。',localMedia:{assetId:catalog[0].assetId,placement:'standalone',willingness:0.4}}:{script:'Atri说：“'+c+'”',interaction:{reply:{mode:'immediate',content:c}}}};
 async function confirm(){const j=pace.job;entries.set('script',{id:'script',content:j.ackScript});entries.set('ack',{id:'ack'});await pace.confirmed(story,[{id:'ack',kind:'character-message',participantId:'p',content:j.ackBody,metadata:{scriptEntryId:'script'}}]);}
 return {entriesSet:id=>entries.set(id,{id}),pace,open,request,ackDecide,confirm,story,platform,journal,seen,sent,body,get reads(){return reads},get sends(){return sends}};
}
test('settings default to the original always-ack path for older eyes',()=>{assert.equal(ackSettings({}).probability,1);assert.equal(ackSettings({ackProbability:0.7}).probability,0.7);assert.equal(ackSettings({ackProbability:5}).probability,1);assert.equal(ackSettings({}).stickerRatio,0)});
test('explicit asks',()=>{for(const x of ['你看看','帮我看看这个','快看','这个你看一下','有空看看'])assert.equal(explicitAsk(x),true,x);for(const x of ['','哈哈哈哈笑死','好家伙','这up又更新了'])assert.equal(explicitAsk(x),false,x)});
test('similarity catches near repeats only',()=>{assert.equal(similar('我去看看，等我一下。','我去看看等我一下'),true);assert.equal(similar('好','好的'),true);assert.equal(similar('这是啥？','从哪翻出来的'),false);assert.equal(similar('等我把手上的弄完就看','行，我这就点开'),false)});
test('skip branch: seen, no reply, reads without confirmation, one natural reply',async t=>{
 const f=fixture(t,{rolls:[0.9]});f.open();assert.equal(f.pace.job.mode,'skip');
 const out=await f.pace.acknowledge(f.pace.job,f.request(),f.ackDecide);
 assert.deepEqual(out.interaction.reply,{mode:'none'});assert.equal(out.script,'');
 await waitFor(()=>f.pace.job.status==='sent');assert.equal(f.reads,1);assert.deepEqual(f.sent,[f.body]);
 const draft=f.seen.at(-1);assert.match(draft.story.setting.world,/没有先回复/);assert.doesNotMatch(draft.story.setting.world,/已经取得实际投递回执/);
 assert.equal(f.journal.data.viewTasks.at(-1).mode,'skip');
});
test('ack branch keeps confirmation before reading',async t=>{
 const f=fixture(t,{rolls:[0.1]});f.open();assert.equal(f.pace.job.mode,'ack');
 const out=await f.pace.acknowledge(f.pace.job,f.request(),f.ackDecide);assert.equal(out.interaction.reply.content,'去看看。');
 await new Promise(r=>setTimeout(r,10));assert.equal(f.reads,0);
 await f.confirm();await waitFor(()=>f.pace.job.status==='sent');assert.equal(f.reads,1);
 assert.deepEqual(f.journal.data.ackHistory,['去看看。']);assert.match(f.seen.at(-1).story.setting.world,/开场回应「去看看。」/);
});
test('explicit “你看看” always answers; streak guards',t=>{
 const f=fixture(t,{rolls:[0.99]});
 f.open({ackProbability:0,userText:'你看看这个'});assert.equal(f.pace.job.mode,'ack');
 const g=fixture(t,{rolls:[0.99]});const modes=[];for(let n=0;n<6;n++){g.open({ackProbability:0.7});modes.push(g.pace.job.mode)}
 assert.deepEqual(modes,['skip','skip','ack','skip','skip','ack']);
 const a=fixture(t,{rolls:[0]});const am=[];for(let n=0;n<6;n++){a.open({ackProbability:0.7});am.push(a.pace.job.mode)}
 assert.deepEqual(am,['ack','ack','ack','ack','skip','ack']);
 const z=fixture(t,{rolls:[0]});for(let n=0;n<6;n++){z.open({ackProbability:1});assert.equal(z.pace.job.mode,'ack')}
});
test('opening prompt: style direction, recent history, card title',async t=>{
 const f=fixture(t,{rolls:[0]});f.journal.data.ackHistory=['我去看看。','来了来了'];
 f.open({cardTitle:'【4K】海边小镇的一天'});const req=f.pace.ackRequest(f.pace.job,f.request());const w=req.story.setting.world;
 assert.match(w,/工具尚未开始读取/);assert.match(w,/这次说法的方向/);assert.match(w,/「我去看看。」「来了来了」/);assert.match(w,/【4K】海边小镇的一天/);assert.doesNotMatch(w,/准备去看看/);
 const n=fixture(t,{rolls:[0]});n.open({ackVariety:false,ackTitleReaction:false,cardTitle:'x标题'});const w2=n.pace.ackRequest(n.pace.job,n.request()).story.setting.world;assert.doesNotMatch(w2,/说法的方向|x标题/);
});
test('near-repeat opening costs no second HDS call: goes quiet, explicit asks keep the reply',async t=>{
 const g=fixture(t,{rolls:[0],ackReply:['我去看看～','不该被调用']});g.journal.data.ackHistory=['我去看看'];g.journal.data.ackPlan={last:'skip',n:1};g.open();
 const o2=await g.pace.acknowledge(g.pace.job,g.request(),g.ackDecide);assert.deepEqual(o2.interaction.reply,{mode:'none'});assert.equal(g.pace.job.mode,'skip');
 assert.equal(g.seen.length,1);assert.deepEqual(g.journal.data.ackPlan,{last:'skip',n:2});
 await waitFor(()=>g.pace.job.status==='sent');assert.deepEqual(g.sent,[g.body]);
 const f=fixture(t,{rolls:[0],ackReply:'我去看看～'});f.journal.data.ackHistory=['我去看看'];f.open({userText:'你看看这个'});
 const out=await f.pace.acknowledge(f.pace.job,f.request(),f.ackDecide);assert.equal(out.interaction.reply.content,'我去看看～');assert.equal(f.pace.job.mode,'ack');assert.equal(f.seen.length,1);
});
test('generation yields to a pending HDS turn before calling the model; delivery backs off and keeps the draft',async t=>{
 let pending=true,hold=true,checks=0;
 const f=fixture(t,{rolls:[0.9]});
 // Foreground becomes busy again the moment the draft exists, so delivery must wait.
 const svc=f.pace.getService();svc.hasPendingNarrative=()=>{checks++;return pending||(hold&&f.seen.length>=1)};
 f.pace.busyStepMax=20;
 f.open();await f.pace.acknowledge(f.pace.job,f.request(),f.ackDecide);
 await waitFor(()=>f.reads===1);await new Promise(r=>setTimeout(r,60));
 assert.equal(f.seen.length,0,'no HDS draft call while foreground busy');assert.equal(f.pace.job.status,'generating');
 pending=false;await waitFor(()=>f.seen.length===1);
 await new Promise(r=>setTimeout(r,120));
 assert.equal(f.pace.job.status,'waiting');assert.ok(f.pace.job.draft,'draft kept while busy');assert.equal(f.sends,0);
 hold=false;await waitFor(()=>f.pace.job.status==='sent');assert.deepEqual(f.sent,[f.body]);assert.ok(checks>4);
});
test('a stuck foreground ends only after the long cap, as foreground-busy',async t=>{
 const f=fixture(t,{rolls:[0]});const svc=f.pace.getService();let busy=false;svc.hasPendingNarrative=()=>busy;
 f.pace.busyStepMax=5;f.pace.busyMaxMs=40;
 f.open();await f.pace.acknowledge(f.pace.job,f.request(),f.ackDecide);await f.confirm();
 await waitFor(()=>f.pace.job.status==='waiting');busy=true;f.pace.deliver(f.pace.job);
 await waitFor(()=>f.pace.job.status==='failed');assert.equal(f.pace.job.row.code,'hds-foreground-busy');assert.equal(f.sends,0);
});
test('sticker-only opening waits for HDS sticker receipt before reading',async t=>{
 const catalog=[{assetId:'st1',description:'点头'}];
 const f=fixture(t,{rolls:[0],catalog});f.open({ackStickerRatio:1});
 const out=await f.pace.acknowledge(f.pace.job,f.request(),f.ackDecide);
 assert.deepEqual(out.localMedia,{assetId:'st1',placement:'standalone',willingness:1});assert.deepEqual(out.interaction.reply,{mode:'none'});
 assert.match(f.seen[0].story.setting.world,/只发一个表情包/);
 await new Promise(r=>setTimeout(r,10));assert.equal(f.reads,0);
 await f.pace.stickerSent(f.story,{assetId:'other'});assert.equal(f.reads,0);
 f.entriesSet('pa1');f.platform.push({id:'pa1',kind:'character-platform-action',occurredAt:new Date().toISOString(),metadata:{action:'local-sticker',assetId:'st1'}});
 await f.pace.stickerSent(f.story,{assetId:'st1'});
 await waitFor(()=>f.pace.job.status==='sent');assert.equal(f.reads,1);assert.match(f.seen.at(-1).story.setting.world,/只回了一个表情包/);
});
test('“等会看” openings wait longer, capped at 10 minutes',async t=>{
 const f=fixture(t,{rolls:[0],ackReply:'等我把这个弄完就看',pick:(a,b)=>b});f.open({waitMinSec:30,waitMaxSec:90});
 await f.pace.acknowledge(f.pace.job,f.request(),f.ackDecide);await f.confirm();
 await waitFor(()=>f.pace.job.status==='waiting');const left=(f.pace.job.dueAt-Date.now())/1000;assert.ok(left>250&&left<=270,String(left));
});
test('card title extraction is title-only',()=>{
 const card={prompt:'[QQ小程序]哔哩哔哩',meta:{detail_1:{appid:'1109937557',title:'哔哩哔哩',desc:'猫猫第一次见到雪',qqdocurl:'https://www.bilibili.com/video/BV1Yw7M6RERb/'}}};
 assert.equal(cardTitle(JSON.stringify(card)),'猫猫第一次见到雪');
 const info=collect({elements:h.parse(h('json',{data:JSON.stringify(card)}).toString())});assert.equal(info.title,'猫猫第一次见到雪');assert.deepEqual(info.refs,['BV1Yw7M6RERb']);
 assert.equal(cardTitle(JSON.stringify({prompt:'[QQ小程序]哔哩哔哩',meta:{detail_1:{desc:'哔哩哔哩'}}})),'');
 assert.equal(collect({elements:h.parse('BV1Yw7M6RERb')}).title,'');
});
