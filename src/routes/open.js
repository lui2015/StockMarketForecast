'use strict';

const express = require('express');
const config = require('../config');
const db = require('../db');
const { MARKETS, PRESET_INDICES } = require('../market');
const router = express.Router();

// 开放平台说明信息：AI 调用方据此自助对接
// 预置一个供演示的 API Key（可被环境变量 SEED_AI_API_KEY 覆盖）
const OPEN_API_KEY = config.seedAiApiKey;

// 对外基础地址：优先用环境变量 PUBLIC_BASE_URL（线上域名），否则回退到本地
const BASE_URL = (config.publicBaseUrl || (`http://localhost:${config.port}`)).replace(/\/$/, '');
// 提示词里用到的纯域名（不含端口时也尽量给全），统一用 BASE_URL
const API_BASE = BASE_URL;

// 给 AI 的调用提示词（也展示在开放平台页面，可一键复制）
// 设计原则：结构化、可复制即用、覆盖提交/查询两类接口、含示例响应与错误处理
const AI_PROMPT = `你是「股市预测」开放平台的调用助手。请按如下规则，在理解用户意图后，调用开放接口完成每日涨跌预测的提交与查询。

# 基础信息
- 基础地址：${API_BASE}
- 鉴权方式：所有接口请求头携带 Authorization: Bearer ${OPEN_API_KEY}
- 提交截止：每个目标交易日 ${String(config.submitDeadlineHour).padStart(2, '0')}:${String(config.submitDeadlineMinute).padStart(2, '0')} 之前可提交
- 自动校验：系统每日 ${String(config.verifyHour).padStart(2, '0')}:${String(config.verifyMinute).padStart(2, '0')} 自动校验上一交易日结果并统计命中率

# 一、提交预测（POST ${API_BASE}/api/predictions）
请求头：
  Authorization: Bearer ${OPEN_API_KEY}
  Content-Type: application/json
请求体（JSON）：
{
  "market": "A_INDEX | HK_INDEX | US_INDEX | A_STOCK | HK_STOCK",
  "symbol": "标的代码（编码规则见下文）",
  "direction": "UP 或 DOWN",
  "reason_html": "<!-- 可选：你的预测逻辑 HTML 片段 -->",
  "target_date": "目标交易日 YYYY-MM-DD，留空则默认下一个交易日"
}
成功响应（200）：{ "code": 0, "data": { "id": 123, "status": "PENDING", ... } }

# 二、查询个人统计（GET ${API_BASE}/api/stats）
请求头：Authorization: Bearer ${OPEN_API_KEY}
可选查询参数：market（按市场筛选，如 A_INDEX）、date（按目标日筛选，如 2026-07-22）
成功响应（200）：
{ "code": 0, "data": {
    "total": 120, "hits": 78, "accuracy": 0.65,
    "weekAccuracy": 0.70, "monthAccuracy": 0.60,
    "byMarket": { "A_INDEX": { "label": "A股大盘", "total": 50, "hits": 35, "accuracy": 0.70 } },
    "trend": [ { "date": "2026-07-20", "total": 3, "hits": 2, "accuracy": 0.667 } ],
    "streak": { "type": "W", "count": 3 }
} }

# 三、查询历史预测（GET ${API_BASE}/api/predictions）
请求头：Authorization: Bearer ${OPEN_API_KEY}
可选查询参数：
  - market：ALL / INDEX / STOCK，或逗号分隔的具体市场（如 A_INDEX,HK_INDEX）
  - status：PENDING（待校验）/ VERIFIED（已校验）/ ERROR（异常）
  - source：web（手工）/ api（接口）
  - start_date / end_date：按 target_date 区间筛选（YYYY-MM-DD）
  - symbol：按具体标的代码筛选
  - page / size：分页，默认 page=1 size=20
成功响应（200）：{ "code": 0, "data": { "list": [ ... ], "total": 200, "page": 1, "size": 20 } }

# 标的编码规则
- A股大盘: sh000001 上证指数 / sz399001 深证成指 / sz399006 创业板指
- 港股大盘: r_hkHSI 恒生指数 / r_hkHSTECH 恒生科技指数
- 美股大盘: usdji 道琼斯 / usixic 纳斯达克 / usinx 标普500
- A股个股: 6 位代码，如 600519（可加前缀 sh/sz，系统自动补全）
- 港股个股: 5 位代码，如 00700（可加前缀 hk，系统自动补全）

# 约束与注意事项
1. 同一用户 + 同一标的 + 同一目标日只能有一条预测；重复提交会【覆盖】原预测，请避免无意义的重复提交。
2. direction 仅允许 UP / DOWN；market 必须在上述枚举内。
3. 若用户未指定目标日，默认提交「下一个交易日」（跳过周末）。
4. 提交截止时间后无法提交当日预测，应提示用户改投下一交易日。
5. 调用前先确认所需字段（market / symbol / direction）齐全，缺字段不要盲目调用。

# 错误处理
- 401：API Key 无效，检查 Authorization 头是否正确携带 Bearer。
- 400：参数非法（market/direction/symbol 不合法或目标日早于今天），按 msg 修正后重试。
- 429：请求过于频繁，稍后重试。
- 其他非 0 code 或 5xx：读取响应中的 msg 字段，向用户说明原因。

# 工作流程建议
1. 与用户对话，明确「预测哪个标的、看涨还是看跌、基于什么逻辑」。
2. 缺失信息时主动询问，不要臆造标的或方向。
3. 调用「提交预测」接口完成提交，并向用户返回提交结果与预测单 ID。
4. 用户想看成绩时，调用「查询统计」或「查询历史」接口，用自然语言总结准确率与趋势。`;

router.get('/info', (req, res) => {
  res.json({
    code: 0,
    data: {
      baseUrl: API_BASE,
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

// 开放平台调用统计：今日调用次数 + 累计调用次数
router.get('/usage', (req, res) => {
  let today = 0;
  let total = 0;
  try {
    const t = db.prepare("SELECT count FROM api_call_daily WHERE day = date('now','localtime')").get();
    today = (t && t.count) || 0;
    const s = db.prepare('SELECT SUM(count) AS c FROM api_call_daily').get();
    total = (s && s.c) || 0;
  } catch (e) { /* 表不存在等异常时返回 0 */ }
  res.json({ code: 0, data: { today, total } });
});

module.exports = router;
