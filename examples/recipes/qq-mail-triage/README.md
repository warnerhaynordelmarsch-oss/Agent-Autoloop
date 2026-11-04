# QQ 邮箱巡检与分诊 (qq-mail-triage)

## 解决什么
每 5 分钟定时看一眼 QQ 邮箱是否有新邮件。
- **零 Token 浪费**：没有新邮件时仅本地巡检，不拉起大模型，不消耗 Token。
- **智能分诊与通知**：发现新邮件时按标题与正文摘要区分 `mail.urgent`（验证码、安全告警、账单等）与 `mail.unread`（常规邮件）。
- **人机安全协同**：如果是验证码或告警，立即通过通知卡片告知主人；若需要回复，先草拟回复内容并发 `ask` 卡片请主人拍板，绝不私自对外发信。
- **凭证双盲安全**：巡检调用 `qq-mail` CLI，授权凭证由 macOS 钥匙串或受保护的本地环境管理，不在配置或提示词中出现明文密码。

## 怎么启用
把 `rules.json` 中的 `sources`、`agents`、`channels` 与 `rules` 并入 `~/.agent-autoloop/rules.json`，然后执行规则校验：
```bash
agent-autoloop check
```

确保接单电脑已就绪 `qq-mail` 命令行工具（默认路径 `~/.local/bin/qq-mail`）：
```bash
qq-mail status
```

## 要改哪几处
- **主目录路径**：把 `agents.watcher.command` 与 `rules` 中的 `cwd` 路径里的 `/Users/yourname` 替换为自己电脑上的真实主目录路径（如 `/Users/dorian` 或 `/home/ubuntu`；中台执行命令时不经 shell，不会自动展开 `~`）。
- **Worker 标识**：把 `agents` 中的 `"worker": "local"` 换成你实际接单电脑的 worker 名称。
- **巡检脚本路径**：若将 `watch-qq-mail.sh` 放置于其他目录，更新 `watcher` 的 `command` 路径。
- **执行频率**：默认每 5 分钟（`*/5 * * * *`），可按需调整 cron。
- **处理 Agent**：可根据习惯将处理 Agent 切为 `agy`、`codex` 或 `claude`。
