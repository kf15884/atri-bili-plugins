"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const { Fault, cleanCookie, id } = require("./api");
const { atomic } = require("./store");
const LOGIN_NAMES = new Set([
  "SESSDATA",
  "bili_jct",
  "DedeUserID",
  "DedeUserID__ckMd5",
  "sid",
  "buvid3",
  "buvid4",
]);
function value(v) {
  if (
    typeof v !== "string" ||
    v.length > 4096 ||
    !/^[\x21-\x3a\x3c-\x7e]*$/.test(v)
  )
    throw new Fault("session-cookie-invalid");
  return v;
}
function put(out, k, v) {
  if (Object.hasOwn(out, k) && out[k] !== v)
    throw new Fault("session-cookie-conflict");
  out[k] = value(v);
}
function parseCookie(raw) {
  const out = Object.create(null);
  for (const piece of cleanCookie(raw).split(";")) {
    if (!piece.trim()) continue;
    const i = piece.indexOf("="),
      k = piece.slice(0, i).trim();
    if (i < 1 || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(k))
      throw new Fault("session-cookie-invalid");
    put(out, k, piece.slice(i + 1).trim());
  }
  return out;
}
function joinCookie(parts) {
  return cleanCookie(
    Object.entries(parts)
      .map(([k, v]) => `${k}=${value(v)}`)
      .join("; "),
  );
}
function parseQrCookies(data, headers = {}) {
  const out = Object.create(null);
  let lines =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : headers["set-cookie"] || [];
  if (typeof lines === "string") lines = [lines];
  if (
    !Array.isArray(lines) ||
    lines.length > 64 ||
    lines.some((x) => typeof x !== "string") ||
    lines.join("").length > 32768
  )
    throw new Fault("qr-cookie-invalid");
  for (const line of lines) {
    if (/[\r\n\0]/.test(line)) throw new Fault("qr-cookie-invalid");
    // Split a collapsed Set-Cookie only at a new cookie name, never at Expires' weekday comma.
    for (const item of line.split(/,(?=\s*[A-Za-z0-9_]+\s*=)/)) {
      const first = item.split(";", 1)[0].trim(),
        i = first.indexOf("=");
      if (i > 0 && LOGIN_NAMES.has(first.slice(0, i)))
        put(out, first.slice(0, i), first.slice(i + 1));
    }
  }
  if (data?.url) {
    let u;
    try {
      u = new URL(data.url);
    } catch {
      throw new Fault("qr-cookie-url-invalid");
    }
    // Parsing only: never fetch cross-domain URL or forward cookies to it.
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.port ||
      !["passport.bilibili.com", "passport.biligame.com"].includes(
        u.hostname,
      ) ||
      !["/crossDomain", "/x/passport-login/web/crossDomain"].includes(
        u.pathname,
      )
    )
      throw new Fault("qr-cookie-url-invalid");
    for (const item of u.search.slice(1).split("&")) {
      const i = item.indexOf("="),
        k = item.slice(0, i);
      if (i > 0 && LOGIN_NAMES.has(k)) put(out, k, item.slice(i + 1));
    }
  }
  if (!out.SESSDATA || !out.bili_jct || !out.DedeUserID)
    throw new Fault("qr-cookie-incomplete");
  id(out.DedeUserID);
  return joinCookie(out);
}
function devicePart(v) {
  if (typeof v !== "string" || !/^[A-Za-z0-9._%~-]{8,256}$/.test(v))
    throw new Fault("device-response-invalid");
  return v;
}
class Session {
  constructor(dir, manual = () => "") {
    this.manual = manual;
    this.file = path.join(dir, "account-session.json");
    this.deviceFile = path.join(dir, "device-session.json");
    this.stored = "";
    this.device = {};
    this.vaultFault = false;
    this.deviceFault = false;
    this.closed = false;
    this.generation = 0;
    this.pending = null;
    this.attemptFailed = false;
    try {
      const d = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (d.version !== 1 || typeof d.cookie !== "string") throw Error();
      parseCookie(d.cookie);
      this.stored = d.cookie;
      fs.chmodSync(this.file, 0o600);
    } catch (e) {
      if (e.code !== "ENOENT") this.vaultFault = true;
    }
    try {
      const d = JSON.parse(fs.readFileSync(this.deviceFile, "utf8"));
      if (d.version !== 1 || d.source !== "official-spi") throw Error();
      devicePart(d.buvid3);
      if (d.buvid4) devicePart(d.buvid4);
      this.device = d;
      fs.chmodSync(this.deviceFile, 0o600);
    } catch (e) {
      if (e.code !== "ENOENT") this.deviceFault = true;
    }
  }
  base() {
    if (this.closed) throw new Fault("execution-disposed");
    if (this.vaultFault) throw new Fault("vault-unavailable");
    return parseCookie(this.manual() || this.stored);
  }
  effective() {
    const base = this.base();
    if (base.buvid3 || base.buvid4)
      return { base, source: this.manual() ? "手填Cookie" : "扫码Cookie" };
    if (this.deviceFault) throw new Fault("device-session-unavailable");
    return {
      base: {
        ...base,
        ...(this.device.buvid3 ? { buvid3: this.device.buvid3 } : {}),
        ...(this.device.buvid4 ? { buvid4: this.device.buvid4 } : {}),
      },
      source: this.device.buvid3 ? "官方SPI本地缓存" : "未准备",
    };
  }
  cookie() {
    return joinCookie(this.effective().base);
  }
  status() {
    try {
      const { base, source } = this.effective();
      return {
        loginSource: this.manual()
          ? "手填Cookie"
          : this.stored
            ? "扫码文件"
            : "无",
        sessdata: !!base.SESSDATA,
        csrf: !!base.bili_jct,
        uid: !!base.DedeUserID,
        buvid3: !!base.buvid3,
        buvid4: !!base.buvid4,
        source,
        failed: this.attemptFailed,
        fault: false,
      };
    } catch (e) {
      return {
        fault: true,
        code: e instanceof Fault ? e.code : "session-local-error",
      };
    }
  }
  async prepare(api, { explicit = false } = {}) {
    const current = this.effective();
    if (current.base.buvid3) return this.status();
    if (current.base.buvid4) throw new Fault("device-partial-review-required");
    if (this.pending) return this.pending;
    if (this.attemptFailed && !explicit)
      throw new Fault("device-prepare-explicit-required");
    const generation = this.generation;
    // Do not mix a new result into a different login or manually changed configuration.
    const before = joinCookie(this.base());
    this.pending = (async () => {
      try {
        const d = await api.buvid();
        const next = {
          version: 1,
          source: "official-spi",
          buvid3: devicePart(d.buvid3),
          buvid4: d.buvid4 ? devicePart(d.buvid4) : "",
          savedAt: Date.now(),
        };
        if (
          this.closed ||
          generation !== this.generation ||
          before !== joinCookie(this.base())
        )
          throw new Fault("session-changed");
        try {
          atomic(this.deviceFile, next);
        } catch {
          this.deviceFault = true;
          throw new Fault("device-save-failed");
        }
        this.device = next;
        this.attemptFailed = false;
        return this.status();
      } catch (e) {
        this.attemptFailed = true;
        throw e instanceof Fault ? e : new Fault("device-prepare-failed");
      }
    })();
    try {
      return await this.pending;
    } finally {
      this.pending = null;
    }
  }
  saveLogin(raw, nav, expectedUid = "") {
    if (this.closed) throw new Fault("execution-disposed");
    if (this.vaultFault) throw new Fault("vault-unavailable");
    if (this.manual()) throw new Fault("manual-cookie-present");
    const c = parseCookie(raw);
    if (
      !c.SESSDATA ||
      !c.bili_jct ||
      !c.DedeUserID ||
      !nav?.isLogin ||
      id(c.DedeUserID) !== id(nav.mid) ||
      (expectedUid && id(expectedUid) !== id(nav.mid))
    )
      throw new Fault("account-uid-mismatch");
    const cookie = joinCookie(c);
    try {
      atomic(this.file, { version: 1, cookie });
    } catch {
      this.vaultFault = true;
      throw new Fault("vault-save-failed");
    }
    this.stored = cookie;
    this.generation++;
    this.attemptFailed = false;
  }
  clear() {
    atomic(this.file, { version: 1, cookie: "" });
    this.stored = "";
    this.vaultFault = false;
    this.generation++;
    this.attemptFailed = false;
  }
  close() {
    this.closed = true;
    this.generation++;
  }
}
function sessionSummary(s) {
  if (s.fault) return `会话文件/格式检查未通过 [${s.code}]；未输出凭据。`;
  return `登录来源：${s.loginSource}；SESSDATA：${s.sessdata ? "有" : "无"}；CSRF：${s.csrf ? "有" : "无"}；UID字段：${s.uid ? "有" : "无"}\n设备标识：buvid3=${s.buvid3 ? "有" : "无"}；buvid4=${s.buvid4 ? "有" : "无"}；来源：${s.source}\n仅字段检查，不证明登录有效或QQ卡片展示。未输出Cookie/设备标识值。${s.failed ? "\n此前准备失败；需本人执行 /bili prepare 才再次尝试。" : ""}`;
}
module.exports = {
  Session,
  parseCookie,
  joinCookie,
  parseQrCookies,
  sessionSummary,
  devicePart,
};
