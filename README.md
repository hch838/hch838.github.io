# Tasker 直装包自动同步

每 2 小时探测开发者下载页，发现版本变化时把 APK 拉下来传到 Cloudflare R2，并更新下载页信息。

- 下载地址：`https://dl.273150.xyz/Tasker.latest.apk`（固定不变）
- 页面：`https://273150.xyz/dl/`
- 仓库：`hch838/hch838.github.io`（master 分支）

## 数据来源

开发者入口 `https://tasker.joaoapps.com/direct_purchase_download` 返回的不是 302，而是一段 JS：

```html
// window.location.href = "https://drive.google.com/file/d/...";   ← 注释掉的备用源
window.location.href = "https://www.dropbox.com/scl/fi/<ID>/Tasker.28.Direct.apk?rlkey=<KEY>&dl=1";
```

所以每次运行先抓这个页面、正则取未注释的最后一条 `window.location.href`，拿到**当前真实链接**。这样 `rlkey` 变更、文件 ID 变更、甚至切到 Google Drive，都能自动跟上，不依赖任何写死的 Dropbox 地址。

**不需要 Dropbox API 和任何 Dropbox 凭证。**

## 变更检测

三重信号，任一变化即同步（`Decide whether to sync` 步骤）：

| 信号 | 说明 |
|---|---|
| `source_url` | 入口页里的链接变了，说明开发者发了新版 |
| `etag` | Dropbox CDN 返回的 ETag，原地覆盖内容时变化 |
| `content_length` | 文件字节数，顺便兜底 |

三个信号都拿不到时，保守地每次都同步。比对记录存在 `.sync-state.json`，没有变化就退出，不产生 commit，也不下载 46MB。

## 执行流程

```
Resolve source URL  → 抓入口页，正则取跳转链接
Probe remote headers → HEAD 拿 ETag / Content-Length
Decide whether sync  → 与 state 比对
Download package     → 校验 PK 文件头 + 最小体积
Upload to R2         → 固定 key Tasker.latest.apk，覆盖写
Verify public URL    → 公开地址非 200 则中断
Update page & state  → 改 dl/index.html + 改 Tasker/index.html + 写 state + commit
```

任何一步失败都会中断，不会发布指向坏链接的页面。

## 两个页面一起改

| 文件 | 改什么 | 靠什么定位 |
|---|---|---|
| `dl/index.html` | 文件名、大小、同步时间、sha、下载链接 | `id="file-name"` / `id="file-size"` / `id="sync-time"` / `id="file-hash"` / `id="dlink"` / `id="dtext"` |
| `Tasker/index.html` | 列表最后一条“直购版”的 href 与文字 | `id="latest-direct"` |

两者都指向同一个 CDN 地址 `https://dl.273150.xyz/Tasker.latest.apk?v=<sha 前 8 位>`，导航页文字随版本号与当天日期变化，形如 `Tasker_6.7.9_直购版（2026-11-09更新）`。

用 `id` 而不是“第几个 li”来定位，是为了以后往列表里加条目时不会被改错。**新增条目时不要把 `id="latest-direct"` 弄丢**，否则那条链接会停在旧版本不再更新（工作流会打印“未找到 … 跳过导航页更新”）。


## 仓库 Secrets

| Secret | 用途 |
|---|---|
| `R2_ACCESS_KEY_ID` | R2 API Token 的 Access Key |
| `R2_SECRET_ACCESS_KEY` | R2 API Token 的 Secret |

token 名 `github-actions`，权限 Object Read & Write，限定桶 `dl273150`。

## Cloudflare 侧

| 项 | 值 |
|---|---|
| 账户 ID | `9c41c820ae166ca1726efc6ffeb42da5` |
| 桶 | `dl273150`（WNAM，Standard） |
| 自定义域名 | `dl.273150.xyz`，证书 active |
| Endpoint | `https://9c41c820ae166ca1726efc6ffeb42da5.r2.cloudflarestorage.com` |
| 主站 | `273150.xyz` 8 条记录已设置灰云，直连 GitHub Pages |

R2 里始终只有一个对象 `Tasker.latest.apk`，覆盖写，不累积。下载时通过 `Content-Disposition` 还原文件名，格式为 `Tasker-<版本号>-<YYYYMMDD_HHMM>.apk`，例如 `Tasker-6.7.9-20261109_1223.apk`。版本号取自 APK 内 `AndroidManifest.xml` 的 `versionName`，由 `scripts/axml.py` 纯标准库解析；解析失败时退化为 `Tasker-<时间戳>.apk`。

因为对象 key 固定，Cloudflare 边缘缓存会命中旧响应，所以页面上的下载链接统一带版本参数 `?v=<sha256 前 8 位>`，每次同步都是一条新 URL，天然绕开缓存。

## 已知问题

**Pages 构建会间歇性 `errored`。** 短时间内连续多次提交时，前面的构建会被后来的取代并标记为 failure，这类记录 `duration` 为 0，不是真失败，只有最后一次成功。判断站点是否正常应该看 `pages.status` 是否为 `built`，而不是看构建历史里有没有红叉。

已提交 `.nojekyll` 跳过 Jekyll 处理（仓库里有 453MB 静态文件，Jekyll 逐文件扫描会拖到 9 分钟以上甚至卡死）。当前单次构建约 50 秒。若再次出现 `building` 长时间不动，手动触发重建：`POST /repos/hch838/hch838.github.io/pages/builds`。

**Cloudflare 会拦 Python 默认 UA。** `Python-urllib/3.x` 访问 `dl.273150.xyz` 返回 403（error 1010），浏览器、curl、wget、aria2 均正常。

**别开 R2 versioning。** 开了之后每次覆盖都会保留旧对象，存储会像 git 历史一样累积。当前未开启。

**cron 不准时。** GitHub schedule 在整点前后延迟 10–30 分钟常见，偶尔跳过。60 天无 commit 会自动停用，需在 Actions 页面点 Enable。

## 免费额度

R2 每月 10 GB-month 存储、100 万次 Class A、1000 万次 Class B，**出站流量永久免费**。当前只存一个 46MB 对象，约占免费额度 0.45%。

## 本地目录

```
dropbox-to-github/
├── .github/workflows/dropbox-sync.yml
├── dl/index.html
├── scripts/axml.py        # 纯标准库读 APK versionName
└── README.md
```
