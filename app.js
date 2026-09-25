(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const qsa = (sel, root=document) => [...root.querySelectorAll(sel)];
  const PEN = new Intl.NumberFormat('es-PE', {style:'currency', currency:'PEN', maximumFractionDigits:2});
  const INT = new Intl.NumberFormat('es-PE', {maximumFractionDigits:0});
  const DEC = new Intl.NumberFormat('es-PE', {maximumFractionDigits:2});
  const PRODUCTS = ['ING 1','ING 2','ING 3','ING 4','ING 5','ING 6','ING 7','ING 8','Otro'];
  const DEFAULT_SETTINGS = {
    ad_surcharge_pct: 18,
    monthly_goal: 10000,
    chatgpt_cost: 0,
    active_campaigns: ['ING 1','ING 3 y 4','ING 7'],
    base_prices: {'ING 1':9.9,'ING 3 y 4':12.9,'ING 7':12.9},
    combo_price:15.9,
    vip_price:29.9
  };

  const state = {
    sales: [], ads: [], settings: structuredClone(DEFAULT_SETTINGS),
    mode: 'local', sb: null, user: null, range: 'month', charts: {}, deferredPrompt: null
  };

  function num(v){ const n=Number(v); return Number.isFinite(n)?n:0; }
  function money(v){ return PEN.format(num(v)).replace('PEN','S/'); }
  function pct(v){ return `${DEC.format(num(v)*100)}%`; }
  function isoToday(){ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  function toDate(s){ return new Date(`${s}T12:00:00`); }
  function dateAdd(s, days){ const d=toDate(s); d.setDate(d.getDate()+days); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  function humanDate(s){ if(!s) return '—'; return new Intl.DateTimeFormat('es-PE',{day:'2-digit',month:'short',year:'numeric'}).format(toDate(s)); }
  function monthName(s){ return new Intl.DateTimeFormat('es-PE',{month:'long',year:'numeric'}).format(toDate(s)); }
  function uid(){ return (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`); }
  function escapeHtml(v){ return String(v??'').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
  function toast(msg, isError=false){ const el=$('toast'); el.textContent=msg; el.className=`toast show${isError?' error':''}`; clearTimeout(el._t); el._t=setTimeout(()=>el.className='toast',2600); }
  function latestDataDate(){ const dates=[...state.sales.map(x=>x.sale_date),...state.ads.map(x=>x.ad_date)].filter(Boolean).sort(); return dates.at(-1) || isoToday(); }
  function cloudConfigured(){ const c=window.MYM_CONFIG||{}; return Boolean(c.supabaseUrl && c.supabaseAnonKey && c.storageMode!=='local'); }
  function realMultiplier(){ return 1 + num(state.settings.ad_surcharge_pct)/100; }

  function seedSales(){
    return (window.MYM_SEED?.sales||[]).map(s=>({
      id:uid(), sale_date:s.date, sale_time:s.time||null, campaign:s.product||'Histórico', product:s.product||'',
      upsell:Boolean(s.upsell), offer_type:s.offer_type||'HISTÓRICA', amount:num(s.sold_price), original_price:s.original_price==null?null:num(s.original_price),
      followup_stage:s.followup_stage||'Directo', discount:s.discount==null?null:num(s.discount), notes:'Migrado desde MyM.xlsx'
    }));
  }
  function seedAds(){
    return (window.MYM_SEED?.ads||[]).map(a=>({id:uid(), ad_date:a.date, campaign:a.campaign, conversations:num(a.conversations), ad_spend:num(a.ad_spend)}));
  }
  function mergedSettings(base){
    const s={...structuredClone(DEFAULT_SETTINGS), ...(base||{})};
    s.base_prices={...DEFAULT_SETTINGS.base_prices,...(base?.base_prices||{})};
    s.active_campaigns=Array.isArray(s.active_campaigns)?s.active_campaigns:DEFAULT_SETTINGS.active_campaigns;
    return s;
  }

  function saveLocal(){
    localStorage.setItem('mym_sales', JSON.stringify(state.sales));
    localStorage.setItem('mym_ads', JSON.stringify(state.ads));
    localStorage.setItem('mym_settings', JSON.stringify(state.settings));
    localStorage.setItem('mym_initialized','1');
  }
  function loadLocal(){
    const init=localStorage.getItem('mym_initialized');
    if(!init){
      state.sales=seedSales(); state.ads=seedAds();
      state.settings=mergedSettings(window.MYM_SEED?.settings||{});
      state.settings.base_prices={...DEFAULT_SETTINGS.base_prices}; state.settings.combo_price=15.9; state.settings.vip_price=29.9;
      saveLocal();
    }else{
      try{state.sales=JSON.parse(localStorage.getItem('mym_sales')||'[]')}catch{state.sales=[]}
      try{state.ads=JSON.parse(localStorage.getItem('mym_ads')||'[]')}catch{state.ads=[]}
      try{state.settings=mergedSettings(JSON.parse(localStorage.getItem('mym_settings')||'{}'))}catch{state.settings=mergedSettings({})}
    }
    state.mode='local'; updateStorageUi();
  }

  async function initSupabase(){
    if(!cloudConfigured() || !window.supabase){ loadLocal(); return; }
    try{
      state.sb=window.supabase.createClient(window.MYM_CONFIG.supabaseUrl, window.MYM_CONFIG.supabaseAnonKey);
      const {data:{session}}=await state.sb.auth.getSession();
      if(session){ state.user=session.user; await loadCloud(); }
      else $('authOverlay').classList.remove('hidden');
      state.sb.auth.onAuthStateChange(async (_event,session)=>{
        if(session && (!state.user || state.user.id!==session.user.id)){ state.user=session.user; $('authOverlay').classList.add('hidden'); await loadCloud(); }
      });
    }catch(err){ console.error(err); loadLocal(); toast('No se pudo conectar a Supabase; usando modo local.',true); }
  }
  async function loadCloud(){
    if(!state.sb||!state.user) return;
    const uidv=state.user.id;
    const [{data:sales,error:se},{data:ads,error:ae},{data:settings,error:ste}] = await Promise.all([
      state.sb.from('sales').select('*').eq('user_id',uidv).order('sale_date',{ascending:true}),
      state.sb.from('ad_daily').select('*').eq('user_id',uidv).order('ad_date',{ascending:true}),
      state.sb.from('user_settings').select('*').eq('user_id',uidv).maybeSingle()
    ]);
    if(se||ae||ste){ console.error(se||ae||ste); toast('Error cargando datos de la nube.',true); return; }
    state.sales=(sales||[]).map(x=>({...x,amount:num(x.amount),original_price:x.original_price==null?null:num(x.original_price),discount:x.discount==null?null:num(x.discount)}));
    state.ads=(ads||[]).map(x=>({...x,conversations:num(x.conversations),ad_spend:num(x.ad_spend)}));
    state.settings=mergedSettings(settings||{});
    state.mode='supabase'; updateStorageUi(); $('authOverlay').classList.add('hidden');
    renderAll();
  }
  async function cloudInsertSale(s){
    const row={...s,user_id:state.user.id}; delete row.id;
    const {data,error}=await state.sb.from('sales').insert(row).select().single();
    if(error) throw error; return data;
  }
  async function cloudUpsertAd(a){
    const row={...a,user_id:state.user.id}; delete row.id;
    const {data,error}=await state.sb.from('ad_daily').upsert(row,{onConflict:'user_id,ad_date,campaign'}).select().single();
    if(error) throw error; return data;
  }
  async function cloudSaveSettings(){
    const payload={user_id:state.user.id,ad_surcharge_pct:num(state.settings.ad_surcharge_pct),monthly_goal:num(state.settings.monthly_goal),chatgpt_cost:num(state.settings.chatgpt_cost),active_campaigns:state.settings.active_campaigns,base_prices:state.settings.base_prices,combo_price:num(state.settings.combo_price),vip_price:num(state.settings.vip_price)};
    const {error}=await state.sb.from('user_settings').upsert(payload,{onConflict:'user_id'}); if(error) throw error;
  }

  function updateStorageUi(){
    $('storageBadge').textContent=state.mode==='supabase'?'☁ Sincronizado con Supabase':'● Modo local';
    $('cloudStatus').textContent=state.mode==='supabase'?'Tus datos se guardan en Supabase y se sincronizan entre dispositivos.':'Tus datos se guardan en este navegador. Puedes conectarlos a Supabase cuando quieras.';
    $('btnLogout').classList.toggle('hidden',state.mode!=='supabase');
  }

  function rangeBounds(range){
    const end=latestDataDate();
    if(range==='all') return {start:'0000-01-01',end};
    if(range==='month') return {start:`${end.slice(0,7)}-01`,end};
    const days=num(range)||30; return {start:dateAdd(end,-days+1),end};
  }
  function within(d,start,end){ return d>=start && d<=end; }
  function filterData(range=state.range, campaign='all', custom=null){
    const b=custom||rangeBounds(range);
    const sales=state.sales.filter(x=>within(x.sale_date,b.start,b.end) && (campaign==='all'||x.campaign===campaign));
    const ads=state.ads.filter(x=>within(x.ad_date,b.start,b.end) && (campaign==='all'||x.campaign===campaign));
    return {sales,ads,bounds:b};
  }
  function metrics(sales,ads){
    const revenue=sales.reduce((a,x)=>a+num(x.amount),0), buyers=sales.length;
    const adSpend=ads.reduce((a,x)=>a+num(x.ad_spend),0), conversations=ads.reduce((a,x)=>a+num(x.conversations),0);
    const realAds=adSpend*realMultiplier(), profit=revenue-realAds;
    return {
      revenue,buyers,adSpend,realAds,profit,conversations,
      conversion:conversations?buyers/conversations:0,
      roas:adSpend?revenue/adSpend:0, realRoas:realAds?revenue/realAds:0,
      margin:revenue?profit/revenue:0, ticket:buyers?revenue/buyers:0,
      rpc:conversations?revenue/conversations:0, cpc:conversations?adSpend/conversations:0,
      cpa:buyers?adSpend/buyers:0, realCpa:buyers?realAds/buyers:0,
      upsellCount:sales.filter(x=>x.upsell).length,
      upsellRevenue:sales.filter(x=>x.upsell).reduce((a,x)=>a+num(x.amount),0)
    };
  }
  function groupDaily(sales,ads){
    const map={};
    for(const s of sales){ const d=s.sale_date; map[d] ||= {date:d,revenue:0,buyers:0,adSpend:0,conversations:0}; map[d].revenue+=num(s.amount); map[d].buyers++; }
    for(const a of ads){ const d=a.ad_date; map[d] ||= {date:d,revenue:0,buyers:0,adSpend:0,conversations:0}; map[d].adSpend+=num(a.ad_spend); map[d].conversations+=num(a.conversations); }
    return Object.values(map).sort((a,b)=>a.date.localeCompare(b.date)).map(x=>({...x,realAds:x.adSpend*realMultiplier(),profit:x.revenue-x.adSpend*realMultiplier(),roas:x.adSpend?x.revenue/x.adSpend:0}));
  }
  function groupCampaign(sales,ads){
    const map={};
    const ensure=(c)=>map[c] ||= {campaign:c,revenue:0,buyers:0,adSpend:0,conversations:0,upsells:0};
    for(const s of sales){ const x=ensure(s.campaign||'Sin origen'); x.revenue+=num(s.amount); x.buyers++; if(s.upsell)x.upsells++; }
    for(const a of ads){ const x=ensure(a.campaign||'Sin origen'); x.adSpend+=num(a.ad_spend); x.conversations+=num(a.conversations); }
    return Object.values(map).map(x=>{
      x.realAds=x.adSpend*realMultiplier(); x.profit=x.revenue-x.realAds; x.roas=x.adSpend?x.revenue/x.adSpend:0; x.conversion=x.conversations?x.buyers/x.conversations:0; x.rpc=x.conversations?x.revenue/x.conversations:0; x.cpc=x.conversations?x.adSpend/x.conversations:0; return x;
    }).sort((a,b)=>b.profit-a.profit);
  }

  function kpi(label,value,sub='',tone=''){ return `<div class="kpi ${tone}"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`; }

  function renderDashboard(){
    const {sales,ads}=filterData(); const m=metrics(sales,ads);
    $('kpiGrid').innerHTML=[
      kpi('Facturación',money(m.revenue),`${INT.format(m.buyers)} compradores`),
      kpi('Resultado real',money(m.profit),`después de Ads +${DEC.format(state.settings.ad_surcharge_pct)}%`,m.profit>=0?'positive':'negative'),
      kpi('Ads reales',money(m.realAds),`${money(m.adSpend)} registrado en Meta`),
      kpi('Conversaciones',INT.format(m.conversations),`Costo/chat ${money(m.cpc)}`),
      kpi('Conversión real',pct(m.conversion),`${INT.format(m.buyers)} pagos / ${INT.format(m.conversations)} chats`),
      kpi('ROAS',DEC.format(m.roas),`ROAS sobre costo real ${DEC.format(m.realRoas)}`),
      kpi('Facturación/chat',money(m.rpc),`Ticket ${money(m.ticket)}`),
      kpi('Margen tras Ads',pct(m.margin),`CPA real ${money(m.realCpa)}`,m.margin>=0?'positive':'negative')
    ].join('');

    renderDailyChart(groupDaily(sales,ads)); renderOfferChart(sales); renderCampaignCards(groupCampaign(sales,ads)); renderGoal(); renderInsights(m,groupCampaign(sales,ads),sales);
  }

  function renderDailyChart(rows){
    if(!window.Chart) return;
    state.charts.daily?.destroy();
    const ctx=$('dailyChart');
    state.charts.daily=new Chart(ctx,{type:'line',data:{labels:rows.map(x=>x.date.slice(5).split('-').reverse().join('/')),datasets:[
      {label:'Facturación',data:rows.map(x=>x.revenue),borderColor:'#111827',backgroundColor:'rgba(17,24,39,.08)',tension:.3,fill:false},
      {label:'Ads reales',data:rows.map(x=>x.realAds),borderColor:'#f59e0b',backgroundColor:'rgba(245,158,11,.08)',tension:.3,fill:false},
      {label:'Resultado',data:rows.map(x=>x.profit),borderColor:'#22c55e',backgroundColor:'rgba(34,197,94,.08)',tension:.3,fill:false}
    ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{boxWidth:10,usePointStyle:true,font:{size:10}}},tooltip:{callbacks:{label:(c)=>`${c.dataset.label}: ${money(c.raw)}`}}},scales:{x:{grid:{display:false},ticks:{font:{size:9}}},y:{grid:{color:'#eef0f3'},ticks:{font:{size:9},callback:v=>`S/${v}`}}}}});
  }
  function renderOfferChart(sales){
    if(!window.Chart) return;
    const groups={}; sales.forEach(s=>groups[s.offer_type||'Sin clasificar']=(groups[s.offer_type||'Sin clasificar']||0)+1);
    state.charts.offer?.destroy(); state.charts.offer=new Chart($('offerChart'),{type:'doughnut',data:{labels:Object.keys(groups),datasets:[{data:Object.values(groups),backgroundColor:['#111827','#22c55e','#3b82f6','#f59e0b','#a78bfa','#94a3b8'],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,cutout:'66%',plugins:{legend:{position:'bottom',labels:{boxWidth:9,usePointStyle:true,font:{size:9}}}}}});
  }
  function renderCampaignCards(rows){
    const breakEven=realMultiplier();
    $('campaignCards').innerHTML=rows.slice(0,7).map(x=>{
      const color=x.adSpend===0?'green':x.roas>=2.5?'green':x.roas>=breakEven?'amber':'red';
      return `<div class="campaign-item"><div class="name"><span class="status-dot ${color}"></span>${escapeHtml(x.campaign)}</div><div class="metric"><span>Facturación</span><strong>${money(x.revenue)}</strong></div><div class="metric"><span>Chats</span><strong>${INT.format(x.conversations)}</strong></div><div class="metric"><span>ROAS</span><strong>${x.adSpend?DEC.format(x.roas):'—'}</strong></div><div class="metric"><span>Resultado</span><strong>${money(x.profit)}</strong></div></div>`;
    }).join('') || '<p>Sin datos en este periodo.</p>';
  }
  function renderGoal(){
    const anchor=latestDataDate(), start=`${anchor.slice(0,7)}-01`, {sales,ads}=filterData('all','all',{start,end:anchor}); const m=metrics(sales,ads), goal=num(state.settings.monthly_goal)||10000;
    const pctv=goal?m.revenue/goal:0; $('goalMonthLabel').textContent=monthName(anchor); $('goalRevenue').textContent=money(m.revenue); $('goalTarget').textContent=`de ${money(goal)}`; $('goalBar').style.width=`${Math.min(100,pctv*100)}%`; $('goalPct').textContent=`${DEC.format(pctv*100)}%`; $('goalRemaining').textContent=m.revenue>=goal?'Meta alcanzada':`Faltan ${money(goal-m.revenue)}`;
    const d=toDate(anchor), elapsed=d.getDate(), days=new Date(d.getFullYear(),d.getMonth()+1,0).getDate(), projected=elapsed?m.revenue/elapsed*days:0; $('monthProjection').textContent=money(projected); $('projectionHint').textContent=`Ritmo medio del mes (${elapsed} días transcurridos).`;
  }
  function renderInsights(m,campaigns,sales){
    const best=campaigns[0]; const upShare=m.revenue?m.upsellRevenue/m.revenue:0; const be=realMultiplier(); const items=[];
    if(best) items.push(`<div class="insight"><strong>🏆 Mejor origen</strong><span>${escapeHtml(best.campaign)} deja ${money(best.profit)} después del recargo publicitario en este periodo.</span></div>`);
    items.push(`<div class="insight"><strong>↗ Upsell</strong><span>${INT.format(m.upsellCount)} ventas marcadas como upsell generan ${money(m.upsellRevenue)} (${DEC.format(upShare*100)}% de la facturación).</span></div>`);
    items.push(`<div class="insight"><strong>⚖ Punto de equilibrio</strong><span>Con ${DEC.format(state.settings.ad_surcharge_pct)}% de recargo, el ROAS registrado mínimo para no perder en Ads es ${DEC.format(be)}.</span></div>`);
    items.push(`<div class="insight"><strong>💬 Valor del chat</strong><span>Cada conversación genera ${money(m.rpc)} y Meta cuesta ${money(m.cpc)} por conversación antes del recargo.</span></div>`);
    if(m.conversion) items.push(`<div class="insight"><strong>🛒 Cierre real</strong><span>${DEC.format(m.conversion*100)} de cada 100 conversaciones terminan en un pago registrado.</span></div>`);
    const vip=sales.filter(s=>s.offer_type==='VIP FULL').length; items.push(`<div class="insight"><strong>🔥 VIP FULL</strong><span>${vip} pagos fueron clasificados como VIP FULL. Los negociados siguen guardándose por su monto real.</span></div>`);
    $('insights').innerHTML=items.slice(0,6).join('');
  }

  function renderStats(){
    const from=$('statsFrom').value, to=$('statsTo').value, campaign=$('statsCampaign').value||'all'; if(!from||!to)return;
    const {sales,ads}=filterData('all',campaign,{start:from,end:to}), m=metrics(sales,ads), camps=groupCampaign(sales,ads), days=groupDaily(sales,ads).reverse();
    $('statsKpis').innerHTML=[kpi('Facturación',money(m.revenue)),kpi('Resultado',money(m.profit)),kpi('Compradores',INT.format(m.buyers)),kpi('Conversión',pct(m.conversion)),kpi('ROAS',DEC.format(m.roas)),kpi('S/ por chat',money(m.rpc))].join('');
    $('campaignTable').innerHTML=camps.map(x=>`<tr><td><strong>${escapeHtml(x.campaign)}</strong></td><td>${INT.format(x.conversations)}</td><td>${INT.format(x.buyers)}</td><td>${pct(x.conversion)}</td><td>${money(x.revenue)}</td><td>${money(x.rpc)}</td><td>${money(x.adSpend)}</td><td>${x.adSpend?DEC.format(x.roas):'—'}</td><td>${money(x.profit)}</td></tr>`).join('')||'<tr><td colspan="9">Sin datos.</td></tr>';
    $('dailyTable').innerHTML=days.slice(0,45).map(x=>`<tr><td>${humanDate(x.date)}</td><td>${INT.format(x.conversations)}</td><td>${INT.format(x.buyers)}</td><td>${money(x.revenue)}</td><td>${money(x.realAds)}</td><td>${money(x.profit)}</td><td>${x.adSpend?DEC.format(x.roas):'—'}</td></tr>`).join('');
  }

  function populateCampaigns(){
    const campaigns=state.settings.active_campaigns||[];
    $('saleCampaign').innerHTML=campaigns.map(c=>`<option>${escapeHtml(c)}</option>`).join('')+'<option>Otro</option>';
    $('statsCampaign').innerHTML='<option value="all">Todas</option>'+[...new Set([...campaigns,...state.ads.map(a=>a.campaign),...state.sales.map(s=>s.campaign)])].filter(Boolean).sort().map(c=>`<option>${escapeHtml(c)}</option>`).join('');
    $('saleProduct').innerHTML=PRODUCTS.map(p=>`<option>${p}</option>`).join('');
    $('adsRows').innerHTML=campaigns.map(c=>`<tr data-campaign="${escapeHtml(c)}"><td><strong>${escapeHtml(c)}</strong></td><td><input class="ad-conv" type="number" min="0" step="1" value="0"></td><td><input class="ad-spend" type="number" min="0" step="0.01" value="0"></td><td class="ads-real">${money(0)}</td></tr>`).join('');
  }
  function updateSalePreview(){
    $('previewCampaign').textContent=$('saleCampaign').value||'—'; $('previewType').textContent=$('saleUpsell').value==='true'?'Upsell':'Directa'; $('previewOffer').textContent=$('saleOffer').value||'—'; $('previewAmount').textContent=money($('saleAmount').value);
  }
  function autoPrice(){
    const offer=$('saleOffer').value,c=$('saleCampaign').value; let v=null;
    if(offer==='COMBO PRO')v=state.settings.combo_price; else if(offer==='VIP FULL')v=state.settings.vip_price; else if(offer==='OPCIÓN / DIRECTA')v=state.settings.base_prices?.[c];
    if(v!=null) $('saleAmount').value=num(v).toFixed(2); updateSalePreview();
  }
  function resetSaleForm(){ $('saleForm').reset(); $('saleDate').value=isoToday(); $('saleTime').value=new Date().toTimeString().slice(0,5); populateCampaigns(); autoPrice(); updateSalePreview(); }

  async function saveSale(e){
    e.preventDefault();
    const s={id:uid(),sale_date:$('saleDate').value,sale_time:$('saleTime').value||null,campaign:$('saleCampaign').value,product:$('saleProduct').value,upsell:$('saleUpsell').value==='true',offer_type:$('saleOffer').value,amount:num($('saleAmount').value),original_price:$('saleOriginal').value?num($('saleOriginal').value):null,followup_stage:$('saleFollowup').value,discount:null,notes:$('saleNotes').value.trim()||null};
    if(!s.sale_date||!s.campaign||s.amount<=0){toast('Completa fecha, campaña y monto.',true);return;}
    try{
      if(state.mode==='supabase'){ const saved=await cloudInsertSale(s); state.sales.push(saved); }
      else{ state.sales.push(s); saveLocal(); }
      toast(`Venta guardada: ${money(s.amount)}`); resetSaleForm(); renderAll();
    }catch(err){console.error(err);toast('No se pudo guardar la venta.',true)}
  }
  function loadAdsForDate(){
    const date=$('adsDate').value;
    qsa('#adsRows tr').forEach(tr=>{
      const c=tr.dataset.campaign, found=state.ads.find(a=>a.ad_date===date&&a.campaign===c); tr.querySelector('.ad-conv').value=found?.conversations??0; tr.querySelector('.ad-spend').value=found?.ad_spend??0; updateAdRealRow(tr);
    });
  }
  function updateAdRealRow(tr){ const spend=num(tr.querySelector('.ad-spend').value); tr.querySelector('.ads-real').textContent=money(spend*realMultiplier()); }
  async function saveAdsDay(){
    const date=$('adsDate').value; if(!date){toast('Elige una fecha.',true);return;}
    try{
      for(const tr of qsa('#adsRows tr')){
        const a={id:uid(),ad_date:date,campaign:tr.dataset.campaign,conversations:num(tr.querySelector('.ad-conv').value),ad_spend:num(tr.querySelector('.ad-spend').value)};
        if(state.mode==='supabase'){
          const saved=await cloudUpsertAd(a); const i=state.ads.findIndex(x=>x.ad_date===date&&x.campaign===a.campaign); if(i>=0)state.ads[i]=saved; else state.ads.push(saved);
        } else {
          const i=state.ads.findIndex(x=>x.ad_date===date&&x.campaign===a.campaign); if(i>=0)state.ads[i]=a; else state.ads.push(a);
        }
      }
      if(state.mode==='local')saveLocal(); toast('Publicidad guardada.'); renderAll();
    }catch(err){console.error(err);toast('No se pudo guardar publicidad.',true)}
  }

  function readSettingsForm(){
    state.settings.ad_surcharge_pct=num($('setSurcharge').value); state.settings.monthly_goal=num($('setGoal').value); state.settings.chatgpt_cost=num($('setChatgpt').value); state.settings.combo_price=num($('setCombo').value); state.settings.vip_price=num($('setVip').value);
    state.settings.base_prices={'ING 1':num($('setIng1').value),'ING 3 y 4':num($('setIng34').value),'ING 7':num($('setIng7').value)};
    state.settings.active_campaigns=$('setCampaigns').value.split(',').map(x=>x.trim()).filter(Boolean);
  }
  function renderSettings(){
    $('setSurcharge').value=state.settings.ad_surcharge_pct; $('setGoal').value=state.settings.monthly_goal; $('setChatgpt').value=state.settings.chatgpt_cost; $('setCombo').value=state.settings.combo_price; $('setVip').value=state.settings.vip_price; $('setIng1').value=state.settings.base_prices?.['ING 1']??9.9; $('setIng34').value=state.settings.base_prices?.['ING 3 y 4']??12.9; $('setIng7').value=state.settings.base_prices?.['ING 7']??12.9; $('setCampaigns').value=(state.settings.active_campaigns||[]).join(', ');
  }
  async function saveSettings(){ readSettingsForm(); try{ if(state.mode==='supabase')await cloudSaveSettings(); else saveLocal(); populateCampaigns(); renderAll(); toast('Configuración guardada.'); }catch(err){console.error(err);toast('No se pudo guardar configuración.',true)} }

  function baseMetricsForProjection(){
    const base=$('projBase').value; if(base==='manual') return null; const {sales,ads}=filterData(base==='all'?'all':base); return metrics(sales,ads);
  }
  function renderProjection(){
    const base=baseMetricsForProjection(); if(base){$('projRoas').value=base.roas?base.roas.toFixed(2):'0.00'; $('projRoas').readOnly=true;} else $('projRoas').readOnly=false;
    const roas=num($('projRoas').value), budget=num($('projBudget').value), goal=num($('projGoal').value)||num(state.settings.monthly_goal), registeredAds=budget*30, revenue=registeredAds*roas, realAds=registeredAds*realMultiplier(), profit=revenue-realAds-num(state.settings.chatgpt_cost), margin=revenue?profit/revenue:0;
    const cpc=base?.cpc || metrics(filterData('30').sales,filterData('30').ads).cpc; const chats=cpc?registeredAds/cpc:0; const goalBudget=roas?goal/(roas*30):0;
    $('projRevenue').textContent=money(revenue); $('projAds').textContent=money(registeredAds); $('projRealAds').textContent=money(realAds); $('projProfit').textContent=money(profit); $('projMargin').textContent=pct(margin); $('projChats').textContent=INT.format(chats); $('projGoalBudget').textContent=`${money(goalBudget)}/día`;
  }

  function renderAll(){
    populateCampaigns(); renderSettings(); renderDashboard(); renderStats(); $('projGoal').value=state.settings.monthly_goal; renderProjection(); updateStorageUi();
  }

  function exportBackup(){
    const payload={version:1,exported_at:new Date().toISOString(),settings:state.settings,sales:state.sales,ads:state.ads}; const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`mym-backup-${isoToday()}.json`; a.click(); URL.revokeObjectURL(a.href);
  }
  async function importBackupFile(file){
    try{
      const raw=JSON.parse(await file.text());
      const normalizeSale=(s)=> s.sale_date ? {
        ...s, amount:num(s.amount), original_price:s.original_price==null?null:num(s.original_price),
        discount:s.discount==null?null:num(s.discount)
      } : {
        id:uid(), sale_date:s.date, sale_time:s.time||null, campaign:s.product||'Histórico',
        product:s.product||'', upsell:Boolean(s.upsell), offer_type:s.offer_type||'HISTÓRICA',
        amount:num(s.sold_price), original_price:s.original_price==null?null:num(s.original_price),
        followup_stage:s.followup_stage||'Directo', discount:s.discount==null?null:num(s.discount),
        notes:'Migrado desde MyM.xlsx'
      };
      const normalizeAd=(a)=> a.ad_date ? {
        ...a, conversations:num(a.conversations), ad_spend:num(a.ad_spend)
      } : {
        id:uid(), ad_date:a.date, campaign:a.campaign, conversations:num(a.conversations), ad_spend:num(a.ad_spend)
      };
      const data={
        settings:mergedSettings(raw.settings||{}),
        sales:(raw.sales||[]).map(normalizeSale),
        ads:(raw.ads||[]).map(normalizeAd)
      };
      if(!Array.isArray(data.sales)||!Array.isArray(data.ads)) throw new Error('Formato inválido');

      if(state.mode==='supabase'){
        if(!state.user) throw new Error('Inicia sesión primero');
        if(!confirm('Se importará tu historial privado a Supabase. Los registros que ya existan se omitirán cuando sea posible. ¿Continuar?')) return;
        const sk=new Set(state.sales.map(saleKey)), ak=new Set(state.ads.map(adKey));
        const newS=data.sales.filter(s=>!sk.has(saleKey(s)));
        const newA=data.ads.filter(a=>!ak.has(adKey(a)));

        for(let i=0;i<newS.length;i+=100){
          const rows=newS.slice(i,i+100).map(s=>({
            user_id:state.user.id, sale_date:s.sale_date, sale_time:s.sale_time||null,
            campaign:s.campaign||'Histórico', product:s.product||null, upsell:Boolean(s.upsell),
            offer_type:s.offer_type||'HISTÓRICA', amount:num(s.amount),
            original_price:s.original_price==null?null:num(s.original_price),
            followup_stage:s.followup_stage||'Directo',
            discount:s.discount==null?null:num(s.discount), notes:s.notes||null
          }));
          const {error}=await state.sb.from('sales').insert(rows); if(error) throw error;
        }
        for(let i=0;i<newA.length;i+=100){
          const rows=newA.slice(i,i+100).map(a=>({
            user_id:state.user.id, ad_date:a.ad_date, campaign:a.campaign,
            conversations:num(a.conversations), ad_spend:num(a.ad_spend)
          }));
          const {error}=await state.sb.from('ad_daily').upsert(rows,{onConflict:'user_id,ad_date,campaign'}); if(error) throw error;
        }
        state.settings=mergedSettings({...state.settings,...data.settings});
        await cloudSaveSettings();
        await loadCloud();
        toast(`Historial importado: +${newS.length} ventas y +${newA.length} registros de Ads.`);
        return;
      }

      if(!confirm('Esto reemplazará los datos guardados actualmente en este navegador. ¿Continuar?')) return;
      state.sales=data.sales; state.ads=data.ads; state.settings=data.settings; saveLocal(); renderAll();
      toast('Copia privada importada correctamente.');
    }catch(e){console.error(e);toast('Archivo de copia no válido o no se pudo importar.',true)}
  }
  function saleKey(s){return [s.sale_date,s.sale_time||'',s.campaign,s.amount,s.upsell?'1':'0'].join('|')}
  function adKey(a){return [a.ad_date,a.campaign].join('|')}
  async function importHistory(){
    const ss=seedSales(), aa=seedAds();
    try{
      if(state.mode==='local'){
        const sk=new Set(state.sales.map(saleKey)); const ak=new Set(state.ads.map(adKey)); let ns=0,na=0; for(const s of ss){if(!sk.has(saleKey(s))){state.sales.push(s);ns++;}} for(const a of aa){if(!ak.has(adKey(a))){state.ads.push(a);na++;}} saveLocal(); renderAll(); toast(`Historial revisado: +${ns} ventas, +${na} filas de Ads.`); return;
      }
      if(!state.user)return;
      const existingS=new Set(state.sales.map(saleKey)), existingA=new Set(state.ads.map(adKey)); const newS=ss.filter(s=>!existingS.has(saleKey(s))), newA=aa.filter(a=>!existingA.has(adKey(a)));
      for(let i=0;i<newS.length;i+=100){ const rows=newS.slice(i,i+100).map(s=>({user_id:state.user.id,sale_date:s.sale_date,sale_time:s.sale_time,campaign:s.campaign,product:s.product,upsell:s.upsell,offer_type:s.offer_type,amount:s.amount,original_price:s.original_price,followup_stage:s.followup_stage,discount:s.discount,notes:s.notes})); const {error}=await state.sb.from('sales').insert(rows); if(error)throw error; }
      for(let i=0;i<newA.length;i+=100){ const rows=newA.slice(i,i+100).map(a=>({user_id:state.user.id,ad_date:a.ad_date,campaign:a.campaign,conversations:a.conversations,ad_spend:a.ad_spend})); const {error}=await state.sb.from('ad_daily').upsert(rows,{onConflict:'user_id,ad_date,campaign'}); if(error)throw error; }
      await loadCloud(); toast(`Historial importado: ${newS.length} ventas y ${newA.length} registros de Ads.`);
    }catch(e){console.error(e);toast('No se pudo importar el historial.',true)}
  }

  function setView(name){
    qsa('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${name}`)); qsa('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
    const copy={dashboard:['Dashboard','Tu negocio en una sola vista.'],sale:['Nueva venta','Registra el monto real, incluso si fue negociado.'],ads:['Publicidad','Conversaciones y gasto de Meta por campaña.'],stats:['Estadísticas','Compara campañas y periodos sin abrir Excel.'],projection:['Proyección','Simula el efecto de subir presupuesto.'],settings:['Configuración','Precios, recargo, meta y almacenamiento.']}; $('viewTitle').textContent=copy[name][0]; $('viewSubtitle').textContent=copy[name][1]; document.querySelector('.sidebar').classList.remove('open'); if(name==='stats')renderStats(); if(name==='projection')renderProjection();
  }

  function initStatsDates(){ const end=latestDataDate(); $('statsTo').value=end; $('statsFrom').value=dateAdd(end,-29); }
  function bind(){
    qsa('.nav-item').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view))); qsa('[data-jump]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.jump))); $('mobileMenu').addEventListener('click',()=>document.querySelector('.sidebar').classList.toggle('open'));
    qsa('#rangeSelector button').forEach(b=>b.addEventListener('click',()=>{qsa('#rangeSelector button').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.range=b.dataset.range;renderDashboard();})); $('btnRefresh').addEventListener('click',renderAll);
    $('saleForm').addEventListener('submit',saveSale); $('resetSale').addEventListener('click',resetSaleForm); ['saleCampaign','saleOffer'].forEach(id=>$(id).addEventListener('change',autoPrice)); ['saleUpsell','saleAmount'].forEach(id=>$(id).addEventListener('input',updateSalePreview));
    $('adsDate').addEventListener('change',loadAdsForDate); $('adsRows').addEventListener('input',e=>{const tr=e.target.closest('tr');if(tr)updateAdRealRow(tr)}); $('saveAds').addEventListener('click',saveAdsDay);
    $('applyStats').addEventListener('click',renderStats); $('saveSettings').addEventListener('click',saveSettings); $('exportBackup').addEventListener('click',exportBackup); $('importBackup').addEventListener('change',e=>e.target.files[0]&&importBackupFile(e.target.files[0])); $('importHistory')?.addEventListener('click',importHistory);
    ['projBudget','projRoas','projGoal'].forEach(id=>$(id).addEventListener('input',renderProjection)); $('projBase').addEventListener('change',renderProjection); qsa('[data-budget]').forEach(b=>b.addEventListener('click',()=>{$('projBudget').value=b.dataset.budget;renderProjection()}));
    $('btnLogin').addEventListener('click',async()=>{try{const {error}=await state.sb.auth.signInWithPassword({email:$('authEmail').value,password:$('authPassword').value});if(error)throw error;$('authMessage').textContent='';}catch(e){$('authMessage').textContent=e.message||'No se pudo ingresar.'}});
    $('btnSignup').addEventListener('click',async()=>{try{const {error}=await state.sb.auth.signUp({email:$('authEmail').value,password:$('authPassword').value});if(error)throw error;$('authMessage').textContent='Cuenta creada. Si Supabase solicita confirmación, revisa tu correo.';}catch(e){$('authMessage').textContent=e.message||'No se pudo crear la cuenta.'}});
    $('btnResendConfirm')?.addEventListener('click',async()=>{try{const email=$('authEmail').value.trim();if(!email){$('authMessage').textContent='Escribe tu email primero.';return;}const {error}=await state.sb.auth.resend({type:'signup',email});if(error)throw error;$('authMessage').textContent='Correo de confirmación reenviado. Revisa entrada y spam.';}catch(e){$('authMessage').textContent=e.message||'No se pudo reenviar el correo.'}});
    $('btnUseLocal').addEventListener('click',()=>{$('authOverlay').classList.add('hidden');loadLocal();renderAll()}); $('btnLogout').addEventListener('click',async()=>{await state.sb?.auth.signOut();location.reload()});
    window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();state.deferredPrompt=e;$('btnInstall').classList.remove('hidden')}); $('btnInstall').addEventListener('click',async()=>{if(state.deferredPrompt){state.deferredPrompt.prompt();await state.deferredPrompt.userChoice;state.deferredPrompt=null;$('btnInstall').classList.add('hidden')}});
  }

  async function init(){
    $('todayLabel').textContent=new Intl.DateTimeFormat('es-PE',{weekday:'short',day:'2-digit',month:'short'}).format(new Date()); $('saleDate').value=isoToday(); $('saleTime').value=new Date().toTimeString().slice(0,5); $('adsDate').value=isoToday(); bind();
    await initSupabase(); if(state.mode==='local' || state.user){ initStatsDates(); populateCampaigns(); resetSaleForm(); loadAdsForDate(); renderAll(); }
    if('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(()=>{});
  }
  document.addEventListener('DOMContentLoaded',init);
})();
