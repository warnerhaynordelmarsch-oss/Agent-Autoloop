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
