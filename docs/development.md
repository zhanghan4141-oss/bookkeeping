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
```
