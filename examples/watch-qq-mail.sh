#!/bin/sh
# 定时巡检 QQ 邮箱是否有新邮件，没有新邮件不消耗 Token。
#
#   "agents": {
#     "watcher": {
#       "name": "QQ 邮箱巡检",
#       "worker": "local",
#       "use": "command",
#       "command": ["sh", "~/Agent-Autoloop/examples/watch-qq-mail.sh", "10"]
#     }
#   }
#   "rules": [
#     {
#       "name": "拉取 QQ 邮箱新邮件",
#       "when": { "cron": "*/5 * * * *" },
#       "to": "watcher",
#       "cwd": "~/.agent-autoloop",
#       "tell": "never",
#       "emits": { "source": "qq-mail", "types": ["mail.urgent", "mail.unread"] }
#     },
#     {
#       "name": "处理紧急与未读邮件",
#       "when": { "source": "qq-mail", "types": ["mail.urgent", "mail.unread"] },
#       "to": "agy",
#       "cwd": "~/.agent-autoloop",
#       "prompt": "阅读资料文件中的邮件内容。若是验证码或紧急告警，立即发 notice 或 ask 卡片通知主人；若是需要回复的邮件，先拟好草稿发 ask 卡片请主人拍板后再调用 qq-mail send 发送。"
#     }
#   ]
set -eu

LIMIT="${1:-10}"
QQ_MAIL_BIN="${QQ_MAIL_BIN:-$HOME/.local/bin/qq-mail}"
STATE_DIR="${AGENT_AUTOLOOP_HOME:-$HOME/.agent-autoloop}"
STATE_FILE="$STATE_DIR/qq-mail-last-uid"

mkdir -p "$STATE_DIR"

# 获取邮件列表 JSON（安全调用 qq-mail CLI，零明文暴露密码）
LIST_JSON="$("$QQ_MAIL_BIN" list "$LIMIT" 2>/dev/null || echo '[]')"

# 过滤新邮件、更新游标并格式化为标准 agent-autoloop events 代码块
node -e '
const fs = require("fs");
const stateFile = process.argv[1];
const rawJson = process.argv[2] || "[]";
const limit = process.argv[3];

let lastUid = 0;
if (fs.existsSync(stateFile)) {
  const content = fs.readFileSync(stateFile, "utf-8").trim();
  const parsed = Number(content);
  if (!Number.isNaN(parsed)) lastUid = parsed;
}

let list = [];
try {
  const parsed = JSON.parse(rawJson);
  list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.messages) ? parsed.messages : []);
} catch {
  list = [];
}

const URGENT_PATTERN = /验证码|verification|code|安全|告警|账单|security|alert|bill/i;

// 过滤 uid > lastUid 的新邮件
const newMails = list.filter((m) => {
  const uid = Number(m.uid);
  return !Number.isNaN(uid) && uid > lastUid;
});

// 更新 stateFile 游标为最大 UID
let maxUid = lastUid;
for (const m of newMails) {
  const uid = Number(m.uid);
  if (uid > maxUid) maxUid = uid;
}
if (maxUid > lastUid) {
  fs.writeFileSync(stateFile, String(maxUid), "utf-8");
}

const events = newMails.map((m) => {
  const uid = String(m.uid ?? "");
  const subject = String(m.subject ?? "");
  const from = String(m.from ?? "");
  const snippet = String(m.snippet ?? "");
  const isUrgent =
    Boolean(m.isVerificationCode) ||
    URGENT_PATTERN.test(subject) ||
    URGENT_PATTERN.test(snippet);
  const type = isUrgent ? "mail.urgent" : "mail.unread";

  return {
    id: `qq-mail-${uid}`,
    type,
    subject: `qq-mail:${uid}`,
    summary: `[${from}] ${subject}`.slice(0, 200),
    detail: snippet.slice(0, 4000),
    link: "",
  };
});

console.log(`看了 QQ 邮箱最近 ${limit} 封邮件，发现 ${events.length} 封新邮件`);
console.log("");
console.log("```agent-autoloop");
console.log(JSON.stringify({ events }));
console.log("```");
' "$STATE_FILE" "$LIST_JSON" "$LIMIT"
