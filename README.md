# 手机网页记账本

一个手机端使用的网页记账本，支持多用户/家人共用。

## 功能

- **多账本**：日常账本、贷款账本、自定义账本，各账本有独立记账类别
- **贷款账本**：多笔贷款管理，支持等额本息 / 等额本金 / 先息后本 / 自定义还款计划，按还款日汇总每日待还金额，站内 + 邮件还款提醒
- **记账**：收入/支出/转账流水，Excel 导入导出
- **统计**：公历/农历统计周期切换，多账本汇总统计收支与盈余
- **Android App + PWA**：Android 可下载安装 APK（Capacitor 外壳），iPhone 走 PWA「添加到主屏幕」

## 技术栈

- 前端：React 18 + TypeScript + Vite + antd-mobile v5 + TanStack Query + Zustand + ECharts + lunar-javascript
- 后端：NestJS + TypeScript + Prisma + MySQL 8 + Nodemailer + @nestjs/schedule + exceljs
- Android App：Capacitor 8 外壳 + 本地资源包（复用同一套前端）
- 部署：Docker Compose + nginx + GitHub Actions 构建镜像 + 阿里云 ACR

## 目录结构

```
bookkeeping/
├── frontend/   # React 前端（构建产物 dist/）
├── backend/    # NestJS 后端
├── deploy/     # Docker Compose 部署配置
└── docs/       # 文档
```

详见 `docs/` 与部署文档。
