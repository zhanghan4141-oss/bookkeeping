# 本地开发指南

## 环境要求

- Node.js ≥ 20（推荐 22）
- MySQL 8（本地 3306）

## 后端

```bash
cd backend
cp .env.example .env   # 修改 DATABASE_URL 指向本地 MySQL
npm install
npx prisma migrate dev --name init   # 建表（首次）
npm run start:dev                      # 启动，默认 http://localhost:3000/api
```

## 前端

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173，/api 已代理到 3000
```

## 手动触发还款提醒（测试）

```bash
curl -X POST http://localhost:3000/api/tasks/reminder/run \
  -H "Authorization: Bearer <你的 accessToken>"
```

## 目录结构

```
backend/
  prisma/schema.prisma    数据模型
  src/
    auth/                 认证（注册/登录/JWT）
    ledger/               账本 + 成员
    category/             类别
    transaction/          流水
    loan/                 贷款 + 还款计划计算
    repayment/            每日还款汇总
    notification/         站内通知
    settings/             提醒设置
    stat/                 统计（公历/农历 + 多账本汇总）
    import-export/        Excel 导入导出
    tasks/                定时任务（还款提醒）
    common/               守卫、装饰器、邮件、权限
frontend/
  src/
    api/                  axios 封装
    stores/               Zustand
    pages/                各页面
    components/           通用组件
  android/                Capacitor 生成的 Android 工程
  public/app-update/      App 更新清单与 APK 分发
  capacitor.config.ts     Capacitor 配置

.github/workflows/
  deploy.yml              部署（构建镜像推 ACR + 服务器拉镜像）
  release-apk.yml         打包 APK（tag 触发）
  generate-keystore.yml   生成 keystore（手动触发）

## Android App 打包

App 通过 Capacitor 打包（GitHub Actions 构建，本机无需 JDK/SDK）。详见 [app.md](app.md)。

简要流程：bump `frontend/android/app/build.gradle` 版本 → 打 tag `vX.Y.Z` push → CI 自动出 APK。
```
