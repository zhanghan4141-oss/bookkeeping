# 构建阶段
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci
RUN npx prisma generate
COPY . .
RUN npm run build

# 运行阶段
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY prisma ./prisma
RUN npx prisma generate
COPY --from=builder /app/dist ./dist
EXPOSE 3000
# 启动时执行迁移并启动服务
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
