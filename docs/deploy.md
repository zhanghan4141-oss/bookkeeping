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

- 阿里云 ECS，Ubuntu 22.04，已安装 Docker + Docker Compose v2 + **docker-buildx-plugin**
- **内存 ≥ 2GB，并建议配置 2GB swap**（`docker compose build` 会并发跑两个 `npm install`，内存峰值高，低内存易 OOM 卡死）
- 域名 `bookkeeping.zhangyuning.xyz` 的 A 记录指向服务器公网 IP（与 www 同 IP）
- 安全组放行 80、443

### 检查/添加 swap（低内存服务器必做）

```bash
free -m   # 看 Swap 行是否为 0，若为 0 则执行下面命令添加 2GB swap

sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

> 阿里云轻量服务器常见 1.6GB 内存，跑 MySQL 容器后只剩约 590MB，构建必卡。加 swap 后构建虽慢但不会崩。

---

## 〇、安装 Docker（如已装可跳过）

### 方式一：使用项目脚本（推荐）

```bash
cd /home/admin/bookkeeping/deploy
sudo bash install-docker.sh https://kscq6k8w.mirror.aliyuncs.com
```

> 脚本用阿里云国内源装 Docker + Compose v2，配镜像加速器，并把 admin 加入 docker 组。
> 装完后**退出 SSH 重新登录**，docker 免 sudo 生效。

### 方式二：手动安装（脚本不可用时）

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2 docker-buildx-plugin
sudo usermod -aG docker admin
# 退出 SSH 重新登录使 docker 组生效
```

> ⚠️ **必须安装 `docker-buildx-plugin`**。缺少 buildx 会导致 `docker compose up --build` 构建时出现
> "Bake is configured but buildx isn't installed" 警告，构建回退到旧模式、缓存效率低、速度慢。
>
> 如果之前手动安装时漏了 buildx，可单独补装：
> ```bash
> sudo apt update && sudo apt install -y docker-buildx-plugin
> ```
> 验证 buildx 是否就绪：`docker buildx version`

### 配置国内镜像加速（必须）

> ⚠️ **国内服务器直接拉取 Docker Hub 会超时**，必须配置镜像加速器或手动拉取替代镜像。

```bash
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json << 'EOF'
{
  "registry-mirrors": [
    "https://kscq6k8w.mirror.aliyuncs.com",
    "https://mirror.ccs.tencentyun.com",
    "https://docker.m.daocloud.io"
  ]
}
EOF
sudo systemctl restart docker
```

验证加速器是否生效：

```bash
docker info | grep -A5 "Registry Mirrors"
```

### 镜像加速器失效时的备选方案

如果配置加速器后仍然超时（国内网络环境多变），可手动从华为云 SWR 拉取并打本地标签：

```bash
# 拉取所需基础镜像（华为云 SWR 国内可达）
sudo docker pull swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/mysql:8
sudo docker pull swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/node:22-alpine
sudo docker pull swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/nginx:alpine

# 打上 docker-compose.yml 中引用的本地标签
sudo docker tag swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/mysql:8 mysql:8
sudo docker tag swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/node:22-alpine node:22-alpine
sudo docker tag swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/nginx:alpine nginx:alpine
```

> 💡 打完标签后 `docker compose up --build` 会直接使用本地镜像，不再访问 Docker Hub。

---

## 一、上传代码

```bash
cd /home/admin
git clone https://github.com/zhanghan4141-oss/bookkeeping.git
cd /home/admin/bookkeeping
```

---

## 二、配置环境变量

### 自动生成安全密钥（推荐）

> ⚠️ **不要手动填写弱密码或使用示例值**。以下命令自动生成高强度随机密钥：

```bash
cd /home/admin/bookkeeping/deploy
cat > .env << EOF
DOMAIN=bookkeeping.zhangyuning.xyz
MYSQL_ROOT_PASSWORD=$(openssl rand -base64 24)
MYSQL_PASSWORD=$(openssl rand -base64 24)
JWT_ACCESS_SECRET=$(openssl rand -hex 32)
JWT_REFRESH_SECRET=$(openssl rand -hex 32)
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=30d
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-email@qq.com
SMTP_PASS=your-smtp-auth-code
MAIL_FROM=your-email@qq.com
EOF
chmod 600 .env   # 限制权限，仅所有者可读
```

> ⚠️ **注意**：heredoc 分隔符 `EOF` **不能加单引号**（即不能用 `'EOF'`），否则 `$(...)` 不会被展开，密钥会变成字面字符串。

### 手动编辑（可选）

如需自定义某些值：

```bash
vim .env
```

关键项说明：

| 变量 | 用途 | 注意事项 |
|------|------|----------|
| `MYSQL_ROOT_PASSWORD` | MySQL root 密码 | 泄露则数据库完全暴露 |
| `MYSQL_PASSWORD` | 应用数据库用户密码 | 泄露则业务数据可被读写 |
| `JWT_ACCESS_SECRET` | 短期访问令牌签名密钥（256-bit） | 泄露则可伪造任意用户登录态 |
| `JWT_REFRESH_SECRET` | 长期刷新令牌签名密钥（256-bit） | 泄露则可长期维持伪造会话 |
| `SMTP_*` | 还款提醒邮件 | QQ 邮箱用「授权码」非登录密码；暂不需要可保留占位值 |

---

## 三、启动 Docker 服务

### 低内存服务器：顺序构建（推荐）

`docker compose up -d --build` 会**并发构建 backend + frontend**，两个 `npm install`/`npm run build` 同时跑，内存峰值翻倍，1.6GB 服务器容易 OOM 卡死。

**顺序构建（先 backend 再 frontend，内存峰值减半）：**

```bash
cd /home/admin/bookkeeping/deploy
docker compose build backend
docker compose build frontend
docker compose up -d
```

### 高内存服务器：一键构建

内存 ≥ 4GB 可直接：

```bash
cd /home/admin/bookkeeping/deploy
docker compose up -d --build
```

> 首次构建约需 3-5 分钟（取决于网络）。MySQL 初始化约需 10-20 秒，backend 在此期间可能短暂 Restarting，属正常现象。

### 验证启动状态

```bash
docker compose ps
```

预期输出（三个容器均为 `Up`）：

| 容器 | 状态 | 说明 |
|------|------|------|
| deploy-db-1 | Up | MySQL 正常运行 |
| deploy-backend-1 | Up | NestJS 后端 + Prisma 迁移完成 |
| deploy-frontend-1 | Up (0.0.0.0:8081->80) | Nginx 托管前端静态文件 |

### 检查 backend 日志确认迁移成功

```bash
docker compose logs backend --tail=20
```

看到类似以下输出表示数据库迁移和应用启动成功：

```
Nest application successfully started
Server is running on port 3000
```

> ⚠️ 如果 backend 持续 Restarting 且日志显示 `P1001: Can't reach database server`，等待 15 秒后重试；若仍失败，检查 db 容器日志：`docker compose logs db`。

---

## 四、配置宿主机 nginx（关键：与现有服务共存）
项目提供模板 `deploy/nginx-bookkeeping.conf`，把它合并进你现有的 nginx 配置。

### 1. 准备 SSL 证书

为 `bookkeeping.zhangyuning.xyz` 申请一张独立的 SSL 证书（阿里云/腾讯云免费证书或 Let's Encrypt 均可）。

> ⚠️ 现有证书 `www.zhangyuning.xyz.pem` **不是通配符证书**，不覆盖 bookkeeping 子域名，必须单独申请。

将证书文件放到 `/etc/nginx/ssl/` 目录（与现有证书统一管理）：

```bash
# 确保 admin 用户对该目录有读写权限（首次部署需执行）
sudo chown -R admin:admin /etc/nginx/ssl/
sudo chmod 755 /etc/nginx/ssl/

# 将证书文件放到该目录，文件名建议与域名一致
# 例如：www.bookkeeping.zhangyuning.xyz.pem + www.bookkeeping.zhangyuning.xyz.key
```

验证证书是否覆盖目标域名：

```bash
openssl x509 -in /etc/nginx/ssl/www.bookkeeping.zhangyuning.xyz.pem -noout -text | grep DNS:
# 预期输出包含：DNS:bookkeeping.zhangyuning.xyz
```

### 2. 部署 nginx 反代配置

```bash
# 复制模板到 nginx 配置目录
sudo cp /home/admin/bookkeeping/deploy/nginx-bookkeeping.conf /etc/nginx/conf.d/bookkeeping.conf

# 自动替换证书路径（无需手动 vim 编辑）
sudo sed -i 's|/etc/nginx/certs/bookkeeping.zhangyuning.xyz.pem|/etc/nginx/ssl/www.bookkeeping.zhangyuning.xyz.pem|' /etc/nginx/conf.d/bookkeeping.conf
sudo sed -i 's|/etc/nginx/certs/bookkeeping.zhangyuning.xyz.key|/etc/nginx/ssl/www.bookkeeping.zhangyuning.xyz.key|' /etc/nginx/conf.d/bookkeeping.conf
```

> 💡 如果你的证书文件名不同，请相应调整 `sed` 命令中的替换目标路径。

### 3. 测试并重载

```bash
sudo nginx -t                # 确认语法正确
sudo systemctl reload nginx  # 平滑重载，不影响 tongshandagong
```

### 4. 验证反代生效

```bash
# 验证 bookkeeping 子域名 HTTPS 访问
curl -sI --resolve bookkeeping.zhangyuning.xyz:443:127.0.0.1 https://bookkeeping.zhangyuning.xyz | head -5
# 预期返回：HTTP/2 200

# 确认现有服务未受影响
curl -sI --resolve www.zhangyuning.xyz:443:127.0.0.1 https://www.zhangyuning.xyz | head -5
# 预期返回：HTTP/2 200
```

---

## 五、验证

浏览器/手机访问 `https://bookkeeping.zhangyuning.xyz`：

- 首次进入应看到登录页
- 注册账号 → 建账本 → 记账 → 建贷款账本 → 录贷款 → 看还款计划
- 手机浏览器「添加到主屏幕」可安装为 PWA
- 同时确认 `www.zhangyuning.xyz` 的 tongshandagong 不受影响

快速验证端口响应（无需浏览器）：

```bash
curl -sI http://127.0.0.1:8081 | head -5
```

预期返回 `HTTP/1.1 200 OK`。

---

## 六、更新

```bash
cd /home/admin/bookkeeping
git pull
cd deploy
# 低内存服务器用顺序构建，避免 OOM
docker compose build backend
docker compose build frontend
docker compose up -d
```

数据库迁移自动执行。nginx 配置若无变化无需重载。

---

## 七、数据备份

```bash
cd /home/admin/bookkeeping/deploy
docker compose exec db mysqldump -u bookkeeping -p bookkeeping > backup.sql
```

---

## 八、故障排查与重建

### 构建卡死排查（重点）

构建卡在 `npm install` 不动，是低内存国内服务器最常见的故障。按以下顺序排查：

**1. 看是不是卡住（而非慢）**

```bash
ps aux --sort=-%mem | head -15
```

- 若看到多个 `npm install` 进程处于 `D` 状态（不可中断睡眠），说明构建卡死且**任务堆积**（连续 push 触发多次构建）
- 堆积会耗尽内存，导致后续一切变慢/卡住

**2. 终止卡死的构建进程**

```bash
sudo kill -9 <卡住的 PID>
# 例：sudo kill -9 8612 8621 8661
```

> `D` 状态进程 kill 后可能不会立即消失（在等 I/O），可等待或最后重启。

**3. 检查内存（最常被忽视的根因）**

```bash
free -m
```

- `available` 低于 600MB 时，构建极易 OOM 卡死 → **加 swap**（见前置条件）
- 检查是否有**多余的 MySQL 实例**（`ps aux | grep mysqld`）。项目用 Docker 里的 MySQL，若还有系统 apt 装的 `/usr/sbin/mysqld` 且无其他服务依赖，可停掉释放约 350MB：
  ```bash
  sudo systemctl disable --now mysql
  ```

**4. 检查 npm 源连通性（在服务器上，勿用 HEAD 请求）**

```bash
curl -s -o /dev/null -w "npmmirror: HTTP %{http_code} 耗时 %{time_total}s\n" --max-time 10 https://registry.npmmirror.com/react
```

- `HTTP 200` 且几秒内返回 → 源正常，卡住是内存/audit 问题
- `HTTP 000` 或超时 → 源不通，换源（Dockerfile 里 `registry.npmmirror.com`）

**5. 确认 Dockerfile 是最新版**

上述坑（node 版本、npm 镜像、audit 跳过）都已通过 Dockerfile 修复，确认服务器代码已 `git pull` 到最新。

### 完全重建（数据会丢失！）
当遇到无法修复的容器异常时（如 MySQL 初始化失败、backend 持续 Restarting），可清除所有数据和容器重新开始：

```bash
cd /home/admin/bookkeeping/deploy
sudo docker compose down -v     # 停止容器并删除数据卷
sudo docker compose up -d       # 重新启动（镜像已构建过，无需 --build）
```

> ⚠️ `-v` 会删除 `db_data` 数据卷，**所有数据库数据将丢失**。生产环境请先执行第七节备份。

#### `docker compose down -v` 卡住或无响应怎么办？

该命令在清理容器和数据卷时可能因 Docker daemon 繁忙而长时间无输出（并非死机）。处理方式：

1. **耐心等待**：首次清理可能需要 30-60 秒，不要反复 Ctrl+C 中断
2. **如果超过 2 分钟仍无响应**：按 Ctrl+C 中断后，手动分步清理：
   ```bash
   sudo docker compose stop                    # 先停止容器
   sudo docker compose rm -f                   # 删除容器定义
   sudo docker volume rm deploy_db_data        # 单独删除数据卷
   sudo docker compose up -d                   # 重新启动
   ```
3. **极端情况**（Docker daemon 无响应）：重启 Docker 服务后再清理：
   ```bash
   sudo systemctl restart docker
   cd /home/admin/bookkeeping/deploy
   sudo docker compose down -v && sudo docker compose up -d
   ```

#### 什么时候需要完全重建？

| 场景 | 是否需要 `down -v` | 说明 |
|------|-------------------|------|
| 修改了 `.env` 中的数据库密码 | ✅ 是 | 旧数据卷中的 MySQL 用户密码不会自动更新 |
| MySQL 日志报 `unknown variable` 或表缺失 | ✅ 是 | 旧数据卷由不兼容版本创建，需清除后让新版本重新初始化 |
| 仅修改了代码或 Dockerfile | ❌ 否 | `docker compose up -d --build` 即可，数据保留 |
| backend 短暂 Restarting 后恢复 Up | ❌ 否 | MySQL 初始化期间的正常现象，无需干预 |

### 常见问题速查

| 症状 | 原因 | 解决方案 |
|------|------|----------|
| `docker: permission denied` | 当前用户不在 docker 组 | `sudo usermod -aG docker admin` 后重新登录 |
| `dial tcp ... i/o timeout` | Docker Hub 不可达 | 配置镜像加速器或使用华为云 SWR 手动拉取（见第〇节） |
| `npm ci ... not in sync` | package-lock.json 与 Node 版本不匹配 | Dockerfile 中已将 `npm ci` 改为 `npm install`，重新 build 即可 |
| `unknown variable 'default-authentication-plugin'` | MySQL 8.4+ 移除了该参数 | docker-compose.yml 已移除该参数；若旧数据卷残留，执行 `docker compose down -v` 后重启 |
| backend 持续 Restarting (`P1001`) | MySQL 尚未初始化完成 | 等待 15-30 秒；若 db 日志有错误，检查 `docker compose logs db` |
| 访问不了 bookkeeping 子域名 | DNS/证书/nginx 配置问题 | 确认 DNS A 记录；`nginx -t` 通过；`docker compose ps` 中 frontend 为 Up |
| 8081 端口冲突 | 其他服务占用 | 修改 `docker-compose.yml` 中 `8081:80` 为其他端口，同步修改 nginx `proxy_pass` |
| 收不到还款邮件 | SMTP 配置错误 | 确认用授权码、端口与 `SMTP_SECURE` 匹配（QQ 邮箱 465+true） |
| 前端更新没生效 | 浏览器缓存 | Ctrl+Shift+R 强刷 |
| 构建卡在 `npm install` 不动 | npm audit/fund 请求卡住 | Dockerfile 已加 `--no-audit --no-fund`；确认已 pull 最新代码 |
| 构建报 `Run Command Timeout` | SSH 命令超时（默认10m） | workflow 已改 `command_timeout: 30m` |
| 构建报 `EBADENGINE` | node 版本旧 | Dockerfile 已改用 `node:24-alpine` |
| 连续 push 构建冲突 | 部署任务并发竞态 | workflow 已加 `concurrency` 排队串行 |

---

## 附录：安全加固建议（生产环境推荐）

以下为可选的生产级增强配置，非部署必需，但建议在生产环境中逐步实施：

1. **容器资源限制**：在 `docker-compose.yml` 中为每个服务添加 `deploy.resources.limits`，防止单容器耗尽宿主机资源
2. **日志轮转**：配置 Docker 日志驱动（如 `json-file` + `max-size/max-file`），避免日志撑满磁盘
3. **SSL 自动续期**：考虑使用 certbot + cron 或 acme.sh 替代手动证书，避免证书过期导致服务中断
4. **容器健康检查**：在 `docker-compose.yml` 中添加 `healthcheck`，配合 `depends_on.condition: service_healthy` 确保 backend 在 MySQL 就绪后才启动
5. **定期备份自动化**：将第七节的 mysqldump 命令加入 crontab，每日自动备份并保留最近 7 天
