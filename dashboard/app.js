(function () {
  'use strict';
  var D = window.RADAR;
  var root = document.getElementById('app');
  if (!D || !root) { root.textContent = 'Radar data is unavailable.'; return; }
  var rows = D.rows.slice();
  var trading = D.trading.slice().sort(function (a, b) { return b.mcap_usd - a.mcap_usd; });
  var state = { q: '', category: 'all', chain: 'all', band: 'all', minimum: 'all', sort: 'rank', direction: 1, peerDirection: -1 };
  var boardRows = Object.create(null);
  var money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function usd(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    var a = Math.abs(n);
    if (a >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return money.format(n);
  }
  function percent(n) { return n === null || n === undefined ? 'n/a' : (n > 0 ? '+' : '') + Number(n).toFixed(2) + '%'; }
  function age(n) { return n === null || n === undefined ? 'Unknown' : n >= 365 ? (n / 365).toFixed(1) + ' years' : Math.round(n) + ' days'; }
  function node(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function link(label, href, cls) {
    var a = node('a', cls, label); a.href = href; return a;
  }
  function append(parent) {
    for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]);
    return parent;
  }
  function chains(r) { return Array.isArray(r.chains) && r.chains.length ? r.chains.join(', ') : 'Chain not recorded'; }
  function boardChains(r) {
    if (!Array.isArray(r.chains) || !r.chains.length) return 'Chain not recorded';
    return r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '');
  }
  function rowFor(slug) { return rows.find(function (r) { return r.slug === slug; }); }
  function route() {
    var hash = (window.location.hash.replace(/^#/, '') || '/').split('?')[0];
    var parts = hash.split('/').filter(Boolean).map(decodeURIComponent);
    if (!parts.length) return { page: 'board' };
    if (parts[0] === 'p' && parts[1]) return { page: 'detail', slug: parts[1] };
    if (parts[0] === 'trading') return { page: 'trading' };
    if (parts[0] === 'model') return { page: 'model' };
    return { page: 'board' };
  }
  function shell(page) {
    root.textContent = '';
    var wrap = node('div', 'shell');
    var header = node('header', 'mast');
    var brand = link('', '#/', 'brand');
    append(brand, node('span', 'brand-mark', 'R'), node('span', '', 'TOKEN RADAR'));
    var nav = node('nav', 'nav'); nav.setAttribute('aria-label', 'Main navigation');
    [['Board','#/'],['Trading','#/trading'],['Model','#/model']].forEach(function (x) {
      var a = link(x[0], x[1], page === x[0].toLowerCase() ? 'active' : '');
      if ((page === 'detail' && x[0] === 'Board') || (page === 'board' && x[0] === 'Board')) a.classList.add('active');
      nav.appendChild(a);
    });
    append(header, brand, nav, node('span', 'snapshot', 'SNAPSHOT  ' + D.as_of));
    wrap.appendChild(header); root.appendChild(wrap); return wrap;
  }
  function footer(parent) {
    var f = node('footer', 'footer');
    append(f, node('span', '', 'Method: TVL × category peer median × seven-day growth adjustment × age adjustment. Estimates are not market prices.'), node('span', '', 'One rule for every protocol; no protocol name is ever special-cased.'));
    parent.appendChild(f);
  }
  function stat(label, value, note) {
    var x = node('div', 'stat');
    append(x, node('span', 'stat-label', label), node('strong', 'stat-value', value), node('span', 'stat-note', note || ''));
    return x;
  }
  function filterOptions(select, options, selected) {
    options.forEach(function (o) {
      var op = node('option', '', o.label); op.value = o.value; op.selected = o.value === selected; select.appendChild(op);
    });
  }
  function sortRows(list) {
    var key = state.sort, dir = state.direction;
    return list.sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'change') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? -Infinity : a.age_days; bv = b.age_days === null ? -Infinity : b.age_days; }
      else if (key === 'multiple') { av = a.multiple; bv = b.multiple; }
      else if (key === 'implied') { av = a.implied_value_usd; bv = b.implied_value_usd; }
      else { av = a.rank; bv = b.rank; }
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.rank - b.rank;
    });
  }
  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return sortRows(rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (state.band !== 'all') {
        var b = state.band.split('-').map(Number);
        if (r.tvl_usd < b[0] || (b[1] && r.tvl_usd >= b[1])) return false;
      }
      if (state.minimum !== 'all' && r.implied_value_usd < Number(state.minimum)) return false;
      if (q && [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) < 0) return false;
      return true;
    }));
  }
  function boardCell(label, value, cls) {
    var td = node('td', cls || '', value); td.setAttribute('data-label', label); return td;
  }
  function sortButton(key, label) {
    var th = node('th');
    var b = node('button', '', label + (state.sort === key ? (state.direction === 1 ? ' ↑' : ' ↓') : ''));
    b.type = 'button'; b.addEventListener('click', function () {
      if (state.sort === key) state.direction *= -1; else { state.sort = key; state.direction = key === 'rank' ? 1 : -1; }
      drawBoard();
    });
    th.appendChild(b); return th;
  }
  function drawBoard() {
    var wrap = shell('board');
    var hero = node('section', 'hero');
    var copy = node('div', 'hero-copy');
    append(copy, node('div', 'kicker', 'Protocol intelligence / ' + D.model_version), node('h1', '', 'A radar for tokenless protocols.'), node('p', '', 'A ranked view of tokenless protocols using TVL, category peers, recent growth and operating age. Implied values are estimates; protocols with a trading token stay in their own market-data lane.'));
    var note = node('aside', 'hero-note'); append(note, node('strong', '', 'One board, two realities'), node('span', '', 'Modelled potential below. Live token market caps on a separate route.'));
    append(hero, copy, note); wrap.appendChild(hero);
    var stats = node('section', 'stats');
    append(stats, stat('Protocols in snapshot', String(D.counts.protocols), 'protocol index'), stat('Watchlist covered', D.watchlist_size + ' / ' + D.watchlist_size, 'all qualifying protocols'), stat('Rows scored', String(D.board_size), 'pre-token ranking'), stat('Token protocols set aside', String(D.live_size), 'market values, not estimates'));
    wrap.appendChild(stats);
    var box = node('section', 'filter-box'); var form = node('div', 'filters');
    function field(label, kind, options, value, cls, id) {
      var f = node('div', 'field' + (cls ? ' ' + cls : '')); var l = node('label', '', label); l.htmlFor = id;
      var input = kind === 'input' ? node('input') : node('select'); input.id = id;
      if (kind === 'input') { input.type = 'search'; input.placeholder = 'Name, slug, category, chain'; input.value = value; input.setAttribute('aria-label', label); }
      else { filterOptions(input, options, value); input.setAttribute('aria-label', label); }
      f.appendChild(l); f.appendChild(input); return { box:f, input:input };
    }
    var cats = Array.from(new Set(rows.map(function (r) { return r.category; }).filter(Boolean))).sort().map(function (x) { return { value:x,label:x }; });
    var chainNames = Array.from(new Set(rows.reduce(function (acc,r) { return acc.concat(r.chains || []); }, []))).sort().map(function (x) { return { value:x,label:x }; });
    var search = field('Search protocols', 'input', [], state.q, 'search', 'search-protocol');
    var category = field('Category', 'select', [{value:'all',label:'All categories'}].concat(cats), state.category, '', 'category');
    var chain = field('Chain', 'select', [{value:'all',label:'All chains'}].concat(chainNames), state.chain, '', 'chain');
    var band = field('TVL band', 'select', [{value:'all',label:'Any TVL'},{value:'0-10000000',label:'Under $10M'},{value:'10000000-50000000',label:'$10M–$50M'},{value:'50000000-100000000',label:'$50M–$100M'},{value:'100000000-1000000000',label:'$100M–$1B'},{value:'1000000000-0',label:'$1B+'}], state.band, '', 'tvl-band');
    var minimum = field('Min implied value', 'select', [{value:'all',label:'Any value'},{value:'1000000',label:'$1M+'},{value:'10000000',label:'$10M+'},{value:'50000000',label:'$50M+'},{value:'100000000',label:'$100M+'},{value:'250000000',label:'$250M+'}], state.minimum, '', 'min-value');
    var sortSelect = field('Sort by', 'select', [{value:'rank',label:'Board rank'},{value:'name',label:'Protocol name'},{value:'tvl',label:'TVL'},{value:'change',label:'7-day change'},{value:'age',label:'Age'},{value:'multiple',label:'Multiple'},{value:'implied',label:'Implied value'}], state.sort, '', 'sort-order');
    [search,category,chain,band,minimum,sortSelect].forEach(function (f) { form.appendChild(f.box); });
    box.appendChild(form);
    var results = node('div', 'results-line'); var count = node('span', 'count', ''); count.id = 'result-count'; results.appendChild(count);
    var clear = node('button', 'clear', 'Reset filters'); clear.type = 'button'; clear.addEventListener('click', function () { state.q=''; state.category='all'; state.chain='all'; state.band='all'; state.minimum='all'; drawBoard(); });
    results.appendChild(clear); box.appendChild(results); wrap.appendChild(box);
    var boardSummary = node('section', 'board-summary'); boardSummary.id = 'board-summary'; wrap.appendChild(boardSummary);
    var panel = node('section', 'panel'); panel.id = 'board-table'; wrap.appendChild(panel);
    [search.input,category.input,chain.input,band.input,minimum.input,sortSelect.input].forEach(function (input, i) {
      input.addEventListener(i === 0 ? 'input' : 'change', function () {
        if (i === 0) state.q = input.value;
        if (i === 1) state.category = input.value;
        if (i === 2) state.chain = input.value;
        if (i === 3) state.band = input.value;
        if (i === 4) state.minimum = input.value;
        if (i === 5) { state.sort = input.value; state.direction = input.value === 'rank' ? 1 : -1; }
        updateTable();
      });
    });
    updateTable();
    footer(wrap);
  }
  function updateTable() {
    var panel = document.getElementById('board-table'); if (!panel) return;
    var list = filteredRows();
    var count = document.getElementById('result-count'); if (count) count.textContent = list.length + ' of ' + rows.length + ' protocols shown';
    var summary = document.getElementById('board-summary');
    if (summary) {
      var total = list.reduce(function (sum, r) { return sum + r.implied_value_usd; }, 0);
      var watchlistOnBoard = Math.max(0, D.board_size - D.early_size);
      summary.textContent = '';
      append(summary, node('div','board-total',list.length + ' rows shown'), node('div','board-total',usd(total) + ' combined implied value'), node('div','board-total',watchlistOnBoard + ' watchlist entries covered'));
    }
    panel.textContent = '';
    if (!list.length) { panel.appendChild(node('p','empty','No protocols match these filters. Reset filters to restore the board.')); return; }
    var sortedMultiples = rows.map(function (r) { return Number(r.peer_median); }).sort(function (a,b) { return a-b; });
    var mid = Math.floor(sortedMultiples.length / 2);
    var boardMedian = sortedMultiples.length % 2 ? sortedMultiples[mid] : (sortedMultiples[mid-1] + sortedMultiples[mid]) / 2;
    var max = rows.reduce(function (m,r) { return Math.max(m,r.implied_value_usd || 0); }, 1);
    var scroll = node('div','table-scroll'); var table = node('table');
    table.appendChild(node('caption','', 'Pre-token protocols. Select a name for its value arithmetic and farm plan.'));
    var thead = node('thead'), hr = node('tr');
    [['rank','Rank'],['name','Protocol'],['tvl','TVL'],['change','7-day'],['age','Age'],['multiple','Multiple'],['implied','Implied value']].forEach(function (x) { hr.appendChild(sortButton(x[0],x[1])); });
    hr.appendChild(node('th','','Token')); thead.appendChild(hr); table.appendChild(thead);
    var tbody = node('tbody');
    var ledger = node('tr','ledger'); var ledgerCell = node('td','',list.length + ' ranked rows · ' + usd(list.reduce(function (sum,r) { return sum + r.implied_value_usd; },0)) + ' combined · ' + Math.max(0,D.board_size-D.early_size) + ' watchlist entries covered · value bars compare with rank 1'); ledgerCell.colSpan = 8; ledger.appendChild(ledgerCell); tbody.appendChild(ledger);
    list.forEach(function (r) {
      var tr = boardRows[r.slug];
      if (!tr) {
        tr = node('tr'); tr.tabIndex = 0; tr.setAttribute('aria-label', r.name + ', detail');
        tr.addEventListener('click', function (e) { if (!e.target.closest('a')) window.location.hash = '/p/' + encodeURIComponent(r.slug); });
        tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') window.location.hash = '/p/' + encodeURIComponent(r.slug); });
        tr.appendChild(boardCell('Rank', String(r.rank), 'rank num'));
        var protocol = node('td','protocol'); protocol.setAttribute('data-label','Protocol');
        append(protocol, link(r.name, '#/p/' + encodeURIComponent(r.slug), ''), node('span','meta',(r.category || 'Other') + ' · ' + boardChains(r)));
        tr.appendChild(protocol);
        tr.appendChild(boardCell('TVL',usd(r.tvl_usd),'num'));
        tr.appendChild(boardCell('7-day',percent(r.change_7d),'num ' + (r.change_7d === null ? '' : r.change_7d < 0 ? 'neg' : 'pos')));
        tr.appendChild(boardCell('Age',age(r.age_days),'num'));
        tr.appendChild(boardCell('Multiple',Number(r.multiple).toFixed(2) + '×','num'));
        var val = node('td','value-cell'); val.setAttribute('data-label','Implied value');
        var line = node('div','value-line'); var bar = node('span','value-bar'); var fill = node('i'); fill.style.width = Math.max(1,Math.min(100,(r.implied_value_usd/max)*100)) + '%'; bar.appendChild(fill);
        append(line,bar,node('strong','num',usd(r.implied_value_usd)));
        if (Number(r.peer_median).toFixed(2) !== boardMedian.toFixed(2)) line.appendChild(node('span','peer-multiple',Number(r.peer_median).toFixed(2) + '× peer'));
        val.appendChild(line); tr.appendChild(val);
        var token = boardCell('Token','',''); token.appendChild(node('span','status','no token recorded')); tr.appendChild(token);
        boardRows[r.slug] = tr;
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody); scroll.appendChild(table); panel.appendChild(scroll);
  }
  function detail(slug) {
    var r = rowFor(slug); if (!r) { window.location.hash = '/'; return; }
    var wrap = shell('detail'); wrap.appendChild(link('← Back to board','#/','back'));
    var hero = node('section','detail-hero'); var left = node('div');
    append(left,node('div','kicker','Rank ' + r.rank + ' / ' + D.board_size + ' · PRE-TOKEN'),node('h1','',r.name),node('p','sub',r.category || 'Other'));
    var chainChips = node('div','chips detail-chains');
    (Array.isArray(r.chains) && r.chains.length ? r.chains : ['Chain not recorded']).forEach(function (chain) { chainChips.appendChild(node('span','chip',chain)); });
    left.appendChild(chainChips);
    var big = node('div'); append(big,node('div','big-value',usd(r.implied_value_usd)),node('span','big-label','MODELLED IMPLIED VALUE · ESTIMATE'));
    append(hero,left,big); wrap.appendChild(hero);
    var grid = node('div','detail-grid');
    var model = node('section','card'); model.appendChild(node('h2','','Value arithmetic'));
    var formula = node('div','formula');
    var factorRows = [
      ['TVL',usd(r.tvl_usd)],
      ['Category peer median',Number(r.peer_median).toFixed(4) + '× (' + (r.peer_source === 'category' ? 'category median' : 'all-market median') + ', ' + (r.peer_source === 'category' ? r.peer_samples : D.counts.trading) + ' protocol' + ((r.peer_source === 'category' ? r.peer_samples : D.counts.trading) === 1 ? '' : 's') + ')'],
      ['7-day growth adjustment',Number(r.growth_adj).toFixed(4) + '× from ' + percent(r.change_7d)],
      ['Age adjustment',Number(r.age_adj).toFixed(4) + '× from ' + age(r.age_days)],
      ['Factor product',Number(r.peer_median).toFixed(4) + ' × ' + Number(r.growth_adj).toFixed(4) + ' × ' + Number(r.age_adj).toFixed(4) + ' = ' + Number(r.multiple).toFixed(6) + '×'],
      ['Combined multiple',Number(r.multiple).toFixed(6) + '×'],
      ['TVL × multiple',usd(r.tvl_usd) + ' × ' + Number(r.multiple).toFixed(6) + ' = ' + usd(r.implied_value_usd)]
    ];
    factorRows.forEach(function (x) { var row = node('div','formula-row'); append(row,node('span','formula-label',x[0]),node('strong','formula-val',x[1])); formula.appendChild(row); });
    model.appendChild(formula);
    model.appendChild(node('p','equation-note','Implied value = TVL × category peer median × 7-day adjustment × age adjustment. Factors shown are the model inputs from this snapshot; the resulting combined multiple is applied to TVL. This is not a market price.'));
    grid.appendChild(model);
    var figures = node('section','card'); figures.appendChild(node('h2','','Protocol figures'));
    var figureGrid = node('div','figure-grid');
    [['TVL',usd(r.tvl_usd)],['7-day change',percent(r.change_7d)],['Operating age',age(r.age_days)],['Listed',r.listed_at || 'Date not recorded']].forEach(function (x) { var box = node('div','figure-box'); append(box,node('span','',x[0]),node('b','figure',x[1])); figureGrid.appendChild(box); });
    figures.appendChild(figureGrid);
    figures.appendChild(node('p','token-no','Token record: ' + (r.token_status === 'pre-token' ? 'No token recorded in this snapshot.' : 'A token record is present.')));
    grid.appendChild(figures); wrap.appendChild(grid);
    var stepsSection = node('section','section'); var sh = node('div','section-head'); append(sh,node('h2','','A practical farm plan'),node('p','','Snapshot-generated steps · review risk before acting')); stepsSection.appendChild(sh);
    var ol = node('ol','steps');
    (r.farm_steps || []).forEach(function (text) {
      var li = node('li','step'); var content = node('div');
      var cost = text.match(/Cost:\s*(.*?)(?:\s*Time:\s*(.*))?$/i);
      var body = cost ? text.slice(0,cost.index).trim() : text;
      content.appendChild(node('p','step-text',body));
      if (cost) { var chips = node('div','chips'); if (cost[1]) chips.appendChild(node('span','chip','Cost · ' + cost[1].replace(/[.;]$/,''))); if (cost[2]) chips.appendChild(node('span','chip','Time · ' + cost[2].replace(/[.;]$/,''))); content.appendChild(chips); }
      li.appendChild(content); ol.appendChild(li);
    });
    stepsSection.appendChild(ol); wrap.appendChild(stepsSection);
    var peerTrading = trading.filter(function (t) { return t.category === r.category; }).slice(0,5);
    var market = node('section','section card'); var mh = node('div','section-head'); append(mh,node('h2','','Token-recording peers'),node('p','','Same category · market-reported data')); market.appendChild(mh);
    market.appendChild(node('p','market-note','These are the market’s own values for protocols with a trading token — market cap and market-cap/TVL ratio, not radar estimates.'));
    if (!peerTrading.length) market.appendChild(node('p','market-empty','No token-recording protocols from this category appear in the trading sample.'));
    else {
      var list = node('div','market-list'); peerTrading.forEach(function (t) {
        var line = node('div','market-row'); append(line,node('span','',t.name),node('strong','num',usd(t.mcap_usd)),node('span','market-multiple num',Number(t.mcap_over_tvl).toFixed(2) + '× mcap/TVL')); list.appendChild(line);
      }); market.appendChild(list);
    }
    wrap.appendChild(market);
    var idx = rows.findIndex(function (x) { return x.slug === slug; }); var pag = node('nav','pagination'); pag.setAttribute('aria-label','Previous and next protocol');
    if (idx > 0) pag.appendChild(link('← Previous · ' + rows[idx-1].name,'#/p/' + encodeURIComponent(rows[idx-1].slug),'pager'));
    else pag.appendChild(node('span',''));
    if (idx < rows.length - 1) pag.appendChild(link('Next · ' + rows[idx+1].name + ' →','#/p/' + encodeURIComponent(rows[idx+1].slug),'pager'));
    wrap.appendChild(pag); footer(wrap);
  }
  function tradingPage() {
    var wrap = shell('trading'); var hero = node('section','hero');
    append(hero,node('div','hero-copy',null));
    var copy = hero.firstChild; append(copy,node('div','kicker','Market data / separate from model'),node('h1','','Already trading, valued by the market.'),node('p','intro','These protocols have token records in the snapshot. Market cap and mcap/TVL below are reported market metrics; there is no radar implied-value estimate on this page.'));
    wrap.appendChild(hero);
    var notice = node('p','market-note','Market values only · ranked by reported market cap · no radar estimate is calculated for these protocols.'); wrap.appendChild(notice);
    var count = node('p','results-line count',trading.length + ' token-recording protocols'); wrap.appendChild(count);
    var panel = node('section','panel'), scroll = node('div','table-scroll'), table = node('table');
    table.appendChild(node('caption','','Ranked by market capitalization, largest first.')); var head = node('thead'), hr = node('tr');
    ['Rank','Protocol','Category','TVL','Market cap','Mcap / TVL'].forEach(function (x) { hr.appendChild(node('th','',x)); }); head.appendChild(hr); table.appendChild(head);
    var body = node('tbody'); trading.forEach(function (t,i) {
      var tr = node('tr'); tr.appendChild(boardCell('Rank',String(i+1),'rank num'));
      tr.appendChild(boardCell('Protocol',t.name,'protocol')); tr.lastChild.appendChild(node('span','meta',t.slug));
      tr.appendChild(boardCell('Category',t.category || 'Other',''));
      tr.appendChild(boardCell('TVL',usd(t.tvl_usd),'num'));
      tr.appendChild(boardCell('Market cap',usd(t.mcap_usd),'num'));
      tr.appendChild(boardCell('Mcap / TVL',Number(t.mcap_over_tvl).toFixed(2) + '×','num')); body.appendChild(tr);
    });
    table.appendChild(body); scroll.appendChild(table); panel.appendChild(scroll); wrap.appendChild(panel); footer(wrap);
  }
  function modelPage() {
    var wrap = shell('model'); var hero = node('section','hero'); var copy = node('div','hero-copy');
    append(copy,node('div','kicker','Method / inspect the inputs'),node('h1','','The model, in the open.'),node('p','intro','A consistent scoring rule for every pre-token protocol. Peer multiples come from observed market cap divided by TVL; live token protocols remain separate from the ranked estimate.'));
    hero.appendChild(copy); wrap.appendChild(hero);
    var card = node('section','card'); card.appendChild(node('h2','','Formula'));
    var formulaText = 'Implied value = round(TVL × category peer median × growth adjustment × age adjustment). The combined multiple is the product of the three adjustments and the category peer median.';
    var c=D.constants;
    formulaText += ' Growth adjustment = 1 + clamp(7-day change, ' + c.growth_floor_pct + '%, ' + c.growth_cap_pct + '%) / 100 × ' + c.growth_weight + '. Age adjustment = ' + c.age_base + ' + ' + c.age_range + ' × min(age days, ' + c.age_days_cap + ') / ' + c.age_days_cap + '; unknown age uses ' + c.unknown_age_adj + '.';
    card.appendChild(node('p','equation-note',formulaText));
    var constTitle = node('h2','','Model constants'); constTitle.style.marginTop = '20px'; card.appendChild(constTitle);
    var constants = node('div','figure-grid'); Object.keys(D.constants).sort().forEach(function (k) {
      var box = node('div','figure-box'); append(box,node('span','',k.replace(/_/g,' ')),node('b','figure',String(D.constants[k]))); constants.appendChild(box);
    }); card.appendChild(constants);
    wrap.appendChild(card);
    var counts = node('section','card section'); counts.appendChild(node('h2','','Snapshot and coverage'));
    var countGrid = node('div','figure-grid');
    [['As of',D.as_of],['TVL floor',usd(D.floor_usd)],['Protocols indexed',D.counts.protocols],['Watchlist',D.watchlist_size],['Pre-token protocols',D.counts.pre_token],['Rows scored',D.board_size],['Trading protocols',D.counts.trading],['Model version',D.model_version]].forEach(function (x) { var b=node('div','figure-box'); append(b,node('span','',x[0]),node('b','figure',String(x[1]))); countGrid.appendChild(b); });
    counts.appendChild(countGrid); var source=node('p','source'); source.style.marginTop='12px'; source.textContent='Snapshot source: ' + D.source; counts.appendChild(source); wrap.appendChild(counts);
    var peerSection = node('section','card peer-wrap'); var peerHead = node('div','section-head'); append(peerHead,node('h2','','Peer table'),node('p','','53 categories · click median to sort')); peerSection.appendChild(peerHead);
    var peerTable = node('table','peer-table'); var thd=node('thead'), trh=node('tr'); trh.appendChild(node('th','','Category')); trh.appendChild(node('th','','Protocols sampled'));
    var medianTh=node('th'); var medianButton=node('button','sortable','Median mcap/TVL ↓'); medianButton.type='button'; medianButton.addEventListener('click',function(){ state.peerDirection *= -1; peerButton.textContent='Median mcap/TVL ' + (state.peerDirection < 0 ? '↓' : '↑'); drawPeers(peerTable); });
    medianTh.appendChild(medianButton); trh.appendChild(medianTh); thd.appendChild(trh); peerTable.appendChild(thd); peerSection.appendChild(peerTable); drawPeers(peerTable); wrap.appendChild(peerSection); footer(wrap);
    var peerButton = medianButton;
  }
  function drawPeers(table) {
    var old=table.querySelector('tbody'); if(old) old.remove();
    var peers=D.peer_table.slice().sort(function(a,b){var av=Number(a.median_multiple),bv=Number(b.median_multiple); return (av-bv)*state.peerDirection;});
    var body=node('tbody'); peers.forEach(function(p){
      var tr=node('tr'); tr.appendChild(boardCell('Category',p.category,'')); tr.appendChild(boardCell('Protocols sampled',String(p.sample_count),'num'));
      tr.appendChild(boardCell('Median mcap/TVL',Number(p.median_multiple).toFixed(4)+'×','num')); body.appendChild(tr);
    }); table.appendChild(body);
  }
  function render() {
    var r=route();
    if(r.page==='detail') detail(r.slug);
    else if(r.page==='trading') tradingPage();
    else if(r.page==='model') modelPage();
    else drawBoard();
  }
  var hashQuery = window.location.hash.indexOf('?');
  var query = new URLSearchParams(hashQuery >= 0 ? window.location.hash.slice(hashQuery + 1) : window.location.search.slice(1));
  if (query.get('q')) state.q = query.get('q');
  if (query.get('category')) state.category = query.get('category');
  if (query.get('chain')) state.chain = query.get('chain');
  if (query.get('band')) state.band = query.get('band');
  if (query.get('minimum')) state.minimum = query.get('minimum');
  window.addEventListener('hashchange', render);
  render();
})();
