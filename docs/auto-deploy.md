# 自动部署（GitHub Actions + SSH）

push 到 `master` 分支后，GitHub 自动 SSH 到服务器执行 `git pull` + `docker compose up -d --build`，实现一键自动部署。

## 原理

```
git push master
  → GitHub Actions 触发
  → SSH 登录你的服务器（用部署私钥）
  → cd /home/admin/bookkeeping && git pull && docker compose up -d --build
```

## 一次性配置（只需做一次）

### 1. 在服务器上生成专用部署密钥

```bash
# SSH 登录服务器（admin 用户）
ssh admin@你的服务器IP

# 生成专用部署密钥对（不影响你现有的登录密钥）
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/deploy_key -N ""
```

### 2. 把公钥加入授权

```bash
cat ~/.ssh/deploy_key.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

### 3. 查看私钥内容（复制到 GitHub）

```bash
cat ~/.ssh/deploy_key
```

会输出类似：
```
-----BEGIN OPENSSH PRIVATE KEY-----
xxxxxxxxxxxxxxxxxxxxxxxxxxxx
-----END OPENSSH PRIVATE KEY-----
```
**完整复制**这段（包括 BEGIN/END 行）。

### 4. 在 GitHub 仓库配置 Secrets

打开仓库页面 → **Settings → Secrets and variables → Actions → New repository secret**，添加三个：

| Secret 名 | 值 |
|---|---|
| `DEPLOY_HOST` | 服务器公网 IP |
| `DEPLOY_USERNAME` | `admin` |
| `DEPLOY_SSH_KEY` | 第 3 步复制的完整私钥内容 |

> 若 SSH 端口不是 22，再加一个 `DEPLOY_PORT`。

## 使用

配置完成后，以后每次：

```bash
git push origin master
```

推送后自动触发部署。在仓库的 **Actions** 标签页可看部署进度和日志。

## 手动部署（备用）

如果 webhook 没触发或想手动部署，SSH 到服务器执行：

```bash
cd /home/admin/bookkeeping
git pull
cd deploy
docker compose up -d --build
```

## 常见问题

- **Actions 显示 "Host key verification failed"**：首次 SSH 需要确认主机指纹。可先在服务器上手动 `ssh admin@IP` 一次，或在 workflow 里加 `host_key_checking: false`（不推荐）。
- **权限不足**：确认 admin 用户已在 docker 组（安装脚本已自动加入，需重新登录生效）。
- **git pull 冲突**：如果服务器上有人手动改过代码导致冲突，SSH 上去 `git stash` 或 `git checkout -- .` 后再手动拉。
