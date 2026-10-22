'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Recommender}=require('../recommend'),{runBackground}=require('../background');
const albumBg=require('../../../qa/background-fixtures/album/background'),journalBg=require('../../../qa/background-fixtures/journal/background');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn)=>{for(let i=0;i<250;i++){if(fn())return;await sleep(5)}assert.fail('condition not reached')};
function fixture(t){
 const p={id:'p',status:'active',userId:'owner'},story={id:'s',status:'active',platform:'onebot',selfId:'bot',setting:{world:'old-world'}};
 let busy=false,paused=false,split=false,context='old',calls=0;
 const requests=[],s={taskGeneration:()=>1,taskGenerationCurrent:()=>true,getStory:async()=>story,getParticipant:async()=>p,canHandleStory:()=>true,canHandleParticipant:()=>true,getDesktopRuntimePhase:()=>paused?'paused':'running',hasPendingNarrative:()=>busy,pendingSplitSegments:async()=>split?[{}]:[],recentEntriesForPrompt:async()=>[{kind:'user-message',content:context}]};
 const r=new Recommender({c:{},journal:{data:{shares:[]},save(){}},active:()=>true,getService:()=>s,getBase:()=>({decide:async(req)=>{calls++;requests.push(req);return 'generated'}}),log:{info(){},warn(){}},candidates:async()=>[],watch:async(x)=>x});
 const job=r.ask=r.job('ask',{story,participant:p},p);t.after(()=>r.dispose());
 return{r,job,s,requests,get calls(){return calls},setBusy:v=>busy=v,setPaused:v=>paused=v,setSplit:v=>split=v,setContext:v=>context=v};
}
test('0.8.4 recommendation and album/journal share one FIFO model lane',async t=>{
 const f=fixture(t),events=[];let release;const held=new Promise(r=>release=r);t.after(()=>release());
 const a=albumBg.runBackground(f.s,'s',{},async()=>{events.push('album');await held});await until(()=>events.length===1);
 const b=f.r.decide(f.job,'guide','internal');await sleep(20);const j=journalBg.runBackground(f.s,'s',{},async()=>events.push('journal'));
 await sleep(20);assert.equal(f.calls,0);release();await Promise.all([a,b,j]);assert.equal(f.calls,1);assert.deepEqual(events,['album','journal']);
});
test('0.8.4 foreground wait expiry never forces a recommendation model call',async t=>{
 const f=fixture(t);f.r.yieldMs=10;f.setBusy(true);await assert.rejects(f.r.decide(f.job,'guide','internal'),{code:'recommend-cancelled'});assert.equal(f.calls,0);
});
test('0.8.4 queued recommendation refreshes context after native split completes',async t=>{
 const f=fixture(t);f.setSplit(true);const task=f.r.decide(f.job,'guide','internal');await sleep(30);assert.equal(f.calls,0);f.setContext('new-foreground-message');f.setSplit(false);await task;assert.equal(f.calls,1);assert.equal(f.requests[0].recentEntries[0].content,'new-foreground-message');assert.equal(f.requests[0].writingOptions.browserMode,'disabled');
});
test('0.8.4 queued recommendation cancellation releases the next plugin',async t=>{
 const f=fixture(t);let release;const held=new Promise(r=>release=r);t.after(()=>release());
 const a=albumBg.runBackground(f.s,'s',{},async()=>held);await sleep(10);
 const b=f.r.decide(f.job,'guide','internal').catch(e=>e.code);await sleep(20);f.r.cancelAsk('owner-cancelled');release();await a;assert.ok(['background-cancelled','recommend-source-invalid','recommend-cancelled'].includes(await b));assert.equal(f.calls,0);assert.equal(await journalBg.runBackground(f.s,'s',{},async()=>42),42);
});
test('0.8.4 pause prevents recommendation model work',async t=>{const f=fixture(t);f.setPaused(true);await assert.rejects(f.r.decide(f.job,'guide','internal'),{code:'recommend-source-invalid'});assert.equal(f.calls,0)});
test('0.8.4 explicit eyes compatibility and empty public endpoint default',()=>{const main=require('..'),eyes=require('../../atri-bili-eyes/package.json');assert.equal(main.Config({}).framesUrl,'');assert.equal(eyes.version,'0.6.1-beta.1');assert.ok(eyes.peerDependencies['koishi-plugin-atri-bilibili'].split('||').map(x=>x.trim()).includes(require('../package.json').version));assert.match(eyes.peerDependencies['koishi-plugin-atri-bilibili'],/>=0.8.0/)});
