#!/usr/bin/env bash
# 一键安装 Docker + Docker Compose（适配阿里云国内网络）
# 用法：sudo bash install-docker.sh [镜像加速器地址]
# 例：sudo bash install-docker.sh https://xxxx.mirror.aliyuncs.com
set -euo pipefail

MIRROR_URL="${1:-}"

# 必须 root 执行
if [ "$(id -u)" -ne 0 ]; then
  echo "请用 sudo 或 root 运行本脚本"
  exit 1
fi

# 已安装则跳过
if command -v docker >/dev/null 2>&1; then
  echo "Docker 已安装：$(docker --version)"
  docker compose version 2>/dev/null && echo "Docker Compose 插件已就绪" || echo "警告：未检测到 docker compose 插件"
  exit 0
fi

# 检测系统
if [ ! -f /etc/os-release ]; then
  echo "无法识别系统类型（缺少 /etc/os-release）"
  exit 1
fi
. /etc/os-release
echo "检测到系统：${NAME:-$ID} ${VERSION_ID:-}"

install_ubuntu_debian() {
  echo "==> 使用阿里云 docker-ce 源安装（Ubuntu/Debian）"
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://mirrors.aliyun.com/docker-ce/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  local codename
  codename="$(. /etc/os-release && echo "${VERSION_CODENAME:-$(lsb_release -cs 2>/dev/null || echo stable)}")"
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://mirrors.aliyun.com/docker-ce/linux/ubuntu ${codename} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
}

install_centos_family() {
  echo "==> 使用阿里云 docker-ce 源安装（CentOS/RHEL/Alibaba Cloud Linux 等）"
  yum install -y yum-utils
  yum-config-manager --add-repo https://mirrors.aliyun.com/docker-ce/linux/centos/docker-ce.repo
  # Alibaba Cloud Linux 等系统的 $releasever 可能不匹配，替换为 9（或 8）
  local releasever
  releasever="$(rpm -q --qf '%{VERSION}' "$(rpm -q --whatprovides redhat-release)" 2>/dev/null | cut -d. -f1 || echo 8)"
  sed -i "s/\$releasever/${releasever}/g" /etc/yum.repos.d/docker-ce.repo
  yum install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
}

case "$ID" in
  ubuntu|debian)
    install_ubuntu_debian
    ;;
  centos|rhel|rocky|almalinux|alinux|anolis|openEuler|tencentos|uos|kylin)
    install_centos_family
    ;;
  *)
    echo "未识别的系统 ID：${ID}。脚本支持 Ubuntu/Debian 与 CentOS/RHEL/Alibaba Cloud Linux 系。"
    echo "请手动安装，或把 /etc/os-release 内容发给我调整脚本。"
    exit 1
    ;;
esac

# 配置镜像加速器（国内拉镜像提速）
if [ -n "$MIRROR_URL" ]; then
  echo "==> 配置镜像加速器：$MIRROR_URL"
  mkdir -p /etc/docker
  cat > /etc/docker/daemon.json <<EOF
{
  "registry-mirrors": ["${MIRROR_URL}"],
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF
else
  echo "==> 未提供镜像加速器地址，跳过（可稍后编辑 /etc/docker/daemon.json 添加 registry-mirrors）"
fi

# 启动并开机自启
echo "==> 启动 Docker 并设置开机自启"
systemctl enable docker
systemctl start docker

# 把通过 sudo 运行本脚本的用户加入 docker 组，之后免 sudo 使用 docker
if [ -n "${SUDO_USER:-}" ]; then
  echo "==> 将用户 ${SUDO_USER} 加入 docker 组"
  usermod -aG docker "${SUDO_USER}"
  echo "    （需退出重新登录 SSH 后生效）"
fi

# 验证
echo ""
echo "================ 安装完成 ================"
docker --version
docker compose version
echo "=========================================="
echo "可选：运行 docker run --rm hello-world 验证拉取镜像是否正常"
