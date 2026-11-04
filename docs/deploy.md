# 部署指南（阿里云 + Docker Compose + HTTPS）

## 前置条件

- 阿里云 ECS（建议 2C4G 及以上），已安装 Docker + Docker Compose v2
- 一个已备案/可用的域名，A 记录指向服务器公网 IP
- 服务器安全组放行 80、443 端口

## 一、上传代码

```bash
git clone https://github.com/zhanghan4141-oss/bookkeeping.git
cd bookkeeping
```

## 二、配置环境变量

```bash
cd deploy
cp .env.example .env
vim .env   # 填写域名、邮箱、数据库密码、JWT secret、SMTP
```

关键项：
- `DOMAIN`：你的域名，如 `bookkeeping.example.com`
- `LETSENCRYPT_EMAIL`：用于 Let's Encrypt 证书通知的邮箱
- `SMTP_*`：发还款提醒邮件用的 SMTP（QQ 邮箱需用「授权码」而非登录密码）

## 三、启动

```bash
cd deploy
docker compose up -d --build
```

首次启动会：
1. 构建前后端镜像（前端只承载 `dist/` 构建产物）
2. 启动 MySQL，后端自动执行 `prisma migrate deploy` 建表
3. `nginx-proxy` + `acme-companion` 自动申请/续期 HTTPS 证书

查看状态：

```bash
docker compose ps
docker compose logs -f backend
```

## 四、验证

浏览器/手机访问 `https://你的域名`：
- 首次进入应看到登录页
- 注册账号 → 建账本 → 记账 → 建贷款账本 → 录贷款 → 看还款计划
- 手机浏览器「添加到主屏幕」可安装为 PWA

## 五、更新

```bash
git pull
cd deploy
docker compose up -d --build
```

数据库迁移自动执行，无需手动操作。

## 六、数据备份

MySQL 数据在 `db_data` 卷中，备份命令：

```bash
docker compose exec db mysqldump -u bookkeeping -p bookkeeping > backup.sql
```

## 常见问题

- **HTTPS 证书没签发**：确认域名 A 记录已指向服务器，80 端口已放行；`docker compose logs acme` 看详情。
- **收不到还款邮件**：确认 SMTP 用的是授权码、端口与 `SMTP_SECURE` 匹配（QQ 邮箱 465+true）。
- **前端更新没生效**：nginx 静态资源有缓存，刷新时用 Ctrl+Shift+R 强刷。
