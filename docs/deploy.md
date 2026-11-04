# 部署指南（阿里云 + Docker Compose + HTTPS）

> 本文假设：系统 **Ubuntu 22.04**，登录用户 **admin**，项目放在 **`/home/admin/bookkeeping`**。

## 前置条件

- 阿里云 ECS（建议 2C4G 及以上），Ubuntu 22.04
- 一个已备案/可用的域名，A 记录指向服务器公网 IP
- 服务器安全组放行 80、443 端口

---

## 〇、安装 Docker（新服务器必做）

项目已提供一键安装脚本 `deploy/install-docker.sh`，自动识别系统、使用阿里云国内源、配置镜像加速器。

### 1. 获取镜像加速器地址（重要）

国内服务器直接拉取 Docker Hub 会超时，需要配置加速器。

你的阿里云专属加速器地址：**`https://kscq6k8w.mirror.aliyuncs.com`**

> 地址若失效，可重新到[阿里云容器镜像服务控制台](https://cr.console.aliyun.com/cn-hangzhou/instances/mirrors)获取新的专属地址，形如 `https://xxxx.mirror.aliyuncs.com`。

### 2. 上传并运行安装脚本

先获取代码（见下一步「上传代码」），然后：

```bash
cd /home/admin/bookkeeping/deploy
sudo bash install-docker.sh https://kscq6k8w.mirror.aliyuncs.com
```

> 不传加速器参数也可以安装，之后可手动编辑 `/etc/docker/daemon.json` 添加 `registry-mirrors`。
> 脚本会自动把 admin 加入 docker 组，安装后**退出 SSH 重新登录**，即可免 sudo 使用 docker。

脚本会自动：
- 识别 Ubuntu/Debian 或 CentOS/RHEL/Alibaba Cloud Linux 等系统
- 用阿里云 docker-ce 源安装 Docker + Docker Compose v2 插件
- 写入镜像加速器配置
- 启动 Docker 并设置开机自启

### 3. 验证

```bash
docker --version
docker compose version
docker run --rm hello-world   # 能正常拉取镜像即表示加速器生效
```

> 若系统无法被脚本识别，把 `/etc/os-release` 的内容发给我调整脚本。也可以手动装：
> - Ubuntu/Debian：https://mirrors.aliyun.com/docker-ce/linux/ubuntu
> - CentOS 系：https://mirrors.aliyun.com/docker-ce/linux/centos

---

## 一、上传代码

```bash
cd /home/admin
git clone https://github.com/zhanghan4141-oss/bookkeeping.git
cd /home/admin/bookkeeping
```

## 二、配置环境变量

```bash
cd /home/admin/bookkeeping/deploy
cp .env.example .env
vim .env   # 填写域名、邮箱、数据库密码、JWT secret、SMTP
```

关键项：
- `DOMAIN`：你的域名，如 `bookkeeping.example.com`
- `LETSENCRYPT_EMAIL`：用于 Let's Encrypt 证书通知的邮箱
- `SMTP_*`：发还款提醒邮件用的 SMTP（QQ 邮箱需用「授权码」而非登录密码）

## 三、启动

```bash
cd /home/admin/bookkeeping/deploy
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
cd /home/admin/bookkeeping
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
