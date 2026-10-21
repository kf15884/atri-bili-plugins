"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { App, h } = require("koishi"),
  HTTP = require("@koishijs/plugin-http").default,
  SQLite = require("@koishijs/plugin-database-sqlite").default,
  HDS = require("koishi-plugin-hds-interlude"),
  bili = require(".."),
  eyes = require("../../atri-bili-eyes"),
  { Api } = require("../api");
const V = "BV1Yw7M6RERb",
  url = `https://www.bilibili.com/video/${V}/`,
  body = url + "这个分镜很有意思。<sep/>想听听你怎么看。",
  rec = {
    bvid: V,
    detail: {
      bvid: V,
      title: "动画分镜",
      pic: "https://i0.hdslb.com/bfs/archive/unit.jpg",
    },
    note: "实际字幕：作者从分镜一步步制作动画。仅API资料。",
  };
for (const order of ["bili-first", "hds-first"])
  test(
    "real Koishi + HDS " +
      HDS.version +
      " + SQLite: " +
      order +
      " hooks and commit keep original format and policy",
    { timeout: 20000 },
    async (t) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bili070-hds-")),
        app = new App();
      app.baseDir = dir;
      let middleware, sharedMiddleware;
      app.plugin(HTTP, {});
      app.plugin(SQLite, { path: path.join(dir, "koishi.db") });
      const oldMiddleware = app.middleware.bind(app);
      app.middleware = (fn, ...args) => {
        if (fn.toString().includes("/bili")) middleware = fn;
        if (fn.toString().includes("prepareShared")) sharedMiddleware = fn;
        return oldMiddleware(fn, ...args);
      };
      const cfg = bili.Config({
        targetUserId: "1000000001",
        selfId: "1000000002",
        quietStart: 0,
        quietEnd: 0,
        autoEnabled: false,
        candidateLimit: 1,
      });
      const hc = HDS.Config({
        storyDefaults: {
          characterName: "Atri",
          characterProfile: "原人设不修改",
          world: "原世界不修改",
        },
        runtime: {
          autoAdvanceEnabled: false,
          allowProactiveMessages: false,
          splitReplyMessages: true,
          messageSeparator: "<sep/>",
        },
        model: { providers: [] },
        memory: { enabled: false },
        onebot: { enabled: false },
        logging: { logScriptPreview: false },
      });
      const bp = () => {
          app.plugin(bili, cfg);
          app.plugin(eyes, eyes.Config({watchPacing:false}));
        },
        hp = () => app.plugin(HDS, hc);
      if (order === "bili-first") {
        bp();
        hp();
      } else {
        hp();
        bp();
      }
      t.after(async () => {
        await app.stop();
        fs.rmSync(dir, { recursive: true, force: true });
      });
      await app.start();
      await new Promise((r) => setTimeout(r, 100));
      assert.ok(app.interlude);
      assert.ok(app.atriBiliApi);
      assert.ok(app.atriBiliEyes);
      const service = app.interlude,
        session = {
          platform: "onebot",
          selfId: "1000000002",
          userId: "1000000001",
          channelId: "private:1000000001",
          username: "测试用户",
          isDirect: true,
        };
      const story = await service.createStory(session),
        participant = await service.ensureParticipant(story, session),
        saved = JSON.stringify(story.setting),
        wrapped = service.getNarrator();
      // Replace only the underlying narrator's method, keeping the plugin decorator active.
      const original = Object.getPrototypeOf(wrapped),
        decide = original.decide;
      let observed;
      original.decide = async function (r) {
        observed = r;
        return {
          script:
            "Atri看到字幕里作者制作分镜的过程，觉得有意思，给对方发消息说：“" +
            url +
            "这个分镜很有意思。”",
          interaction: {
            seen: true,
            reply: { mode: "immediate", content: body },
          },
        };
      };
      const note = Api.prototype.note,
        popular = Api.prototype.popular;
      Api.prototype.note = async () => rec;
      Api.prototype.popular = async () => [rec.detail];
      t.after(() => {
        original.decide = decide;
        Api.prototype.note = note;
        Api.prototype.popular = popular;
      });
      assert.ok(middleware, "strict command middleware captured");
      const incoming = { ...session, content: "/bili pick 动画" },
        search = Api.prototype.search;
      Api.prototype.search = async () => [rec.detail];
      t.after(() => (Api.prototype.search = search));
      let input;
      await middleware(incoming, async () => {
        input = incoming.content;
      });
      assert.match(input, /atri-bili-request/);
      const req = {
        story,
        participant,
        participants: [participant],
        phase: "user-message",
        userMessage: input,
        webContext: [],
        writingOptions: {
          messageSeparator: "<sep/>",
          splitReplyMessages: true,
          browserMode: "disabled",
        },
      };
      const decision = await service.getNarrator().decide(req);
      assert.equal(decision.interaction.reply.content, body);
      assert.match(observed.story.setting.world, /实际字幕/);
      assert.equal(JSON.stringify(story.setting), saved);
      const now = new Date(),
        persisted = await service.serial(story.id, () =>
          service.persistDecision(
            story,
            participant,
            decision,
            now,
            now,
            true,
            "user-message",
            [],
          ),
        );
      assert.ok(persisted.scriptEntry);
      assert.ok(persisted.messages.length);
      assert.match(persisted.messages[0].content, /这个分镜很有意思/);
      assert.deepEqual(persisted.messages[0].laterSegments, [
        "想听听你怎么看。",
      ]);
      assert.equal(hc.runtime.allowProactiveMessages, false);
      assert.equal(hc.runtime.autoAdvanceEnabled, false);
      assert.equal(
        JSON.stringify(
          (await app.database.get("interlude_story", { id: story.id }))[0]
            .setting,
        ),
        saved,
      );
      const state = JSON.parse(
        fs.readFileSync(
          path.join(dir, "data/atri-bilibili/watch-state-v2.json"),
          "utf8",
        ),
      );
      assert.equal(
        state.shares.length,
        0,
        "model result and persisted script alone must never send a card",
      );
      const status = await middleware(
        { ...session, content: "/bili status" },
        () => {},
      );
      assert.match(status, /已挂接HDS/);
      assert.ok(sharedMiddleware, "eyes incoming middleware captured");
      for (const [i, source] of [
        V,
        url + '?share_source=copy',
        h('json', { data: JSON.stringify({meta:{detail_1:{appid:'1109937557',qqdocurl:url,desc:'not trusted'}}}) }).toString(),
      ].entries()) {
        const shared = { ...session, messageId: 'shared-' + i, content: source, elements: h.parse(source) };
        let forwarded = 0;
        await sharedMiddleware(shared, () => forwarded++);
        assert.equal(forwarded, 1);
        assert.match(shared.content, /atri-bili-request/);
        const sharedReq = {...req, userMessage: shared.content};
        const sharedDecision = await service.getNarrator().decide(sharedReq);
        assert.equal(sharedDecision.interaction.reply.content, body);
        assert.match(observed.story.setting.world, /实际字幕/);
        assert.match(observed.story.setting.world, /默认只发对话/);
        assert.equal(JSON.stringify(story.setting), saved);
        assert.equal(observed.onEarlyReply, undefined);
      }

    },
  );
