'use strict'
// Fixed-origin account operations. No generic POST tool, automatic retry,
// captcha bypass, invented playback duration, or model-selected @ recipients.
const crypto = require('node:crypto')
const API = 'https://api.bilibili.com'
const uid = value => /^[1-9]\d{0,15}$/.test(String(value || ''))
  && Number.isSafeInteger(Number(value)) ? String(value) : ''
const fingerprint = cookie => crypto.createHash('sha256').update(String(cookie || '')).digest('hex')
const cookieValue = (cookie, key) => new RegExp('(?:^|;\\s*)' + key + '=([^;]*)').exec(cookie || '')?.[1]?.trim() || ''
function assertNoSecrets(value, config = {}, service) {
  const candidates = [config.apiKey, config.researchApiKey, ...(service?.config?.model?.providers || []).map(p => p.apiKey)]
  for (const segment of String(config.cookie || '').split(';')) {
    const match = /^\s*(SESSDATA|bili_jct|buvid3|buvid4|sid)=([\s\S]*)$/i.exec(segment)
    if (match) {
      candidates.push(match[2])
      try { candidates.push(decodeURIComponent(match[2])) } catch {}
    }
  }
  const text = String(value || '')
  if (candidates.some(secret => typeof secret === 'string' && secret.length >= 8 && text.includes(secret))) throw Error('known-secret-in-public-text')
}

function publicSentence(value, config = {}) {
  if (typeof value !== 'string') throw Error('comment-not-text')
  const message = value.normalize('NFC').trim()
  if (!message || [...message].length > Math.min(config.commentMaxChars || 100, 180)
    || /[\r\n\u0000-\u001f\u007f@＠<>`]/u.test(message)) throw Error('comment-format')
  const stops = message.match(/[。！？!?]|(?<!\d)\.(?!\d)/gu) || []
  if (stops.length > 1) throw Error('comment-one-sentence')
  if (/(?:https?:|www\.|[a-z0-9-]+\.(?:com|cn|net|org|io)\b)|[\w.+-]+@|(?:\d[\s-]*){5,}/iu.test(message)
    || /(?:SESSDATA|bili_jct|api[_ -]?key|token\s*[:=]|sk-[a-z0-9]{12,}|-----BEGIN|ssh-(?:rsa|ed25519))/iu.test(message)
    || /(?:身份证|手机号|家庭住址|私钥|密码是|订阅链接|我的QQ|你的QQ|我们的聊天记录|私聊里你|私聊里我)/u.test(message)) {
    throw Error('comment-private-data')
  }
  if (/(?:完整看完|全部看完|从头看到尾|整片看完|我听到|我看到画面)/u.test(message)) throw Error('comment-overclaim')
  if ((config.blockWords || []).some(word => word && message.includes(word))) throw Error('comment-blockword')
  return message
}

class AccountError extends Error {
  constructor(kind, code) { super(kind); this.name = 'AccountError'; this.kind = kind; if (Number.isFinite(code)) this.code = code }
}

function createAccountClient(bili) {
  async function post(path, fields, cookie, beforeSend) {
    if (typeof beforeSend !== 'function' || !await beforeSend()) throw new AccountError('cancelled-before-send')
    const csrf = cookieValue(cookie, 'bili_jct')
    if (!csrf || !cookieValue(cookie, 'SESSDATA')) throw new AccountError('missing-auth', -111)
    let response, json
    try {
      response = await fetch(API + path, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { ...bili.headers(), Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ ...fields, csrf }),
      })
      json = await response.json()
    } catch {
      // The server might already have accepted a write. Never retry it.
      throw new AccountError('unknown')
    }
    if (Number.isFinite(json?.code) && json.code !== 0) throw new AccountError('rejected', json.code)
    if (!response.ok || json?.code !== 0) throw new AccountError('unknown')
    return json.data || {}
  }
  return {
    async mention(value) {
      const mid = uid(value)
      if (!mid) throw new AccountError('invalid-target')
      const data = await bili.get(API + '/x/web-interface/card', { mid })
      const card = data?.card
      if (uid(card?.mid) !== mid || typeof card?.name !== 'string'
        || !card.name || [...card.name].length > 32 || /[\s\u0000-\u001f\u007f@＠<>]/u.test(card.name)) {
        throw new AccountError('target-not-verified')
      }
      return { mid, name: card.name }
    },
    async comment({ aid, message, mention, cookie, beforeSend }) {
      if (!uid(aid) || !uid(mention?.mid) || !mention?.name) throw new AccountError('invalid-comment-target')
      const body = publicSentence(message, { commentMaxChars: 180 })
      const d = await post('/x/v2/reply/add', {
        type: '1', oid: String(aid), root: '0', parent: '0', plat: '1',
        message: `${body} @${mention.name} `,
        at_name_to_mid: JSON.stringify({ [mention.name]: Number(mention.mid) }),
      }, cookie, beforeSend)
      if (d.need_captcha) throw new AccountError('verification-required')
      const rpid = String(d.rpid_str || d.rpid || d.reply?.rpid_str || d.reply?.rpid || '')
      if (!/^[1-9]\d{0,22}$/.test(rpid)) throw new AccountError('unknown')
      const members = d.reply?.content?.members || []
      return { status: 'accepted', rpid,
        mentionStatus: members.some(member => uid(member.mid) === mention.mid) ? 'acknowledged' : 'unverified',
        mentionUid: mention.mid, mentionName: mention.name, mentionBindingSubmitted: true, visibility: 'unverified', notification: 'unverified' }
    },
    async openHistory({ bvid, aid, cid, cookie, beforeSend }) {
      if (!uid(aid) || !uid(cid)) throw new AccountError('invalid-history-target')
      // Do not reset an existing human playback position. If the response
      // omits either field or indicates any previous playback, do not write.
      const progress = await bili.get(API + '/x/player/wbi/v2', { bvid, cid }, true)
      if (progress?.last_play_time !== 0 || progress?.last_play_cid !== 0) {
        return { status: 'skipped-preserve-progress', progressSeconds: null }
      }
      await post('/x/v2/history/report', { aid: String(aid), cid: String(cid), progress: '0' }, cookie, beforeSend)
      return { status: 'accepted-open-only', progressSeconds: 0 }
    },
  }
}
module.exports = { uid, fingerprint, cookieValue, publicSentence, assertNoSecrets, AccountError, createAccountClient }