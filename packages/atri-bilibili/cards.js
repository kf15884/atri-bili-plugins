'use strict'

// Accepting a OneBot JSON segment does not prove the QQ client can render it.
// LLBot's generic structmsg card failed real-client verification; auto uses links.
// This file performs no Bilibili/model requests and never changes plugin state.
const clip = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const { buildMiniAppRequest, parseMiniAppResponse } = require('./miniapp')

function buildShareCard(video, now = Date.now()) {
  if (!/^BV[0-9A-Za-z]{10}$/.test(video.bvid || '')) throw new Error('视频 BV 号格式无效')
  const title = clip(video.title || video.bvid, 80)
  const url = `https://www.bilibili.com/video/${video.bvid}`
  const time = Math.floor(now / 1000)
  let preview = String(video.pic || '').replace(/^\/\//, 'https://').replace(/^http:/, 'https:')
  try {
    const parsed = new URL(preview)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) preview = ''
  } catch { preview = '' }
  return {
    app: 'com.tencent.structmsg', view: 'news', ver: '0.0.0.1',
    desc: '新闻', prompt: `[分享]${title}`,
    config: { autosize: true, forward: true, type: 'normal', ctime: time },
    meta: { news: {
      action: '', android_pkg_name: '', app_type: 1, appid: 100951776, ctime: time,
      title, desc: clip(video.up ? `UP：${video.up}` : '哔哩哔哩视频', 100),
      jumpUrl: url, preview, tag: '哔哩哔哩', source_icon: '', source_url: '',
    } },
  }
}

async function onebot(bot, action, params = {}) {
  const internal = bot.internal
  let result
  if (typeof internal?._get === 'function') result = await internal._get(action, params)
  else if (typeof internal?._request === 'function') result = await internal._request(action, params)
  else throw new Error('当前适配器不支持 OneBot 原始接口')
  if (result && typeof result === 'object' && 'retcode' in result) {
    if (Number(result.retcode) !== 0) {
      const error = new Error(`${action} 失败（retcode: ${result.retcode}）`)
      error.retcode = result.retcode
      throw error
    }
    return result.data
  }
  return result
}

function missingMiniApp(error) {
  return Number(error?.retcode ?? error?.code) === 1404 ||
    /retcode\s*[:=]\s*1404\b|API\s*不存在|unknown action|unsupported action/i.test(String(error?.message || ''))
}

function createCardSender({ onBackendSelected = () => {} } = {}) {
  const backends = new WeakMap()
  async function backend(bot) {
    if (!backends.has(bot)) {
      backends.set(bot, onebot(bot, 'get_version_info').then(result => {
        const info = result?.data ?? result
        const name = String(info?.app_name || '')
        const type = /llonebot|luckylillia|llbot/i.test(name) ? 'link' : 'ark'
        if (type === 'link') onBackendSelected(type)
        return type
      }).catch(() => 'ark'))
    }
    return backends.get(bot)
  }
  async function sendJson(bot, card, targetUserId) {
    const userId = Number(targetUserId)
    if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('接收推荐的 QQ 号格式无效')
    const data = typeof card === 'string' ? card : JSON.stringify(card)
    return onebot(bot, 'send_private_msg', { user_id: userId, message: [{ type: 'json', data: { data } }] })
  }
  async function send(bot, video, config) {
    if (config.cardMode === 'link') return 'link'
    if (config.cardMode === 'miniapp') {
      const userId = Number(config.targetUserId)
      if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('接收推荐的 QQ 号格式无效')
      const request = buildMiniAppRequest(video, config)
      let response
      try { response = await onebot(bot, 'send_pb', request) } catch (error) {
        // Do not log the raw request/response or generated QQ share metadata.
        if (missingMiniApp(error)) throw new Error('当前协议端不支持 send_pb，无法请求 QQ 生成小程序卡片')
        const match = String(error?.message || '').match(/retcode\s*[:=]\s*(-?\d+)/i)
        const code = error?.retcode ?? match?.[1]
        throw new Error(`QQ 小程序卡片生成请求失败${code != null ? `（retcode: ${Number(code)}）` : '，请检查 LLBot 的 PMHQ 连接与日志'}`)
      }
      const card = parseMiniAppResponse(response?.data ?? response)
      try { await sendJson(bot, card, config.targetUserId) } catch {
        throw new Error('QQ 已生成小程序卡片，但卡片发送请求失败')
      }
      return 'miniapp'
    }
    if (config.cardMode === 'share') {
      await sendJson(bot, buildShareCard(video), config.targetUserId)
      return 'share'
    }
    if (await backend(bot) === 'link') return 'link'
    let response
    try {
      response = await onebot(bot, 'get_mini_app_ark', {
        type: 'bili', title: clip(video.title, 60), desc: clip(video.title, 60),
        picUrl: String(video.pic || '').replace(/^\/\//, 'https://').replace(/^http:/, 'https:'),
        jumpUrl: (config.cardJumpPath || '').replace(/\{bvid\}/g, video.bvid),
        webUrl: `https://www.bilibili.com/video/${video.bvid}`,
      })
    } catch (error) {
      // Only a definitive unsupported-action response changes the capability.
      // A timeout or failed send must not trigger a second card attempt.
      if (!missingMiniApp(error)) throw error
      backends.set(bot, Promise.resolve('link'))
      onBackendSelected('link')
      return 'link'
    }
    let card = response?.data ?? response
    if (card && typeof card === 'object' && card.data && !card.app) card = card.data
    if (!card) throw new Error('协议端没有返回卡片数据')
    await sendJson(bot, card, config.targetUserId)
    return 'ark'
  }
  return { send }
}

module.exports = { buildShareCard, createCardSender, onebot }
