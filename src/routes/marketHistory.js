'use strict';

const express = require('express');
const router = express.Router();
const { getMonthHistory } = require('../marketHistory');

// GET /api/market-history?month=YYYY-MM
// 返回三大盘指数在指定月份每个交易日的实际涨跌方向：
// { code:0, data: { A_INDEX:{ 'YYYY-MM-DD':'up'|'down', ... }, HK_INDEX:{...}, US_INDEX:{...} } }
router.get('/', async (req, res) => {
  const month = String(req.query.month || '');
  const m = /^(\d{4})-(\d{1,2})$/.exec(month);
  if (!m) return res.json({ code: 400, msg: 'month 参数格式应为 YYYY-MM' });
  try {
    const data = await getMonthHistory(parseInt(m[1], 10), parseInt(m[2], 10));
    res.json({ code: 0, data });
  } catch (e) {
    console.error('[market-history]', e);
    // 外部接口异常时不影响日历本身渲染，仅不上色
    res.json({ code: 0, data: {} });
  }
});

module.exports = router;
