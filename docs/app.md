# Android App 打包与发布

记账本支持 Android App（Capacitor 外壳 + 本地资源包），iOS 走 PWA。App 复用网页端同一套前端代码，只有 `/api` 走网络。

## 技术方案

- **Capacitor 8 外壳 + 本地资源包**：`frontend/dist/`（Vite 构建产物）打进 APK，首屏不依赖网络。
- App 内 origin 是 `https://localhost`，API 走绝对地址 `https://bookkeeping.zhangyuning.xyz/api`——由 `frontend/src/api/client.ts` 的 `IS_APP` 判断 + `public/env.js` 覆盖（内测时可用 `--server` 覆盖）。
- 包名 `com.zhanghan.bookkeeping`（上架后不可改）。

## 构建（GitHub Actions，本机无需 JDK/SDK）

发版步骤：

1. bump 版本：改 `frontend/android/app/build.gradle` 的 `versionCode+1` + `versionName`，commit。
2. 打 tag 并 push：

```bash
git tag -a v1.0.0 -m "更新说明"
git push origin v1.0.0
```

push tag 触发 `.github/workflows/release-apk.yml`，CI 自动：

- 装 Node 24 + JDK 21 + Android SDK 36
- `vite build` → `cap sync android` → `assembleRelease`
- 用 keystore 签名（GitHub Secrets `RELEASE_KEYSTORE_B64` + `RELEASE_KEYSTORE_PASSWORD`）
- 发布 GitHub Release 资产 + 写 `frontend/public/app-update/manifest.json` + `latest.apk` 入仓

## keystore

- keystore 不入库（`.gitignore` 忽略 `*.keystore`），用 GitHub Secrets 注入。
- 生成：手动跑一次 `.github/workflows/generate-keystore.yml`（workflow_dispatch），在 GitHub 上 keytool 生成，下载 artifact 里的 `release.keystore.b64.txt` 内容填到 Secret `RELEASE_KEYSTORE_B64`（密码填 `RELEASE_KEYSTORE_PASSWORD`）。

## 应用内更新

- App 启动拉 `/app-update/manifest.json`（见 `frontend/src/lib/appUpdate.ts`），版本高于本机则弹窗提示下载。
- APK 分发：服务器 `/app-update/latest.apk`（部署时由 vite build 从 `public/app-update/` 复制到 dist），兜底 GitHub Release。

## iOS（PWA）

iPhone 用 Safari「添加到主屏幕」获得全屏类 App 入口（PWA）。Android 网页端也支持安装，或直接下载 APK。
