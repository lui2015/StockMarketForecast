'use strict';

const express = require('express');
const config = require('../config');
const { MARKETS, PRESET_INDICES } = require('../market');
const router = express.Router();

// 开放平台说明信息：AI 调用方据此自助对接
// 预置一个供演示的 API Key（可被环境变量 SEED_AI_API_KEY 覆盖）
const OPEN_API_KEY = config.seedAiApiKey;

// 给 AI 的调用提示词（也展示在开放平台页面，可一键复制）
const AI_PROMPT = `你是「股市预测」开放平台的调用助手。请按如下规则为用户完成每日涨跌预测提交。

【目标】
在交易日收盘前（截止 ${String(config.submitDeadlineHour).padStart(2, '0')}:${String(config.submitDeadlineMinute).padStart(2, '0')}），针对指定标的提交一条涨跌预测。

【接口】
POST ${'http://localhost:' + config.port}/api/predictions
Headers:
  Authorization: Bearer ${OPEN_API_KEY}
  Content-Type: application/json
Body (JSON):
{
  "market": "A_INDEX|HK_INDEX|US_INDEX|A_STOCK|HK_STOCK",
  "symbol": "标的代码，见下方编码规则",
  "direction": "UP 或 DOWN",
  "reason_html": "<!-- 你的预测逻辑 HTML 片段，可选 -->",
  "target_date": "目标交易日 YYYY-MM-DD，留空默认下一个交易日"
}

【标的编码】
- A股大盘: sh000001 上证指数 / sz399001 深证成指 / sz399006 创业板指
- 港股大盘: r_hkHSI 恒生指数 / r_hkHSTECH 恒生科技指数
- 美股大盘: usdji 道琼斯 / usixic 纳斯达克 / usinx 标普500
- A股个股: 6位代码，如 600519（可加前缀 sh/sz）
- 港股个股: 5位代码，如 00700（可加前缀 hk）

【约束】
1. 同一用户同一标的同一目标日只能有一条预测（重复提交会覆盖）。
2. direction 仅允许 UP / DOWN；market 必须在上述枚举内。
3. 每日 16:30 系统自动校验上一交易日结果并统计命中率。
4. 提交后不要重复提交，避免覆盖。

请在与用户对话中理解其意图，选择合适的标的与方向，调用上述接口完成提交，并返回提交结果。`;

router.get('/info', (req, res) => {
  res.json({
    code: 0,
    data: {
      apiKey: OPEN_API_KEY,
      endpoint: '/api/predictions',
      method: 'POST',
      authHeader: 'Authorization: Bearer ' + OPEN_API_KEY,
      submitDeadline: `${String(config.submitDeadlineHour).padStart(2, '0')}:${String(config.submitDeadlineMinute).padStart(2, '0')}`,
      verifyTime: `${String(config.verifyHour).padStart(2, '0')}:${String(config.verifyMinute).padStart(2, '0')}`,
      prompt: AI_PROMPT,
      markets: MARKETS,
      presets: PRESET_INDICES,
      limit: { direction: ['UP', 'DOWN'] },
    },
  });
});

module.exports = router;
