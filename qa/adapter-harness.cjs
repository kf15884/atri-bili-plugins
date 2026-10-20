'use strict'
const {OneBotMessageEncoder}=require('koishi-plugin-adapter-onebot')
function adapterHarness({beforeSend=()=>{},failCard=false,omitId=false}={}){
  const calls=[]
  const app={serial:async(...args)=>beforeSend(args[2]),emit(){}}
  const bot={selfId:'1000000002',platform:'onebot',ctx:{},internal:{sendPrivateMsg:async(id,message)=>{
    calls.push({id,message})
    if(failCard && message.some(x=>x.type==='json'))throw Error('platform send rejected')
    return omitId?undefined:-123-calls.length
  }},session(event={}){
    const e={message:{},channel:{},user:{},...event}
    return {event:e,app,bot,platform:'onebot',selfId:bot.selfId,transform:async x=>x,
      get isDirect(){return e.channel.type===1},set isDirect(v){},
      get channelId(){return e.channel.id},set channelId(v){e.channel.id=v},
      get messageId(){return e.message.id},set messageId(v){e.message.id=v},
      get guildId(){return e.guild?.id},set guildId(v){if(v)e.guild={id:v}},set content(v){e.message.content=v}}
  }}
  return {bot,calls,async encode(content){return new OneBotMessageEncoder(bot,'private:1000000001').send(content)},async send(content){return (await this.encode(content)).map(r=>r.id)}}
}
module.exports={adapterHarness}
