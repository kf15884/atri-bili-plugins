'use strict'
// Fixed-origin APIs only. Templates informed endpoint selection; policy here is
// independent: off by default, durable reservations, human nonce confirmation.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const { uid, cookieValue, fingerprint, assertNoSecrets, publicSentence } = require('./social')
const FLAGS = { like:'allowLike', unlike:'allowLike', coin:'allowCoin', triple:'allowTriple', favorite:'allowFavorite', unfavorite:'allowFavorite', follow:'allowFollow', unfollow:'allowUnfollow', dynamic:'allowDynamic', deleteDynamic:'allowDeleteDynamic' }
const BV = /^BV1[0-9A-Za-z]{9}$/
function action(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !FLAGS[value.op]) throw Error('action-format')
  const a = { op:value.op }
  if (['like','unlike','coin','triple','favorite','unfavorite'].includes(a.op)) {
    if (!BV.test(value.bvid || '')) throw Error('action-video'); a.bvid=value.bvid
  }
  if (['coin','triple'].includes(a.op)) { a.coins=Number(value.coins || 1); if (![1,2].includes(a.coins)) throw Error('coin-count') }
  if (['favorite','unfavorite'].includes(a.op)) { a.folderId=uid(value.folderId); if (!a.folderId) throw Error('folder-id') }
  if (['follow','unfollow'].includes(a.op)) { a.uid=uid(value.uid); if (!a.uid) throw Error('follow-uid') }
  if (a.op==='dynamic') a.content=publicSentence(value.content,{ commentMaxChars:180 })
  if (a.op==='deleteDynamic') { a.dynamicId=String(value.dynamicId || ''); if (!/^[1-9]\d{0,22}$/.test(a.dynamicId)) throw Error('dynamic-id') }
  return a
}
function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive:true, mode:0o700 })
  const fd=fs.openSync(file+'.tmp','w',0o600)
  try { fs.writeFileSync(fd,JSON.stringify(value)); fs.fchmodSync(fd,0o600); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  fs.renameSync(file+'.tmp',file); const d=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(d)}finally{fs.closeSync(d)}
}
function extractCookies(headers, data={}) {
  const result={}, names=new Set(['SESSDATA','bili_jct','DedeUserID','DedeUserID__ckMd5','sid','buvid3','buvid4'])
  const lines=headers.getSetCookie?.() || [headers.get?.('set-cookie') || '']
  for (const line of lines) for (const item of line.split(/,(?=\s*[^;,=\s]+=)/)) {
    const m=/^\s*([^=;\s]+)=([^;\r\n]*)/.exec(item); if(m && names.has(m[1])) result[m[1]]=m[2]
  }
  // The returned cross-domain URL is parsed, never fetched or exposed.
  try { const u=new URL(data.url); if(u.protocol==='https:' && /(^|\.)bilibili\.com$/.test(u.hostname)) for(const [k,v] of u.searchParams) if(names.has(k) && !/[;\r\n]/.test(v)) result[k] ||= v } catch {}
  return Object.entries(result).filter(([,v])=>v).map(([k,v])=>`${k}=${v}`).join('; ')
}
function createVault(file, manual=()=>'', request=fetch) {
  let stored='', fault=false, login=null, epoch=0
  try { const d=JSON.parse(fs.readFileSync(file,'utf8')); if(typeof d.cookie!=='string') throw Error('vault'); stored=d.cookie; fs.chmodSync(file,0o600) } catch(e) { if(e.code!=='ENOENT') fault=true }
  const cookie=()=>fault?'':manual().trim() || stored
  async function api(endpoint, params={}) {
    const url=new URL('https://passport.bilibili.com/x/passport-login/web/qrcode/'+endpoint)
    for(const [k,v] of Object.entries(params)) url.searchParams.set(k,v)
    const r=await request(url,{redirect:'error',signal:AbortSignal.timeout(15000)});const j=await r.json()
    if(!r.ok || j.code!==0) throw Error('qr-api-failed');return { data:j.data,headers:r.headers }
  }
  return { cookie, get fault(){return fault}, async begin() {
    if(fault) throw Error('vault-unreadable'); if(manual().trim()) throw Error('manual-cookie-present')
    const generation=++epoch; const {data}=await api('generate'); const u=new URL(data?.url)
    if(generation!==epoch) throw Error('qr-cancelled')
    if(u.protocol!=='https:' || !/(^|\.)bilibili\.com$/.test(u.hostname) || !/^[A-Za-z0-9_-]{8,128}$/.test(data.qrcode_key || '')) throw Error('qr-invalid')
    login={key:data.qrcode_key,expires:Date.now()+180000,generation};return u.href
  }, async poll() {
    if(!login || Date.now()>login.expires) {login=null;return 'expired'}
    const current=login;const {data,headers}=await api('poll',{qrcode_key:current.key})
    if(current!==login || current.generation!==epoch) return 'cancelled'
    if(data?.code===0) { const c=extractCookies(headers,data);if(!cookieValue(c,'SESSDATA') || !cookieValue(c,'bili_jct') || !uid(cookieValue(c,'DedeUserID'))) throw Error('qr-incomplete')
      atomic(file,{version:1,cookie:c});stored=c;login=null;return 'logged-in' }
    if(data?.code===86038) {login=null;return 'expired'}
    if(data?.code===86090) return 'confirm-on-phone'
    if(data?.code===86101) return 'waiting'
    throw Error('qr-verification-required')
  }, clear() {++epoch;login=null;atomic(file,{version:1,cookie:''});stored=''}, dispose(){++epoch;login=null} }
}
function createManager({config,bili,state,save,service,now=()=>Date.now()}) {
  const data=state.accountActions ||= { version:1, entries:[], dynamics:{} }
  if(!data || data.version!==1 || !Array.isArray(data.entries) || !data.dynamics || typeof data.dynamics!=='object' || Array.isArray(data.dynamics)
    || data.entries.some(e=>!e || !FLAGS[e.op] || !/^[a-f0-9]{16}$/.test(e.id || '') || !['pending','approved','submitting','accepted','rejected','unknown','cancelled'].includes(e.status))) throw Error('account-ledger-invalid')
  // Never retry an in-flight POST after a process restart.
  for(const e of data.entries) if(e.status==='submitting') {e.status='unknown';e.result='进程中断，平台结果未知，不重试'}
  let busy=false, disposed=false
  function enabled(a) {return config[FLAGS[a.op]]===true && (a.op!=='triple' || config.allowLike===true && config.allowCoin===true && config.allowFavorite===true)}
  function persist(){if(save()===false)throw Error('account-state-save-failed')}
  async function propose(input, origin, context={}) {
    const a=action(input);if(!enabled(a))throw Error('account-action-disabled');assertNoSecrets(a.content,config,typeof service==='function'?service():service)
    if(data.entries.length>=2000)throw Error('account-ledger-full')
    if(context.sourceValid && !await context.sourceValid()) throw Error('source-invalid')
    if(a.content && (!context.script || !context.script.includes(a.content))) throw Error('public-text-not-in-script')
    const n=await bili.nav();const accountUid=uid(n.mid), cookie=config.cookie
    if(!n.isLogin || !accountUid || accountUid!==uid(cookieValue(cookie,'DedeUserID')))throw Error('account-not-verified')
    if(a.op==='deleteDynamic' && data.dynamics[a.dynamicId]?.accountUid!==accountUid)throw Error('not-plugin-owned-dynamic')
    const key=crypto.createHash('sha256').update(accountUid+':'+JSON.stringify(a)+':'+(origin||'')).digest('hex')
    const semantic=crypto.createHash('sha256').update(accountUid+':'+JSON.stringify(a)).digest('hex')
    const prior=data.entries.find(e=>e.key===key || e.semantic===semantic && (['unknown','submitting'].includes(e.status) || ['dynamic','coin','triple'].includes(a.op) && e.status==='accepted'));if(prior)return prior
    const e={...a,semantic,id:crypto.randomBytes(8).toString('hex'),key,origin:String(origin||''),accountUid,fingerprint:fingerprint(cookie),createdAt:now(),status:'pending',source:context.source || null}
    // Coin spending, triples and deletion always require the real owner nonce.
    const confirm=config.writeMode!=='auto' || ['coin','triple','deleteDynamic'].includes(a.op)
    data.entries.push(e);persist()
    if(!confirm){e.status='approved';persist()}
    return e
  }
  async function execute(e, sourceValid=async()=>true) {
    if(disposed || busy || e.status!=='approved')return e
    busy=true
    try {
      const guard=async()=>!disposed && !state.paused && !state.persistenceFault && enabled(e) && now()-e.createdAt<20*60000 && fingerprint(config.cookie)===e.fingerprint && await sourceValid(e)
      if(!await guard())throw Error('action-guard-failed')
      const n=await bili.nav();if(!n.isLogin || uid(n.mid)!==e.accountUid)throw Error('account-changed')
      const dayKey=t=>new Intl.DateTimeFormat('en-CA',{timeZone:config.timezone || 'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t))
      const day=dayKey(now())
      const used=data.entries.filter(x=>x.submittedAt && dayKey(x.submittedAt)===day)
      if(used.length>=Math.min(config.accountWriteDailyLimit ?? 5,20))throw Error('daily-action-limit')
      if(used.some(x=>now()-x.submittedAt<Math.max(10,config.accountWriteCooldownSec ?? 60)*1000))throw Error('action-cooldown')
      if(['coin','triple'].includes(e.op) && used.reduce((s,x)=>s+(x.coins||0),0)+e.coins>Math.min(config.coinDailyLimit ?? 2,5))throw Error('coin-budget')
      const cookie=config.cookie,csrf=cookieValue(cookie,'bili_jct');if(!csrf || !cookieValue(cookie,'SESSDATA'))throw Error('missing-csrf')
      let endpoint,fields,host='https://api.bilibili.com',jsonBody=false
      let detail
      if(e.bvid){detail=await bili.detail(e.bvid);if(detail.bvid!==e.bvid || !uid(detail.aid))throw Error('video-mismatch')}
      if(e.op==='like'||e.op==='unlike'){endpoint='/x/web-interface/archive/like';fields={aid:detail.aid,like:e.op==='like'?1:2}}
      if(e.op==='coin'){endpoint='/x/web-interface/coin/add';fields={aid:detail.aid,multiply:e.coins,select_like:0}}
      if(e.op==='triple'){endpoint='/x/web-interface/archive/like/triple';fields={aid:detail.aid};e.coins=2; if((config.coinDailyLimit??2)<2 || used.reduce((s,x)=>s+(x.coins||0),0)+2>Math.min(config.coinDailyLimit??2,5))throw Error('coin-budget')}
      if(['favorite','unfavorite'].includes(e.op)){
        const folders=await bili.get('https://api.bilibili.com/x/v3/fav/folder/created/list-all',{up_mid:e.accountUid,type:2})
        if(!folders?.list?.some(f=>String(f.id)===e.folderId))throw Error('not-own-folder')
        endpoint='/x/v3/fav/resource/deal';fields={rid:detail.aid,type:2,add_media_ids:e.op==='favorite'?e.folderId:'',del_media_ids:e.op==='unfavorite'?e.folderId:''}
      }
      if(['follow','unfollow'].includes(e.op)){
        const card=await bili.get('https://api.bilibili.com/x/web-interface/card',{mid:e.uid});if(uid(card?.card?.mid)!==e.uid)throw Error('follow-target-mismatch')
        endpoint='/x/relation/modify';fields={fid:e.uid,act:e.op==='follow'?1:2,re_src:11}
      }
      if(e.op==='dynamic') { assertNoSecrets(e.content,config,typeof service==='function'?service():service);publicSentence(e.content,{commentMaxChars:180});jsonBody=true;endpoint='/x/dynamic/feed/create/dyn';fields={dyn_req:{content:{contents:[{raw_text:e.content,type:1,biz_id:''}]},scene:1,meta:{app_meta:{from:'create.dynamic.web',mobi_app:'web'}}}} }
      if(e.op==='deleteDynamic'){
        if(data.dynamics[e.dynamicId]?.accountUid!==e.accountUid)throw Error('not-plugin-owned-dynamic')
        host='https://api.vc.bilibili.com';endpoint='/dynamic_svr/v1/dynamic_svr/rm_dynamic';fields={dynamic_id:e.dynamicId,csrf_token:csrf}
      }
      if(!endpoint || !await guard())throw Error('action-guard-failed')
      e.status='submitting';e.submittedAt=now();persist() // MUST precede any network write.
      try {
        const url=host+endpoint+(jsonBody?'?csrf='+encodeURIComponent(csrf):'')
        const r=await fetch(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{...bili.headers(),Cookie:cookie,'Content-Type':jsonBody?'application/json':'application/x-www-form-urlencoded'},body:jsonBody?JSON.stringify(fields):new URLSearchParams({...fields,csrf})})
        const j=await r.json()
        if(Number.isFinite(j?.code) && j.code!==0){e.status='rejected';e.code=j.code;e.result='平台拒绝，未自动重试'}
        else if(!r.ok || j?.code!==0 || j?.data?.need_captcha){e.status='unknown';e.result='结果或风控状态未确认，不重试'}
        else {e.status='accepted';e.result='平台接口已接受；实际展示/通知仍未验证'
          if(e.op==='dynamic'){const id=String(j.data?.dyn_id_str || j.data?.dyn_id || j.data?.dynamic_id_str || j.data?.dynamic_id || '');if(/^[1-9]\d{0,22}$/.test(id)){e.dynamicId=id;data.dynamics[id]={accountUid:e.accountUid,entryId:e.id}}else{e.status='unknown';e.result='接口接受但缺动态编号，未确认成功，不重试'}}
        }
      } catch {e.status='unknown';e.result='请求后结果未知，不自动重试'}
      persist();return e
    } catch(error) {if(!e.submittedAt){e.status='cancelled';e.result='安全检查未通过，未发送';persist()}else{e.status='unknown';e.result='结果或本地持久化未确认，停止账号写入';state.paused=true;state.persistenceFault=true}throw error} finally{busy=false}
  }
  return {propose,execute,entries:()=>data.entries, enabled, dispose(){disposed=true}, confirm(id){const e=data.entries.find(x=>x.id===id);if(!e || e.status!=='pending' || now()-e.createdAt>=20*60000)throw Error('confirmation-expired');e.status='approved';persist();return e},cancel(id){const e=data.entries.find(x=>x.id===id);if(e && ['pending','approved'].includes(e.status)){e.status='cancelled';e.result='用户取消';persist()}return e},summary(e){return `${e.id} ${e.op} ${e.bvid||e.uid||e.dynamicId||''} ${e.content||''}\n${e.status}：${e.result||'需要确认'}${e.coins?'（最多 '+(e.op==='triple'?2:e.coins)+' 枚硬币）':''}`}}
}
module.exports={createVault,createManager,action,extractCookies,atomic,FLAGS}
