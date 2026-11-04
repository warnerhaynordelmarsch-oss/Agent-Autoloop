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
#   "rules": [
#     {
#       "name": "拉取 QQ 邮箱新邮件",
#       "when": { "cron": "*/5 * * * *" },
#       "to": "watcher",
#       "cwd": "/Users/yourname/.agent-autoloop",
#       "tell": "never",
#       "emits": { "source": "qq-mail", "types": ["mail.urgent", "mail.unread"] }
#     },
#     {
#       "name": "处理紧急与未读邮件",
#       "when": { "source": "qq-mail", "types": ["mail.urgent", "mail.unread"] },
#       "to": "agy",
#       "cwd": "/Users/yourname/.agent-autoloop",
#       "prompt": "阅读资料文件中的邮件内容。若是验证码或紧急告警，立即发 notice 或 ask 卡片通知主人；若是需要回复的邮件，先拟好草稿发 ask 卡片请主人拍板后再调用 qq-mail send 发送。"
#     }
#   ]
set -eu

LIMIT="${1:-10}"
SINCE_UID="${2:-${QQ_MAIL_SINCE_UID:-0}}"

# 定位 qq-mail CLI（优先环境变量，其次 PATH，最后回退 ~/.local/bin/qq-mail）
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

# 获取邮件列表 JSON（非 0 退出时报错并退出，绝不静默吞错）
if ! LIST_JSON=$("$QQ_MAIL_BIN" list "$LIMIT"); then
  echo "Error: qq-mail list failed" >&2
  exit 1
fi

# 过滤新邮件、读取正文并格式化为标准 agent-autoloop events 代码块
node -e '
const { execFileSync } = require("child_process");
const qqMailBin = process.argv[1];
const rawJson = process.argv[2] || "";
const sinceUid = Number(process.argv[3] || 0);

let list;
try {
  const parsed = JSON.parse(rawJson);
  list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.messages) ? parsed.messages : null);
  if (!list) {
    throw new Error("Invalid list format: expected array or { messages: [...] }");
  }
} catch (err) {
  console.error("Error parsing qq-mail list output:", err.message);
  process.exit(1);
}

const URGENT_PATTERN = /验证码|verification|code|安全|告警|账单|security|alert|bill/i;

// 过滤 uid > sinceUid 的邮件（无状态幂等拉取，中台内核按 event.id 自动幂等去重）
const filtered = list.filter((m) => {
  const uid = Number(m.uid);
  return !Number.isNaN(uid) && uid > sinceUid;
});

const events = [];
for (const item of filtered) {
  const uid = String(item.uid);
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

console.log(`检查了 ${events.length} 封邮件。`);
console.log("");
console.log("```agent-autoloop");
console.log(JSON.stringify({ events }));
console.log("```");
' "$QQ_MAIL_BIN" "$LIST_JSON" "$SINCE_UID"
