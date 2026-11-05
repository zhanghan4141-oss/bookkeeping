# 构建阶段
FROM node:24-alpine AS builder
WORKDIR /app
# 使用国内 npm 镜像加速（容器内默认访问 registry.npmjs.org 在国内极慢）
RUN npm config set registry https://registry.npmmirror.com
# --no-audit --no-fund 跳过审计/捐赠请求（国内网络下这些请求会卡住构建）
RUN npm config set audit false
RUN npm config set fund false
COPY package*.json ./
COPY prisma ./prisma
RUN npm install --no-audit --no-fund
RUN npx prisma generate
COPY . .
RUN npm run build

# 运行阶段
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN npm config set registry https://registry.npmmirror.com
RUN npm config set audit false
RUN npm config set fund false
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY prisma ./prisma
RUN npx prisma generate
COPY --from=builder /app/dist ./dist
EXPOSE 3000
# 启动时执行迁移并启动服务
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
