'use strict';

const config = require('./config');

// 标的类型枚举
const MARKETS = {
  A_INDEX: 'A股大盘',
  HK_INDEX: '港股大盘',
  US_INDEX: '美股大盘',
  A_STOCK: 'A股个股',
  HK_STOCK: '港股个股',
  US_STOCK: '美股个股',
};

// 预置大盘指数（symbol 与行情源编码对应）
const PRESET_INDICES = {
  A_INDEX: [
    { symbol: 'sh000001', name: '上证指数' },
    { symbol: 'sz399001', name: '深证成指' },
    { symbol: 'sz399006', name: '创业板指' },
  ],
  HK_INDEX: [
    { symbol: 'r_hkHSI', name: '恒生指数' },
    { symbol: 'r_hkHSTECH', name: '恒生科技指数' },
  ],
  US_INDEX: [
    { symbol: 'usdji', name: '道琼斯' },
    { symbol: 'usixic', name: '纳斯达克' },
    { symbol: 'usinx', name: '标普500' },
  ],
};

// 预置指数 symbol -> 中文名 的大小写不敏感映射
const _symbolNameMap = {};
Object.keys(PRESET_INDICES).forEach((m) => {
  (PRESET_INDICES[m] || []).forEach((x) => { _symbolNameMap[x.symbol.toLowerCase()] = x.name; });
});
// 解析标的显示名称：命中预置则优先用中文名，否则回退 fallback（通常为原始代码）
function resolveSymbolName(symbol, fallback) {
  if (!symbol) return fallback || symbol;
  const s = String(symbol).toLowerCase();
  return _symbolNameMap[s] || fallback || symbol;
}

// 证券代码结构校验
function normalizeSymbol(market, raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (market === 'A_INDEX' || market === 'HK_INDEX' || market === 'US_INDEX') return s;
  if (market === 'A_STOCK') {
    // 允许 sh600519 / 600519（默认上交所）
    if (/^(sh|sz)\d{6}$/.test(s)) return s;
    if (/^\d{6}$/.test(s)) return 'sh' + s;
    return null;
  }
  if (market === 'HK_STOCK') {
    // 允许 hk00700 / 00700
    if (/^hk\d{5}$/.test(s)) return s;
    if (/^\d{4,5}$/.test(s)) return 'hk' + s.padStart(5, '0');
    return null;
  }
  if (market === 'US_STOCK') {
    // 允许 usaapl / AAPL（自动加 us 前缀，内部统一小写）
    if (/^us[a-z]+$/.test(s)) return s;
    if (/^[a-z]{1,6}$/i.test(s)) return 'us' + s.toLowerCase();
    return null;
  }
  return null;
}

// 东方财富 secid 映射
function toSecid(symbol) {
  if (symbol.startsWith('sh')) return '1.' + symbol.slice(2);
  if (symbol.startsWith('sz')) return '0.' + symbol.slice(2);
  if (symbol.startsWith('hk')) return '116.' + symbol.slice(2);
  if (symbol.startsWith('r_hk')) return '124.' + symbol.slice(3); // 港股指数
  if (symbol.startsWith('us')) return '100.' + symbol.slice(2).toUpperCase(); // 美股指数/个股（东方财富 secid 大写代码）
  if (symbol === 'sh000001' || symbol === 'sz399001' || symbol === 'sz399006') {
    return symbol.startsWith('sh') ? '1.' + symbol.slice(2) : '0.' + symbol.slice(2);
  }
  return null;
}

// 内部 symbol -> 腾讯行情(qt.gtimg.cn)代码
// A股: sh600519/sz000001 直接可用；港股个股: hk00700 -> hk00700
// 港股指数: r_hkHSI -> hkHSI；美股: usdji -> usDJI（腾讯美股代码大写并加 us 前缀）
function toTencentCode(symbol) {
  if (!symbol) return null;
  const s = String(symbol);
  if (/^(sh|sz)\d{6}$/.test(s)) return s;              // A股大盘/个股
  if (/^hk\d{4,5}$/.test(s)) return s;                 // 港股个股
  if (/^r_hk/i.test(s)) return 'hk' + s.slice(4);      // 港股指数 r_hkHSI -> hkHSI
  if (/^us/i.test(s)) return 'us' + s.slice(2).toUpperCase(); // 美股 usdji -> usDJI
  return null;
}

// 调用腾讯行情接口，解析涨跌幅。返回 { changePct, close, prevClose } 或 null
// 数据格式：v_xxx="字段0~名称1~代码2~现价3~昨收4~...~涨跌额31~涨跌幅%32~..."
async function fetchTencent(symbol) {
  const code = toTencentCode(symbol);
  if (!code) return null;
  const url = `https://qt.gtimg.cn/q=${code}`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    clearTimeout(timer);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const text = buf.toString('binary'); // 数字字段为 ASCII，中文名乱码不影响解析
    const m = text.match(/="([^"]*)"/);
    if (!m) return null;
    const f = m[1].split('~');
    if (f.length < 33) return null;
    const price = parseFloat(f[3]);
    const prevClose = parseFloat(f[4]);
    let changePct = f[32] !== '' && f[32] != null ? parseFloat(f[32]) / 100 : null;
    if ((changePct == null || Number.isNaN(changePct)) && prevClose) {
      changePct = (price - prevClose) / prevClose;
    }
    if (changePct == null || Number.isNaN(changePct)) return null;
    return { changePct, close: Number.isNaN(price) ? null : price, prevClose: Number.isNaN(prevClose) ? null : prevClose, source: 'tencent' };
  } catch (e) {
    return null;
  }
}
function mockChangePct(symbol, dateStr) {
  let h = 0;
  const str = symbol + '|' + dateStr;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  const v = (h % 1000) / 1000; // 0..1
  // 映射到 -5% ~ +5%
  return (v * 0.10 - 0.05);
}

async function fetchLive(symbol) {
  const secid = toSecid(symbol);
  if (!secid) return null;
  const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${encodeURIComponent(secid)}&fields=f43,f57,f58,f60,f169&invt=2&_=${Date.now()}`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    clearTimeout(timer);
    if (!res.ok) return null;
    const json = await res.json();
    const d = json && json.data;
    if (!d || d.f43 == null || d.f43 === '-') return null;
    const price = parseFloat(d.f43);
    const changePct = d.f169 != null && d.f169 !== '-' ? parseFloat(d.f169) / 100 : null;
    const prevClose = d.f60 != null && d.f60 !== '-' ? parseFloat(d.f60) : null;
    if (changePct == null && prevClose) {
      return { changePct: (price - prevClose) / prevClose, close: price, prevClose };
    }
    return { changePct, close: price, prevClose };
  } catch (e) {
    return null;
  }
}

// 从行情源获取证券中文名称（best-effort），失败返回 null
async function fetchSecurityName(symbol) {
  const secid = toSecid(symbol);
  if (!secid) return null;
  const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${encodeURIComponent(secid)}&fields=f57,f58&invt=2&_=${Date.now()}`;
  // 行情接口偶发返回空，做少量重试
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
      clearTimeout(timer);
      if (res.ok) {
        const json = await res.json();
        const name = json && json.data && json.data.f58;
        if (name && name !== '-') return String(name).trim();
      }
    } catch (e) { /* 重试 */ }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 600));
  }
  return null;
}

// 按名称/代码搜索标的（外部接口，best-effort），返回 [{ symbol, name, market }]
// 用于提交预测时「输入名称自动获取代码」。market 可限定 A_STOCK/HK_STOCK/US_STOCK。
// 数据源：腾讯股票智能提示（服务器端可达，东方财富该接口在服务器侧被拦截）。
async function searchSymbolByName(q, market) {
  const query = String(q || '').trim();
  if (query.length < 1) return [];
  const url = `https://smartbox.gtimg.cn/s3/?v=2&t=all&q=${encodeURIComponent(query)}`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://stockapp.finance.qq.com/' },
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const text = await res.text();
    // 形如 v_hint="us~aapl.oq~苹果~pg~GP^hk~00700~腾讯控股~txkg~GP^..."
    // 每条以 ^ 分隔，字段以 ~ 分隔：prefix~code~name~pinyin~type
    const m = text.match(/v_hint="([^"]*)"/);
    if (!m) return [];
    const entries = m[1].split('^').filter(Boolean);
    const out = [];
    const seen = new Set();
    for (const e of entries) {
      const f = e.split('~');
      if (f.length < 3) continue;
      const [prefix, code, name, , type] = f;
      if (type && !type.startsWith('GP')) continue; // 仅保留正股，剔除权证/期权
      const mapped = mapTencentPrefix(prefix, code);
      if (!mapped) continue;
      if (market && mapped.market !== market) continue;
      const key = mapped.market + ':' + mapped.symbol;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ symbol: mapped.symbol, name: name || mapped.symbol, market: mapped.market });
      if (out.length >= 10) break;
    }
    return out;
  } catch (e) {
    return [];
  }
}

// 腾讯智能提示前缀 -> 内部市场与 symbol
function mapTencentPrefix(prefix, code) {
  if (prefix === 'us') {
    const c = code.replace(/\.(oq|ps)$/i, ''); // 去掉 .oq / .ps 后缀
    return { market: 'US_STOCK', symbol: 'us' + c.toLowerCase() };
  }
  if (prefix === 'hk') return { market: 'HK_STOCK', symbol: 'hk' + code.padStart(5, '0') };
  if (prefix === 'sh') return { market: 'A_STOCK', symbol: 'sh' + code };
  if (prefix === 'sz') return { market: 'A_STOCK', symbol: 'sz' + code };
  return null;
}

// 获取某标的在指定交易日的实际涨跌幅；返回 { changePct, close, prevClose } 或 null
async function getQuote(symbol, dateStr) {
  if (config.quoteMode === 'mock') {
    return { changePct: mockChangePct(symbol, dateStr), close: 100, prevClose: 100, mock: true };
  }
  // live 模式：优先腾讯行情（云服务器可达），失败回退东方财富
  const q = await fetchTencent(symbol);
  if (q && q.changePct != null) return q;
  return fetchLive(symbol);
}

// 将前端筛选值展开为具体市场数组：ALL/空 → 不过滤；INDEX → 三大盘；STOCK → 个股；或逗号列表
const INDEX_MARKETS = ['A_INDEX', 'HK_INDEX', 'US_INDEX'];
const STOCK_MARKETS = ['A_STOCK', 'HK_STOCK', 'US_STOCK'];
function expandMarketFilter(m) {
  if (!m || m === 'ALL') return null;
  if (m === 'INDEX') return INDEX_MARKETS;
  if (m === 'STOCK') return STOCK_MARKETS;
  const valid = m.split(',').map((x) => x.trim()).filter((x) => MARKETS[x]);
  return valid.length ? valid : null;
}

module.exports = {
  MARKETS,
  PRESET_INDICES,
  INDEX_MARKETS,
  STOCK_MARKETS,
  normalizeSymbol,
  resolveSymbolName,
  fetchSecurityName,
  getQuote,
  toSecid,
  expandMarketFilter,
  searchSymbolByName,
};
