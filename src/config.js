'use strict';

const path = require('path');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  // 数据库文件位置（容器内对应持久化数据卷 /app/data）
  dataDir,
  dbFile: process.env.DB_FILE || 'forecast.db',
  // 预测逻辑 HTML 文件存储目录（容器内对应持久化数据卷 /app/data）
  reasonsDir: process.env.REASONS_DIR || path.join(dataDir, 'reasons'),
  // 上传的 HTML 文件大小上限（字节），默认 2MB
  reasonMaxBytes: parseInt(process.env.REASON_MAX_BYTES || String(2 * 1024 * 1024), 10),
  // 行情模式：mock=本地可离线测试（按标的+日期确定性生成）；live=调用东方财富公开接口
  quoteMode: process.env.QUOTE_MODE || 'mock',
  // 每日自动校验触发时间（24h），默认 16:30（A股收盘后）
  verifyHour: parseInt(process.env.VERIFY_HOUR || '16', 10),
  verifyMinute: parseInt(process.env.VERIFY_MINUTE || '30', 10),
  // 提交截止时间（目标交易日该时间后不允许提交），默认 09:00
  submitDeadlineHour: parseInt(process.env.SUBMIT_DEADLINE_HOUR || '9', 10),
  submitDeadlineMinute: parseInt(process.env.SUBMIT_DEADLINE_MINUTE || '0', 10),
  // 默认管理员密码（首次启动用于生成管理员账户）
  adminName: process.env.ADMIN_NAME || 'admin',
  adminPass: process.env.ADMIN_PASS || 'admin123',
  // 预置一个供 AI 调用的 API Key（可用环境变量覆盖）
  seedAiApiKey: process.env.SEED_AI_API_KEY || 'sk-ai-demo-0001',
};

module.exports = config;
