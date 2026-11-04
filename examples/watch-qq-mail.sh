#!/bin/sh
# 定时巡检 QQ 邮箱是否有新邮件，没有新邮件不消耗 Token。
#
#   "agents": {
#     "watcher": {
#       "name": "QQ 邮箱巡检",
#       "worker": "local",
#       "use": "command",
#       "command": ["sh", "/Users/yourname/.agent-autoloop/app/examples/watch-qq-mail.sh", "10"]
#     }
#   }
set -eu

LIMIT="${1:-10}"
SINCE_UID_ARG="${2:-}"
AUTOLOOP_HOME="${AGENT_AUTOLOOP_HOME:-$HOME/.agent-autoloop}"
CURSOR_FILE="${QQ_MAIL_CURSOR_FILE:-$AUTOLOOP_HOME/qq-mail-last-uid}"

QQ_MAIL_BIN="${QQ_MAIL_BIN:-}"
if [ -z "$QQ_MAIL_BIN" ]; then
  if command -v qq-mail >/dev/null 2>&1; then
    QQ_MAIL_BIN="qq-mail"
  elif [ -x "$HOME/.local/bin/qq-mail" ]; then
    QQ_MAIL_BIN="$HOME/.local/bin/qq-mail"
  else
    QQ_MAIL_BIN="qq-mail"
  fi
fi

node - "$QQ_MAIL_BIN" "$LIMIT" "$SINCE_UID_ARG" "$CURSOR_FILE" <<'EOF'
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const [, , qqMailBin, limitArg, sinceArg, cursorFile] = process.argv;
const baseLimit = Math.max(1, Number(limitArg || 10));

let sinceUid = 0;
if (sinceArg !== undefined && sinceArg !== "") {
  sinceUid = Number(sinceArg);
} else if (process.env.QQ_MAIL_SINCE_UID) {
  sinceUid = Number(process.env.QQ_MAIL_SINCE_UID);
} else if (cursorFile && fs.existsSync(cursorFile)) {
  const saved = Number(fs.readFileSync(cursorFile, "utf8").trim());
  if (!Number.isNaN(saved) && saved > 0) sinceUid = saved;
}

function fetchList(n) {
  let raw;
  try {
    raw = execFileSync(qqMailBin, ["list", String(n)], { encoding: "utf8" });
  } catch (err) {
    console.error("Error: qq-mail list failed:", err.message);
    process.exit(1);
  }
  try {
    const parsed = JSON.parse(raw);
    const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.messages) ? parsed.messages : null;
    if (!arr) throw new Error("Expected array or { messages: [...] }");
    return arr;
  } catch (err) {
    console.error("Error parsing qq-mail list output:", err.message);
    process.exit(1);
  }
}

let currentLimit = baseLimit;
let list = fetchList(currentLimit);

// Automatic backlog expansion: if sinceUid > 0 and every returned item is newer than sinceUid, expand window up to 200
while (
  sinceUid > 0 &&
  list.length >= currentLimit &&
  currentLimit < 200 &&
  list.every((m) => Number(m.uid) > sinceUid)
) {
  currentLimit = Math.min(200, currentLimit * 5);
  list = fetchList(currentLimit);
}

const URGENT_PATTERN = /验证码|verification|code|安全|告警|账单|security|alert|bill/i;

const filtered = list
  .filter((m) => {
    const uid = Number(m.uid);
    return !Number.isNaN(uid) && uid > sinceUid;
  })
  .sort((a, b) => Number(a.uid) - Number(b.uid));

const events = [];
let maxUid = sinceUid;

for (const item of filtered) {
  const uid = String(item.uid);
  const numUid = Number(uid);
  if (numUid > maxUid) maxUid = numUid;

  let mailData = item;
  try {
    const rawRead = execFileSync(qqMailBin, ["read", uid], { encoding: "utf8" });
    const parsedRead = JSON.parse(rawRead);
    mailData = { ...item, ...parsedRead };
  } catch (err) {
    console.error(`Error reading mail ${uid}:`, err.message);
    process.exit(1);
  }

  const subject = String(mailData.subject ?? "");
  const from = String(mailData.from ?? "");
  const body = String(mailData.body ?? mailData.snippet ?? "");
  const isUrgent =
    Boolean(mailData.isVerificationCode) ||
    URGENT_PATTERN.test(subject) ||
    URGENT_PATTERN.test(body);
  const type = isUrgent ? "mail.urgent" : "mail.unread";

  events.push({
    id: `qq-mail-${uid}`,
    type,
    subject: `qq-mail:${uid}`.slice(0, 100),
    summary: [...`[${from}] ${subject}`].slice(0, 200).join(""),
    detail: [...String(body ?? "")].slice(0, 4000).join(""),
    link: "",
  });
}

if (cursorFile && maxUid > sinceUid) {
  try {
    fs.mkdirSync(path.dirname(cursorFile), { recursive: true, mode: 0o700 });
    const tmp = `${cursorFile}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, `${maxUid}\n`, { mode: 0o600 });
    fs.renameSync(tmp, cursorFile);
  } catch (err) {
    console.error("Error writing cursor file:", err.message);
    process.exit(1);
  }
}

console.log(`检查了 ${events.length} 封新邮件。`);
console.log("");
console.log("```agent-autoloop");
console.log(JSON.stringify({ events }));
console.log("```");
EOF
