// xhs_collect.js — Tabbit nodejs 程序：小红书热门笔记评论批量采集
//
// 用法：
//   1) 复制本文件，修改顶部 CONFIG
//   2) bash 调用（先探测 CLI 路径，不要硬编码用户名）：
//      export PATH="/usr/bin:/bin:$PATH"
//      for p in "$LOCALAPPDATA/Tabbit/LocalAgent/bin/tabbit-cli.exe" \
//               "$HOME/.local/Tabbit/LocalAgent/bin/tabbit-cli.exe"; do
//        [ -f "$p" ] && CLI="$p" && break; done
//      [ -z "$CLI" ] && echo "未找到 tabbit-cli，请先安装 Tabbit Browser"
//      "$CLI" nodejs --task <TASK> --request-id <RID> --timeout-ms 170000 < xhs_collect.js
//      ⚠️ Bash 工具的 timeout 参数必须 >= 300000（否则默认 120s 会 SIGTERM 砍掉）
//   3) 收尾：finish --task <TASK> --discard
//
// ⚠️ 硬约束（踩过的坑，勿改）：
//   - 不要 browser.newContext() → 被 TabbitDance 拒绝，用隐式 page
//   - 笔记详情页裸 URL 必定 404（error_code=300031，缺 xsec_token）→ 必须在搜索页点卡片
//   - 搜索页卡片懒加载 → 先 scrollBy 触发，再等
//   - 评论懒加载 → 必须滚 20 次 x 1200px 才近乎全量（SCROLL_ROUNDS）
//   - 连续访问过密会整页不渲染卡片 → 每篇之间 sleep，任务间 sleep 15s

// ============ CONFIG ============
const CONFIG = {
  keywords: ["外贸获客"],       // 必改
  perKeyword: 1,                // 每个关键词采几篇（注意超时：1篇≈50-80s，2篇≈120-170s）
  scrollRounds: 20,             // 滚动轮数，控制评论加载深度
  scrollStep: 1200,
  scrollPause: 900,             // 每轮滚动间隔 ms
  maxCommentsPerNote: 60,
  keepRawFull: true,            // 保留 full 字段（含作者/时间/赞，用于人工核对）
  budgetMs: 150000,             // 时间预算守卫：超过就停止开新笔记，保住已采到的数据
  adaptive: true                // 滚动自适应：评论数不再增长就提前停，省时间
};
// ==============================

// ---- 时间预算守卫（关键：Tabbit 单任务硬 deadline 170s，超时=任务被杀+标签页泄漏）----
const START = Date.now();
const elapsed = () => Date.now() - START;
const outOfBudget = () => elapsed() > CONFIG.budgetMs;


const out = { config: CONFIG, notes: [], errors: [], loginState: null, startedAt: new Date().toISOString() };

// 噪声分类：区分真实需求 / 引流广告 / 水军
const NOISE_PATTERNS = [
  { type: "ad_ freight", re: /(货代|海运|空运|双清|清关|整柜|大货|报关|DDP|专线|港航|国际物流|转运)/ },
  { type: "ad_company", re: /(注册.{0,4}公司|公司注册|商标注册|财税代理|代理记账|银行账户|账户见证)/ },
  { type: "ad_website", re: /(独立站|建站|网站.{0,3}(搭建|代建)|SEO|GEO优化|服务器|域名|阿里云注册)/ },
  { type: "ad_groupbuy", re: /(拼团|一起拼|团购|拼单|带你做|招募|合伙人|招商|课程|训练营|付费社群)/ },
  { type: "ad_wechat", re: /(加我?微信|VX|vx|wx|威信|私信我|私我|扣1|主页链接|评论区扣)/i },
  { type: "water_army", re: /(干货.{0,4}收藏|满满的干货|分析得.{0,3}透彻|说到点子上了|稳扎稳打才是正道|干货满满)/ },
  { type: "ad_resource", re: /(打个.{0,3}(已|一)[^\s]{0,4}\s*可以拿|拿走|评论区扣|扣\s*1|私信领取|已guan|發尼了|發你|需要的扣|自取|dd)/i },
  { type: "ad_softtag", re: /(可以找他哦|可以找我|私我|详聊|dd我|＋我|\+我|薇信|威信|看主页|主页有|戳我)/ },
  { type: "water_dup", re: /^(加油|优秀|非常好用|学到了|谢谢分享|支持一下|好厉害|收藏了?|消息你了?|消息了|已guan|發尼了?)$/ }
];

function classifyComment(text, meta) {
  const t = String(text || "").trim();
  const m = meta || {};
  if (!t || t.length < 3) return { tag: "empty", reason: "过短/空内容" };
  // 作者回复刷屏：同一人短时间内大量 "消息你了" 类回复，会淹没真实需求
  if (m.isAuthor) return { tag: "noise", subtype: "author_reply", reason: "博主回复（非用户需求）" };
  if (NOISE_PATTERNS.some(p => p.re.test(t))) {
    const hit = NOISE_PATTERNS.find(p => p.re.test(t));
    return { tag: "noise", subtype: hit.type, reason: "命中噪声特征" };
  }
  if (t.length <= 4 && !/[？?]/.test(t)) return { tag: "noise", subtype: "water_dup", reason: "短且无提问意图" };
  return { tag: "real", reason: "含提问/痛点/具体场景特征" };
}

// 抽评论：选择器对齐 Tabbit 官方 playbook（.comment-item）
const extractComments = (cfg) => {
  const limit = Math.min(200, Math.max(1, cfg.limit || 60));
  const sels = ['.comment-item', '[class*="comment-item"]', '.reply-item', '[class*="commentItem"]'];
  let nodes = [];
  for (const s of sels) { nodes = Array.from(document.querySelectorAll(s)); if (nodes.length) break; }
  const items = nodes.map((node) => {
    const authorNode = node.querySelector('.name, [class*="author"] a, a[href*="/user/profile"], [class*="author"]');
    const contentNode = node.querySelector('.content, [class*="content"], .note-text');
    const likeNode = node.querySelector('[class*="like"], [class*="count"]');
    const full = (node.textContent || '').trim();
    // 博主本人回复：DOM 中带「作者」徽标 / author-badge / 与笔记作者同名
    const isAuthor = !!node.querySelector('.author-badge, [class*="author-badge"], [class*="authorTag"]')
      || /作者/.test((authorNode?.textContent || ''));
    return {
      author: (authorNode?.textContent || '').trim().slice(0, 24),
      content: (contentNode?.textContent || node.textContent || '').trim().slice(0, 300),
      like: (likeNode?.textContent || '').trim().slice(0, 8),
      hasReply: /展开\s*\d+\s*条回复/.test(full),
      isAuthor,
      ...(cfg.keepFull ? { full: full.slice(0, 420) } : {})
    };
  }).filter(x => x.content.length > 2);
  return { total: nodes.length, items: items.slice(0, limit) };
};

// 登录态检测（未登录也能读，但评论加载深度受限）
async function detectLogin() {
  return await page.evaluate(() => {
    const t = document.body ? document.body.innerText : "";
    const hasLoginBtn = !!document.querySelector('.login-btn, [class*="login-btn"], .side-bar .user-info');
    return {
      hasLoginWall: /扫码登录|手机号登录|立即登录/.test(t),
      hasUserInfo: hasLoginBtn,
      hint: hasLoginBtn ? "可能已登录（评论可读更深）" : "未登录/游客（评论加载受限）"
    };
  });
}

async function openSearch(kw) {
  await page.goto("https://www.xiaohongshu.com/search_result?keyword=" + encodeURIComponent(kw) + "&type=51",
    { waitUntil: "commit", timeout: 60000 });
  await page.waitForTimeout(9000);
  for (let i = 0; i < 3; i++) { await page.evaluate(() => window.scrollBy(0, 800)); await page.waitForTimeout(1400); }
  await page.waitForTimeout(2000);
  return await page.locator("section.note-item").count();
}

for (const kw of CONFIG.keywords) {
  for (let k = 0; k < CONFIG.perKeyword; k++) {
    // 时间预算守卫：宁可少采一篇，也不能让整个任务被硬 deadline 杀掉（已采数据会全部丢失）
    if (outOfBudget()) {
      out.errors.push("BUDGET_STOP at " + kw + "#" + k + " (elapsed=" + elapsed() + "ms)，剩余关键词未采");
      break;
    }
    try {
      const cards = await openSearch(kw);
      if (out.loginState === null) out.loginState = await detectLogin();
      if (!cards) { out.errors.push(kw + "#" + k + ": no cards rendered (可能限流，等 15s 重试)"); continue; }

      // 必须点卡片进详情（裸 URL 404）
      await page.locator("section.note-item a.cover").first().click({ timeout: 25000 });
      await page.waitForTimeout(10000);

      const ctx = await page.evaluate(() => ({
        url: location.href,
        title: (document.querySelector('#detail-title, .title')?.textContent || '').trim().slice(0, 120),
        author: (document.querySelector('.author-wrapper .name, .user-name, [class*="author"] [class*="name"]')?.textContent || '').trim().slice(0, 40),
        is404: /404|无法浏览|不见了/.test(document.title),
        totalCmt: (document.body.innerText.match(/共\s*(\d+)\s*条评论/) || [])[1] || null
      }));
      if (ctx.is404) { out.errors.push(kw + "#" + k + ": 404（token 失效，重开搜索页）"); continue; }

      // 关键：滚到底加载评论（自适应：连续 3 轮无增长就停）
      let prevCount = 0, stagnant = 0, actualRounds = 0;
      for (let i = 0; i < CONFIG.scrollRounds; i++) {
        await page.evaluate((s) => window.scrollBy(0, s), CONFIG.scrollStep);
        await page.waitForTimeout(CONFIG.scrollPause);
        actualRounds = i + 1;
        if (CONFIG.adaptive && i >= 4) {
          const now = await page.evaluate(() => document.querySelectorAll('.comment-item, [class*="comment-item"]').length);
          if (now <= prevCount) { stagnant++; if (stagnant >= 3) break; } else { stagnant = 0; }
          prevCount = now;
        }
      }

      const res = await page.evaluate(extractComments, {
        limit: CONFIG.maxCommentsPerNote, keepFull: CONFIG.keepRawFull
      });

      // 打噪声标签（把 isAuthor 传入，供 classifyComment 识别博主回复）
      const classified = res.items.map(c => ({ ...c, ...classifyComment(c.content, { isAuthor: c.isAuthor }) }));

      out.notes.push({
        keyword: kw, cardIndex: k,
        title: ctx.title, author: ctx.author, url: ctx.url.split("?")[0],
        pageSaysTotal: ctx.totalCmt, commentNodes: res.total,
        scrollRounds: actualRounds, elapsedMs: elapsed(),
        realCount: classified.filter(x => x.tag === "real").length,
        noiseCount: classified.filter(x => x.tag === "noise").length,
        comments: classified
      });
    } catch (e) {
      out.errors.push(kw + "#" + k + ": " + String(e && e.message ? e.message : e).slice(0, 180));
    }
  }
}

out.stats = {
  notes: out.notes.length,
  comments: out.notes.reduce((a, n) => a + n.comments.length, 0),
  real: out.notes.reduce((a, n) => a + n.realCount, 0),
  noise: out.notes.reduce((a, n) => a + n.noiseCount, 0)
};
out.ok = true;
return JSON.stringify(out);
