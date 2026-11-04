// QQ Mail webhooks / bridge. Failure modes: a wrong or missing signature/token is accepted;
// urgent emails (verification code, security alerts, billing) are classified as normal unread;
// single or multiple message payload shapes fail to parse; payload data is improperly formatted.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import qqMail from "../plugins/qq-mail/source.ts";

const secret = "test-secret-key-12345";

function sign(body: string, s: string = secret) {
  return `sha256=${createHmac("sha256", s).update(body).digest("hex")}`;
}

test("qq-mail: normal unread mail with valid HMAC signature", () => {
  const mail = {
    uid: "1001",
    subject: "本周团队周报汇总",
    from: "colleague@example.com",
    date: "2026-11-04 10:00:00",
    snippet: "这是本周的研发与产品进展汇报，请查阅。",
  };
  const body = JSON.stringify(mail);
  const [event] = qqMail({
    headers: { "x-qq-mail-signature": sign(body) },
    body,
    secret,
  });

  assert.equal(event.id, "qq-mail-1001");
  assert.equal(event.type, "mail.unread");
  assert.equal(event.subject, "qq-mail:1001");
  assert.equal(event.summary, "[colleague@example.com] 本周团队周报汇总");
  assert.equal(event.detail, "这是本周的研发与产品进展汇报，请查阅。");
  assert.equal(event.link, "");
});

test("qq-mail: verification code in subject triggers mail.urgent", () => {
  const mail = {
    uid: "1002",
    subject: "【服务平台】您的验证码是 938210",
    from: "auth@service.com",
    date: "2026-11-04 10:05:00",
    snippet: "验证码 5 分钟内有效，请勿泄露给他人。",
  };
  const body = JSON.stringify(mail);
  const [event] = qqMail({
    headers: { "x-qq-mail-signature": sign(body) },
    body,
    secret,
  });

  assert.equal(event.id, "qq-mail-1002");
  assert.equal(event.type, "mail.urgent");
  assert.equal(event.subject, "qq-mail:1002");
  assert.equal(event.summary, "[auth@service.com] 【服务平台】您的验证码是 938210");
});

test("qq-mail: keywords (code, verification, 安全, 告警, 账单) or isVerificationCode trigger mail.urgent", () => {
  const urgentCases = [
    { uid: "201", subject: "Your verification code", snippet: "Use this code" },
    { uid: "202", subject: "GitHub security alert", snippet: "Suspicious login from new IP" },
    { uid: "203", subject: "云服务器紧急告警", snippet: "CPU 超过 95%" },
    { uid: "204", subject: "本月云服务账单通知", snippet: "请在到期前核实" },
    { uid: "205", subject: "Login notification", snippet: "nothing", isVerificationCode: true },
    { uid: "206", subject: "Notice", snippet: "Here is your one-time code: 4567" },
  ];

  for (const item of urgentCases) {
    const body = JSON.stringify(item);
    const [event] = qqMail({
      headers: { "x-qq-mail-signature": sign(body) },
      body,
      secret,
    });
    assert.equal(event.type, "mail.urgent", `Expected mail.urgent for ${item.subject}`);
  }
});

test("qq-mail: parses { messages: [...] } array and bare array", () => {
  const batch = {
    messages: [
      { uid: "301", subject: "通知一", from: "a@x.com", snippet: "内容一" },
      { uid: "302", subject: "账号安全告警", from: "b@x.com", snippet: "内容二" },
    ],
  };
  const bodyBatch = JSON.stringify(batch);
  const events = qqMail({
    headers: { "x-qq-mail-signature": sign(bodyBatch) },
    body: bodyBatch,
    secret,
  });
  assert.equal(events.length, 2);
  assert.equal(events[0].id, "qq-mail-301");
  assert.equal(events[0].type, "mail.unread");
  assert.equal(events[1].id, "qq-mail-302");
  assert.equal(events[1].type, "mail.urgent");

  const bareList = [
    { uid: "401", subject: "普通测试", from: "c@x.com", snippet: "详情" },
  ];
  const bodyBare = JSON.stringify(bareList);
  const [bareEvent] = qqMail({
    headers: { "x-qq-mail-signature": sign(bodyBare) },
    body: bodyBare,
    secret,
  });
  assert.equal(bareEvent.id, "qq-mail-401");
  assert.equal(bareEvent.type, "mail.unread");
});

test("qq-mail: supports Bearer token and x-qq-mail-token authentication", () => {
  const body = JSON.stringify({ uid: "501", subject: "通过 Bearer 鉴权", from: "admin@test.com" });

  const [evBearer] = qqMail({
    headers: { authorization: `Bearer ${secret}` },
    body,
    secret,
  });
  assert.equal(evBearer.id, "qq-mail-501");

  const [evToken] = qqMail({
    headers: { "x-qq-mail-token": secret },
    body,
    secret,
  });
  assert.equal(evToken.id, "qq-mail-501");
});

test("qq-mail: bad or missing signature / token throws error", () => {
  const body = JSON.stringify({ uid: "601", subject: "测试" });

  // Wrong HMAC signature
  assert.throws(
    () => qqMail({ headers: { "x-qq-mail-signature": sign(body, "wrong-secret") }, body, secret }),
    /signature/,
  );

  // Missing signature and auth header
  assert.throws(
    () => qqMail({ headers: {}, body, secret }),
    /signature/,
  );

  // Wrong Bearer token
  assert.throws(
    () => qqMail({ headers: { authorization: "Bearer wrong-token" }, body, secret }),
    /signature/,
  );

  // Empty secret
  assert.throws(
    () => qqMail({ headers: { "x-qq-mail-signature": sign(body) }, body, secret: "" }),
    /signature/,
  );
});

test("qq-mail: summary and detail are properly truncated", () => {
  const longSubject = "标".repeat(300);
  const longSnippet = "内".repeat(5000);
  const body = JSON.stringify({
    uid: "701",
    subject: longSubject,
    from: "bot@test.com",
    snippet: longSnippet,
  });

  const [event] = qqMail({
    headers: { "x-qq-mail-signature": sign(body) },
    body,
    secret,
  });

  assert.equal([...event.summary].length, 200);
  assert.equal([...event.detail].length, 4000);
});


import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";
import { parseRules } from "../protocol/rules.ts";
import { readMessage, resultFrom } from "../worker/contract.ts";

const ROOT = join(import.meta.dirname, "..");
const tmpDir = mkdtempSync(join(tmpdir(), "agent-autoloop-qqmail-"));
after(() => rmSync(tmpDir, { recursive: true, force: true }));

test("watch-qq-mail.sh: reads mail body via qq-mail read, detects body verification codes, truncates long body, and matches recipe rules", () => {
  const fakeBin = join(tmpDir, "fake-qq-mail");
  const longBody = "正".repeat(5000);
  writeFileSync(
    fakeBin,
    `#!/usr/bin/env node
const [cmd, arg] = process.argv.slice(2);
if (cmd === "list") {
  console.log(JSON.stringify([
    { uid: "2001", from: "notice@service.com", subject: "账户登录提醒", date: "2026-11-04" },
    { uid: "2002", from: "colleague@company.com", subject: "普通项目讨论", date: "2026-11-04" },
    { uid: "1999", from: "old@company.com", subject: "旧邮件", date: "2026-11-03" }
  ]));
} else if (cmd === "read" && arg === "2001") {
  console.log(JSON.stringify({ uid: "2001", from: "notice@service.com", subject: "账户登录提醒", body: "您好，您的动态登录验证码为 839201，5 分钟内有效。" }));
} else if (cmd === "read" && arg === "2002") {
  console.log(JSON.stringify({ uid: "2002", from: "colleague@company.com", subject: "普通项目讨论", body: ${JSON.stringify(longBody)} }));
} else {
  process.exit(1);
}
`,
  );
  chmodSync(fakeBin, 0o755);

  const done = spawnSync("sh", [join(ROOT, "examples", "watch-qq-mail.sh"), "10", "2000"], {
    env: { ...process.env, QQ_MAIL_BIN: fakeBin },
    encoding: "utf8",
  });
  assert.equal(done.status, 0, done.stderr);

  const { result, problem } = resultFrom(readMessage(done.stdout), {});
  assert.equal(problem, undefined);
  assert.equal(result.outcome, "done");
  const events = result.events!;
  assert.equal(events.length, 2);

  // 2001: ordinary subject, but body has "验证码" -> must be classified as mail.urgent and carry full body
  assert.equal(events[0].id, "qq-mail-2001");
  assert.equal(events[0].type, "mail.urgent");
  assert.match(events[0].detail, /839201/);

  // 2002: normal subject & body, 5000 chars truncated to 4000
  assert.equal(events[1].id, "qq-mail-2002");
  assert.equal(events[1].type, "mail.unread");
  assert.equal([...events[1].detail].length, 4000);

  // Verify compatibility with examples/recipes/qq-mail-triage/rules.json
  const rawRules = readFileSync(join(ROOT, "examples", "recipes", "qq-mail-triage", "rules.json"), "utf8");
  const parsed = parseRules(rawRules, 0, "Asia/Shanghai");
  const watcherAgent = parsed.agents.watcher;
  assert.ok(!watcherAgent.command!.some((arg) => arg.startsWith("~")), "command must not rely on unexpanded ~");
  const watcherRule = parsed.rules.find((r) => r.emits);
  const handlerRule = parsed.rules.find((r) => r.when.source === "qq-mail");
  assert.ok(watcherRule && handlerRule);
  assert.equal(watcherRule.emits!.source, handlerRule.when.source);
  assert.deepEqual(watcherRule.emits!.types, handlerRule.when.types);
  for (const ev of events) {
    assert.ok(watcherRule.emits!.types.includes(ev.type));
    assert.ok(handlerRule.when.types!.includes(ev.type));
  }
});

test("watch-qq-mail.sh: fails explicitly with non-zero exit code when qq-mail fails or prints invalid JSON", () => {
  const brokenBin = join(tmpDir, "broken-qq-mail");
  writeFileSync(brokenBin, "#!/bin/sh\necho 'IMAP error' >&2\nexit 1\n");
  chmodSync(brokenBin, 0o755);

  const failedCli = spawnSync("sh", [join(ROOT, "examples", "watch-qq-mail.sh"), "10"], {
    env: { ...process.env, QQ_MAIL_BIN: brokenBin },
    encoding: "utf8",
  });
  assert.notEqual(failedCli.status, 0);

  const badJsonBin = join(tmpDir, "badjson-qq-mail");
  writeFileSync(badJsonBin, "#!/bin/sh\necho 'not-valid-json'\n");
  chmodSync(badJsonBin, 0o755);

  const failedJson = spawnSync("sh", [join(ROOT, "examples", "watch-qq-mail.sh"), "10"], {
    env: { ...process.env, QQ_MAIL_BIN: badJsonBin },
    encoding: "utf8",
  });
  assert.notEqual(failedJson.status, 0);
});

// Failure mode: installer accepts an unsupported Node release or rejects a supported one.
test("install.sh: enforces Node 22.16 minimum", () => {
  const bin = join(tmpDir, "install-bin");
  mkdirSync(bin, { recursive: true });
  const realNode = process.execPath;
  writeFileSync(join(bin, "node"), `#!/bin/sh
if [ "$1" = "-v" ]; then echo "v$TEST_NODE_VERSION"; exit; fi
exec "${realNode}" -e 'Object.defineProperty(process.versions, "node", { value: process.env.TEST_NODE_VERSION }); eval(process.argv[1])' "$2"
`);
  writeFileSync(join(bin, "git"), "#!/bin/sh\necho git-reached >&2\nexit 42\n");
  chmodSync(join(bin, "node"), 0o755);
  chmodSync(join(bin, "git"), 0o755);
  for (const [version, accepted] of [["22.15.0", false], ["22.16.0", true], ["24.0.0", true]] as const) {
    const run = spawnSync("sh", [join(ROOT, "install.sh")], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TEST_NODE_VERSION: version, AGENT_AUTOLOOP_HOME: join(tmpDir, `home-${version}`) },
      encoding: "utf8",
    });
    assert.equal(run.stderr.includes("git-reached"), accepted, version);
    if (!accepted) assert.match(run.stdout, /需要 Node.js 22\.16/);
  }
});
