"use strict";
const https = require("node:https"),
  dns = require("node:dns"),
  net = require("node:net"),
  zlib = require("node:zlib");
class Fault extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
function publicIP(a) {
  if (net.isIP(a) === 4) {
    const [x, y] = a.split(".").map(Number);
    return !(
      x === 0 ||
      x === 10 ||
      x === 127 ||
      x >= 224 ||
      (x === 169 && y === 254) ||
      (x === 172 && y >= 16 && y <= 31) ||
      (x === 192 && [0, 168].includes(y)) ||
      (x === 100 && y >= 64 && y <= 127) ||
      (x === 198 && [18, 19].includes(y))
    );
  }
  if (net.isIP(a) === 6)
    return /^2[0-9a-f]{3}:/i.test(a) && !/^2001:(?:db8|0):/i.test(a);
  return false;
}
function lookup(host, opts, cb) {
  dns.lookup(host, { all: true }, (e, rows) => {
    if (e) return cb(e);
    if (!rows.length || rows.some((x) => !publicIP(x.address)))
      return cb(new Fault("network-private-address"));
    const family = typeof opts === "object" ? opts.family : opts;
    const r = rows.find((x) => !family || x.family === family);
    if (!r) return cb(new Fault("network-family"));
    cb(null, opts?.all ? [r] : r.address, opts?.all ? undefined : r.family);
  });
}
function decode(buffer, enc, max) {
  try {
    const opt = { maxOutputLength: max };
    switch ((enc || "").toLowerCase()) {
      case "gzip":
        return zlib.gunzipSync(buffer, opt);
      case "br":
        return zlib.brotliDecompressSync(buffer, opt);
      case "deflate":
        try {
          return zlib.inflateSync(buffer, opt);
        } catch {
          return zlib.inflateRawSync(buffer, opt);
        }
      case "":
      case "identity":
        return buffer;
      default:
        throw Error();
    }
  } catch {
    throw new Fault("network-decode-or-size");
  }
}
function request(
  url,
  {
    method = "GET",
    headers = {},
    body,
    timeout = 20000,
    maxBytes = 2 * 1024 * 1024,
  } = {},
) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
      if (
        u.protocol !== "https:" ||
        u.username ||
        u.password ||
        (u.port && u.port !== "443") ||
        (net.isIP(u.hostname.replace(/^\[|\]$/g, "")) &&
          !publicIP(u.hostname.replace(/^\[|\]$/g, "")))
      )
        throw Error();
    } catch {
      return reject(new Fault("network-url"));
    }
    let settled = false;
    let req;
    const timer = setTimeout(
      () => req?.destroy(new Fault("network-timeout")),
      timeout,
    );
    const done = (err, v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      err ? reject(err) : resolve(v);
    };
    req = https.request(
      u,
      {
        method,
        headers: { "Accept-Encoding": "gzip, deflate, br", ...headers },
        lookup,
        agent: false,
        rejectUnauthorized: true,
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on("data", (c) => {
          size += c.length;
          if (size > maxBytes) req.destroy(new Fault("network-size"));
          else chunks.push(c);
        });
        res.on("error", () => done(new Fault("network-response")));
        res.on("aborted", () => done(new Fault("network-aborted")));
        res.on("end", () => {
          try {
            const bytes = decode(
              Buffer.concat(chunks),
              res.headers["content-encoding"],
              maxBytes,
            );
            if (bytes.length > maxBytes) throw new Fault("network-size");
            done(null, {
              status: res.statusCode,
              headers: res.headers,
              text: bytes.toString("utf8"),
            });
          } catch (e) {
            done(e);
          }
        });
      },
    );
    req.on("error", (e) =>
      done(
        new Fault(
          /CERT|TLS/.test(e.code || "")
            ? "network-tls-failed"
            : e instanceof Fault
              ? e.code
              : "network-connect",
        ),
      ),
    );
    if (body) req.write(body);
    req.end();
  });
}
module.exports = { request, Fault, publicIP, decode };
