# 小红书评论需求挖掘 · xhs-hot-note-demand-mining

> 从热门笔记的**评论区**深挖用户真实需求，反推爆款选题。
> 无需小红书 MCP，基于 Tabbit 浏览器**免登录**采集。

**标签**：`xiaohongshu` `agent-skill` `scraping` `tabbit` `content-research`

[安装](#快速开始) · [踩坑记录](#踩坑记录) · [已知限制](#已知限制) · [License](#license)


## 为什么做这个

小红书热门笔记下的评论，是**用户未被内容包装的真实提问与抱怨**。它比行业报告更直接——你能看到他们卡在哪、纠结什么、怕被坑什么。

这个 skill 把「评论区」变成可量化、可排序的需求清单：

```
定买家搜索词 → 批量采评论 → 需求归类打分 → 反推爆款选题
```

## 快速开始

### 1. 安装

解压后把 `xhs-hot-note-demand-mining/` 放进技能目录：

| Agent | 路径 |
|---|---|
| WorkBuddy / Claude Code（用户级） | `~/.workbuddy/skills/` |
| 项目级（随仓库共享） | `<项目>/.workbuddy/skills/` |
| OpenClaw | `~/.openclaw/skills/` |

### 2. 环境要求

需要 **Tabbit Browser**（内含 `tabbit-cli`）。若已连接 `xiaohongshu-mcp` 也可走 MCP 路线。

> ⚠️ 小红书以 App 为主、网页版内容极少，**不要用 WebFetch / Playwright 替代**——纯爬虫会被 `xsec_token` 拦成 404。

检查环境：

```bash
export PATH="/usr/bin:/bin:$PATH"
for p in "$LOCALAPPDATA/Tabbit/LocalAgent/bin/tabbit-cli.exe" \
         "$HOME/.local/Tabbit/LocalAgent/bin/tabbit-cli.exe"; do
  [ -f "$p" ] && echo "找到: $p" && break
done
```

### 3. 采集

复制 `scripts/xhs_collect.js`，改顶部 `CONFIG.keywords`：

```javascript
const CONFIG = {
  keywords: ["阿波罗付费吗"],   // 用买家原话，不是行业黑话
  perKeyword: 1,                // 单任务 1 篇最稳（约 60s）
  scrollRounds: 20,             // 评论加载深度
  budgetMs: 150000,             // 时间预算守卫
  adaptive: true                // 自适应滚动
};
```

运行：

```bash
CLI="$LOCALAPPDATA/Tabbit/LocalAgent/bin/tabbit-cli.exe"
"$CLI" nodejs --task xhs1 --request-id r1 --timeout-ms 170000 < xhs_collect.js
"$CLI" finish --task xhs1 --discard     # 收尾，清标签页
```

> ⚠️ 通过 agent 的 Bash 工具调用时，`timeout` 参数必须 **≥ 300000**（默认 120s 会 SIGTERM 砍掉任务）。

### 📊 想看真实跑出来的效果？

**[`EXAMPLE.md`](EXAMPLE.md)** 是一次完整实战的原始输出：输入配置 → 采集 JSON → 噪声分类对照 → 需求归类 → 5 个可写选题，含性能实测数据。

## 需求分析

采集后按 8+1 维度归类，每条打 5 项指标算热度分（≥0.7 必做选题）：

| 维度 | 它在说什么 |
|---|---|
| **内容缺口** | 求具体方法、教程、步骤 |
| **痛点抱怨** | 使用中卡住、踩坑、没效果 |
| **场景需求** | 绑定人群、场合、资质 |
| **价格性价比** | 贵不贵、有无免费额度 |
| **决策犹豫** | 先做哪步、选哪个 |
| **渠道真伪** | 怕被骗、合规风险 |
| **情感共鸣** | 情绪认同、身份确认 |
| **功能需求** | 想要某功能/效果 |

### 噪声必须剔除

实测评论区 **约 40% 是引流广告 + 水军 + 博主刷屏**。脚本内置 9 类噪声识别（货代/公司注册/建站/拼团/留联系方式/资源暗号/软广@人/博主刷屏/模板化水军）。

若 `stats.noise / stats.comments > 0.5`，说明关键词太偏工具/服务品类（这类内容评论区本身就是同行引流盘），应换成**买家视角词**。

## 选题反推

实测有效的选题公式（完整 7 个见 `references/topic-formulas.md`）：

> **《[人群]总遇到 [痛点]？改这 N 个地方，[可量化结果]》**

- ✅《领英加好友总被拒？改这 3 个地方，通过率翻倍》
- ❌《如何做好领英运营》

**核心原则**：用户要「照着做就能做」的步骤，不是方法论。选题必须带**具体数字/字段/次数**。

## 踩坑记录

这些都是实测踩过的，脚本已内置防护：

| 坑 | 症状 | 正解 |
|---|---|---|
| `browser.newContext()` | `Command rejected by TabbitDance` | 用隐式 `page` |
| 笔记详情页裸 URL | 404 `error_code=300031` | **必须在搜索页点卡片进入**（自动带 `xsec_token`） |
| 搜索页不渲染卡片 | 定位到 0 个卡片 | 懒加载，先滚动触发；访问过密会整页空白 |
| 评论只读到前几条 | 页面显示 124 条只读到 12 | 滚动不足，默认 20 轮 × 1200px |
| 任务被 SIGTERM | rc=70 / `EVALUATION_TIMEOUT` | 调大 timeout，开时间预算守卫 |
| 超时后标签页泄漏 | `tabsRetained: true` | `resume --task <新名> --group <gid>` → `finish --task <新名> --discard` |

## 已知限制

- **未登录时评论加载深度受限**：页面标 124 条的笔记约只能读到 12–19 条。深挖需在 Tabbit 登录小红书。
- **搜索结果每次会变**：同一关键词多次运行拿到不同笔记，跨批次对比时勿假设可复现。
- **Tabbit 延迟长尾**：冷启动实测 3s–132s，别按「单篇几十毫秒」估算工时。
- **样本量建议**：单次（4 篇 / 28 条）够定方向不够下结论，同赛道累积 **≥3 批、≥50 条**再定排期。

## 目录结构

```
xhs-hot-note-demand-mining/
├── SKILL.md                      主流程 + 踩坑表
├── INSTALL.md                    安装与调参速查
├── scripts/
│   └── xhs_collect.js            采集脚本
└── references/
    ├── demand-taxonomy.md        维度定义 + 热度模型 + 噪声正则
    └── topic-formulas.md         7 个选题公式 + 自检清单
```

## License

内部自建工具，随意取用修改。
