---
name: xhs-hot-note-demand-mining
description: 从小红书热门笔记的评论区深挖用户真实需求，并据此确定爆款笔记选题与内容方向。当用户说「找小红书选题」「看小红书评论」「挖用户需求」「竞品笔记分析」「爆款选题」「小红书需求调研」「评论区洞察」时使用。基于 Tabbit 浏览器免登录采集，不依赖 xiaohongshu-mcp。
agent_created: true
---

# 小红书热门笔记评论 → 用户需求挖掘 → 爆款选题

把「评论区」当成一手需求来源：热门笔记下的评论是用户**未被内容包装的真实提问与抱怨**，比行业报告更直接。执行四段闭环：搜热帖 → 批量采评论 → 需求归类打分 → 反推选题。

## 何时使用

- 找小红书账号的下一批选题
- 想知道目标赛道「用户到底在纠结什么、卡在哪」
- 竞品笔记爆了，想知道它评论区在讨论什么
- 判断某个需求是真是假、有没有付费意愿

**不适用**：纯内容创作（交给 `xhs-prepublish-check`）、账号数据复盘（`xhs-postpublish-review`）、对标账号筛选（`xhs-benchmark-finder`）。

## 核心前提

- **不需要 xiaohongshu-mcp**。若已连上 MCP 也可优先用；本技能走 Tabbit 独立通路，不依赖 MCP。
- **免登录可读**，但未登录时评论加载深度受限（实测：页面标 124 条的笔记只能读到约 12 条）。要深挖需在 Tabbit 登录一次小红书。
- **不要用 WebFetch / Playwright 替代**小红书：小红书 App 主导，网页版内容极少，纯爬虫会被 xsec_token 拦成 404。

## 执行流程

### 第 1 步：定关键词（别一上来就抓）

选 3–5 个**买家自己会搜的词**，不是行业黑话。判断标准：这个词是不是用户打字进搜索框的原话。

- ✅ 「阿波罗付费吗」「展会名单从哪找」「领英加好友被拒」
- ❌ 「B2B 数字化转型」「供应链赋能」

### 第 2 步：采评论

用 `scripts/xhs_collect.js`。先做环境自检，再改脚本顶部 CONFIG 的 `keywords` / `perKeyword`。

#### 环境自检（换机器时必做）

```bash
# 1) 定位 tabbit-cli（不要硬编码路径）
for p in "$LOCALAPPDATA/Tabbit/LocalAgent/bin/tabbit-cli.exe" \
         "$HOME/.local/Tabbit/LocalAgent/bin/tabbit-cli.exe" \
         "/c/Users/$USERNAME/AppData/Local/Tabbit/LocalAgent/bin/tabbit-cli.exe"; do
  [ -f "$p" ] && CLI="$p" && break
done
[ -z "$CLI" ] && command -v tabbit-cli && CLI=$(command -v tabbit-cli)
[ -z "$CLI" ] && echo "未找到 tabbit-cli：请先安装 Tabbit Browser（内含 LocalAgent CLI）"

# 2) bash 环境修复（PATH 常被环境脚本打断）
export PATH="/usr/bin:/bin:$PATH"

# 3) 跑采集
"$CLI" nodejs --task xhs<N> --request-id r<N> --timeout-ms 170000 < xhs_collect.js
```

> 无 Tabbit 时：可改用 xiaohongshu-mcp（若已连接）。两者都不可用则如实告知用户缺环境，不要用 WebFetch/Playwright 硬替（小红书 App 主导，网页版内容极少）。

硬性要求：
- Bash 工具的 `timeout` 参数 **必须 ≥ 300000**（否则默认 120s 会 SIGTERM 砍掉，白跑）
- 调 tabbit-cli 通常需要绕过沙箱（回执写入 AppData 会被拦）
- **单任务 1 篇最稳**（约 60s）；2 篇就要压到 150s 预算
- 收尾：`finish --task <NAME> --discard`


脚本已内置：**时间预算守卫**（`budgetMs` 默认 150s，超时停止开新篇、保住已采数据）+ **自适应滚动**（评论数连续 3 轮不增长就早停）+ **噪声自动分类**。

### 第 3 步：需求归类打分

脚本已按 8 维度打好 `tag`，人工只需确认误判。完整维度定义、判断技巧、热度打分模型见 `references/demand-taxonomy.md`。

维度：`功能需求` `痛点抱怨` `价格性价比` `决策犹豫` `场景需求` `内容缺口` `情感身份` `渠道真伪`

**核心判据**：`内容缺口`（求具体方法）和 `痛点抱怨`（卡在哪）通常是选题金矿；`渠道真伪`（防骗）反映信任危机，是低成本建立信任的切口。

**噪声必须剔除**：实测评论区约 40% 是引流广告（货代、公司注册、建站SEO、拼团）+ 模板化水军 + 博主刷屏回复。留着会污染结论。脚本 `NOISE_PATTERNS` 已覆盖 9 类形态，采完务必看 `stats.noise` 比例——**超 50% 说明选的关键词太偏工具/服务品类**。

### 第 4 步：反推选题

读 `references/topic-formulas.md` 拿选题公式。核心原则：

1. **用户要「照着做就能做」的步骤，不是方法论。** 实测最高赞回复全是可抄的动作（「完善领英资料、多发动态、每周一条」），不是「要重视领英」。选题必须带**具体数字/字段/次数**。
2. **优先做「有问无答」的缺口**——问题被反复问、但评论区没有高质量回答的，就是爆款位。
3. **找「几乎没人系统写」的第二痛点。** 实测外贸赛道里「有询盘却成交不了」7 赞共鸣却几乎没人系统写，这就是差异化空位。

## 踩坑记录（必读，勿重复踩）

| 坑 | 症状 | 正解 |
|---|---|---|
| `browser.newContext()` | `Command rejected by TabbitDance` | 用隐式 `page`，别建新 context |
| 笔记详情页裸 URL | 404 + `error_code=300031 当前笔记暂时无法浏览` | **必须在搜索页点卡片进入**，点击自动带 `xsec_token` |
| 搜索页不渲染卡片 | 定位到 0 个 `section.note-item` | 卡片懒加载，先 `scrollBy` 触发；连续访问过密会整页空白 → 任务间 sleep 15s |
| 评论只读到前几条 | 页面显示 124 条但只读到 12 | 滚动不足。脚本默认 20 轮 × 1200px |
| 点第 2 张卡超时 | `locator.click: Timeout 15000ms` | 每次都重新 goto 搜索页再点，别复用上一轮 DOM |
| 任务被 SIGTERM | rc=70 / `EVALUATION_TIMEOUT` | Bash timeout 参数太小，或没开时间预算守卫 |
| 超时后标签页泄漏 | `tabsRetained: true` | `resume --task <新名> --group <gid>` → `finish --task <新名> --discard`；`finish --task X --group G --discard` 语法不被接受 |

Tabbit 本身延迟长尾（冷启动实测 3s–132s），批量任务别按「单篇几十毫秒」估算工时。

## 交付物形态

采集完别只给原始评论，交付这三样：

1. **分析报告**：需求维度统计表 + Top 需求排序 + 关键发现 + 可直接开写的选题（带热度依据）
2. **打分表**：结构化数据落 Excel，便于跨批次累积对比
3. **可复用脚本**：把本次 CONFIG 记录下来，下轮换关键词即可

若需在 Tabbit 登录小红书以解锁更深评论，务必先征求用户同意。
