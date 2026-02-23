# MuseMark Chrome Web Store 更新上架手册（2026-02-23）

适用场景：你已经在 Chrome Web Store 上有旧版本，现在要上传 MuseMark 最新版本。

## 1) 一次性前置检查（账号侧）

1. 开发者账号已注册并已支付一次性注册费。  
2. Google 账号已开启两步验证（2-Step Verification）。  
3. 开发者后台可正常进入并看到现有条目（Your listings）。  

官方依据：
- [Register your developer account](https://developer.chrome.com/docs/webstore/register/)
- [Use the Chrome Web Store API](https://developer.chrome.com/docs/webstore/using-api)（前置要求中明确 2-Step Verification）

## 2) 本地安全打包（隐私不进包）

在项目根目录执行：

```bash
cd /Users/shiwen/Desktop/auto_note
npm run release:pack
```

该命令会自动完成：

1. `npm run check`
2. `npx tsc --noEmit --noUnusedLocals --noUnusedParameters`
3. `npm run build`
4. `dist/content.js` 顶层 `import` 检查（防止 `Cannot use import statement outside a module`）
5. `dist/` 的常见 secret pattern 扫描
6. 仅打包 `dist/`，且排除 `*.map`

成功后产物路径：

```bash
releases/musemark-store-v<manifest.version>.zip
```

你还可以额外执行：

```bash
unzip -l releases/musemark-store-v0.1.1.zip
shasum -a 256 releases/musemark-store-v0.1.1.zip
```

隐私红线（必须遵守）：

1. 不要从项目根目录直接 `zip -r` 整仓。  
2. 不要把浏览器导出的本地数据文件（书签导出、profile 数据库、日志）放入 `dist/`。  
3. 不要提交包含 `.env`、私钥、token 的任何文件到 `dist/`。  

## 3) 上传“已有条目”的新版本（Dashboard）

1. 打开 [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)。  
2. 进入 `Your listings`，点击 `MuseMark`。  
3. 进入左侧 `Package`。  
4. 点击 `Upload new package`。  
5. 选择本次打包产物：`releases/musemark-store-v0.1.1.zip`（或更高版本）。  
6. 等待包校验完成，确认未报错。  

注意：

1. `manifest.json` 的 `version` 必须高于线上版本。  
2. 若发现上传错误，优先修复后重新打包上传，不要在 Dashboard 反复提交同一包。  

官方依据：
- [Update your Chrome Web Store item](https://developer.chrome.com/docs/webstore/update/)
- [Publish in the Chrome Web Store](https://developer.chrome.com/docs/webstore/publish/)

## 4) Dashboard 各标签页可复制模板

### 4.1 Store listing

`Short description`（可直接粘贴）：

```text
One-key save, AI classify, semantic search, and quick access for heavy bookmark workflows.
```

`Detailed description`（可直接粘贴）：

```text
MuseMark helps you capture and organize web content with minimal friction.

Key features:
- One-key save current page (Cmd/Ctrl+Shift+S)
- AI-assisted summary, category, and tags
- Semantic + keyword search in Manager
- QuickDock on web pages for fast reopen
- Trash/restore lifecycle management
- Optional cloud sync with Supabase

Privacy:
- API keys are stored locally in chrome.storage.local.
- Bookmark data is stored locally by default (cloud sync is optional).
- No remote code execution is used.
```

素材最小要求（按官方）：

1. 128x128 Store icon  
2. 至少 1 张截图（推荐 1280x800）  

官方依据：
- [Complete your listing information](https://developer.chrome.com/docs/webstore/cws-dashboard-listing/)

### 4.2 Privacy

`Single purpose description`（可直接粘贴）：

```text
Capture, organize, and quickly retrieve bookmarks with AI-assisted classification and search.
```

`Permissions justification`（按当前 manifest 逐项填，建议文案）：

```text
storage: Save user settings, local bookmark metadata, and auth/session state.
scripting: Fallback injection used only for user-triggered capture actions.
activeTab: Access current tab content only when the user triggers save/capture.
commands: Enable keyboard shortcuts (for example Cmd/Ctrl+Shift+S).
notifications: Show user-visible error/fallback status notifications.
alarms: Schedule background cleanup/sync/backfill jobs.
identity: Support Google sign-in for optional cloud sync.
host permissions (http://*/*, https://*/*): Render QuickDock and capture helpers on normal web pages.
content scripts: Inject local extension scripts for in-page capture and QuickDock UI.
```

`Remote code` 选择建议：

```text
No, I am not using remote code.
```

`Privacy policy URL`：

```text
https://bridge.musemark.app/privacy.html
```

官方依据：
- [Fill out the privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy/)

### 4.3 Pricing & Distribution

建议（更新版本）：

1. `Free`  
2. 可先 `Unlisted` 做最终线上冒烟，再切 `Public`  
3. 区域：默认 `All regions`（如有合规要求再按国家裁剪）  

官方依据：
- [Prepare to publish: set up payment and distribution](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution)

### 4.4 Test instructions（可直接粘贴）

```text
1) Install the extension and open any HTTPS page.
2) Press Cmd/Ctrl+Shift+S to save current page.
3) Open MuseMark Manager from extension action.
4) Verify the item appears in Inbox/Library.
5) In Manager, search with Enter and Search button; both should work.
6) Verify Back returns to default list after search.
7) Press Cmd/Ctrl+K to open/close command panel.
8) In page QuickDock, click an icon to open bookmark.
9) Simulate favicon load failure; QuickDock should switch candidates and fallback icon.
10) Optional auth flow: sign in with Google and confirm sync status appears.
```

## 5) 提交审核与发布策略

1. 点击 `Submit for review`。  
2. 建议选择 `Defer publish`（通过审核后手动发布，便于你控制上线时机）。  
3. 审核通过后，执行手动发布到既定可见性。  

官方依据：
- [Publish in the Chrome Web Store](https://developer.chrome.com/docs/webstore/publish/)

## 6) 审核中改错（新流程，强烈建议记住）

如果刚提交就发现 bug：

1. 进入条目页面 `⋮` 菜单  
2. 点击 `Cancel review`  
3. 修复后重新上传并再次提交  

限制：每个 publisher 每天最多取消 6 次。  

官方依据：
- [Cancel a review](https://developer.chrome.com/docs/webstore/cancel-review)
- [Feature announcement (2025-03-03)](https://developer.chrome.com/blog/chrome-webstore-cancel-review)

## 7) 状态跟踪与超时处理

常见状态：`Published / Pending / Rejected / Taken down`。  

建议：

1. 在 Dashboard 持续看状态。  
2. 开启开发者账号邮件通知。  
3. 若超过 3 周仍在 pending，走官方支持渠道。  

官方依据：
- [Check on your review status](https://developer.chrome.com/docs/webstore/check-review)
- [Chrome Web Store review process](https://developer.chrome.com/docs/webstore/review-process/)

## 8) 可复制的整套命令（本地）

```bash
cd /Users/shiwen/Desktop/auto_note
npm install
npm run release:pack
unzip -l releases/musemark-store-v0.1.1.zip
shasum -a 256 releases/musemark-store-v0.1.1.zip
```

## 9) 可选：API 上传/发布（适合后续自动化）

仅当你已完成 OAuth2 凭证与 token 流程后使用：

```bash
# 上传新包（更新已有 item）
curl -H "Authorization: Bearer $TOKEN" \
  -X POST \
  -T releases/musemark-store-v0.1.1.zip \
  "https://chromewebstore.googleapis.com/upload/v2/publishers/$PUBLISHER_ID/items/$EXTENSION_ID:upload"

# 提交发布
curl -H "Authorization: Bearer $TOKEN" \
  -X POST \
  "https://chromewebstore.googleapis.com/v2/publishers/$PUBLISHER_ID/items/$EXTENSION_ID:publish"
```

官方依据：
- [Use the Chrome Web Store API](https://developer.chrome.com/docs/webstore/using-api)

---

如果你只想“最低风险上线”：  
先 `Unlisted + Defer publish`，审核通过后做一次真实账号冒烟，再切 `Public`。
