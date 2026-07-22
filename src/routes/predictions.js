'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const db = require('../db');
const config = require('../config');
const { MARKETS, PRESET_INDICES, normalizeSymbol, expandMarketFilter } = require('../market');
const { resolveUser } = require('../auth');
const router = express.Router();

function nextTradingDay(from = new Date()) {
  const d = new Date(from);
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function todayStr() { return new Date().toISOString().slice(0, 10); }

// 上传的 HTML 文件存内存，再落盘到 reasonsDir
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.reasonMaxBytes },
  fileFilter: (req, file, cb) => {
    const ok = /\.html?$/i.test(file.originalname) || /html/i.test(file.mimetype || '');
    cb(null, !!ok);
  },
});

// 提交预测（支持 multipart 上传 HTML 文件，或 JSON 传 reason_html 文本）
router.post('/', (req, res, next) => {
  upload.single('reason_file')(req, res, (err) => {
    if (err) return res.status(400).json({ code: 400, msg: 'HTML 文件上传失败：' + err.message });
    next();
  });
}, resolveUser, (req, res) => {
  const body = req.body || {};
  const market = body.market;
  const symbol = body.symbol;
  const target_date = body.target_date;
  const direction = body.direction;
  const caption = (body.reason || '').toString().slice(0, 500);
  const symbolNameInput = (body.symbol_name || '').toString().trim();

  if (!MARKETS[market]) return res.status(400).json({ code: 400, msg: 'market 非法' });
  if (!['UP', 'DOWN'].includes(direction)) return res.status(400).json({ code: 400, msg: 'direction 必须为 UP 或 DOWN' });
  const sym = normalizeSymbol(market, symbol);
  if (!sym) return res.status(400).json({ code: 400, msg: '证券代码格式非法' });
  const tdate = target_date || nextTradingDay();
  if (tdate < todayStr()) return res.status(400).json({ code: 400, msg: '目标交易日不能早于今天' });

  if (tdate === todayStr()) {
    const now = new Date();
    if (now.getHours() > config.submitDeadlineHour ||
       (now.getHours() === config.submitDeadlineHour && now.getMinutes() >= config.submitDeadlineMinute)) {
      return res.status(400).json({ code: 400, msg: '已过今日提交截止时间' });
    }
  }

  const nameMap = {};
  (PRESET_INDICES[market] || []).forEach((x) => { nameMap[x.symbol] = x.name; });
  // 个股优先使用用户提交的证券名称；预设大盘用映射；其余回退到代码
  const symbolName = symbolNameInput || nameMap[sym] || sym;

  try {
    db.prepare(`INSERT INTO predictions (user_id, market, symbol, symbol_name, target_date, direction, reason)
      VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(user_id, symbol, target_date) DO UPDATE SET
        direction=excluded.direction, reason=excluded.reason, status='PENDING',
        actual_change=NULL, is_hit=NULL, verified_at=NULL, updated_at=datetime('now')`)
      .run(req.user.id, market, sym, symbolName, tdate, direction, caption);

    const row = db.prepare('SELECT * FROM predictions WHERE user_id=? AND symbol=? AND target_date=?')
      .get(req.user.id, sym, tdate);

    // 解析 HTML 逻辑内容（来源于上传文件或 JSON 字段 reason_html）
    let html = null;
    if (req.file && req.file.buffer && req.file.buffer.length) html = req.file.buffer;
    else if (typeof body.reason_html === 'string' && body.reason_html.length) html = Buffer.from(body.reason_html, 'utf8');

    if (html) {
      if (html.length > config.reasonMaxBytes) {
        return res.status(400).json({ code: 400, msg: 'HTML 文件超出大小限制' });
      }
      const safeName = row.id + '.html';
      fs.writeFileSync(path.join(config.reasonsDir, safeName), html);
      db.prepare('UPDATE predictions SET reason_file=?, reason=? WHERE id=?')
        .run(safeName, caption, row.id);
      row.reason_file = safeName;
      row.reason = caption;
    }

    res.json({ code: 0, data: row });
  } catch (e) {
    res.status(500).json({ code: 500, msg: '提交失败: ' + e.message });
  }
});

// 读取某条预测关联的 HTML 逻辑文件（需鉴权，仅本人可见）
router.get('/:id/reason', resolveUser, (req, res) => {
  const row = db.prepare('SELECT * FROM predictions WHERE id=? AND user_id=?').get(parseInt(req.params.id, 10), req.user.id);
  if (!row || !row.reason_file) return res.status(404).json({ code: 404, msg: '无关联逻辑文件' });
  const fp = path.join(config.reasonsDir, row.reason_file);
  if (!fs.existsSync(fp)) return res.status(404).json({ code: 404, msg: '文件不存在' });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Security-Policy',
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob: *; font-src * data:; connect-src 'none'");
  res.send(fs.readFileSync(fp));
});

// 列表/筛选
router.get('/', resolveUser, (req, res) => {
  const { market, status, symbol, target_date, page = 1, size = 20 } = req.query;
  const where = ['user_id=?'];
  const params = [req.user.id];
  const markets = expandMarketFilter(market);
  if (markets) { where.push(`market IN (${markets.map(() => '?').join(',')})`); params.push(...markets); }
  if (symbol) { where.push('symbol=?'); params.push(symbol); }
  if (status) { where.push('status=?'); params.push(status); }
  if (target_date) { where.push('target_date=?'); params.push(target_date); }
  const sql = `SELECT * FROM predictions WHERE ${where.join(' AND ')} ORDER BY target_date DESC, id DESC LIMIT ? OFFSET ?`;
  const list = db.prepare(sql).all(...params, parseInt(size, 10), (parseInt(page, 10) - 1) * parseInt(size, 10));
  const total = db.prepare(`SELECT COUNT(*) c FROM predictions WHERE ${where.join(' AND ')}`).get(...params).c;
  res.json({ code: 0, data: { list, total, page: parseInt(page, 10), size: parseInt(size, 10) } });
});

router.get('/:id', resolveUser, (req, res) => {
  const row = db.prepare('SELECT * FROM predictions WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ code: 404, msg: '未找到' });
  res.json({ code: 0, data: row });
});

module.exports = router;
module.exports.nextTradingDay = nextTradingDay;
