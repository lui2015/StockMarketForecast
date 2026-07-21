'use strict';

// 独立的校验任务脚本：可用于 crontab / 容器 CMD
// 用法: node verify-task.js
const { runVerify } = require('./src/verify');

(async () => {
  const r = await runVerify();
  console.log('校验完成:', JSON.stringify(r));
  process.exit(0);
})();
