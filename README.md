# 故事预测系统

每日提交对 **A股大盘 / 港股大盘 / A股个股 / 港股个股** 的涨跌预测（含预测逻辑），次日自动校验准确性并统计**准确率与累积准确率**。移动端优先，并提供 **API 供 AI 调用**。

## 功能
- 预测提交：选择标的类型 → 大盘(预置指数)/个股(代码) → 涨跌方向 + 预测逻辑
- 自动校验：每日收盘后（默认 16:30）拉取行情，判定命中/未命中；行情缺失转「异常」可人工补录
- 统计：综合准确率、累积准确率、分类准确率、近期命中趋势、连胜/连败、全局排行榜
- 移动端页面：首页提交 / 统计 / 历史 三个 Tab，响应式适配手机
- AI 接口：Bearer API Key 鉴权，提交预测、查询统计、查询历史，按 Key 限流

## 快速开始（本地）
```bash
npm install
npm start
# 打开 http://localhost:3000
```
> 默认 `QUOTE_MODE=mock`（按 标的+日期 确定性生成行情，便于离线测试）。
> 改为真实行情：`QUOTE_MODE=live npm start`（调用东方财富公开接口，需联网）。

## AI 调用示例
```bash
# 提交预测（使用预置演示 Key）
curl -X POST http://localhost:3000/api/predictions \
  -H "Authorization: Bearer sk-ai-demo-0001" \
  -H "Content-Type: application/json" \
  -d '{"market":"A_INDEX","symbol":"sh000001","target_date":"2026-07-22","direction":"UP","reason":"资金面宽松"}'

# 查询统计
curl http://localhost:3000/api/stats -H "Authorization: Bearer sk-ai-demo-0001"
```

## 管理操作
- 网页端点右上角设置昵称即可提交（归属到该用户）。
- 管理员补录/触发校验：`POST /api/admin/run-verify`、`POST /api/admin/verify`，需请求头 `X-Admin-Pass: admin123`。
- 手动运行校验任务：`node verify-task.js`。

## 环境变量
| 变量 | 默认 | 说明 |
|------|------|------|
| PORT | 3000 | 服务端口 |
| QUOTE_MODE | mock | mock / live |
| VERIFY_HOUR / VERIFY_MINUTE | 16 / 30 | 每日自动校验触发时间 |
| SUBMIT_DEADLINE_HOUR / MINUTE | 9 / 0 | 当日提交截止 |
| ADMIN_PASS | admin123 | 管理员口令 |
| SEED_AI_API_KEY | sk-ai-demo-0001 | 预置 AI Key |
| DATA_DIR | ./data | 数据库目录（容器挂载 /app/data） |

## Docker 部署（参考既有 Lighthouse 方式）
```bash
docker build -t stock-forecast:latest .
docker run -d --name forecast -p 3030:3000 -v /root/stockForecast/data:/app/data stock-forecast:latest
```

## 目录结构
```
src/config.js        配置
src/db.js            数据库与种子账户
src/market.js        行情源（mock / 东方财富）
src/verify.js        校验与统计逻辑
src/auth.js          API Key 鉴权 + 限流
src/routes/*.js      接口
public/              移动端前端
verify-task.js       独立校验脚本
server.js            服务入口 + 定时调度
```
