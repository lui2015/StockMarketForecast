'use strict';

const express = require('express');
const db = require('../db');
const config = require('../config');
const { PRESET_INDICES, MARKETS } = require('../market');
const { runVerify, manualVerify } = require('../verify');
const router = express.Router();

// 网页端：按昵称识别/创建用户，返回 uid
router.post('/identify', (req, res) => {
  const name = String((req.body && req.body.name) || '').trim();
  if (!name) return res.status(400).json({ code: 400, msg: '请输入昵称' });
  let acc = db.prepare('SELECT * FROM accounts WHERE name=? AND type=?').get(name, 'USER');
  if (!acc) acc = db.prepare('INSERT INTO accounts (name, type, pass, rate_limit) VALUES (?,?,?,?) RETURNING *')
    .get(name, 'USER', '', 100);
  res.json({ code: 0, data: { uid: acc.id, name: acc.name } });
});

function adminGuard(req, res, next) {
  if (req.headers['x-admin-pass'] !== config.adminPass) {
    return res.status(403).json({ code: 403, msg: '管理员口令错误' });
  }
  next();
}

// 手动补录校验结果
router.post('/verify', adminGuard, (req, res) => {
  const { id, actual_change } = req.body || {};
  const r = manualVerify(parseInt(id, 10), parseFloat(actual_change));
  if (!r) return res.status(404).json({ code: 404, msg: '未找到预测' });
  res.json({ code: 0, data: r });
});

// 待处理/异常列表
router.get('/pending', adminGuard, (req, res) => {
  const rows = db.prepare("SELECT * FROM predictions WHERE status IN ('PENDING','ERROR') ORDER BY target_date DESC").all();
  res.json({ code: 0, data: rows });
});

// 立即触发一次校验
router.post('/run-verify', adminGuard, async (req, res) => {
  const r = await runVerify();
  res.json({ code: 0, data: r });
});

// 预置大盘列表 & 市场枚举（前端初始化用）
router.get('/meta', (req, res) => {
  res.json({ code: 0, data: { markets: MARKETS, presets: PRESET_INDICES } });
});

module.exports = router;
