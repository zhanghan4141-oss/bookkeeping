# 构建阶段：编译前端，产出 dist/
FROM node:24-alpine AS builder
WORKDIR /app
# 使用国内 npm 镜像加速（容器内默认访问 registry.npmjs.org 在国内极慢）
RUN npm config set registry https://registry.npmmirror.com
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# 运行阶段：nginx 只承载构建产物（不含源码/node_modules）
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
