const state = {
  cash: 1000000,
  realized: 0,
  orders: JSON.parse(localStorage.getItem("mp_orders") || "[]"),
  positions: JSON.parse(localStorage.getItem("mp_positions") || "{}"),
  selected: "NIFTY 50",
  orderSide: "buy",
  prices: {
    "NIFTY 50": {price:25240, open:25134, decimals:2},
    "BANK NIFTY": {price:57860, open:57964, decimals:2},
    "RELIANCE": {price:1524.75, open:1515.05, decimals:2},
    "TCS": {price:4118.30, open:4109.68, decimals:2}
  },
  candles: []
};

const symbols = Object.keys(state.prices);
const el = id => document.getElementById(id);
const money = n => "₹" + Number(n).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
const shortMoney = n => "₹" + Math.round(n).toLocaleString("en-IN");

function save(){localStorage.setItem("mp_orders",JSON.stringify(state.orders));localStorage.setItem("mp_positions",JSON.stringify(state.positions));}
function current(sym=state.selected){return state.prices[sym].price}
function pct(sym=state.selected){let p=state.prices[sym];return ((p.price-p.open)/p.open*100)}
function initCandles(){
  let base=current();
  state.candles=[];
  for(let i=0;i<55;i++){
    const drift=(Math.random()-.48)*24;
    const o=i===0?base-18:state.candles[i-1].c;
    const c=o+drift;
    const h=Math.max(o,c)+Math.random()*20;
    const l=Math.min(o,c)-Math.random()*20;
    state.candles.push({o,h,l,c,v:35+Math.random()*65});
  }
}
let liveMode=false;
let lastLiveFetch=0;
const instrumentKeys={
  "NIFTY 50":"NSE_INDEX|Nifty 50",
  "BANK NIFTY":"NSE_INDEX|Nifty Bank",
  "RELIANCE":"NSE_EQ|INE002A01018",
  "TCS":"NSE_EQ|INE467B01029"
};

function setMarketStatus(live,msg=""){
  liveMode=live;
  const box=el("marketStatus");
  if(box) box.innerHTML=`<span class="pulse"></span> ${live?"Upstox live market data":"Demo market feed"}${msg?" · "+msg:""}`;
  document.querySelectorAll("[data-live-label]").forEach(x=>x.textContent=live?"LIVE":"DEMO");
  const note=el("apiNote");
  if(note) note.textContent=live?"Connected to Upstox market data. Paper orders remain simulated.":"Live data is unavailable, so the dashboard is using simulated prices.";
}

async function fetchLiveQuotes(){
  try{
    const r=await fetch("/api/quotes",{cache:"no-store"});
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    const payload=await r.json();
    if(!payload.ok) throw new Error(payload.error||"Live quote request failed");
    Object.entries(payload.data||{}).forEach(([sym,q])=>{
      if(!state.prices[sym]||!Number.isFinite(q.last_price)) return;
      state.prices[sym].price=q.last_price;
      if(Number.isFinite(q.prev_close_price)) state.prices[sym].open=q.prev_close_price;
      state.prices[sym].live=true;
    });
    setMarketStatus(true, payload.timestamp ? new Date(payload.timestamp).toLocaleTimeString() : "live");
    lastLiveFetch=Date.now();
    if(state.selected==="NIFTY 50") appendLiveCandle();
    renderAll();drawChart();
    syncPriceField();
    return true;
  }catch(err){
    setMarketStatus(false,"fallback");
    return false;
  }
}
function appendLiveCandle(){
  const last=state.candles[state.candles.length-1];
  const c=current();
  const o=last?last.c:c;
  const h=Math.max(o,c,last?last.h:c), l=Math.min(o,c,last?last.l:c);
  state.candles.push({o,h,l,c,v:last?last.v:50});
  state.candles.shift();
}
async function updateSymbols(){
  if(liveMode || lastLiveFetch===0){
    const ok=await fetchLiveQuotes();
    if(ok) return;
  }
  if(!liveMode){
    const ids={ "NIFTY 50":["niftyPrice","niftyChange"],"BANK NIFTY":["bankPrice","bankChange"],"RELIANCE":["reliancePrice","relianceChange"],"TCS":["tcsPrice","tcsChange"]};
    symbols.forEach(s=>{
      const data=state.prices[s]; data.price=Math.max(10,data.price+(Math.random()-.49)*(s.includes("NIFTY")?24:4));
      const [pid,cid]=ids[s]; el(pid).textContent=data.price.toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
      const ch=pct(s); el(cid).textContent=(ch>=0?"+":"")+ch.toFixed(2)+"%"; el(cid).className=ch>=0?"positive":"negative";
    });
    appendLiveCandle();renderAll();drawChart();
  }
}

async function checkApi(){
  try{
    const r=await fetch("/api/status",{cache:"no-store"});
    const j=await r.json();
    setMarketStatus(Boolean(j.liveConfigured),j.liveConfigured?"configured":"demo");
    const mode=el("apiModalMode");if(mode)mode.textContent=j.liveConfigured?"Live data configured":"Demo fallback";
    return j;
  }catch(e){
    const mode=el("apiModalMode");if(mode)mode.textContent="Backend not running";
  }
}

function totalEquity(){
  let v=state.cash;
  Object.entries(state.positions).forEach(([s,p])=>v+=p.qty*current(s));
  return v;
}
function invested(){
  return Object.values(state.positions).reduce((a,p)=>a+p.qty*p.avg,0);
}
function unrealized(){
  return Object.entries(state.positions).reduce((a,[s,p])=>a+(current(s)-p.avg)*p.qty,0);
}
function tradeQtyValue(){return Number(el("qtyInput").value||0)*Number(el("priceInput").value||0)}
function syncPriceField(){
  el("priceInput").value=current(el("orderSymbol").value).toFixed(2);
  el("tradeValue").textContent=money(tradeQtyValue());
}

function placeOrder(){
  const sym=el("orderSymbol").value, side=state.orderSide, qty=Math.max(1,Number(el("qtyInput").value||1)), price=Number(el("priceInput").value||current(sym));
  const value=qty*price;
  if(side==="buy" && value>state.cash){showToast("Not enough virtual buying power.");return}
  const p=state.positions[sym]||{qty:0,avg:0};
  if(side==="buy"){
    p.avg=(p.qty*p.avg+value)/(p.qty+qty); p.qty+=qty; state.cash-=value;
  }else{
    if(qty>p.qty){showToast("Sell quantity exceeds open position.");return}
    const pnl=(price-p.avg)*qty; state.realized+=pnl; p.qty-=qty; state.cash+=value;
    if(p.qty===0) delete state.positions[sym]; else state.positions[sym]=p;
  }
  const order={id:Date.now(),time:new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}),side,sym,qty,price,value,status:"FILLED"};
  state.orders.unshift(order); state.orders=state.orders.slice(0,100); save(); showToast(`${side==="buy"?"Bought":"Sold"} ${qty} ${sym} @ ${money(price)}`); renderAll();
}
function showToast(msg){el("toast").textContent=msg;setTimeout(()=>{if(el("toast"))el("toast").textContent=""},2600)}

function renderAll(){
  const equity=totalEquity(), dayPnl=equity-1000000;
  ["totalEquity","portfolioEquity"].forEach(id=>el(id).textContent=money(equity));
  el("buyingPower").textContent=money(state.cash);
  el("sideBalance").textContent=shortMoney(state.cash);
  el("dailyPnl").textContent=(dayPnl>=0?"+":"-")+money(Math.abs(dayPnl)).replace("₹","₹")+" ("+(dayPnl/equity*100).toFixed(2)+"%)";
  el("dailyPnl").className=dayPnl>=0?"positive":"negative";
  el("investedValue").textContent=money(invested());
  el("unrealizedPnl").textContent=money(unrealized());
  el("unrealizedPnl").className=unrealized()>=0?"positive":"negative";
  el("tradeCount").textContent=state.orders.length;

  const body=el("positionsBody"); body.innerHTML="";
  const keys=Object.keys(state.positions);
  if(!keys.length){body.innerHTML='<tr><td colspan="6" class="muted">No open positions. Place a paper trade to begin.</td></tr>'}
  keys.forEach(s=>{
    const p=state.positions[s], ltp=current(s), pnl=(ltp-p.avg)*p.qty;
    body.innerHTML+=`<tr><td><b>${s}</b></td><td>${p.qty}</td><td>${money(p.avg)}</td><td>${money(ltp)}</td><td>${money(ltp*p.qty)}</td><td class="${pnl>=0?"positive":"negative"}">${money(pnl)}</td></tr>`;
  });

  const ob=el("ordersBody");ob.innerHTML=state.orders.length?state.orders.map(o=>`<tr><td>${o.time}</td><td class="${o.side==="buy"?"positive":"negative"}"><b>${o.side.toUpperCase()}</b></td><td>${o.sym}</td><td>${o.qty}</td><td>${money(o.price)}</td><td>${money(o.value)}</td><td class="positive">${o.status}</td></tr>`).join(""):'<tr><td colspan="7" class="muted">No paper orders yet.</td></tr>';

  el("recentTrades").innerHTML=state.orders.slice(0,5).map(o=>`<div class="activity"><div><span class="side ${o.side}">${o.side.toUpperCase()}</span> · ${o.sym}</div><div>${o.qty} @ ${money(o.price)}</div></div>`).join("") || '<div class="muted">Your recent paper trades will appear here.</div>';

  const movers=Array.from(symbols).sort((a,b)=>Math.abs(pct(b))-Math.abs(pct(a)));
  el("moversList").innerHTML=movers.map(s=>`<div class="mover"><div><div class="mover-name">${s}</div><div class="mover-price">${current(s).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2})}</div></div><div class="mover-change ${pct(s)>=0?"positive":"negative"}">${pct(s)>=0?"+":""}${pct(s).toFixed(2)}%</div></div>`).join("");

  const rsi=Math.max(25,Math.min(78,55+pct()*8+(Math.random()-0.5)*4));
  el("rsiValue").textContent=rsi.toFixed(1);
  el("macdValue").textContent=(pct()*42).toFixed(1);
  el("volumeValue").textContent=Math.round(48+Math.random()*50)+"%";
  const trend=pct()>=0?"Bullish":"Bearish"; el("trendValue").textContent=trend; el("trendValue").className=pct()>=0?"positive":"negative";
  const patterns=["Bullish Engulfing","Doji","Hammer","Morning Star","Bearish Engulfing","Shooting Star"];
  const pattern=patterns[Math.floor(Math.random()*patterns.length)];
  el("patternName").textContent=pattern;
  el("patternNote").textContent=(pattern.includes("Bearish")||pattern==="Shooting Star")?"Potential reversal setup":"Momentum / reversal setup";
}

function drawChart(){
  const c=el("chartCanvas"), ctx=c.getContext("2d"), rect=c.getBoundingClientRect(), dpr=devicePixelRatio||1;
  c.width=rect.width*dpr;c.height=rect.height*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);
  const w=rect.width,h=rect.height,pad={l:46,r:14,t:18,b:28}; 
  ctx.clearRect(0,0,w,h);
  const cs=state.candles, vals=cs.flatMap(x=>[x.h,x.l]), max=Math.max(...vals), min=Math.min(...vals), range=max-min||1;
  const y=v=>pad.t+(max-v)/range*(h-pad.t-pad.b);
  const step=(w-pad.l-pad.r)/cs.length;
  ctx.font="10px Inter, sans-serif";
  for(let i=0;i<5;i++){const gy=pad.t+i*(h-pad.t-pad.b)/4;ctx.strokeStyle="#15303a";ctx.beginPath();ctx.moveTo(pad.l,gy);ctx.lineTo(w-pad.r,gy);ctx.stroke();const v=max-i*range/4;ctx.fillStyle="#617983";ctx.fillText(v.toFixed(0),4,gy+3)}
  cs.forEach((d,i)=>{
    const x=pad.l+i*step+step/2, oy=y(d.o), cy=y(d.c), hy=y(d.h), ly=y(d.l), up=d.c>=d.o;
    ctx.strokeStyle=up?"#46ddb0":"#ff6f82";ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x,hy);ctx.lineTo(x,ly);ctx.stroke();
    const bw=Math.max(3,step*.55), top=Math.min(oy,cy), bh=Math.max(2,Math.abs(oy-cy));
    ctx.fillStyle=up?"#2ec69c":"#f06077";ctx.fillRect(x-bw/2,top,bw,bh);
  });
  ctx.strokeStyle="#61bde3";ctx.setLineDash([4,4]);ctx.beginPath();const last=cs[cs.length-1].c;ctx.moveTo(pad.l,y(last));ctx.lineTo(w-pad.r,y(last));ctx.stroke();ctx.setLineDash([]);
  ctx.fillStyle="#78a7b7";ctx.fillText(last.toFixed(2),w-70,y(last)-5);
}

document.querySelectorAll(".nav-item").forEach(btn=>btn.addEventListener("click",()=>switchTab(btn.dataset.tab)));
document.querySelectorAll("[data-tab-jump]").forEach(btn=>btn.addEventListener("click",()=>switchTab(btn.dataset.tabJump)));
function switchTab(id){
  document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.tab===id));
  document.querySelectorAll(".tab-panel").forEach(p=>p.classList.toggle("active",p.id===id));
}

document.querySelectorAll(".index-card").forEach(card=>card.addEventListener("click",()=>{
  state.selected=card.dataset.symbol;
  document.querySelectorAll(".index-card").forEach(c=>c.classList.remove("selected"));card.classList.add("selected");
  el("chartTitle").textContent=state.selected; el("orderSymbol").value=state.selected; syncPriceField(); initCandles(); drawChart();
}));
document.querySelectorAll(".timeframes button").forEach(b=>b.addEventListener("click",()=>{document.querySelectorAll(".timeframes button").forEach(x=>x.classList.remove("active"));b.classList.add("active");showToast("Demo timeframe switched to "+b.textContent);}));
document.querySelectorAll(".order-tabs button").forEach(b=>b.addEventListener("click",()=>{state.orderSide=b.dataset.order;b.classList.add("active");document.querySelectorAll(".order-tabs button").forEach(x=>x!==b&&x.classList.remove("active"));el("placeOrderBtn").textContent="Place Paper "+(state.orderSide==="buy"?"Buy":"Sell");}));
el("orderSymbol").addEventListener("change",syncPriceField);
el("qtyInput").addEventListener("input",()=>el("tradeValue").textContent=money(tradeQtyValue()));
el("priceInput").addEventListener("input",()=>el("tradeValue").textContent=money(tradeQtyValue()));
el("placeOrderBtn").addEventListener("click",placeOrder);
el("resetBtn").addEventListener("click",()=>{state.cash=1000000;state.realized=0;state.orders=[];state.positions={};save();renderAll();showToast("Paper account reset to ₹10,00,000.");});

const headlines=[
  ["Indian equities open firm as banks gain traction","Nifty-linked banking names are showing stronger simulated momentum in the morning session.","Bullish","09:42"],
  ["IT stocks mixed; investors watch global tech demand","Large-cap IT counters trade with moderate volatility in this demo feed.","Neutral","09:28"],
  ["Reliance moves higher on broad market strength","Energy and consumer-linked shares participate in the simulated advance.","Bullish","09:12"],
  ["Volatility rises ahead of key macro data","Traders in the demo market are monitoring price swings and support zones.","Bearish","08:56"],
  ["F&O activity picks up in index names","Open-interest and volume are being simulated for educational analysis.","Bullish","08:37"],
  ["TCS holds near key technical level","The chart engine is flagging a watch area around recent support.","Neutral","08:15"]
];
el("newsGrid").innerHTML=headlines.map(([t,p,s,time])=>`<article class="news-card"><div class="eyebrow">MARKET DESK</div><h3>${t}</h3><p>${p}</p><div class="news-meta"><span>Today · ${time}</span><span class="sentiment ${s.toLowerCase()}">${s}</span></div></article>`).join("");

initCandles();renderAll();drawChart();syncPriceField();

const apiModal=el("apiModal");
el("apiSettingsBtn")?.addEventListener("click",async()=>{apiModal?.classList.add("open");await checkApi();});
el("closeApiModal")?.addEventListener("click",()=>apiModal?.classList.remove("open"));
el("refreshApiBtn")?.addEventListener("click",async()=>{await checkApi();await fetchLiveQuotes();});
apiModal?.addEventListener("click",e=>{if(e.target===apiModal)apiModal.classList.remove("open")});
checkApi();
fetchLiveQuotes();
setInterval(updateSymbols,2200);
window.addEventListener("resize",drawChart);
