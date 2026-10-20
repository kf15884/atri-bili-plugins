'use strict'
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os')
const {createDeep,run}=require('../deep')
test('real ffmpeg/ffprobe sampled frames -> mocked vision, secret not transmitted, all temp files removed',{timeout:60000},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'deep-local-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
 const source=path.join(dir,'source.mp4')
 await run('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=320x240:d=2','-c:v','libx264','-threads','1','-pix_fmt','yuv420p',source],{cwd:dir,timeout:15000})
 const downloader=path.join(dir,'download.js');fs.writeFileSync(downloader,`#!${process.execPath}\nconst fs=require('node:fs'),path=require('node:path');const a=process.argv.slice(2);fs.copyFileSync(${JSON.stringify(source)},a[a.indexOf('--output')+1].replace('%(ext)s','mp4'));fs.writeFileSync(${JSON.stringify(path.join(dir,'cwd'))},process.cwd())\n`,{mode:0o700})
 const original=fetch;t.after(()=>global.fetch=original);let request
 global.fetch=async(url,options)=>{request={url,options};return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({choices:[{message:{content:'抽样画面为蓝色，无法判断声音或完整剧情。'}}]})}}
 const deep=createDeep({deepEnabled:true,visionEndpoint:'https://vision.test/v1/chat/completions',visionApiKey:'explicit-test-key',visionModel:'vision-test',deepFrames:2,ytdlpPath:downloader})
 const result=await deep.read({bvid:'BV1ZKJb68EjZ',p:1,duration:2},{cookie:'SESSDATA=private-cookie-value; bili_jct=test',context:'字幕：公开视频资料；评论：网友观点'})
 assert.equal(result.status,'sampled-visual');assert.equal(result.frames,2);assert.match(result.note,/不代表完整观看/)
 const body=JSON.parse(request.options.body);assert.equal(body.messages[1].content.filter(c=>c.type==='image_url').length,2);assert.ok(!request.options.body.includes('private-cookie-value'));assert.ok(!request.options.body.includes('SESSDATA'))
 assert.ok(!fs.existsSync(fs.readFileSync(path.join(dir,'cwd'),'utf8')));deep.dispose()
})
