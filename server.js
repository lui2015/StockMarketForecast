'use strict';

const path = require('path');
const express = require('express');
const config = require('./src/config');
const { runVerify } = require('./src/verify');

const app = express();
app.use(express.json());

// 静态前端
app.use(express.static(path.join(__dirname, 'public')));

// 路由
app.use('/api/predictions', require('./src/routes/predictions'));
app.use('/api/stats', require('./src/routes/stats'));
app.use('/api/admin', require('./src/routes/admin'));

// 健康检查
app.get('/api/health', (req, res) => res.json({ code: 0, msg: 'ok', mode: config.quoteMode }));

// 兜底错误处理
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ code: 500, msg: '服务器内部错误' });
});

// 每日自动校验调度：在配置的时:分触发一次
function scheduleDailyVerify() {
  const tick = () => {
    const now = new Date();
    if (now.getHours() === config.verifyHour && now.getMinutes() === config.verifyMinute) {
      runVerify().then((r) => console.log('[verify] 定时校验完成:', r)).catch((e) => console.error('[verify] 失败', e));
    }
  };
  setInterval(tick, 60 * 1000);
  console.log(`[verify] 已注册每日 ${config.verifyHour}:${String(config.verifyMinute).padStart(2, '0')} 自动校验`);
}

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`故事预测系统已启动: http://localhost:${config.port}  (行情模式: ${config.quoteMode})`);
    scheduleDailyVerify();
  });
}

module.exports = app;
