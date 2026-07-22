'use strict';

const state = {
  uid: localStorage.getItem('uid') || null,
  name: localStorage.getItem('name') || null,
  market: 'A_INDEX',
  direction: 'UP',
  symbol: null,
  reasonFile: null,
  meta: { markets: {}, presets: {} },
  calMonth: new Date().toISOString().slice(0, 7),
  calMarket: 'A_INDEX',
  calSymbol: '',
  calAnim: 'fade', // 日历切换动效：fade / left / right
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const pad = (n) => String(n).padStart(2, '0');

function headers() {
  const h = { 'Content-Type': 'application/json' };
  if (state.uid) h['X-User-Id'] = state.uid;
  return h;
}
async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { ...headers(), ...(opts.headers || {}) } });
  return res.json();
}

let _echartsLoading = null;
// 懒加载 echarts：仅进入统计页时按需加载，避免首页被 1MB 脚本阻塞
function loadEcharts() {
  if (window.echarts) return Promise.resolve();
  if (_echartsLoading) return _echartsLoading;
  _echartsLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { _echartsLoading = null; reject(new Error('echarts 加载失败')); };
    document.head.appendChild(s);
  });
  return _echartsLoading;
}

async function init() {
  state.meta = (await api('api/admin/meta')).data;
  bindMarketSeg();
  bindHistFilters();
  ensureStockSymbols();
  await refreshHome();
}

/* ---------- 市场 / 标的选择（提交弹层内） ---------- */
function bindMarketSeg() {
  $$('#marketSeg button').forEach((b) => {
    b.onclick = () => {
      $$('#marketSeg button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      state.market = b.dataset.m;
      state.symbol = null;
      renderSymbolBox();
    };
  });
  $$('.seg.dir button').forEach((b) => {
    b.onclick = () => {
      $$('.seg.dir button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      state.direction = b.dataset.d;
    };
  });
}

function renderSymbolBox() {
  const box = $('#symbolBox');
  const m = state.market;
  if (m === 'A_INDEX' || m === 'HK_INDEX') {
    const list = state.meta.presets[m] || [];
    box.innerHTML = '<div class="chips">' +
      list.map((x, i) => `<span class="chip ${i === 0 ? 'active' : ''}" data-sym="${x.symbol}" data-name="${x.name}">${x.name}</span>`).join('') +
      '</div>';
    state.symbol = list[0] ? list[0].symbol : null;
    state.symbolName = list[0] ? list[0].name : '';
    $$('#symbolBox .chip').forEach((c) => {
      c.onclick = () => {
        $$('#symbolBox .chip').forEach((x) => x.classList.remove('active'));
        c.classList.add('active');
        state.symbol = c.dataset.sym;
        state.symbolName = c.dataset.name;
      };
    });
  } else {
    const ph = m === 'A_STOCK' ? '输入代码，如 600519 或 sh600519' : '输入港股代码，如 00700';
    const nmPh = m === 'A_STOCK' ? '股票名称，如 贵州茅台' : '股票名称，如 腾讯控股';
    box.innerHTML =
      `<input type="text" id="symInput" placeholder="${ph}" />` +
      `<input type="text" id="symNameInput" placeholder="${nmPh}" style="margin-top:8px" />`;
    state.symbol = null;
    state.symbolName = '';
    $('#symInput').oninput = (e) => { state.symbol = e.target.value.trim(); };
    $('#symNameInput').oninput = (e) => { state.symbolName = e.target.value.trim(); };
  }
}

/* ---------- 提交 ---------- */
// 下一交易日（仅跳过周末，与后端一致）：用于日期选择框默认值
function nextTradingDay(from = new Date()) {
  const d = new Date(from);
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function openSubmit() {
  $('#submitModal').classList.remove('hidden');
  $('#submitMsg').textContent = ''; $('#submitMsg').className = 'msg';
  state.reasonFile = null;
  state.symbolName = '';
  $('#reasonFile').value = '';
  $('#reasonFileName').textContent = '';
  const nm = $('#symNameInput'); if (nm) nm.value = '';
  const td = $('#targetDate');
  if (td) {
    const today = new Date().toISOString().slice(0, 10);
    td.min = today;                 // 不允许选过去的日期
    td.value = nextTradingDay();    // 默认下一交易日
  }
  if (!state.symbol) renderSymbolBox();
}
$('#openSubmit').onclick = openSubmit;
$('#closeSubmit').onclick = () => $('#submitModal').classList.add('hidden');

/* ---------- 拖拽 / 点击上传 HTML 逻辑文件 ---------- */
function setReasonFile(file) {
  if (!file) return;
  const name = (file.name || '').toLowerCase();
  if (!/\.html?$/.test(name) && file.type !== 'text/html') {
    $('#submitMsg').textContent = '仅支持 HTML 文件'; $('#submitMsg').className = 'msg err';
    return;
  }
  state.reasonFile = file;
  $('#reasonFileName').textContent = file.name;
}
const drop = $('#reasonDrop');
const fileInput = $('#reasonFile');
drop.onclick = (e) => { if (e.target === drop || e.target.closest('.dz-inner')) fileInput.click(); };
fileInput.onchange = () => setReasonFile(fileInput.files[0]);
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); }));
drop.addEventListener('drop', (e) => {
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) {
    setReasonFile(f);
    const dt = new DataTransfer(); dt.items.add(f);
    try { fileInput.files = dt.files; } catch (_) {}
  }
});

$('#submitBtn').onclick = async () => {
  const msg = $('#submitMsg');
  msg.textContent = ''; msg.className = 'msg';
  let sym = state.symbol;
  let symName = state.symbolName || '';
  if (state.market === 'A_STOCK' || state.market === 'HK_STOCK') {
    sym = $('#symInput') ? $('#symInput').value.trim() : '';
    symName = $('#symNameInput') ? $('#symNameInput').value.trim() : '';
  } else if (state.market === 'A_INDEX' || state.market === 'HK_INDEX' || state.market === 'US_INDEX') {
    // 大盘指数：名称取自预置映射，不依赖可能为空 / 被误改的 state.symbolName
    const preset = (state.meta.presets[state.market] || []).find((x) => x.symbol === sym);
    symName = preset ? preset.name : (state.symbolName || '');
  }
  if (!sym) { msg.textContent = '请选择/输入标的'; msg.className = 'msg err'; return; }
  const fd = new FormData();
  fd.append('market', state.market);
  fd.append('symbol', sym);
  if (symName) fd.append('symbol_name', symName);
  fd.append('direction', state.direction);
  const td = $('#targetDate').value.trim();
  if (td) fd.append('target_date', td);
  fd.append('reason', $('#reasonCaption').value.trim());
  const file = state.reasonFile || $('#reasonFile').files[0];
  if (file) fd.append('reason_file', file);
  // 注意：FormData 提交不能带 Content-Type: application/json，否则会覆盖浏览器自动生成的
  // multipart/form-data; boundary，导致服务端把 multipart 当 JSON 解析而 500。
  const subHeaders = state.uid ? { 'X-User-Id': state.uid } : {};
  const r = await fetch('api/predictions', { method: 'POST', headers: subHeaders, body: fd });
  const data = await r.json();
  if (data.code !== 0) { msg.textContent = data.msg; msg.className = 'msg err'; return; }
  msg.textContent = '提交成功，次日自动校验'; msg.className = 'msg ok';
  state.reasonFile = null;
  state.symbolName = '';
  $('#reasonCaption').value = ''; $('#reasonFile').value = ''; $('#reasonFileName').textContent = '';
  $('#submitModal').classList.add('hidden');
  await refreshHome(); await refreshStats();
};

/* ---------- 首页：指标 + 今日结果 + 日历 ---------- */
async function refreshHome() {
  const today = new Date().toISOString().slice(0, 10);
  let calUrl = 'api/stats/calendar?month=' + state.calMonth + '&market=' + state.calMarket;
  if (state.calMarket === 'STOCK' && state.calSymbol) calUrl += '&symbol=' + encodeURIComponent(state.calSymbol);
  const cal = await api(calUrl);
  // 拉取大盘实际涨跌（用于日历方块底色），仅指数市场需要
  let marketHistory = {};
  if (['A_INDEX', 'HK_INDEX', 'US_INDEX'].includes(state.calMarket)) {
    try {
      const mh = await api('api/market-history?month=' + state.calMonth);
      if (mh && mh.code === 0) marketHistory = mh.data || {};
    } catch (e) { /* 接口异常不影响日历渲染 */ }
  }
  if (cal.code === 0) renderCalendar(cal.data, today, marketHistory);

  await renderToday(today);

  const c = await api('api/stats');
  if (c.code === 0) {
    $('#cumAcc').textContent = (c.data.accuracy * 100).toFixed(1) + '%';
    $('#cumSub').textContent = `共 ${c.data.total} 次 · 命中 ${c.data.hits} 次`;
    $('#weekAcc').textContent = (c.data.weekAccuracy * 100).toFixed(1) + '%';
    $('#weekSub').textContent = `共 ${c.data.weekTotal} 次 · 命中 ${c.data.weekHits} 次`;
    $('#monthAcc').textContent = (c.data.monthAccuracy * 100).toFixed(1) + '%';
    $('#monthSub').textContent = `共 ${c.data.monthTotal} 次 · 命中 ${c.data.monthHits} 次`;
  }
}

let stockSymbolsLoaded = false;
async function ensureStockSymbols() {
  if (stockSymbolsLoaded) return;
  const r = await api('api/stats/symbols');
  if (r.code === 0) {
    const sel = $('#stockSel');
    r.data.forEach((s) => {
      const o = document.createElement('option');
      o.value = s.symbol; o.textContent = s.symbol_name || s.symbol;
      sel.appendChild(o);
    });
    stockSymbolsLoaded = true;
  }
}

async function renderToday(today) {
  const r = await api('api/stats/today?date=' + today);
  if (r.code !== 0) return;
  const order = r.data.order || ['A_INDEX', 'HK_INDEX', 'US_INDEX'];
  const markets = r.data.markets || {};
  const grid = $('#idxGrid');
  grid.innerHTML = order.map((m) => {
    // 同一 symbol 只保留最新一条（后端已按 id DESC 排序，前端去重防御）
    const rows = (markets[m] || []).filter((x, i, arr) => arr.findIndex((y) => y.symbol === x.symbol) === i);
    const label = (state.meta.markets && state.meta.markets[m]) || m;
    let status = 'none', resultText = '未提交', dirText = '今天还没有提交预测';
    if (rows.length) {
      const hasPending = rows.some((x) => x.status !== 'VERIFIED');
      const r0 = rows[0];
      dirText = (r0.direction === 'UP' ? '看涨' : '看跌') + ' · ' + (r0.symbol_name || r0.symbol);
      if (hasPending) {
        status = 'pending'; resultText = '待校验';
      } else {
        const hits = rows.filter((x) => x.is_hit).length;
        if (hits === rows.length) { status = 'hit'; resultText = rows.length > 1 ? `命中 ${hits}/${rows.length}` : '命中'; }
        else { status = 'miss'; resultText = rows.length > 1 ? `未中 ${hits}/${rows.length}` : '未中'; }
      }
    }
    return `<div class="idx-card ${status}" data-market="${m}">
      <div class="idx-name">${label}预测</div>
      <div class="idx-result">${resultText}</div>
      <div class="idx-dir">${dirText}</div>
    </div>`;
  }).join('');

  $$('#idxGrid .idx-card').forEach((card) => {
    card.onclick = () => toggleIdxDetail(card.dataset.market, markets[card.dataset.market] || []);
  });
}

let idxOpen = null;
function toggleIdxDetail(market, rows) {
  const box = $('#idxDetail');
  if (idxOpen === market && box.style.display !== 'none') {
    box.style.display = 'none'; idxOpen = null; return;
  }
  if (!rows.length) { box.innerHTML = '<div class="meta">当日无该市场预测</div>'; }
  else { box.innerHTML = `<h4 style="margin:0 0 8px;color:var(--muted)">${(state.meta.markets && state.meta.markets[market]) || market} · 今日详情</h4>` + rows.map(rowHtml).join(''); }
  box.style.display = 'block';
  idxOpen = market;
}

function renderCalendar(data, today, marketHistory) {
  const month = data.month; // YYYY-MM
  const mh = (marketHistory && marketHistory[state.calMarket]) || {};
  const [y, m] = month.split('-').map(Number);
  $('#calTitle').textContent = `${y}年${m}月`;
  const days = new Date(y, m, 0).getDate();
  const grid = $('#calGrid');
  // 仅展示工作日（周一~周五），周末不开盘
  const workdays = [];
  for (let d = 1; d <= days; d++) {
    const dow = new Date(y, m - 1, d).getDay();
    if (dow !== 0 && dow !== 6) workdays.push(d);
  }
  const firstDow = workdays.length ? new Date(y, m - 1, workdays[0]).getDay() : 1;
  const offset = firstDow - 1; // 周一->0 列
  let html = '';
  for (let i = 0; i < offset; i++) html += '<div class="cal-cell empty"></div>';
  for (const d of workdays) {
    const ds = `${month}-${pad(d)}`;
    const info = data.days[ds];
    const md = mh[ds]; // { dir:'up'|'down', pct:Number } 大盘实际涨跌
    let cls = 'cal-cell', stat = '', face = '', numCls = 'dnum', dir = '';
    if (ds === today) cls += ' today';
    if (md && md.dir === 'up') cls += ' mkt-up';
    else if (md && md.dir === 'down') cls += ' mkt-down';
    if (info && info.total > 0) {
      if (info.verified > 0) {
        if (info.hits === info.verified) { cls += ' hit'; stat = '命中'; face = '😄'; }
        else { cls += ' miss'; stat = '未中'; face = '😭'; }
      } else if (info.pending > 0 || info.err > 0) {
        cls += ' pending'; stat = '待校验'; face = '⏳';
      }
      // 预测方向：只展示当天最新一条预测的方向（看涨红 / 看跌绿），不再显示数量
      const ld = info.latestDir || (info.up > 0 ? 'UP' : (info.down > 0 ? 'DOWN' : ''));
      if (ld === 'UP') dir = '<span class="up">看涨</span>';
      else if (ld === 'DOWN') dir = '<span class="down">看跌</span>';
    }
    const chgTxt = md ? (md.pct > 0 ? '+' : '') + md.pct.toFixed(2) + '%' : '';
    const chgCls = md ? (md.pct >= 0 ? 'up' : 'down') : '';
    html += `<div class="${cls}" data-date="${ds}">`
      + `<div class="dhead"><span class="${numCls}">${d}</span>${dir ? `<span class="ddir">${dir}</span>` : ''}</div>`
      + `<span class="dface">${face}</span>`
      + `<div class="dfoot"><span class="dchg ${chgCls}">${chgTxt}</span><span class="dstat">${stat}</span></div>`
      + `</div>`;
  }
  grid.innerHTML = html;
  $$('#calGrid .cal-cell:not(.empty)').forEach((cell) => {
    bindCalCell(cell);
  });

  // 触发切换动效（先移除再强制回流后添加，确保每次重渲染都重放动画）
  const anim = state.calAnim || 'fade';
  grid.classList.remove('cal-anim-fade', 'cal-anim-left', 'cal-anim-right');
  void grid.offsetWidth;
  grid.classList.add('cal-anim-' + anim);
  state.calAnim = 'fade'; // 复位，默认淡入
}

// 日历单元格：短按跳转当天 HTML，长按(500ms)打开手动修正结果
function bindCalCell(cell) {
  const date = cell.dataset.date;
  let timer = null, longFired = false;
  const start = () => {
    longFired = false;
    timer = setTimeout(() => { longFired = true; openEditResult(date); }, 500);
  };
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  cell.onpointerdown = start;
  cell.onpointerup = cancel;
  cell.onpointerleave = cancel;
  cell.onpointercancel = cancel;
  cell.oncontextmenu = (e) => { e.preventDefault(); longFired = true; openEditResult(date); };
  cell.onclick = () => {
    if (longFired) { longFired = false; return; }
    loadDayDetail(date);
  };
}

// 长按日历某天：手动修正当天的命中/未中结果
async function openEditResult(date) {
  let url = 'api/predictions?target_date=' + encodeURIComponent(date) + '&market=' + state.calMarket + '&page=1&size=50';
  if (state.calMarket === 'STOCK' && state.calSymbol) url += '&symbol=' + encodeURIComponent(state.calSymbol);
  try {
    const r = await fetch(url);
    const data = await r.json();
    const list = (data.data && data.data.list) || [];
    if (!list.length) { alert('当天没有提交预测，无法修改结果'); return; }
    // 同一 symbol 只保留最新一条（后端已去重，前端防御）
    const deduped = list.filter((x, i, arr) => arr.findIndex((y) => y.symbol === x.symbol) === i);
    const box = $('#editResultList');
    box.innerHTML = deduped.map((p) => {
      const dirText = p.direction === 'UP' ? '看涨' : '看跌';
      let statusText, orig;
      if (p.status === 'VERIFIED') { statusText = p.is_hit ? '命中' : '未中'; orig = p.is_hit ? 'HIT' : 'MISS'; }
      else if (p.status === 'ERROR') { statusText = '异常'; orig = 'PENDING'; }
      else { statusText = '待校验'; orig = 'PENDING'; }
      return `<div class="edit-row" data-id="${p.id}" data-orig="${orig}">
        <div class="er-head"><b>${escapeHtml(p.symbol_name || p.symbol)}</b> · ${dirText} · 当前：${statusText}</div>
        <div class="er-body">
          <div class="seg er-seg">
            <button type="button" data-v="HIT" class="${orig === 'HIT' ? 'active' : ''}">命中</button>
            <button type="button" data-v="MISS" class="${orig === 'MISS' ? 'active' : ''}">未中</button>
            <button type="button" data-v="PENDING" class="${orig === 'PENDING' ? 'active' : ''}">待校验</button>
          </div>
        </div>
      </div>`;
    }).join('');
    $('#editResultDate').textContent = '目标交易日：' + date;
    $$('#editResultList .edit-row').forEach((row) => {
      const orig = row.dataset.orig;
      const seg = row.querySelector('.er-seg');
      const sync = () => {
        const sel = seg.querySelector('.active');
        const v = sel ? sel.dataset.v : '';
        row.classList.toggle('dirty', v !== orig);
      };
      seg.querySelectorAll('button').forEach((btn) => {
        btn.onclick = () => {
          seg.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          sync();
        };
      });
    });
    const msg = $('#editResultMsg'); msg.textContent = ''; msg.className = 'msg';
    $('#editResultModal').classList.remove('hidden');
  } catch (e) {
    alert('加载失败');
  }
}

async function saveEditResult() {
  const msg = $('#editResultMsg');
  const rows = $$('#editResultList .edit-row');
  let ok = 0, fail = 0;
  for (const row of rows) {
    if (!row.classList.contains('dirty')) continue;
    const id = row.dataset.id;
    const sel = row.querySelector('.er-seg .active');
    const result = sel ? sel.dataset.v : 'PENDING';
    if (result === row.dataset.orig) continue;
    try {
      const r = await fetch('api/predictions/' + id + '/result', { method: 'PATCH', headers: headers(), body: JSON.stringify({ result }) });
      const j = await r.json();
      if (j.code === 0) ok++; else fail++;
    } catch (e) { fail++; }
  }
  if (ok) {
    msg.textContent = '已保存 ' + ok + ' 条' + (fail ? '，' + fail + ' 条失败' : '');
    msg.className = 'msg ok';
  } else {
    msg.textContent = '没有可保存的修改' + (fail ? '或保存失败' : '');
    msg.className = 'msg err';
  }
  await Promise.all([refreshHome(), refreshStats()]);
  setTimeout(() => $('#editResultModal').classList.add('hidden'), 700);
}

async function loadDayDetail(date) {
  let url = 'api/predictions?target_date=' + encodeURIComponent(date) + '&market=' + state.calMarket + '&page=1&size=50';
  if (state.calMarket === 'STOCK' && state.calSymbol) url += '&symbol=' + encodeURIComponent(state.calSymbol);
  try {
    const r = await fetch(url);
    const data = await r.json();
    if (!data || data.code !== 0) { alert('加载失败'); return; }
    const list = (data.data && data.data.list) || [];
    // 当天没有提交任何预测：仅提示，不跳转
    if (!list.length) { alert('当天没有提交预测'); return; }
    // 当天有预测但没上传 HTML 逻辑：提示，不跳转
    const hit = list.find((p) => p.reason_file);
    if (hit) window.location.href = 'api/predictions/' + hit.id + '/reason';
    else alert('当天未上传预测逻辑 HTML');
  } catch (e) {
    alert('加载失败');
  }
}

$('#calPrev').onclick = () => { shiftMonth(-1); };
$('#calNext').onclick = () => { shiftMonth(1); };

$$('#calFilter button').forEach((b) => {
  b.onclick = () => {
    $$('#calFilter button').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    state.calMarket = b.dataset.m;
    $('#stockSel').value = '';
    state.calSymbol = '';
    refreshHome();
  };
});
$('#stockSel').onchange = () => {
  const v = $('#stockSel').value;
  if (!v) return;
  state.calMarket = 'STOCK';
  state.calSymbol = v;
  $$('#calFilter button').forEach((x) => x.classList.remove('active'));
  refreshHome();
};
function shiftMonth(delta) {
  state.calAnim = delta < 0 ? 'left' : 'right'; // 上一月从左侧滑入，下一月从右侧滑入
  let [y, m] = state.calMonth.split('-').map(Number);
  m += delta;
  if (m < 1) { m = 12; y--; }
  if (m > 12) { m = 1; y++; }
  state.calMonth = `${y}-${pad(m)}`;
  refreshHome();
}

/* ---------- 统计页 ---------- */
async function refreshStats() {
  if (!$('#statAcc').offsetParent) return; // 未显示则不请求
  const r = await api('api/stats');
  if (r.code !== 0) return;
  const d = r.data;
  $('#statAcc').textContent = (d.accuracy * 100).toFixed(1) + '%';
  $('#statSub').textContent = `共 ${d.total} 次 · 命中 ${d.hits} 次`;
  const st = d.streak;
  $('#streak').textContent = st && st.type ? `当前${st.type === 'W' ? '连胜' : '连败'} ${st.count} 次` : '';

  $('#byMarket').innerHTML = '<h3>分类准确率</h3>' + Object.values(d.byMarket).map((x) => `
    <div class="by-m">
      <div><div class="name">${x.label}</div>
        <div class="meta">${x.total} 次 · 命中 ${x.hits}</div>
        <div class="bar"><i style="width:${(x.accuracy * 100).toFixed(0)}%"></i></div>
      </div>
      <div class="acc">${(x.accuracy * 100).toFixed(0)}%</div>
    </div>`).join('');

  renderTrend(d.trend);

  const lb = await api('api/stats/leaderboard');
  if (lb.code === 0) {
    $('#leaderboard').innerHTML = lb.data.length ? lb.data.map((x) => `
      <div class="row"><div class="sym">${x.rank}. ${x.name}</div>
        <div><span class="tag hit">${(x.accuracy * 100).toFixed(1)}%</span> <span class="meta">${x.total}次</span></div></div>`).join('')
      : '<div class="meta">暂无排行</div>';
  }
}

function renderTrend(trend) {
  const el = $('#trendChart');
  if (!el) return;
  if (!window.echarts) { // 统计页首次打开时按需懒加载 echarts
    loadEcharts().then(() => renderTrend(trend)).catch(() => { el.innerHTML = '<div class="meta">图表库加载失败（可能网络受限），请稍后重试</div>'; });
    return;
  }
  const chart = window.echarts.init(el);
  chart.setOption({
    grid: { left: 40, right: 16, top: 16, bottom: 28 },
    xAxis: { type: 'category', data: trend.map((t) => t.date.slice(5)), axisLine: { lineStyle: { color: '#3a4566' } } },
    yAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%', color: '#8a93ad' }, splitLine: { lineStyle: { color: '#232b44' } } },
    series: [{
      type: 'line', smooth: true, data: trend.map((t) => +(t.accuracy * 100).toFixed(1)),
      areaStyle: { color: 'rgba(76,141,255,.18)' }, itemStyle: { color: '#4c8dff' }, lineStyle: { width: 3 },
    }],
    tooltip: { trigger: 'axis' },
  });
}

/* ---------- 历史 ---------- */
async function refreshHistory() {
  const m = $('#histMarketSeg .active').dataset.m;
  const stockSym = $('#histStockSel').value;
  const s = $('#fStatus').value;
  const src = $('#fSource').value;
  const qs = new URLSearchParams({ page: 1, size: 50 });
  if (m) qs.set('market', m);
  if (stockSym) qs.set('symbol', stockSym);
  if (s) qs.set('status', s);
  if (src) qs.set('source', src);
  const sd = $('#fStart').value, ed = $('#fEnd').value;
  if (sd) qs.set('start_date', sd);
  if (ed) qs.set('end_date', ed);
  const r = await api('api/predictions?' + qs.toString());
  if (r.code !== 0) return;
  $('#histList').innerHTML = r.data.list.length ? r.data.list.map(histRowHtml).join('') : '<div class="meta">暂无记录</div>';
}
function fmtCreatedAt(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  if (isNaN(d)) return iso;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function rowHtml(p) {
  const dirTag = `<span class="tag ${p.direction}">${p.direction === 'UP' ? '看涨' : '看跌'}</span>`;
  let stTag = '';
  if (p.status === 'VERIFIED') stTag = p.is_hit ? '<span class="tag hit">命中</span>' : '<span class="tag miss">未中</span>';
  else if (p.status === 'PENDING') stTag = '<span class="tag pending">待校验</span>';
  else stTag = '<span class="tag error">异常</span>';
  const act = p.status === 'VERIFIED' && p.actual_change != null
    ? `实际 ${(p.actual_change * 100).toFixed(2)}%` : (p.status === 'ERROR' ? '行情缺失' : '—');
  const srcText = p.submit_source === 'api' ? 'API' : '手工';
  const reason = p.reason ? `<div class="meta">逻辑：${escapeHtml(p.reason)}</div>` : '';
  const logic = p.reason_file ? `<div class="meta"><button class="tag logic" data-reason="${p.id}">查看逻辑 HTML</button></div>` : '';
  return `<div class="row">
    <div>
      <div class="sym">${p.symbol_name || p.symbol} ${dirTag}</div>
      <div class="meta">目标日 ${p.target_date} · ${act}</div>
      <div class="meta">提交 ${fmtCreatedAt(p.created_at)} · 方式 ${srcText}</div>
      ${reason}
      ${logic}
    </div>
    <div>${stTag}</div>
  </div>`;
}
// 历史列表：与「即将公布的预测」一致的紧凑卡片风格，并保留提交时间
function histRowHtml(p) {
  const dirTag = `<span class="tag ${p.direction}">${p.direction === 'UP' ? '看涨' : '看跌'}</span>`;
  let stTag = '';
  if (p.status === 'VERIFIED') stTag = p.is_hit ? '<span class="tag hit">命中</span>' : '<span class="tag miss">未中</span>';
  else if (p.status === 'PENDING') stTag = '<span class="tag pending">待校验</span>';
  else stTag = '<span class="tag error">异常</span>';
  const mkt = (state.meta.markets && state.meta.markets[p.market]) || p.market;
  const srcText = p.submit_source === 'api' ? 'API' : '手工';
  const act = p.status === 'VERIFIED' && p.actual_change != null ? ` · 实际 ${(p.actual_change * 100).toFixed(2)}%` : '';
  const logic = p.reason_file ? ` · <button class="tag logic" data-reason="${p.id}">逻辑 HTML</button>` : '';
  return `<div class="row hist-row">
    <div>
      <div class="sym">${escapeHtml(p.symbol_name || p.symbol)} ${dirTag}</div>
      <div class="meta">目标日 ${p.target_date} · ${mkt} · 方式 ${srcText} · 提交 ${fmtCreatedAt(p.created_at)}${act}${logic}</div>
    </div>
    <div>${stTag}</div>
  </div>`;
}
function escapeHtml(s) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

/* 历史筛选：市场段与上述首页一致，个股下拉复用预置 */
function bindHistFilters() {
  $$('#histMarketSeg button').forEach((b) => {
    b.onclick = () => {
      $$('#histMarketSeg button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      const m = b.dataset.m;
      if (m === 'A_STOCK' || m === 'HK_STOCK') { $('#histStockSel').style.display = ''; }
      else {
        $('#histStockSel').style.display = (m === '') ? '' : 'none';
        $('#histStockSel').value = '';
      }
      if (m === 'A_STOCK' || m === 'HK_STOCK') renderHistStockSel(m);
      refreshHistory();
    };
  });
  const sel = $('#histStockSel');
  sel.onchange = refreshHistory;
  $('#fStatus').onchange = refreshHistory;
  $('#fSource').onchange = refreshHistory;
  $('#fStart').onchange = refreshHistory;
  $('#fEnd').onchange = refreshHistory;
}
function renderHistStockSel(market) {
  const sel = $('#histStockSel');
  sel.innerHTML = '<option value="" disabled selected>个股</option>';
  (state.meta.presets[market] || []).forEach((x) => {
    const o = document.createElement('option'); o.value = x.symbol; o.text = x.name; sel.appendChild(o);
  });
}

/* ---------- 开放平台 ---------- */
// 调用统计：每次进入开放平台页都刷新（不做缓存）
async function refreshUsage() {
  try {
    const r = await api('api/open/usage');
    if (r.code !== 0) return;
    const fmt = (n) => (Number(n) || 0).toLocaleString('zh-CN');
    if ($('#usageToday')) $('#usageToday').textContent = fmt(r.data.today);
    if ($('#usageTotal')) $('#usageTotal').textContent = fmt(r.data.total);
  } catch (e) { /* 忽略 */ }
}

let openLoaded = false;
async function refreshOpen() {
  refreshUsage();
  if (openLoaded) return;
  const r = await api('api/open/info');
  if (r.code !== 0) return;
  const d = r.data;
  $('#openApiKey').textContent = d.apiKey;
  $('#openApiKey').dataset.copyval = d.apiKey;
  $('#openEndpoint').textContent = d.method + ' ' + d.endpoint;
  $('#openDeadline').textContent = d.submitDeadline + '（收盘前）';
  $('#openVerify').textContent = d.verifyTime + ' 自动校验';
  $('#openPrompt').textContent = d.prompt;
  if ($('#openBaseUrl')) {
    $('#openBaseUrl').textContent = d.baseUrl;
    $('#openBaseUrl').dataset.copyval = d.baseUrl;
  }

  // 真实线上基础地址（含子路径，如 /stockMarketForecast），确保文档里的地址可点击可调用
  const base = d.baseUrl || (location.origin + location.pathname.replace(/\/[^/]*$/, ''));
  const docs =
`# 1. 提交预测（JSON）
POST ${base}${d.endpoint}
Authorization: Bearer ${d.apiKey}
Content-Type: application/json

{
  "market": "A_INDEX | HK_INDEX | US_INDEX | A_STOCK | HK_STOCK",
  "symbol": "标的代码",
  "direction": "UP | DOWN",
  "reason_html": "<!-- 预测逻辑 HTML，可选 -->",
  "target_date": "目标交易日 YYYY-MM-DD，留空=下一交易日"
}

# 2. 提交预测（上传 HTML 逻辑文件）
curl -X POST ${base}${d.endpoint} \\
  -H "Authorization: Bearer ${d.apiKey}" \\
  -F "market=A_INDEX" -F "symbol=sh000001" \\
  -F "direction=UP" -F "reason_file=@logic.html"

# 3. 查询个人统计
GET ${base}/api/stats
Authorization: Bearer ${d.apiKey}

# 4. 查询历史预测
GET ${base}/api/predictions?market=ALL&status=VERIFIED&page=1&size=20
Authorization: Bearer ${d.apiKey}

# 说明
- 同一用户+标的+目标日只能有一条预测，重复提交会覆盖。
- 每日 ${d.verifyTime} 自动校验上一交易日结果并统计命中率。`;
  $('#openDocs').textContent = docs;

  const labels = d.markets;
  const html = Object.entries(d.presets).map(([m, list]) => `
    <div class="op-group">
      <h4>${labels[m] || m}</h4>
      ${list.map((x) => `<div class="op-item"><span>${x.name}</span><code>${x.symbol}</code></div>`).join('')}
    </div>`).join('');
  $('#openPresets').innerHTML = html || '<div class="meta">暂无预置标的</div>';
  openLoaded = true;
}

// 复制到剪贴板（data-copy 指向元素 id，优先取 dataset.copyval）
$$('[data-copy]').forEach((btn) => {
  btn.onclick = () => {
    const el = $('#' + btn.dataset.copy);
    const text = el.dataset.copyval || el.textContent;
    navigator.clipboard.writeText(text).then(() => {
      const old = btn.textContent; btn.textContent = '已复制';
      setTimeout(() => (btn.textContent = old), 1200);
    }).catch(() => alert('复制失败，请手动选择'));
  };
});
$('#copyPrompt').onclick = () => {
  const text = $('#openPrompt').textContent;
  navigator.clipboard.writeText(text).then(() => {
    const old = $('#copyPrompt').textContent; $('#copyPrompt').textContent = '已复制';
    setTimeout(() => ($('#copyPrompt').textContent = old), 1200);
  }).catch(() => alert('复制失败'));
};
if ($('#refreshUsage')) {
  $('#refreshUsage').onclick = () => {
    const btn = $('#refreshUsage');
    const old = btn.textContent; btn.textContent = '刷新中';
    Promise.resolve(refreshUsage()).finally(() => { setTimeout(() => (btn.textContent = old), 600); });
  };
}

/* ---------- 查看预测逻辑 HTML（沙箱渲染，防 XSS） ---------- */
const REASON_CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob: *; font-src * data:; connect-src 'none'">`;
async function viewReason(id) {
  const r = await fetch('api/predictions/' + id + '/reason', { headers: headers() });
  if (!r.ok) { alert('无法加载预测逻辑'); return; }
  const html = await r.text();
  $('#reasonFrame').srcdoc = REASON_CSP + html;
  $('#reasonModal').classList.remove('hidden');
}
$('#closeReason').onclick = () => { $('#reasonModal').classList.add('hidden'); $('#reasonFrame').srcdoc = ''; };
$('#reasonModal').onclick = (e) => { if (e.target === $('#reasonModal')) { $('#reasonModal').classList.add('hidden'); $('#reasonFrame').srcdoc = ''; } };

/* ---------- 手动修正预测结果（长按日历触发） ---------- */
$('#closeEditResult').onclick = () => $('#editResultModal').classList.add('hidden');
$('#editResultModal').onclick = (e) => { if (e.target === $('#editResultModal')) $('#editResultModal').classList.add('hidden'); };
$('#editResultSave').onclick = saveEditResult;
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-reason]');
  if (btn) viewReason(btn.dataset.reason);
});

/* ---------- Tab 切换 ---------- */
$$('.top-tabs button').forEach((b) => {
  b.onclick = () => {
    $$('.top-tabs button').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    $$('.page').forEach((p) => p.classList.add('hidden'));
    $('#page-' + b.dataset.page).classList.remove('hidden');
    if (b.dataset.page === 'stats') refreshStats();
    if (b.dataset.page === 'history') refreshHistory();
    if (b.dataset.page === 'open') refreshOpen();
  };
});

init();
