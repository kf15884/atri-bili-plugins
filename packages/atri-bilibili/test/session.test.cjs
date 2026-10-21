"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const {
  Session,
  parseCookie,
  joinCookie,
  parseQrCookies,
  sessionSummary,
} = require("../session");
const { Api, Fault } = require("../api"),
  { atomic } = require("../store");
const C =
  "SESSDATA=unit%2Fsession%2C%2B; bili_jct=csrf123; DedeUserID=1000000001";
const DEV = {
  buvid3: "official-unit-device-3",
  buvid4: "official-unit-device-4",
};
function fixture(t, manual = () => "") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session062-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, s: new Session(dir, manual) };
}
function qrUrl(extra = "") {
  return (
    "https://passport.biligame.com/crossDomain?SESSDATA=unit%2Fsession%2C%2B&bili_jct=csrf123&DedeUserID=1000000001" +
    extra
  );
}
test("QR: merge Set-Cookie and raw URL without decoding or retaining unrelated fields", () => {
  const c = parseQrCookies(
    {
      url: qrUrl("&gourl=https%3A%2F%2Fexample.com&refresh_token=do-not-save"),
    },
    {
      "set-cookie": [
        "DedeUserID=1000000001; Secure; HttpOnly",
        "sid=abc123; Path=/",
      ],
    },
  );
  assert.equal(parseCookie(c).SESSDATA, "unit%2Fsession%2C%2B");
  assert.equal(parseCookie(c).sid, "abc123");
  assert.ok(!c.includes("refresh_token"));
  assert.ok(!c.includes("gourl"));
});
test("QR: safely parse collapsed Set-Cookie containing Expires comma", () => {
  const c = parseQrCookies(
    {},
    {
      "set-cookie":
        "SESSDATA=encoded%2Fvalue; Expires=Wed, 21 Oct 2030 07:28:00 GMT, bili_jct=csrf123; Path=/, DedeUserID=1000000001; Secure",
    },
  );
  assert.equal(parseCookie(c).SESSDATA, "encoded%2Fvalue");
  assert.equal(parseCookie(c).DedeUserID, "1000000001");
});
test("QR: supports headers getSetCookie without fetching URLs", () => {
  assert.equal(
    parseCookie(
      parseQrCookies(
        {},
        {
          getSetCookie: () => [
            "SESSDATA=test",
            "bili_jct=test",
            "DedeUserID=1000000001",
          ],
        },
      ),
    ).bili_jct,
    "test",
  );
});
for (const url of [
  "https://evil.test/crossDomain",
  "https://passport.biligame.com.evil.test/crossDomain",
  "http://passport.biligame.com/crossDomain",
  "https://user:secret@passport.biligame.com/crossDomain",
  "https://passport.biligame.com:444/crossDomain",
  "https://passport.biligame.com/other",
])
  test("QR: disallow unsafe or unrelated URL " + url, () =>
    assert.throws(() => parseQrCookies({ url }, {}), /qr-cookie-url-invalid/),
  );
test("QR: refuse conflicts across sources and incomplete authentication", () => {
  assert.throws(
    () =>
      parseQrCookies(
        { url: qrUrl() },
        { "set-cookie": ["DedeUserID=1000000002"] },
      ),
    /conflict/,
  );
  assert.throws(
    () => parseQrCookies({ url: qrUrl("&DedeUserID=1000000002") }, {}),
    /conflict/,
  );
  assert.throws(
    () => parseQrCookies({}, { "set-cookie": "SESSDATA=abc" }),
    /incomplete/,
  );
  assert.throws(
    () =>
      parseQrCookies({}, { "set-cookie": "SESSDATA=abc\r\nInjected=secret" }),
    /invalid/,
  );
});
test("cookie: keep opaque encodings; reject control, invalid syntax, conflicting fields", () => {
  assert.equal(joinCookie(parseCookie(C)), C);
  for (const c of ["SESSDATA=a; SESSDATA=b", "SESSDATA=a\nb", "bad name=x"])
    assert.throws(() => parseCookie(c));
});
test("device: officially fetched once, persisted0600, stable across restart", async (t) => {
  const { dir, s } = fixture(t, () => C);
  let calls = 0;
  const api = {
    buvid: async () => {
      calls++;
      return DEV;
    },
  };
  await s.prepare(api);
  const cookie = s.cookie();
  assert.ok(cookie.includes(DEV.buvid3));
  assert.equal(fs.statSync(s.deviceFile).mode & 0o777, 0o600);
  const restarted = new Session(dir, () => C);
  await restarted.prepare(api);
  assert.equal(restarted.cookie(), cookie);
  assert.equal(calls, 1);
  const text = sessionSummary(restarted.status());
  assert.ok(!text.includes(DEV.buvid3));
  assert.ok(!text.includes("unit%2F"));
  assert.ok(!text.includes("csrf123"));
});
test("device: concurrent preparations are single-flight", async (t) => {
  const { s } = fixture(t, () => C);
  let calls = 0;
  const api = {
    buvid: async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return DEV;
    },
  };
  await Promise.all([s.prepare(api), s.prepare(api)]);
  assert.equal(calls, 1);
});
test("device: existing manual buvid reused, never mixed with cached other pair", async (t) => {
  const { dir } = fixture(t);
  atomic(path.join(dir, "device-session.json"), {
    version: 1,
    source: "official-spi",
    ...DEV,
  });
  const s = new Session(dir, () => C + "; buvid3=manual-device-three");
  let calls = 0;
  await s.prepare({
    buvid: async () => {
      calls++;
      return DEV;
    },
  });
  assert.equal(calls, 0);
  assert.equal(parseCookie(s.cookie()).buvid3, "manual-device-three");
  assert.equal(parseCookie(s.cookie()).buvid4, undefined);
});
test("device: partial b4-only cookie does not silently rotate or combine identities", async (t) => {
  const { s } = fixture(t, () => C + "; buvid4=manual-device-four");
  let calls = 0;
  await assert.rejects(
    s.prepare({
      buvid: async () => {
        calls++;
        return DEV;
      },
    }),
    /partial-review/,
  );
  assert.equal(calls, 0);
});
test("device: failure no random fallback, explicit retry only", async (t) => {
  const { s } = fixture(t, () => C);
  let calls = 0;
  const api = {
    buvid: async () => {
      calls++;
      throw new Fault("network-timeout");
    },
  };
  await assert.rejects(s.prepare(api), /network-timeout/);
  assert.equal(s.status().buvid3, false);
  assert.equal(fs.existsSync(s.deviceFile), false);
  await assert.rejects(s.prepare(api), /explicit-required/);
  assert.equal(calls, 1);
  await s.prepare(
    {
      buvid: async () => {
        calls++;
        return DEV;
      },
    },
    { explicit: true },
  );
  assert.equal(calls, 2);
});
test("device: invalid SPI data never persists or generates replacement", async (t) => {
  const { s } = fixture(t, () => C);
  await assert.rejects(
    s.prepare({ buvid: async () => ({ buvid3: "bad; Cookie=secret" }) }),
    /response-invalid/,
  );
  assert.equal(fs.existsSync(s.deviceFile), false);
});
test("device: disposed task cannot persist late response", async (t) => {
  const { s } = fixture(t, () => C);
  let resolve;
  const task = s.prepare({ buvid: () => new Promise((r) => (resolve = r)) });
  s.close();
  resolve(DEV);
  await assert.rejects(task, /session-changed/);
  assert.equal(fs.existsSync(s.deviceFile), false);
});
test("device: manual cookie change during request invalidates result", async (t) => {
  let raw = C;
  const { s } = fixture(t, () => raw);
  let resolve;
  const task = s.prepare({ buvid: () => new Promise((r) => (resolve = r)) });
  raw = C.replace("1000000001", "1000000002");
  resolve(DEV);
  await assert.rejects(task, /session-changed/);
});
test("login: legacy file compatible, same-session UID check and no auth mixing", (t) => {
  const { dir, s } = fixture(t);
  atomic(s.file, { version: 1, cookie: C });
  const restored = new Session(dir);
  assert.equal(restored.cookie(), C);
  assert.throws(
    () => s.saveLogin(C, { isLogin: true, mid: "1000000002" }),
    /mismatch/,
  );
  assert.throws(
    () => s.saveLogin(C, { isLogin: true, mid: "1000000001" }, "1000000002"),
    /mismatch/,
  );
  s.saveLogin(C, { isLogin: true, mid: "1000000001" }, "1000000001");
  assert.equal(s.cookie(), C);
  assert.equal(fs.statSync(s.file).mode & 0o777, 0o600);
  let manual = "SESSDATA=manual-only";
  const m = new Session(dir, () => manual);
  assert.equal(m.cookie(), manual);
  assert.equal(m.status().csrf, false);
  assert.throws(
    () => m.saveLogin(C, { isLogin: true, mid: "1000000001" }),
    /manual-cookie-present/,
  );
});
test("device: logout preserves stable device only, removes stored authentication", async (t) => {
  const { s } = fixture(t);
  s.saveLogin(C, { isLogin: true, mid: "1000000001" });
  await s.prepare({ buvid: async () => DEV });
  s.clear();
  assert.equal(s.status().sessdata, false);
  assert.equal(s.status().buvid3, true);
});
test("session: corrupted vault or device fails closed", (t) => {
  const { dir, s } = fixture(t);
  fs.writeFileSync(s.file, "broken");
  const broken = new Session(dir);
  assert.equal(broken.status().fault, true);
  fs.unlinkSync(s.file);
  fs.writeFileSync(s.deviceFile, "broken");
  const brokenDevice = new Session(dir, () => C);
  assert.equal(brokenDevice.status().fault, true);
});
test("SPI: fixed GET with Origin, no login Cookie; anonymous reply likewise isolated", async () => {
  const calls = [];
  const api = new Api({
    cookie: () => C,
    transport: async (url, o) => {
      calls.push({ url, o });
      return {
        status: 200,
        text: JSON.stringify({
          code: 0,
          data: { b_3: DEV.buvid3, b_4: DEV.buvid4 },
        }),
      };
    },
  });
  assert.deepEqual(await api.buvid(), DEV);
  assert.ok(
    calls[0].url.startsWith("https://api.bilibili.com/x/frontend/finger/spi"),
  );
  assert.equal(calls[0].o.method, "GET");
  assert.equal(calls[0].o.headers.Cookie, undefined);
  assert.equal(calls[0].o.headers.Origin, "https://www.bilibili.com");
  await api.get("/x/web-interface/popular", {}, { auth: false });
  assert.equal(calls[1].o.headers.Cookie, undefined);
});
test("compat063: raw-comma opaque values are preserved for manual and old stored login", (t) => {
  const raw =
    "SESSDATA=unit-session,1900000000,opaque-token*test; bili_jct=unit-csrf; DedeUserID=1000000001";
  assert.equal(joinCookie(parseCookie(raw)), raw);
  const { dir, s } = fixture(t, () => raw);
  assert.equal(s.cookie(), raw);
  assert.equal(s.status().fault, false);
  atomic(s.file, { version: 1, cookie: raw });
  const restored = new Session(dir);
  assert.equal(restored.cookie(), raw);
  assert.equal(restored.status().fault, false);
  assert.equal(parseCookie("SESSDATA=abc%2Cdef").SESSDATA, "abc%2Cdef");
  for (const bad of [
    "SESSDATA=abc\r\nX-Injected=1",
    "SESSDATA=abc def",
    "SESSDATA=abc\u0000def",
    "SESSDATA=a; SESSDATA=b",
  ])
    assert.throws(() => parseCookie(bad));
});
test("compat063: raw comma Set-Cookie and collapsed header boundaries coexist", () => {
  const c = parseQrCookies(
    {},
    {
      "set-cookie":
        "SESSDATA=unit-session,1900000000,opaque-token*test; Expires=Wed, 21 Oct 2030 07:28:00 GMT, bili_jct=unit-csrf; Path=/, DedeUserID=1000000001; Secure",
    },
  );
  assert.equal(
    parseCookie(c).SESSDATA,
    "unit-session,1900000000,opaque-token*test",
  );
  assert.equal(parseCookie(c).bili_jct, "unit-csrf");
});
test("compat063: modern official crossDomain path permits raw commas without decode", () => {
  for (const host of ["passport.bilibili.com", "passport.biligame.com"]) {
    const c = parseQrCookies(
      {
        url:
          "https://" +
          host +
          "/x/passport-login/web/crossDomain?SESSDATA=unit-session,1900000000,opaque-token*test&bili_jct=unit-csrf&DedeUserID=1000000001",
      },
      {},
    );
    assert.equal(
      parseCookie(c).SESSDATA,
      "unit-session,1900000000,opaque-token*test",
    );
  }
});
