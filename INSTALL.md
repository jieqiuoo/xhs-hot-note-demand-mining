# 安装说明

## 包内容

```
xhs-hot-note-demand-mining/
├── SKILL.md                          主流程：4 步闭环 + 踩坑表
├── scripts/
│   └── xhs_collect.js                Tabbit 采集脚本（改顶部 CONFIG 即可换赛道）
└── references/
    ├── demand-taxonomy.md            8+1 需求维度 + 热度打分模型 + 噪声正则
    └── topic-formulas.md             7 个爆款选题公式 + 选题自检清单
```

## 环境要求

| 项 | 要求 | 说明 |
|---|---|---|
| Tabbit Browser | **必需**（二选一） | 内含 `tabbit-cli`，用于免登录采集 |
| xiaohongshu-mcp | 可选替代 | 若已连接 MCP，也可走 MCP 路线，不用 Tabbit |
| 网络 | 能访问 `www.xiaohongshu.com` | 纯本机浏览器，不走代理爬虫 |

**两者都没有** → 如实告知用户缺环境。**不要用 WebFetch / Playwright 替代**：小红书 App 主导、网页版内容极少，纯爬虫会被 `xsec_token` 拦成 404。

## 安装步骤

### 方式 A：复制到技能目录（推荐）

解压后把整个 `xhs-hot-note-demand-mining/` 目录放进：

- **WorkBuddy / Claude Code**：`~/.workbuddy/skills/`（用户级，跨项目）
- **项目级**：`<项目>/.workbuddy/skills/`（随仓库共享给协作者）
- **OpenClaw**：`~/.openclaw/skills/`

重启 agent 即可生效（技能按 `description` 自动触发）。

### 方式 B：让 agent 现场安装

把 zip 交给 agent，说「解压这个 skill 并安装到用户级技能目录」。

## 首次使用自检

```bash
export PATH="/usr/bin:/bin:$PATH"
# 探测 tabbit-cli（不要硬编码用户名）
for p in "$LOCALAPPDATA/Tabbit/LocalAgent/bin/tabbit-cli.exe" \
         "$HOME/.local/Tabbit/LocalAgent/bin/tabbit-cli.exe"; do
  [ -f "$p" ] && echo "找到: $p" && break
done
```

找不到 → 提示用户安装 Tabbit Browser。

## 快速开始

1. 复制 `scripts/xhs_collect.js` 到工作目录
2. 改顶部 `CONFIG.keywords` 为**买家原话式关键词**（如「阿波罗付费吗」「领英加好友被拒」），`perKeyword: 1`
3. 运行：

```bash
CLI="$LOCALAPPDATA/Tabbit/LocalAgent/bin/tabbit-cli.exe"
"$CLI" nodejs --task xhs1 --request-id r1 --timeout-ms 170000 < xhs_collect.js
```

⚠️ **若通过 agent 的 Bash 工具调用，`timeout` 参数必须 ≥ 300000**（默认 120s 会 SIGTERM 砍掉任务）
⚠️ 调 tabbit-cli 通常需绕过沙箱（回执写入 AppData 会被拦）
⚠️ 收尾必做：`finish --task xhs1 --discard`

4. 看输出里的 `stats.real` / `stats.noise`，按 `references/demand-taxonomy.md` 人工复核维度归类
5. 套 `references/topic-formulas.md` 的公式产出选题

## 调参速查

| CONFIG 项 | 默认 | 何时调 |
|---|---|---|
| `keywords` | `["外贸获客"]` | **必改**，用买家原话 |
| `perKeyword` | 1 | 采多篇时调，注意 2 篇就需压 `budgetMs` |
| `scrollRounds` | 20 | 评论读不全时调大；时间紧时调小 |
| `budgetMs` | 150000 | 撞 170s 硬 deadline 时调小 |
| `adaptive` | true | 保持 true（连续 3 轮无增长即早停，省时） |
| `maxCommentsPerNote` | 60 | 单篇评论极多的笔记可调大 |

## 已知限制

- **未登录时评论加载深度受限**：页面标 124 条的笔记约只能读到 12–19 条。要深挖需在 Tabbit 登录小红书（会动用户账号，须先征得同意）。
- **搜索结果每次会变**：同一关键词多次运行拿到不同笔记，做跨批次对比时不要假设结果可复现。
- **Tabbit 延迟长尾**：冷启动实测 3s–132s，别按「单篇几十毫秒」估算工时。
- **噪声占比可能过半**：工具/服务类关键词的评论区本身是同行引流盘，需换买家视角词。

## 许可

内部自建工具，随意取用修改。
