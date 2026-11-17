(function () {
  'use strict';
  var D = window.RADAR;
  var root = document.getElementById('app');
  if (!D || !root) { root.textContent = 'Radar data is unavailable.'; return; }
  var rows = D.rows.slice();
  var trading = D.trading.slice().sort(function (a, b) { return b.mcap_usd - a.mcap_usd; });
  var WATCHLIST = new Set(['armitage-by-wintermute','axis','b14g','bittensor-dtao','clearstar','curvance','doppler-finance','ember','firelight','galaxy-curation','gami-labs','gauntlet','hive-protocol','hyperithm','infinifi','k3-capital','keyrock','lagoon','lightning-network','lofty','mezo-earn','noble','nonce-capital','onre','opentrade','plume-vaults','r25','reti-pooling','rockawayx','saturn','steakhouse-financial','symbiotic','tori-finance','tulipa-capital','tydro','upshift','usdd','valos','veda','yuzu-money']);
  var state = { q: '', category: 'all', chain: 'all', band: 'all', minimum: 'all', watchlistOnly: false, sort: 'rank', direction: 1, peerDirection: -1 };
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
    append(f, node('span', '', 'Method: TVL × peer median × seven-day growth × age. Estimates, not market prices.'), node('span', '', 'One model rule; no name-based estimates.'));
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
      if (state.watchlistOnly && !WATCHLIST.has(r.slug)) return false;
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
  function drawInsights() {
    var band=node('section','insights-band');
    var sorted=rows.slice().sort(function(a,b){return b.implied_value_usd-a.implied_value_usd;});
    var dist=node('section','insight distribution');
    var dhead=node('div','insight-head');append(dhead,node('span','eyebrow','01 / FIELD SHAPE'),node('span','insight-meta',rows.length+' estimates'));
    append(dist,dhead,node('h2','','The value curve'));
    var values=rows.map(function(r){return Number(r.implied_value_usd);}).filter(function(v){return isFinite(v)&&v>0;}).sort(function(a,b){return a-b;});
    var low=values[0]||1,high=values[values.length-1]||low,logLow=Math.log10(low),logSpan=Math.log10(high)-logLow,bucketCount=14,buckets=Array(bucketCount).fill(0);
    values.forEach(function(v){var i=logSpan?Math.floor((Math.log10(v)-logLow)/logSpan*bucketCount):0;buckets[Math.max(0,Math.min(bucketCount-1,i))]++;});
    var peak=Math.max.apply(null,buckets),median=values.length%2?values[(values.length-1)/2]:(values[values.length/2-1]+values[values.length/2])/2;
    var chart=node('div','dist-chart'),axis=node('div','dist-y-axis'),plotWrap=node('div','dist-plot-wrap'),plot=node('div','dist-plot'),ticks=node('div','dist-x-axis');
    [peak,Math.round(peak*.75),Math.round(peak*.5),Math.round(peak*.25),0].forEach(function(n,i){var label=node('span','',String(n));label.style.top=(i*25)+'%';axis.appendChild(label);});
    buckets.forEach(function(count,i){var col=node('div','dist-column');col.style.height=(peak?count/peak*100:0)+'%';col.title='Bucket '+(i+1)+': '+count+' estimates';plot.appendChild(col);});
    var medianPos=logSpan?(Math.log10(median)-logLow)/logSpan*100:50,medianLine=node('span','dist-median-line');medianLine.style.left=medianPos+'%';plot.appendChild(medianLine);
    var medianLabel=node('span','dist-median-label','Median '+usd(median));medianLabel.style.left=Math.max(0,Math.min(100,medianPos))+'%';plot.appendChild(medianLabel);
    var edges=[{value:low,label:usd(low)}];[{value:1e6,label:'$1M'},{value:1e7,label:'$10M'},{value:1e8,label:'$100M'},{value:1e9,label:'$1B'}].forEach(function(edge){if(edge.value>low&&edge.value<high)edges.push(edge);});if(high>low)edges.push({value:high,label:usd(high)});
    edges.forEach(function(edge,i){var tick=node('span','',edge.label),position=logSpan?(Math.log10(edge.value)-logLow)/logSpan*100:0;tick.style.left=position+'%';if(i===0)tick.classList.add('edge-start');if(i===edges.length-1)tick.classList.add('edge-end');ticks.appendChild(tick);});
    append(plotWrap,plot,ticks);append(chart,axis,plotWrap);dist.appendChild(chart);
    var cats=Object.create(null);rows.forEach(function(r){var c=cats[r.category]||(cats[r.category]={sum:0,count:0,peer:Number(r.peer_median)});c.sum+=r.implied_value_usd;c.count++;});
    var leaders=Object.keys(cats).map(function(k){return {name:k,sum:cats[k].sum,count:cats[k].count,peer:cats[k].peer};}).sort(function(a,b){return b.sum-a.sum;}).slice(0,5);
    var category=node('section','insight category-insight');var chead=node('div','insight-head');append(chead,node('span','eyebrow','02 / CATEGORY WEIGHT'),node('span','insight-meta','Top five'));append(category,chead,node('h2','','Where value clusters'));
    var catMax=leaders[0]?leaders[0].sum:1;leaders.forEach(function(c){var item=node('div','category-row');var top=node('div','category-top');append(top,node('strong','',c.name),node('span','category-value',usd(c.sum)));var track=node('div','category-track');var fill=node('i');fill.style.width=(c.sum/catMax*100)+'%';track.appendChild(fill);var meta=node('div','category-meta');append(meta,node('span','',c.count+' protocols'),node('span','', 'Peer median '+c.peer.toFixed(2)+'×'));append(item,top,track,meta);category.appendChild(item);});
    var changes=rows.map(function(r){return r.change_7d;}).filter(function(x){return x!==null&&x!==undefined&&isFinite(x);}).sort(function(a,b){return a-b;});var rise=rows.filter(function(r){return r.change_7d!==null&&r.change_7d!==undefined;}).sort(function(a,b){return b.change_7d-a.change_7d;});
    var grow=node('section','insight growth-insight');var ghead=node('div','insight-head');append(ghead,node('span','eyebrow','03 / SEVEN-DAY MOMENTUM'),node('span','insight-meta','Snapshot change'));append(grow,ghead,node('h2','','Growth, at a glance'));
    var up=rows.filter(function(r){return r.change_7d>0;}).length,down=rows.filter(function(r){return r.change_7d<0;}).length,median=changes.length%2?changes[(changes.length-1)/2]:(changes[changes.length/2-1]+changes[changes.length/2])/2;
    var balance=node('div','growth-balance'),upNum=node('div','growth-number positive'),downNum=node('div','growth-number negative');append(upNum,node('strong','',String(up)),node('small','',' rising'));append(downNum,node('strong','',String(down)),node('small','',' falling'));append(balance,upNum,node('span','versus','/'),downNum);
    var growthTrack=node('div','growth-track');var upFill=node('i');upFill.style.width=(up/(up+down||1)*100)+'%';growthTrack.appendChild(upFill);var medianLine=node('p','median-change');append(medianLine,node('span','','Median '+percent(median)+' · '+(rows.length-up-down)+' flat / n.a.'),node('strong','','7 days'));append(grow,balance,growthTrack,medianLine);
    var risers=node('div','risers');rise.slice(0,3).forEach(function(r,i){var item=node('div','riser');append(item,node('span','riser-rank','0'+(i+1)),link(r.name,'#/p/'+encodeURIComponent(r.slug),'riser-link'),node('strong','positive',percent(r.change_7d)));risers.appendChild(item);});grow.appendChild(risers);
    append(band,dist,category,grow);return band;
  }
  function drawBoard() {
    var wrap = shell('board');
    var hero = node('section', 'hero');
    var copy = node('div', 'hero-copy');
    append(copy, node('div', 'kicker', 'Protocol intelligence / ' + D.model_version), node('h1', '', 'A radar for tokenless protocols.'), node('p', '', 'Tokenless valuations from TVL, peer, growth and age. Trading tokens stay separate.'));
    var note = node('aside', 'hero-note');
    var radarMark = node('div','radar-mark'); radarMark.setAttribute('aria-hidden','true');
    append(note,radarMark,node('div','hero-note-copy'),node('div','hero-mini-stats'));
    append(note.querySelector('.hero-note-copy'),node('strong','','One board, two realities'),node('span','','Modelled potential below. Live token market caps stay in their own lane.'));
    append(note.querySelector('.hero-mini-stats'),node('b','',D.board_size + ' scored'),node('b','',D.watchlist_size + ' watchlist floor'));
    append(hero, copy, note); wrap.appendChild(hero);
    var stats = node('section', 'stats');
    append(stats, stat('Indexed', String(D.counts.protocols), 'protocols'), stat('Watchlist', D.watchlist_size + ' / ' + D.watchlist_size, 'all represented'), stat('Pre-token', String(D.board_size), 'ranked estimates'), stat('Trading', String(D.live_size), 'market data, separate'));
    wrap.appendChild(stats);
    wrap.appendChild(drawInsights());
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
    var watch = node('label','watch-toggle'); var watchInput = node('input'); watchInput.type='checkbox'; watchInput.checked=state.watchlistOnly; watchInput.id='watchlist-only';
    append(watch,watchInput,node('span','','Watchlist only')); form.appendChild(watch);
    box.appendChild(form);
    var results = node('div', 'results-line'); var count = node('span', 'count', ''); count.id = 'result-count'; results.appendChild(count);
    var clear = node('button', 'clear', 'Reset filters'); clear.type = 'button'; clear.addEventListener('click', function () { state.q=''; state.category='all'; state.chain='all'; state.band='all'; state.minimum='all'; state.watchlistOnly=false; drawBoard(); });
    results.appendChild(clear); box.appendChild(results); wrap.appendChild(box);
    var boardSummary = node('section', 'board-summary'); boardSummary.id = 'board-summary'; wrap.appendChild(boardSummary);
    var panel = node('section', 'panel'); panel.id = 'board-table'; wrap.appendChild(panel);
    watchInput.addEventListener('change',function(){state.watchlistOnly=watchInput.checked;updateTable();});
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
      var onList = list.filter(function(r){return WATCHLIST.has(r.slug);}).length;
      summary.textContent = '';
      append(summary, node('div','board-total',list.length + ' rows shown'), node('div','board-total',usd(total) + ' combined implied value'), node('div','board-total',onList + ' watchlist entries in view'));
    }
    panel.textContent = '';
    if (!list.length) { panel.appendChild(node('p','empty','No protocols match these filters. Reset filters to restore the board.')); return; }
    var categoryMedians = Object.create(null);
    D.peer_table.forEach(function(p){categoryMedians[p.category]=Number(p.median_multiple);});
    var max = rows.reduce(function (m,r) { return Math.max(m,r.implied_value_usd || 0); }, 1);
    var scroll = node('div','table-scroll'); var table = node('table');
    table.appendChild(node('caption','', 'Pre-token estimates · mint edge marks the watchlist coverage floor.'));
    var thead = node('thead'), hr = node('tr');
    [['rank','Rank'],['name','Protocol'],['tvl','TVL'],['change','7-day'],['age','Age'],['multiple','Multiple'],['implied','Implied value']].forEach(function (x) { hr.appendChild(sortButton(x[0],x[1])); });
    hr.appendChild(node('th','','Token')); thead.appendChild(hr); table.appendChild(thead);
    var tbody = node('tbody');
    var ledger = node('tr','ledger'); var ledgerCell = node('td','',list.length + ' ranked rows · ' + usd(list.reduce(function (sum,r) { return sum + r.implied_value_usd; },0)) + ' combined · mint rule = watchlist floor · value bars compare with rank 1'); ledgerCell.colSpan = 8; ledger.appendChild(ledgerCell); tbody.appendChild(ledger);
    var previousCategory='';
    list.forEach(function (r) {
      var tr = boardRows[r.slug];
      if (!tr) {
        tr = node('tr'); tr.tabIndex = 0; tr.setAttribute('aria-label', r.name + ', detail');
        if(WATCHLIST.has(r.slug)) tr.classList.add('watch-row');
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
        var categoryMedian=categoryMedians[r.category] || Number(r.peer_median);
        if(Math.abs(Number(r.multiple)-categoryMedian)>0.005) line.appendChild(node('span','peer-multiple',((Number(r.multiple)/categoryMedian-1)*100).toFixed(0)+'% vs peer'));
        val.appendChild(line); tr.appendChild(val);
        var token = boardCell('Token','',''); token.appendChild(node('span','status','no token recorded')); tr.appendChild(token);
        boardRows[r.slug] = tr;
      }
      if(previousCategory && previousCategory!==r.category) tr.classList.add('group-start');
      previousCategory=r.category;
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
    model.appendChild(node('p','equation-note','Implied value = TVL × peer median × growth adjustment × age adjustment. Snapshot inputs, not a market price.'));
    var peerRecord=D.peer_table.find(function(p){return p.category===r.category;}),categoryMultiple=peerRecord&&peerRecord.category_observed_median!==null?Number(peerRecord.category_observed_median):Number(r.peer_median), marketValues=trading.map(function(t){return Number(t.mcap_over_tvl);}).filter(function(x){return isFinite(x);}).sort(function(a,b){return a-b;}), marketMultiple=marketValues.length%2?marketValues[(marketValues.length-1)/2]:(marketValues[marketValues.length/2-1]+marketValues[marketValues.length/2])/2;
    var scenarios=[['Category observed',categoryMultiple],['All-market median',marketMultiple],['This protocol',Number(r.multiple)]];var scenarioMax=Math.max.apply(null,scenarios.map(function(x){return x[1];}).concat([0.001]));var scenario=node('div','scenario-chart');var scenarioHead=node('div','scenario-head');append(scenarioHead,node('h3','','Peer lens'),node('span','','TVL held constant · '+(peerRecord?peerRecord.sample_count:0)+' category peers'));scenario.appendChild(scenarioHead);
    scenarios.forEach(function(x){var line=node('div','scenario-row'),name=node('span','scenario-name',x[0]),track=node('span','scenario-track'),fill=node('i');fill.style.width=Math.max(3,x[1]/scenarioMax*100)+'%';track.appendChild(fill);append(line,name,track,node('strong','scenario-value',usd(r.tvl_usd*x[1])),node('span','scenario-multiple',x[1].toFixed(2)+'×'));scenario.appendChild(line);});
    var scenarioNote=node('p','scenario-note','Sparse groups use market fallback; growth and age shift the estimate.');scenario.appendChild(scenarioNote);model.appendChild(scenario);
    grid.appendChild(model);
    var figures = node('section','card'); figures.appendChild(node('h2','','Protocol figures'));
    var figureGrid = node('div','figure-grid');
    var watchlistValue=rows.reduce(function(sum,row){return sum+(WATCHLIST.has(row.slug)?Number(row.implied_value_usd):0);},0),watchShare=watchlistValue?Number(r.implied_value_usd)/watchlistValue*100:0;
    var peerRecord=D.peer_table.find(function(p){return p.category===r.category;}),categoryMultiple=peerRecord&&peerRecord.category_observed_median!==null?Number(peerRecord.category_observed_median):Number(peerRecord?peerRecord.median_multiple:r.peer_median);
    [['TVL',usd(r.tvl_usd)],['7-day change',percent(r.change_7d)],['Operating age',age(r.age_days)],['Listed',r.listed_at || 'Date not recorded'],['Watchlist share of combined implied value',watchShare.toFixed(1)+'%'],['Category peer median · growth/age at 1×',usd(r.tvl_usd*categoryMultiple)]].forEach(function (x) { var box = node('div','figure-box'); append(box,node('span','',x[0]),node('b','figure',x[1])); figureGrid.appendChild(box); });
    figures.appendChild(figureGrid);
    var figureNote=node('p','figure-note');append(figureNote,node('span','','Snapshot as of '+D.as_of),node('span','',D.board_size+' scored rows'));figures.appendChild(figureNote);
    grid.appendChild(figures); wrap.appendChild(grid);
    var stepsSection = node('section','section'); var sh = node('div','section-head'); append(sh,node('h2','','A practical farm plan'),node('p','','Snapshot plan · review risks')); stepsSection.appendChild(sh);
    var ol = node('ol','steps');
    var costTotal=0,timeMinutes=0,hasCost=false,stepNumber=0;
    (r.farm_steps || []).forEach(function (text) {
      var li = node('li','step'); stepNumber++;
      var number=node('span','step-number',String(stepNumber).padStart(2,'0'));var content = node('div','step-main');
      li.appendChild(number);
      var cost = text.match(/Cost:\s*(.*?)(?:\s*Time:\s*(.*))?$/i);
      var body = cost ? text.slice(0,cost.index).trim() : text;
      content.appendChild(node('p','step-text',body));li.appendChild(content);
      var costText=cost&&cost[1]?cost[1].replace(/[.;]$/,''):'Not stated';var timeText=cost&&cost[2]?cost[2].replace(/[.;]$/,''):'Not stated';
      var amountMatches=costText.match(/\$\s*([\d,]+(?:\.\d+)?)/g)||[];amountMatches.forEach(function(x){var n=Number(x.replace(/[^\d.]/g,''));if(isFinite(n)){costTotal+=n;hasCost=true;}});
      var duration=timeText.match(/(\d+(?:\.\d+)?)(?:\s*[–-]\s*(\d+(?:\.\d+)?))?\s*(minutes?|mins?|hours?|days?)/i);if(duration){var amount=(Number(duration[1])+(duration[2]?Number(duration[2]):0))/ (duration[2]?2:1);var unit=duration[3].toLowerCase();timeMinutes+=amount*(unit.indexOf('day')===0?1440:unit.indexOf('hour')===0?60:1);}
      var costCol=node('div','step-metric step-cost');append(costCol,node('span','','COST'),node('strong','',costText));var timeCol=node('div','step-metric step-time');append(timeCol,node('span','','TIME'),node('strong','',timeText));append(li,costCol,timeCol);ol.appendChild(li);
    });
    var totalDays=timeMinutes/1440,totalText=totalDays>=1?String(Math.round(totalDays*10)/10)+' days':Math.max(1,Math.round(timeMinutes/60))+' hours';
    var planTotal=node('p','plan-total');append(planTotal,node('span','','Cost-chip total · capital at risk included'),node('strong','', 'About '+(hasCost?usd(costTotal):'cost not stated')+' and '+totalText));
    stepsSection.appendChild(ol);stepsSection.appendChild(planTotal);wrap.appendChild(stepsSection);
    var peerTrading = trading.filter(function (t) { return t.category === r.category; }).slice(0,5);
    var market = node('section','section card'); var mh = node('div','section-head'); append(mh,node('h2','','Token-recording peers'),node('p','','Same category · market-reported data')); market.appendChild(mh);
    market.appendChild(node('p','market-note','Live-token peer values: market cap and mcap/TVL, not radar estimates.'));
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
  if (query.get('watchlist') === '1') state.watchlistOnly = true;
  window.addEventListener('hashchange', render);
  render();
})();
