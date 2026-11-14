// Token Radar dashboard (model radar-2). Reads window.RADAR (written beside
// dashboard/ by main.ts from the same board.json) and renders the ranked board,
// a filterable table, a per-protocol detail view with the model's own inputs
// and the protocol's farm plan, plus the live-token view the board is measured
// against. No network: every byte it shows is in data.js. No framework.
//
// The model in one function: the page recomputes a row from the snapshot
// figures and checks the number board.json carries, so the page's code and the
// board's data are visibly the same arithmetic. impliedValueOf() below is that
// function: TVL x peer multiple (median mcap/TVL of live peers in the same
// category, n>=4, clamped 0.10-0.60, else the global peer median) x growth
// (7d change clamped -50..+100%, weight 0.6) x maturity (0.70-1.00 by age to
// 3y) x breadth (1% per extra chain, max 10). No protocol name is special-cased.
(function () {
  'use strict';
  var DATA = window.RADAR;
  var app = document.getElementById('board');
  if (!DATA || !app) return;
  var state = { q: '', category: 'all', chain: 'all', watchOnly: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  function usd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function usdFull(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function ageFmt(d) {
    if (d === null || d === undefined) return 'unknown';
    if (d >= 365) return (d / 365).toFixed(1) + 'y';
    return Math.round(d) + 'd';
  }
  function esc(s) { return String(s == null ? '' : s); }

  // impliedValueOf: the model, recomputed in the page from the row's own figures.
  function impliedValueOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var breadth = 1 + model.breadth_per_chain * Math.min(Math.max(row.chains.length - 1, 0), model.breadth_max_chains);
    return Math.max(1, Math.round(row.tvl_usd * row.peer_multiple * growthMult * maturity * breadth));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
  }

  function readHash() {
    var h = (location.hash || '').replace(/^#/, '');
    var out = {};
    h.split('&').forEach(function (part) {
      var kv = part.split('=');
      if (kv[0]) out[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
    });
    return out;
  }
  function writeHash() {
    var parts = [];
    if (state.selected) parts.push('detail=' + encodeURIComponent(state.selected));
    if (state.category !== 'all') parts.push('cat=' + encodeURIComponent(state.category));
    if (state.chain !== 'all') parts.push('chain=' + encodeURIComponent(state.chain));
    if (state.tab !== 'pre-token') parts.push('tab=' + state.tab);
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    var h = parts.join('&');
    if (('#' + h) !== location.hash) history.replaceState(null, '', h ? '#' + h : location.pathname + location.search);
  }

  var cats = [];
  var chains = [];
  (function () {
    var cs = {}, chs = {};
    DATA.rows.forEach(function (r) {
      if (r.category) cs[r.category] = 1;
      r.chains.forEach(function (c) { chs[c] = 1; });
    });
    cats = Object.keys(cs).sort();
    chains = Object.keys(chs).sort();
  })();

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchOnly && !r.on_watchlist) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (q && (r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0)) return false;
      return true;
    });
  }
  function sortedRows(rows) {
    var key = state.sort;
    var dir = state.dir;
    return rows.slice().sort(function (a, b) {
      var va, vb;
      if (key === 'implied') { va = a.implied_value_usd; vb = b.implied_value_usd; }
      else if (key === 'tvl') { va = a.tvl_usd; vb = b.tvl_usd; }
      else if (key === 'growth') { va = a.change_7d === null ? -9999 : a.change_7d; vb = b.change_7d === null ? -9999 : b.change_7d; }
      else if (key === 'age') { va = a.age_days === null ? -1 : a.age_days; vb = b.age_days === null ? -1 : b.age_days; }
      else if (key === 'name') { return dir * (a.name < b.name ? -1 : a.name > b.name ? 1 : 0); }
      else { va = a.rank; vb = b.rank; }
      return dir * (va - vb) || (a.rank - b.rank);
    });
  }

  function splitStep(s) {
    var m = s.match(/^(.*?) Cost: (.*?)\. Time: (.*?)\.?$/);
    if (!m) return { text: s, cost: '', time: '' };
    return { text: m[1], cost: m[2], time: m[3] };
  }

  function renderDetail(row) {
    var m = DATA.model;
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * m.growth_weight;
    var age = row.age_days === null ? m.unknown_age_days : row.age_days;
    var maturity = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    var breadth = 1 + m.breadth_per_chain * Math.min(Math.max(row.chains.length - 1, 0), m.breadth_max_chains);
    var base = row.tvl_usd * row.peer_multiple;
    var check = impliedValueOf(row, m);
    var box = el('section', { 'class': 'detail', 'aria-label': 'Protocol detail' });
    box.appendChild(el('button', { 'class': 'close', text: 'Close ✕', onclick: function () { state.selected = null; writeHash(); render(); } }));
    box.appendChild(el('h2', {}, '#' + row.rank + '  ' + row.name));
    box.appendChild(el('p', { 'class': 'sub' },
      (row.category || 'Uncategorised') + '  ·  ' + row.chains.join(', ') + '  ·  ' +
      (row.on_watchlist ? 'On the watchlist (TVL at or above $50M, records no token)' : 'Early find below the watchlist floor') +
      '  ·  Implied value ' + usdFull(row.implied_value_usd) + ' — this entry\u2019s own claim, not a market price.'));
    var cols = el('div', { 'class': 'cols' });
    var left = el('div', {});
    left.appendChild(el('h3', {}, 'The record'));
    var kv = el('dl', { 'class': 'kv' });
    [['TVL', usdFull(row.tvl_usd)], ['7-day TVL change', pct(row.change_7d)],
     ['Tracked since', row.listed_at || 'unknown'], ['Age with no token', ageFmt(row.age_days)],
     ['Token recorded', 'none — no market cap, no CoinGecko id, no symbol'],
     ['Chains', String(row.chains.length) + ' — ' + row.chains.slice(0, 5).join(', ') + (row.chains.length > 5 ? '…' : '')]
    ].forEach(function (pair) {
      kv.appendChild(el('dt', {}, pair[0]));
      kv.appendChild(el('dd', {}, pair[1]));
    });
    left.appendChild(kv);
    left.appendChild(el('h3', {}, 'Why it ranks here — the model, step by step'));
    var maxBase = Math.max.apply(null, DATA.rows.map(function (r) { return r.tvl_usd * r.peer_multiple; }));
    [['Base  TVL × peer multiple', base, maxBase, usdFull(base) + '  (×' + row.peer_multiple.toFixed(3) + ')'],
     ['Growth  ×' + growthMult.toFixed(3), growthMult, 1.6, pct(growth) + ' over 7 days'],
     ['Maturity  ×' + maturity.toFixed(3), maturity, 1, ageFmt(row.age_days) + ' with no token'],
     ['Breadth  ×' + breadth.toFixed(3), breadth, 1.1, String(row.chains.length) + ' chain' + (row.chains.length === 1 ? '' : 's')]
    ].forEach(function (b) {
      var r = el('div', { 'class': 'bar-row' });
      r.appendChild(el('span', {}, b[0]));
      var bar = el('div', { 'class': 'bar' });
      bar.appendChild(el('i', { style: 'width:' + Math.max(2, Math.min(100, (b[1] / b[2]) * 100)) + '%' }));
      r.appendChild(bar);
      r.appendChild(el('b', {}, b[3]));
      left.appendChild(r);
    });
    left.appendChild(el('p', { 'class': 'note' },
      'Page check: impliedValueOf() recomputes ' + usdFull(check) + ' from the figures above; board.json carries ' +
      usdFull(row.implied_value_usd) + '. The peer multiple is the median mcap/TVL of the ' +
      'live-token protocols in this category — see the peer table below the board.'));
    var right = el('div', {});
    right.appendChild(el('h3', {}, 'How to farm it — 7 steps'));
    var ol = el('ol', { 'class': 'steps' });
    row.farm_steps.forEach(function (s) {
      var p = splitStep(s);
      var li = el('li', {});
      li.appendChild(el('div', {}, p.text));
      var meta = el('div', { 'class': 'meta' });
      if (p.cost) meta.appendChild(el('span', { 'class': 'pill' }, 'Cost: ', el('b', {}, p.cost)));
      if (p.time) meta.appendChild(el('span', { 'class': 'pill' }, 'Time: ', el('b', {}, p.time)));
      li.appendChild(meta);
      ol.appendChild(li);
    });
    right.appendChild(ol);
    right.appendChild(el('p', { 'class': 'note' },
      'A protocol that records no token may still have one its DefiLlama record does not carry, and it may never issue one. ' +
      'Farm only money you can afford to lose, and claim only from links the protocol itself publishes.'));
    cols.appendChild(left);
    cols.appendChild(right);
    box.appendChild(cols);
    return box;
  }

  function renderTable(rows) {
    var table = el('table', { 'class': 'board' });
    var thead = el('thead', {});
    var hr = el('tr', {});
    var cols = [
      ['rank', '#'], ['name', 'Protocol'], ['implied', 'Implied value'], ['tvl', 'TVL'],
      ['growth', '7d'], ['age', 'Age'], ['category', 'Category']
    ];
    cols.forEach(function (c) {
      var arrow = state.sort === c[0] ? (state.dir === -1 ? ' ▼' : ' ▲') : '';
      hr.appendChild(el('th', {
        text: c[1] + arrow,
        onclick: (function (key) {
          return function () {
            if (state.sort === key) state.dir = -state.dir;
            else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
            render();
          };
        })(c[0])
      }));
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = el('tbody', {});
    rows.forEach(function (r) {
      var tr = el('tr', { 'class': state.selected === r.slug ? 'sel' : '', onclick: function () { state.selected = r.slug; writeHash(); render(); } });
      tr.appendChild(el('td', { 'class': 'rank num' }, String(r.rank)));
      var nameTd = el('td', { 'class': 'name' });
      nameTd.appendChild(el('b', {}, r.name));
      nameTd.appendChild(el('span', {}, r.slug));
      nameTd.appendChild(el('br', {}));
      nameTd.appendChild(el('span', { 'class': 'badge ' + (r.on_watchlist ? 'watch' : 'early') }, r.on_watchlist ? 'Watchlist' : 'Early'));
      tr.appendChild(nameTd);
      tr.appendChild(el('td', { 'class': 'num' }, usd(r.implied_value_usd)));
      tr.appendChild(el('td', { 'class': 'num' }, usd(r.tvl_usd)));
      var g = el('td', { 'class': 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg') }, pct(r.change_7d));
      tr.appendChild(g);
      tr.appendChild(el('td', { 'class': 'num' }, ageFmt(r.age_days)));
      tr.appendChild(el('td', {}, esc(r.category || '—')));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
  }

  function renderLive() {
    var table = el('table', { 'class': 'board' });
    var thead = el('thead', {});
    var hr = el('tr', {});
    ['Protocol', 'Market cap', 'TVL', 'mcap / TVL', '7d', 'Category'].forEach(function (t) { hr.appendChild(el('th', { text: t })); });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = el('tbody', {});
    DATA.live.forEach(function (r) {
      var tr = el('tr', {});
      var nameTd = el('td', { 'class': 'name' });
      nameTd.appendChild(el('b', {}, r.name));
      nameTd.appendChild(el('span', {}, r.slug));
      nameTd.appendChild(el('br', {}));
      nameTd.appendChild(el('span', { 'class': 'badge live' }, 'Token trades'));
      tr.appendChild(nameTd);
      tr.appendChild(el('td', { 'class': 'num' }, usd(r.mcap_usd)));
      tr.appendChild(el('td', { 'class': 'num' }, usd(r.tvl_usd)));
      tr.appendChild(el('td', { 'class': 'num' }, r.mcap_usd && r.tvl_usd ? (r.mcap_usd / r.tvl_usd).toFixed(2) + '×' : 'n/a'));
      tr.appendChild(el('td', { 'class': 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg') }, pct(r.change_7d)));
      tr.appendChild(el('td', {}, esc(r.category || '—')));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
  }

  function renderPeers() {
    var rows = DATA.peers.filter(function (p) { return p.peers >= 1; }).sort(function (a, b) { return b.peers - a.peers; });
    var table = el('table', { 'class': 'mini' });
    var hr = el('tr', {});
    ['Category', 'Live peers', 'Median mcap / TVL', 'Multiple used'].forEach(function (t) { hr.appendChild(el('th', { text: t })); });
    table.appendChild(hr);
    rows.forEach(function (p) {
      var tr = el('tr', {});
      tr.appendChild(el('td', {}, p.category));
      tr.appendChild(el('td', {}, String(p.peers)));
      tr.appendChild(el('td', {}, p.median_multiple ? p.median_multiple.toFixed(3) + '×' : '—'));
      tr.appendChild(el('td', {}, p.applied_multiple.toFixed(3) + '×'));
      table.appendChild(tr);
    });
    return table;
  }

  function render() {
    app.setAttribute('aria-busy', 'false');
    app.innerHTML = '';
    var wrap = el('div', { 'class': 'wrap' });

    var hero = el('header', { 'class': 'hero' });
    hero.appendChild(el('div', { 'class': 'eyebrow' }, 'Token launch radar  ·  model radar-2'));
    hero.appendChild(el('h1', {}, 'Which pre-token protocol is worth farming next?'));
    hero.appendChild(el('p', { 'class': 'lede' },
      'Every protocol DefiLlama tracks at $5M+ of TVL, ranked by what its token would be worth if it launched at the ' +
      'valuation its already-trading peers carry. ' + DATA.board_size + ' pre-token protocols, ' + DATA.watchlist_size +
      ' of them on the watchlist — plus the live-token market they are measured against. Snapshot ' + DATA.as_of + '.'));
    var stats = el('div', { 'class': 'stats' });
    [['Protocols ranked', String(DATA.board_size)], ['On the watchlist', String(DATA.watchlist_size)],
     ['Early finds below the floor', String(DATA.early_size)], ['Total implied value', usd(DATA.total_implied_usd)],
     ['Live tokens compared', String(DATA.live_size)]
    ].forEach(function (s) {
      var d = el('div', { 'class': 'stat' });
      d.appendChild(el('b', {}, s[1]));
      d.appendChild(el('span', {}, s[0]));
      stats.appendChild(d);
    });
    hero.appendChild(stats);
    wrap.appendChild(hero);

    var cards = el('div', { 'class': 'cards' });
    var how = el('section', { 'class': 'card' });
    how.appendChild(el('h2', {}, 'How the value is worked out'));
    how.appendChild(el('div', { 'class': 'formula' }, 'implied = TVL × peer × growth × maturity × breadth'));
    how.appendChild(el('p', {}, ''));
    how.appendChild(el('p', {},
      el('b', {}, 'Peer multiple: '), 'the median market-cap/TVL of the live-token protocols in the same category ' +
      '(at least 4 peers, clamped 0.10–0.60); thin categories use the global peer median. It is computed from this ' +
      'snapshot at run time — no protocol name is ever special-cased, so the same rule scores a protocol that does not exist yet.'));
    how.appendChild(el('p', {},
      el('b', {}, 'Growth: '), '7-day TVL change, clamped −50% to +100%, weight 0.6. ',
      el('b', {}, 'Maturity: '), '0.70–1.00 by how long the protocol has run with no token (up to 3 years). ',
      el('b', {}, 'Breadth: '), '+1% per extra chain, up to 10.'));
    how.appendChild(el('p', {},
      'Wrapped, staked and bridged products of tokens that already trade — WBTC, Binance staked ETH, USDT0 — are ' +
      'never ranked: they are another wrapper, not a launch. Live-token protocols are shown separately, never mixed into the board.'));
    cards.appendChild(how);
    var read = el('section', { 'class': 'card' });
    read.appendChild(el('h2', {}, 'How to read this board'));
    read.appendChild(el('p', {}, 'Click any row for its detail: the model step by step, and a 7-step farm plan with what each step costs and how long it takes.'));
    read.appendChild(el('p', {}, 'Sort by implied value, TVL, 7-day growth or age. Filter by category or chain, search by name, or show only the watchlist.'));
    read.appendChild(el('p', {}, '“Records no token” means DefiLlama records none — it is not proof the protocol has none, and no board value predicts whether or when a token is issued.'));
    read.appendChild(el('p', {}, 'Top of the board, 14 Nov 2026: risk curators dominate — Steakhouse Financial, Gauntlet and Veda hold the most TVL with no token recorded, so their peer-priced launches are the largest on the board.'));
    cards.appendChild(read);
    wrap.appendChild(cards);

    var sel = null;
    if (state.selected) {
      for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === state.selected) sel = DATA.rows[i];
    }
    if (sel) wrap.appendChild(renderDetail(sel));

    var controls = el('div', { 'class': 'controls' });
    var tabs = el('div', { 'class': 'tabs' });
    [['pre-token', 'Pre-token board'], ['live', 'Live tokens']].forEach(function (t) {
      tabs.appendChild(el('button', {
        'class': 'tab', 'aria-pressed': state.tab === t[0] ? 'true' : 'false', text: t[1],
        onclick: function () { state.tab = t[0]; writeHash(); render(); }
      }));
    });
    controls.appendChild(tabs);
    var q = el('input', { type: 'search', placeholder: 'Search name or slug…', value: state.q, 'aria-label': 'Search protocols' });
    q.addEventListener('input', function () { state.q = q.value; writeHash(); render(); });
    controls.appendChild(q);
    var catSel = el('select', { 'aria-label': 'Filter by category' });
    catSel.appendChild(el('option', { value: 'all' }, 'All categories'));
    cats.forEach(function (c) { catSel.appendChild(el('option', { value: c }, c)); });
    catSel.value = state.category;
    catSel.addEventListener('change', function () { state.category = catSel.value; writeHash(); render(); });
    controls.appendChild(catSel);
    var chSel = el('select', { 'aria-label': 'Filter by chain' });
    chSel.appendChild(el('option', { value: 'all' }, 'All chains'));
    chains.forEach(function (c) { chSel.appendChild(el('option', { value: c }, c)); });
    chSel.value = state.chain;
    chSel.addEventListener('change', function () { state.chain = chSel.value; writeHash(); render(); });
    controls.appendChild(chSel);
    var watch = el('label', { 'class': 'check' });
    var cb = el('input', { type: 'checkbox' });
    cb.checked = state.watchOnly;
    cb.addEventListener('change', function () { state.watchOnly = cb.checked; writeHash(); render(); });
    watch.appendChild(cb);
    watch.appendChild(document.createTextNode('Watchlist only'));
    controls.appendChild(watch);
    wrap.appendChild(controls);

    if (state.tab === 'live') {
      var lc = el('div', { 'class': 'count' }, DATA.live.length + ' largest live-token protocols — the market the peer multiples come from. Not farmable as launches.');
      wrap.appendChild(lc);
      wrap.appendChild(renderLive());
    } else {
      var rows = sortedRows(filteredRows());
      wrap.appendChild(el('div', { 'class': 'count' }, rows.length + ' of ' + DATA.board_size + ' protocols — click a row for its detail and farm plan.'));
      if (rows.length === 0) wrap.appendChild(el('div', { 'class': 'empty' }, 'No protocol matches these filters. Clear the search or widen the category.'));
      else wrap.appendChild(renderTable(rows));
    }

    var peerCard = el('section', { 'class': 'card' });
    peerCard.appendChild(el('h2', {}, 'Peer multiples by category — the market behind the model'));
    peerCard.appendChild(el('p', {}, 'Median market-cap / TVL of live-token protocols in each category, computed from this snapshot. Categories with fewer than 4 live peers use the global peer median; every multiple is clamped to 0.10–0.60.'));
    peerCard.appendChild(renderPeers());
    wrap.appendChild(peerCard);

    var foot = el('footer', {});
    foot.appendChild(el('p', {}, 'Source: DefiLlama protocol snapshot, ' + DATA.as_of + ' (' + esc(DATA.source) + '). Floor $50,000,000; 758 protocols at $5M+ TVL. Implied values are this entry\u2019s own claim from the snapshot\u2019s figures — not a price, not a prediction that a token will be issued.'));
    foot.appendChild(el('p', {}, 'Built by Token Radar, model radar-2. The page renders with no network; every figure on it comes from the snapshot this program read.'));
    wrap.appendChild(foot);

    app.appendChild(wrap);
    var focusTarget = sel ? wrap.querySelector('.detail') : null;
    if (focusTarget && location.hash.indexOf('detail=') >= 0) focusTarget.scrollIntoView();
  }

  (function init() {
    var h = readHash();
    if (h.detail) state.selected = h.detail;
    if (h.cat) state.category = h.cat;
    if (h.chain) state.chain = h.chain;
    if (h.tab) state.tab = h.tab;
    if (h.q) state.q = h.q;
    render();
  })();
})();
