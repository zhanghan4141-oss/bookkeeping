# 部署指南（阿里云 + Docker Compose + 与现有服务共存）

> 本文假设：系统 **Ubuntu 22.04**，登录用户 **admin**，项目放在 **`/home/admin/bookkeeping`**。
>
> **共存架构**：服务器已有一个 `nginx + pm2` 部署的服务 `tongshandagong`，占用 80/443 端口。
> 本项目**继续用 Docker 部署**（MySQL/后端/前端均为容器），但入口由**宿主机 nginx** 统一反代，
> 通过子域名 `bookkeeping.zhangyuning.xyz` 与现有服务 `www.zhangyuning.xyz` 区分。

```
浏览器
  └─► 宿主机 nginx（80/443，唯一入口）
       ├── www.zhangyuning.xyz            → tongshandagong（pm2，不动）
       └── bookkeeping.zhangyuning.xyz    → 127.0.0.1:8081（Docker frontend 容器）
                                               └── /api → backend 容器（docker 内网）
```

## 前置条件

- 阿里云 ECS，Ubuntu 22.04，已安装 Docker + Docker Compose v2
- 域名 `bookkeeping.zhangyuning.xyz` 的 A 记录指向服务器公网 IP（与 www 同 IP）
- 安全组放行 80、443

---

## 〇、安装 Docker（如已装可跳过）

```bash
cd /home/admin/bookkeeping/deploy
sudo bash install-docker.sh https://kscq6k8w.mirror.aliyuncs.com
```

> 脚本用阿里云国内源装 Docker + Compose v2，配镜像加速器，并把 admin 加入 docker 组。
> 装完后**退出 SSH 重新登录**，docker 免 sudo 生效。

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
vim .env   # 填数据库密码、JWT secret、SMTP
```

关键项：
- `DOMAIN`：已填好 `bookkeeping.zhangyuning.xyz`
- `MYSQL_ROOT_PASSWORD` / `MYSQL_PASSWORD`：自定义强密码
- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`：随机长字符串
- `SMTP_*`：发还款提醒邮件用（QQ 邮箱用「授权码」非登录密码）

## 三、启动 Docker 服务

```bash
cd /home/admin/bookkeeping/deploy
docker compose up -d --build
```

首次启动会构建镜像、启动 MySQL、自动建表。此时服务已跑在 `127.0.0.1:8081`，但外网还访问不到，需要下一步配宿主机 nginx。

```bash
docker compose ps
docker compose logs -f backend
```

## 四、配置宿主机 nginx（关键：与现有服务共存）

项目提供模板 `deploy/nginx-bookkeeping.conf`，把它合并进你现有的 nginx 配置。

### 1. 准备证书

你的现有服务用「手动证书」。给 `bookkeeping.zhangyuning.xyz` 也准备一张证书（阿里云/腾讯云均可），
把 `.pem` 和 `.key` 放到服务器上，例如 `/etc/nginx/certs/`。

> 如果你的证书是「通配符证书 `*.zhangyuning.xyz`」，可直接复用，无需再买。

### 2. 合并 nginx 配置

```bash
# 把模板拷到 nginx 配置目录（你的 nginx 可能是 conf.d 或 sites-available，二选一）
sudo cp /home/admin/bookkeeping/deploy/nginx-bookkeeping.conf /etc/nginx/conf.d/bookkeeping.conf

# 编辑证书路径，改成你实际存放的 pem/key 路径
sudo vim /etc/nginx/conf.d/bookkeeping.conf
```

### 3. 测试并重载

```bash
sudo nginx -t                # 确认语法正确
sudo systemctl reload nginx  # 平滑重载，不影响 tongshandagong
```

## 五、验证

浏览器/手机访问 `https://bookkeeping.zhangyuning.xyz`：
- 首次进入应看到登录页
- 注册账号 → 建账本 → 记账 → 建贷款账本 → 录贷款 → 看还款计划
- 手机浏览器「添加到主屏幕」可安装为 PWA
- 同时确认 `www.zhangyuning.xyz` 的 tongshandagong 不受影响

## 六、更新

```bash
cd /home/admin/bookkeeping
git pull
cd deploy
docker compose up -d --build
```

数据库迁移自动执行。nginx 配置若无变化无需重载。

## 七、数据备份

```bash
cd /home/admin/bookkeeping/deploy
docker compose exec db mysqldump -u bookkeeping -p bookkeeping > backup.sql
```

## 常见问题

- **访问不了 bookkeeping 子域名**：确认 DNS 已加 A 记录指向服务器 IP；`nginx -t` 通过；`docker compose ps` 里 frontend 是 Up。
- **8081 端口冲突**：`docker-compose.yml` 里 frontend 的 `8081:80` 改成其他端口，同时 nginx 模板里的 `proxy_pass` 同步改。
- **收不到还款邮件**：确认 SMTP 用授权码、端口与 `SMTP_SECURE` 匹配（QQ 邮箱 465+true）。
- **前端更新没生效**：浏览器 Ctrl+Shift+R 强刷。
