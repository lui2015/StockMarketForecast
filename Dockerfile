FROM node:20-alpine

WORKDIR /app

# better-sqlite3 需要编译，安装构建依赖
RUN apk add --no-cache python3 make g++

COPY package.json ./
RUN npm install --omit=dev

COPY . .

# 数据卷挂载点（与既有 investmentQuotes 部署一致：/app/data）
ENV DATA_DIR=/app/data
VOLUME ["/app/data"]

EXPOSE 3000
CMD ["node", "server.js"]
