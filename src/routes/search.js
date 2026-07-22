'use strict';

const express = require('express');
const router = express.Router();
const { searchSymbolByName } = require('../market');

// 按名称/代码搜索标的（A/HK/US 个股）
// 查询参数：q（名称或代码，必填），market（可选，限定 A_STOCK/HK_STOCK/US_STOCK）
router.get('/', async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  const market = (req.query.market || '').toString().trim();
  if (q.length < 1) return res.json({ code: 0, data: [] });
  if (market && !['A_STOCK', 'HK_STOCK', 'US_STOCK'].includes(market)) {
    return res.status(400).json({ code: 400, msg: 'market 非法' });
  }
  try {
    const list = await searchSymbolByName(q, market);
    res.json({ code: 0, data: list });
  } catch (e) {
    res.status(500).json({ code: 500, msg: '搜索失败' });
  }
});

module.exports = router;
