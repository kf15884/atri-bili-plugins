'use strict'

// QQ generates the share URL and card metadata. Never invent a card token/URL.
// Wire fields checked against the upstream MiniAppAdaptShareInfo definitions.
const COMMAND = 'LightAppSvc.mini_app_share.AdaptShareInfo'
const APP_ID = '1109937557'
const MAX_PACKET = 1024 * 1024
const clip = (value, max) => Array.from(String(value ?? '').replace(/\s+/g, ' ').trim()).slice(0, max).join('')

function varint(value) {
  let n = BigInt(value)
  if (n < 0n || n > 0xffffffffffffffffn) throw new Error('小程序请求整数超出范围')
  const bytes = []
  do { const next = Number(n & 127n); n >>= 7n; bytes.push(next | (n ? 128 : 0)) } while (n)
  return Buffer.from(bytes)
}
function uint(field, value) { return Buffer.concat([varint(field * 8), varint(value)]) }
function bytes(field, value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8')
  return Buffer.concat([varint(field * 8 + 2), varint(buffer.length), buffer])
}

function buildMiniAppRequest(video, config = {}, now = Date.now()) {
  if (!/^BV[0-9A-Za-z]{10}$/.test(video.bvid || '')) throw new Error('视频 BV 号格式无效')
  const title = clip(video.title || video.bvid, 60)
  const picture = String(video.pic || '').replace(/^\/\//, 'https://').replace(/^http:/, 'https:')
  let parsed
  try { parsed = new URL(picture) } catch { throw new Error('视频封面地址无效') }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('视频封面地址无效')
  const path = String(config.cardJumpPath || 'pages/video/video?bvid={bvid}').replace(/\{bvid\}/g, video.bvid)
  if (!path.startsWith('pages/') || path.length > 1024 || !path.includes(video.bvid)) throw new Error('小程序跳转路径无效')
  const body = Buffer.concat([
    bytes(1, bytes(2, '')), bytes(2, APP_ID), bytes(3, title), bytes(4, title),
    uint(5, now), uint(6, 1), uint(7, 1), uint(8, 0), bytes(9, picture), bytes(10, ''),
    bytes(11, path), bytes(12, 'https://miniapp.gtimg.cn/public/appicon/51f90239b78a2e4994c11215f4c4ba15_200.jpg'),
    uint(13, 3), uint(14, 0), bytes(15, 'cfc5f7b05b44b5956502edaecf9d2240'), uint(16, 0),
    bytes(17, `https://www.bilibili.com/video/${video.bvid}`), bytes(18, ''),
    bytes(19, Buffer.concat([bytes(1, ''), bytes(2, '')])), bytes(20, ''),
  ])
  return { cmd: COMMAND, hex: Buffer.concat([bytes(2, 'V1_PC_MINISDK_99.99.99_1_APP_A'), bytes(4, body)]).toString('hex') }
}

function fields(buffer) {
  let offset = 0
  const values = new Map()
  const readVarint = () => {
    let value = 0n
    for (let i = 0; i < 10; i++) {
      if (offset >= buffer.length) throw new Error('QQ 小程序回包不完整')
      const byte = buffer[offset++]
      if (i === 9 && byte > 1) throw new Error('QQ 小程序回包整数无效')
      value |= BigInt(byte & 127) << BigInt(i * 7)
      if (!(byte & 128)) return value
    }
    throw new Error('QQ 小程序回包整数无效')
  }
  while (offset < buffer.length) {
    const key = readVarint(), field = Number(key >> 3n), wire = Number(key & 7n)
    if (field < 1 || field > 0x1fffffff) throw new Error('QQ 小程序回包字段无效')
    let value
    if (wire === 0) value = readVarint()
    else if (wire === 2) {
      const length = readVarint()
      if (length > BigInt(buffer.length - offset)) throw new Error('QQ 小程序回包长度无效')
      const end = offset + Number(length)
      value = buffer.subarray(offset, end); offset = end
    } else if (wire === 1 || wire === 5) {
      offset += wire === 1 ? 8 : 4
      if (offset > buffer.length) throw new Error('QQ 小程序回包不完整')
      continue
    } else throw new Error('QQ 小程序回包类型无效')
    values.set(field, value)
  }
  return values
}

function parseMiniAppResponse(response) {
  if (response?.cmd && response.cmd !== COMMAND) throw new Error('QQ 小程序回包命令不匹配')
  const hex = response?.hex
  if (typeof hex !== 'string' || !hex.length || hex.length > MAX_PACKET * 2 || hex.length % 2 || !/^[0-9a-f]+$/i.test(hex)) {
    throw new Error('LLBot 没有返回有效的小程序回包')
  }
  const outer = fields(Buffer.from(hex, 'hex')), content = outer.get(4)
  const json = Buffer.isBuffer(content) ? fields(content).get(2) : null
  if (!Buffer.isBuffer(json) || !json.length || json.length > 65536) {
    const status = outer.get(2)
    throw new Error(`QQ 未返回小程序卡片${typeof status === 'bigint' ? `（状态 ${status}）` : ''}`)
  }
  let raw
  try { raw = JSON.parse(json.toString('utf8')) } catch { throw new Error('QQ 小程序卡片不是有效 JSON') }
  if (raw?.appName !== 'com.tencent.miniapp_01' || typeof raw.appView !== 'string' || !raw.appView.startsWith('view_') ||
      typeof raw.ver !== 'string' || !raw.ver || !raw.config || typeof raw.config !== 'object' || Array.isArray(raw.config) ||
      String(raw.metaData?.detail_1?.appid) !== APP_ID || typeof raw.metaData?.detail_1?.url !== 'string' || !raw.metaData.detail_1.url) {
    throw new Error('QQ 返回的内容不是有效的 B 站小程序卡片')
  }
  return {
    app: raw.appName, view: raw.appView, ver: raw.ver, prompt: raw.prompt,
    config: raw.config, meta: raw.metaData, miniappShareOrigin: 3, miniappOpenRefer: '10002',
  }
}

module.exports = { COMMAND, buildMiniAppRequest, parseMiniAppResponse }
