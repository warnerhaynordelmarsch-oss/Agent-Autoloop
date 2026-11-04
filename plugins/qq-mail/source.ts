// QQ Mail webhooks / bridge events, checked against the secret and turned into events: 'mail.urgent' or 'mail.unread'. In rules.json:
//   "sources": { "qq-mail": { "name": "QQ Mail", "adapter": "qq-mail" } }, and AGENT_AUTOLOOP_SECRET_QQ_MAIL in secrets.env.
import { createHmac, timingSafeEqual } from "node:crypto";

type Input = { headers: Record<string, string | string[] | undefined>; body: string; secret: string };

type MailMessage = {
  uid?: string | number;
  subject?: string;
  from?: string;
  date?: string;
  snippet?: string;
  isVerificationCode?: boolean;
};

const URGENT_PATTERN = /验证码|verification|code|安全|告警|账单|security|alert|bill/i;

function getHeader(headers: Record<string, string | string[] | undefined>, name: string): string {
  const target = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === target) {
      return String(Array.isArray(v) ? v[0] : (v ?? ""));
    }
  }
  return "";
}

function verifyAuth(headers: Record<string, string | string[] | undefined>, body: string, secret: string): boolean {
  if (!secret) return false;

  // 1. HMAC-SHA256 signature in x-qq-mail-signature: sha256=...
  const sigHeader = getHeader(headers, "x-qq-mail-signature");
  if (sigHeader) {
    const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    if (sigHeader.length === expected.length && timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expected))) {
      return true;
    }
  }

  // 2. Direct token in x-qq-mail-token
  const tokenHeader = getHeader(headers, "x-qq-mail-token");
  if (tokenHeader) {
    if (tokenHeader.length === secret.length && timingSafeEqual(Buffer.from(tokenHeader), Buffer.from(secret))) {
      return true;
    }
  }

  // 3. Bearer token in authorization header
  const authHeader = getHeader(headers, "authorization");
  if (authHeader) {
    const bearerPrefix = "bearer ";
    const token = authHeader.toLowerCase().startsWith(bearerPrefix)
      ? authHeader.slice(bearerPrefix.length).trim()
      : authHeader.trim();
    if (token.length === secret.length && timingSafeEqual(Buffer.from(token), Buffer.from(secret))) {
      return true;
    }
  }

  return false;
}

export default function qqMail({ headers, body, secret }: Input) {
  if (!verifyAuth(headers, body, secret)) {
    throw new Error("signature");
  }

  const payload = JSON.parse(body);
  const rawList: MailMessage[] = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.messages)
      ? payload.messages
      : [payload];

  return rawList.map((msg) => {
    const uid = String(msg.uid ?? "");
    const subject = String(msg.subject ?? "");
    const from = String(msg.from ?? "");
    const snippet = String(msg.snippet ?? "");
    const isUrgent =
      Boolean(msg.isVerificationCode) ||
      URGENT_PATTERN.test(subject) ||
      URGENT_PATTERN.test(snippet);

    const type = isUrgent ? "mail.urgent" : "mail.unread";

    return {
      id: `qq-mail-${uid}`,
      type,
      subject: `qq-mail:${uid}`,
      summary: `[${from}] ${subject}`.slice(0, 200),
      detail: String(snippet).slice(0, 4000),
      link: "",
    };
  });
}
