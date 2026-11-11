# 自动部署（GitHub Actions + 阿里云 ACR）

push 到 `master` 后，GitHub Actions 自动：**构建镜像 → 推阿里云 ACR → SSH 服务器拉镜像启动**。服务器不再本地构建，低内存也不会 OOM。

## 原理

```
git push master
  → GitHub Actions 触发 deploy.yml
  → ① build-and-push：构建 backend/frontend 镜像 → 推阿里云 ACR
  → ② deploy：SSH 服务器 → docker login ACR → git pull → docker compose pull → up -d
```

## 一次性配置（GitHub Secrets）

| Secret | 说明 |
|---|---|
| `DEPLOY_HOST` | 服务器公网 IP 或域名 |
| `DEPLOY_USERNAME` | SSH 用户名（admin） |
| `DEPLOY_SSH_KEY` | SSH 私钥 |
| `DEPLOY_PORT` | SSH 端口（默认 22，可省略） |
| `ACR_USERNAME` | 阿里云 ACR「访问凭证」用户名 |
| `ACR_PASSWORD` | 阿里云 ACR「访问凭证」密码 |

## 使用

```bash
git push origin master
```

推送后自动触发部署，在 Actions 标签页看进度。

## 手动部署（备用）

SSH 到服务器执行：

```bash
cd /home/admin/bookkeeping
git pull
cd deploy
docker compose pull
docker compose up -d
```

## 常见问题

- **ACR 登录失败（unauthorized）**：确认 `ACR_USERNAME`（访问凭证用户名，非阿里云账号 UID）和 `ACR_PASSWORD`（访问凭证密码）正确。
- **db Restarting（MySQL 版本不兼容）**：db 镜像需为 `mysql:8.4`（数据目录由 8.4.9 创建，8.0 降级不支持）。
- **git pull 冲突**：服务器代码目录有本地改动时，`git stash` 或 `git checkout -- .` 后再拉。
