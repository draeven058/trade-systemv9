import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import * as XLSX from "xlsx";
import { supabase, supabaseConfigured } from "./supabaseClient";

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const uid  = () => Math.random().toString(36).slice(2);
const fmt  = (n) => n==null||isNaN(n)?"—":Number(n).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtD = (d) => { try { return new Date(d).toLocaleDateString("en-IN"); } catch { return d||""; } };

const DEFAULT_NSE_RATE = 3000;
const DEFAULT_MCX = [
  {script:"CRUDEOIL",lotQty:100,rate:40},{script:"GOLD",lotQty:1,rate:30},
  {script:"SILVER",lotQty:30,rate:25},{script:"COPPER",lotQty:2500,rate:20},
  {script:"NATURALGAS",lotQty:1250,rate:35},
];

const blankTrade = () => ({
  id:uid(), trade_date:"", action:"BUY", qty:"", price:"",
  vol:"", script:"", type:"NORMAL", exchange:"NSE",
  is_settlement:false, sort_order:Date.now()
});

// ─── BROKERAGE ────────────────────────────────────────────────────────────────
function calcBrk(t, nseRate, mcxMap) {
  if (t.type==="FORWARD") return 0;
  const vol=parseFloat(t.vol)||0, qty=parseFloat(t.qty)||0;
  const mcx=mcxMap[(t.script||"").toUpperCase()];
  if (mcx||t.exchange==="MCX") { const {lotQty=1,rate=40}=mcx||{}; return (qty/lotQty)*rate; }
  return vol*(nseRate/10_000_000);
}
function buildReport(trades, nseRate, mcxMap) {
  const grp={};
  for (const t of trades) {
    const k=(t.script||"UNKNOWN").toUpperCase();
    if (!grp[k]) grp[k]={script:k,exchange:t.exchange,buys:[],sells:[]};
    t.action==="BUY"?grp[k].buys.push(t):grp[k].sells.push(t);
    grp[k].exchange=t.exchange;
  }
  return Object.values(grp).map(g=>{
    const buyVol=g.buys.reduce((s,t)=>s+(parseFloat(t.vol)||0),0);
    const sellVol=g.sells.reduce((s,t)=>s+(parseFloat(t.vol)||0),0);
    const buyBrk=g.buys.reduce((s,t)=>s+calcBrk(t,nseRate,mcxMap),0);
    const sellBrk=g.sells.reduce((s,t)=>s+calcBrk(t,nseRate,mcxMap),0);
    const totalBrk=buyBrk+sellBrk, gross=sellVol-buyVol, net=gross-totalBrk;
    return {...g,buyVol,sellVol,buyBrk,sellBrk,totalBrk,gross,net,noOf:g.buys.length+g.sells.length};
  });
}

// ─── PDF BILL GENERATOR ───────────────────────────────────────────────────────
function generateBillPDF(traderName, weekLabel, tradesList, nseRate, mcxMap, pdfTheme) {
  const D=pdfTheme==="dark";
  const bg=D?"#0a0f1e":"#fff", cardBg=D?"#0f172a":"#f8faff", border=D?"#1e293b":"#e2e8f0";
  const txt=D?"#e2e8f0":"#1e293b", sub=D?"#94a3b8":"#64748b";
  const th=D?"#111827":"#f1f5f9", tt=D?"#94a3b8":"#475569", ra=D?"#0f1f3d":"#f0f9ff";
  const green=D?"#4ade80":"#16a34a", red=D?"#f87171":"#dc2626", gold=D?"#fbbf24":"#d97706";

  const report=buildReport(tradesList, nseRate, mcxMap);
  const totalGross=report.reduce((s,r)=>s+r.gross,0);
  const totalBrk=report.reduce((s,r)=>s+r.totalBrk,0);
  const totalNet=report.reduce((s,r)=>s+r.net,0);
  const totalNoOf=report.reduce((s,r)=>s+r.noOf,0);

  const normalTrades=tradesList.filter(t=>t.type==="NORMAL");
  const fwdTrades=tradesList.filter(t=>t.type==="FORWARD");

  const trRow=(t)=>`<tr style="border-top:1px solid ${border}">
    <td style="padding:7px 10px;color:${txt}">${t.trade_date}</td>
    <td style="padding:7px 10px"><span style="background:${t.action==="BUY"?"rgba(22,163,74,0.15)":"rgba(220,38,38,0.15)"};color:${t.action==="BUY"?green:red};padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">${t.action}</span></td>
    <td style="padding:7px 10px;color:${D?"#fde68a":"#92400e"}">${t.qty}</td>
    <td style="padding:7px 10px;color:${D?"#fde68a":"#92400e"}">₹${t.price}</td>
    <td style="padding:7px 10px;font-weight:600;color:${txt}">₹${fmt(parseFloat(t.vol))}</td>
    <td style="padding:7px 10px;font-weight:700;color:${gold}">₹${fmt(calcBrk(t,nseRate,mcxMap))}</td>
    <td style="padding:7px 10px"><span style="background:${t.type==="FORWARD"?"rgba(168,85,247,0.15)":"rgba(99,102,241,0.1)"};color:${t.type==="FORWARD"?"#9333ea":"#6366f1"};padding:2px 7px;border-radius:4px;font-size:10px;font-weight:700">${t.type}${t.is_settlement?" ⚖️":""}</span></td>
  </tr>`;

  const scriptBlocks=report.map(g=>{
    const gTrades=[...g.buys,...g.sells].sort((a,b)=>a.sort_order-b.sort_order);
    return `<div style="margin-bottom:20px;border:1px solid ${border};border-radius:10px;overflow:hidden;background:${cardBg}">
      <div style="background:#1e3a8a;padding:9px 14px;display:flex;justify-content:space-between;align-items:center">
        <span style="color:white;font-weight:800;font-size:14px">${g.script}</span>
        <div style="display:flex;gap:12px;align-items:center">
          <span style="background:rgba(255,255,255,0.2);color:white;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:700">${g.exchange}</span>
          <span style="color:${g.net>=0?"#4ade80":"#f87171"};font-weight:800;font-size:13px">Net: ₹${fmt(g.net)}</span>
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:${th}">
          <th style="padding:8px 10px;text-align:left;color:${tt};font-size:10px;text-transform:uppercase">Date</th>
          <th style="padding:8px 10px;text-align:left;color:${tt};font-size:10px;text-transform:uppercase">Action</th>
          <th style="padding:8px 10px;text-align:left;color:${tt};font-size:10px;text-transform:uppercase">Qty</th>
          <th style="padding:8px 10px;text-align:left;color:${tt};font-size:10px;text-transform:uppercase">Price</th>
          <th style="padding:8px 10px;text-align:left;color:${tt};font-size:10px;text-transform:uppercase">Volume</th>
          <th style="padding:8px 10px;text-align:left;color:${tt};font-size:10px;text-transform:uppercase">Brokerage</th>
          <th style="padding:8px 10px;text-align:left;color:${tt};font-size:10px;text-transform:uppercase">Type</th>
        </tr></thead>
        <tbody>${gTrades.map(trRow).join("")}</tbody>
        <tfoot>
          <tr style="background:rgba(99,102,241,0.12)">
            <td colspan="4" style="padding:8px 10px;color:${txt};font-weight:700">Subtotal</td>
            <td style="padding:8px 10px;color:${txt};font-weight:800">Buy: ₹${fmt(g.buyVol)} | Sell: ₹${fmt(g.sellVol)}</td>
            <td style="padding:8px 10px;color:${gold};font-weight:800">₹${fmt(g.totalBrk)}</td>
            <td></td>
          </tr>
          <tr style="background:rgba(99,102,241,0.06)">
            <td colspan="5" style="padding:8px 10px;color:${sub};font-size:11px">Gross P&L: <strong style="color:${txt}">₹${fmt(g.gross)}</strong></td>
            <td colspan="2" style="padding:8px 10px;font-weight:800;font-size:14px;color:${g.net>=0?green:red}">Net: ₹${fmt(g.net)} ${g.net>=0?"▲":"▼"}</td>
          </tr>
        </tfoot>
      </table>
    </div>`;
  }).join("");

  const summaryRows=report.map((g,i)=>`<tr style="border-top:1px solid ${border};background:${i%2===0?"transparent":ra}">
    <td style="padding:10px 14px"><span style="background:${g.exchange==="MCX"?"rgba(234,179,8,0.15)":"rgba(59,130,246,0.15)"};color:${g.exchange==="MCX"?gold:"#3b82f6"};border-radius:5px;padding:3px 10px;font-size:11px;font-weight:700">${g.exchange}</span></td>
    <td style="padding:10px 14px;font-weight:800;color:${txt}">${g.script}</td>
    <td style="padding:10px 14px;text-align:center;font-weight:700;color:${D?"#a5b4fc":"#6366f1"}">${g.noOf}</td>
    <td style="padding:10px 14px;font-weight:700;color:${g.gross>=0?green:red}">₹${fmt(g.gross)}</td>
    <td style="padding:10px 14px;font-weight:700;color:${gold}">₹${fmt(g.totalBrk)}</td>
    <td style="padding:10px 14px;font-weight:800;font-size:14px;color:${g.net>=0?green:red}">₹${fmt(g.net)}</td>
  </tr>`).join("");

  const html=`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Bill — ${traderName} — ${weekLabel}</title>
  <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Segoe UI',Arial,sans-serif;background:${bg};padding:32px;color:${txt}}@media print{body{padding:0}}</style>
  </head><body><div style="max-width:1000px;margin:0 auto">
    <div style="background:linear-gradient(135deg,#1e3a8a,#2563eb);border-radius:14px;padding:28px 36px;text-align:center;margin-bottom:28px">
      <h1 style="color:white;font-size:26px;font-weight:800;margin-bottom:8px">Trade Bill</h1>
      <div style="color:#bfdbfe;font-size:16px;margin-bottom:4px">Trader: <strong style="color:white;font-size:18px">${traderName}</strong></div>
      <div style="display:inline-block;background:rgba(255,255,255,0.15);border-radius:8px;padding:5px 18px;margin:6px 0"><span style="color:#e0f2fe;font-size:13px;font-weight:600">📅 ${weekLabel}</span></div>
      <div style="color:#93c5fd;font-size:12px;margin-top:6px">Generated: ${new Date().toLocaleString("en-IN")}</div>
    </div>
    ${normalTrades.length>0?`<div style="margin-bottom:8px;padding:6px 14px;background:rgba(99,102,241,0.1);border-left:3px solid #6366f1;border-radius:4px;font-size:12px;color:${sub}">Normal Trades: ${normalTrades.length} | Forward/Settlement Trades: ${fwdTrades.length}</div>`:""}
    ${scriptBlocks}
    <div style="margin-top:32px;border:2px solid #1e3a8a;border-radius:12px;overflow:hidden">
      <div style="background:linear-gradient(90deg,#1e3a8a,#2563eb);padding:13px 18px;display:flex;justify-content:space-between;align-items:center">
        <span style="color:white;font-size:16px;font-weight:800">📊 Summary — ${weekLabel}</span>
        <span style="color:#bfdbfe;font-size:12px">${totalNoOf} trades total</span>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;background:${cardBg}">
        <thead><tr style="background:${th}">
          <th style="padding:10px 14px;text-align:left;color:${tt};font-size:11px;text-transform:uppercase">Exchange</th>
          <th style="padding:10px 14px;text-align:left;color:${tt};font-size:11px;text-transform:uppercase">Script</th>
          <th style="padding:10px 14px;text-align:center;color:${tt};font-size:11px;text-transform:uppercase">No. of Trades</th>
          <th style="padding:10px 14px;text-align:left;color:${tt};font-size:11px;text-transform:uppercase">Total Gross</th>
          <th style="padding:10px 14px;text-align:left;color:${tt};font-size:11px;text-transform:uppercase">Total Brk</th>
          <th style="padding:10px 14px;text-align:left;color:${tt};font-size:11px;text-transform:uppercase">Net P&L</th>
        </tr></thead>
        <tbody>${summaryRows}</tbody>
        <tfoot><tr style="background:#1e3a8a;border-top:2px solid #2563eb">
          <td colspan="2" style="padding:13px 14px;color:white;font-weight:800;font-size:14px">GRAND TOTAL</td>
          <td style="padding:13px 14px;text-align:center;color:#bfdbfe;font-weight:800">${totalNoOf}</td>
          <td style="padding:13px 14px;font-weight:800;font-size:15px;color:${totalGross>=0?"#4ade80":"#f87171"}">₹${fmt(totalGross)}</td>
          <td style="padding:13px 14px;font-weight:800;font-size:15px;color:#fbbf24">₹${fmt(totalBrk)}</td>
          <td style="padding:13px 14px;font-weight:900;font-size:17px;color:${totalNet>=0?"#4ade80":"#f87171"}">₹${fmt(totalNet)}</td>
        </tr></tfoot>
      </table>
    </div>
    <div style="text-align:center;margin-top:18px;font-size:11px;color:${sub}">Trade System · ${new Date().toLocaleDateString("en-IN")}</div>
  </div></body></html>`;

  const blob=new Blob([html],{type:"text/html"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;
  a.download=`Bill_${traderName.replace(/\s+/g,"_")}_${weekLabel.replace(/[^a-zA-Z0-9]/g,"_")}.html`;
  a.click();URL.revokeObjectURL(url);
}

// ─── SPINNER ──────────────────────────────────────────────────────────────────
const Spin=({s=18,c="#6366f1"})=>(
  <div style={{width:s,height:s,border:"2px solid rgba(255,255,255,0.15)",borderTopColor:c,borderRadius:"50%",animation:"spin 0.7s linear infinite",flexShrink:0}}/>
);

// ══════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════════════════════════════════════
export default function App() {
  // ── Auth ──
  const [currentUser, setCurrentUser] = useState(null);
  const [loginForm, setLoginForm]     = useState({username:"",password:""});
  const [loginErr, setLoginErr]       = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  // ── Tab ──
  const [tab, setTab] = useState("Traders");

  // ── Traders ──
  const [traders, setTraders]         = useState([]);
  const [tradersLoading, setTradersLoading] = useState(false);
  const [newTrader, setNewTrader]     = useState({name:"",phone:"",note:""});
  const [traderErr, setTraderErr]     = useState("");
  const [selectedTrader, setSelectedTrader] = useState(null); // full trader obj

  // ── Weeks ──
  const [weeks, setWeeks]             = useState([]);
  const [weeksLoading, setWeeksLoading] = useState(false);
  const [selectedWeek, setSelectedWeek] = useState(null);
  const [showNewWeek, setShowNewWeek] = useState(false);
  const [newWeek, setNewWeek]         = useState({label:"",start_date:"",end_date:""});
  const [weekErr, setWeekErr]         = useState("");

  // ── Trades (entry) ──
  const [trades, setTrades]           = useState([]);
  const [tradesLoading, setTradesLoading] = useState(false);
  const [saveStatus, setSaveStatus]   = useState("");
  const [selectedRows, setSelectedRows] = useState(new Set());

  // ── Settings ──
  const [nseRate, setNseRate]         = useState(DEFAULT_NSE_RATE);
  const [mcxScripts, setMcxScripts]   = useState(DEFAULT_MCX);
  const [pdfTheme, setPdfTheme]       = useState("dark");

  // ── Settlement ──
  const [settlRates, setSettlRates]   = useState([]); // [{script,rate,exchange,lot_qty}]
  const [settlLoading, setSettlLoading] = useState(false);
  const [settlMsg, setSettlMsg]       = useState("");
  const [settlWeek, setSettlWeek]     = useState(null);

  // ── Bills ──
  const [billsWeek, setBillsWeek]     = useState(null);
  const [billsTraders, setBillsTraders] = useState([]); // [{trader, trades, report}]
  const [billsLoading, setBillsLoading] = useState(false);
  const [editBill, setEditBill]       = useState(null); // {trader, trades}

  // ── Users (admin) ──
  const [users, setUsers]             = useState([]);
  const [newUser, setNewUser]         = useState({username:"",password:"",role:"USER",name:""});
  const [userErr, setUserErr]         = useState("");
  const [userLoading, setUserLoading] = useState(false);
  const [showChangePwd, setShowChangePwd] = useState(false);
  const [changePwdTarget, setChangePwdTarget] = useState(null);
  const [newPwd, setNewPwd]           = useState("");
  const [confirmPwd, setConfirmPwd]   = useState("");
  const [pwdErr, setPwdErr]           = useState("");
  const [pwdSuccess, setPwdSuccess]   = useState("");
  const [showSelfPwd, setShowSelfPwd] = useState(false);
  const [selfOldPwd, setSelfOldPwd]   = useState("");
  const [selfNewPwd, setSelfNewPwd]   = useState("");
  const [selfConfirmPwd, setSelfConfirmPwd] = useState("");
  const [selfPwdErr, setSelfPwdErr]   = useState("");
  const [selfPwdSuccess, setSelfPwdSuccess] = useState("");

  // ── Excel ──
  const [excelPreview, setExcelPreview] = useState(null);
  const [showPreview, setShowPreview]   = useState(false);
  const fileRef = useRef();
  const saveTimer = useRef(null);

  const mcxMap = useMemo(()=>{
    const m={};mcxScripts.forEach(s=>{m[s.script.toUpperCase()]=s;});return m;
  },[mcxScripts]);

  const report = useMemo(()=>buildReport(trades,nseRate,mcxMap),[trades,nseRate,mcxMap]);
  const totalGross=report.reduce((s,r)=>s+r.gross,0);
  const totalBrk=report.reduce((s,r)=>s+r.totalBrk,0);
  const totalNet=report.reduce((s,r)=>s+r.net,0);

  // ─── DATA LOADERS ──────────────────────────────────────────────────────────
  const loadTraders = useCallback(async()=>{
    setTradersLoading(true);
    const {data}=await supabase.from("traders").select("*").eq("active",true).order("created_at");
    if(data) setTraders(data);
    setTradersLoading(false);
  },[]);

  const loadWeeks = useCallback(async()=>{
    setWeeksLoading(true);
    const {data}=await supabase.from("weeks").select("*").order("created_at",{ascending:false});
    if(data) setWeeks(data);
    setWeeksLoading(false);
  },[]);

  const loadTrades = useCallback(async(traderId, weekId)=>{
    if(!traderId||!weekId) {setTrades([]);return;}
    setTradesLoading(true);
    const {data}=await supabase.from("trades").select("*")
      .eq("trader_id",traderId).eq("week_id",weekId)
      .order("sort_order").order("created_at");
    if(data&&data.length) setTrades(data);
    else setTrades([blankTrade()]);
    setTradesLoading(false);
  },[]);

  const loadSettings = useCallback(async(username)=>{
    const {data}=await supabase.from("user_settings").select("*").eq("username",username).single();
    if(data) {
      if(data.nse_rate) setNseRate(data.nse_rate);
      if(data.mcx_scripts?.length) setMcxScripts(data.mcx_scripts);
    }
  },[]);

  const loadUsers = useCallback(async()=>{
    const {data}=await supabase.from("users").select("*").order("created_at");
    if(data) setUsers(data);
  },[]);

  const loadSettlRates = useCallback(async(weekId)=>{
    if(!weekId) return;
    const {data}=await supabase.from("settlement_rates").select("*").eq("week_id",weekId);
    if(data?.length) setSettlRates(data.map(r=>({script:r.script,rate:r.rate,exchange:r.exchange||"NSE",lot_qty:r.lot_qty||1})));
    else {
      // auto-detect scripts from all traders' trades this week
      const {data:td}=await supabase.from("trades").select("script,exchange").eq("week_id",weekId);
      if(td) {
        const uniq={};
        td.forEach(t=>{const k=t.script.toUpperCase();if(!uniq[k])uniq[k]={script:k,exchange:t.exchange,rate:"",lot_qty:1};});
        setSettlRates(Object.values(uniq));
      }
    }
  },[]);

  useEffect(()=>{
    if(currentUser) { loadTraders(); loadWeeks(); loadSettings(currentUser.username); }
    if(currentUser?.role==="ADMIN") loadUsers();
  },[currentUser,loadTraders,loadWeeks,loadSettings,loadUsers]);

  useEffect(()=>{
    if(selectedTrader&&selectedWeek) loadTrades(selectedTrader.id,selectedWeek.id);
  },[selectedTrader,selectedWeek,loadTrades]);

  useEffect(()=>{
    if(tab==="Settlement"&&settlWeek) loadSettlRates(settlWeek.id);
  },[tab,settlWeek,loadSettlRates]);

  // ─── AUTO-SAVE TRADES ──────────────────────────────────────────────────────
  useEffect(()=>{
    if(!currentUser||!selectedTrader||!selectedWeek||tradesLoading) return;
    if(saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current=setTimeout(async()=>{
      setSaveStatus("saving");
      try {
        // Delete existing + reinsert (simple upsert approach)
        await supabase.from("trades").delete()
          .eq("trader_id",selectedTrader.id).eq("week_id",selectedWeek.id);
        const toInsert=trades.filter(t=>t.script||t.trade_date).map(t=>({
          id:t.id, trader_id:selectedTrader.id, week_id:selectedWeek.id,
          trade_date:t.trade_date||"", action:t.action||"BUY",
          qty:parseFloat(t.qty)||0, price:parseFloat(t.price)||0,
          vol:parseFloat(t.vol)||0, script:(t.script||"").toUpperCase(),
          type:t.type||"NORMAL", exchange:t.exchange||"NSE",
          is_settlement:t.is_settlement||false, sort_order:t.sort_order||0
        }));
        if(toInsert.length) await supabase.from("trades").insert(toInsert);
        setSaveStatus("saved");
      } catch(e){ setSaveStatus("error"); }
      setTimeout(()=>setSaveStatus(""),2500);
    },1500);
    return()=>clearTimeout(saveTimer.current);
  },[trades,currentUser,selectedTrader,selectedWeek,tradesLoading]);

  // ─── SAVE SETTINGS ─────────────────────────────────────────────────────────
  const saveSettings = useCallback(async()=>{
    if(!currentUser) return;
    await supabase.from("user_settings").upsert({username:currentUser.username,nse_rate:nseRate,mcx_scripts:mcxScripts,updated_at:new Date().toISOString()},{onConflict:"username"});
  },[currentUser,nseRate,mcxScripts]);

  useEffect(()=>{if(currentUser)saveSettings();},[nseRate,mcxScripts]);

  // ─── LOGIN ─────────────────────────────────────────────────────────────────
  const handleLogin=async()=>{
    setLoginErr("");
    const uname=loginForm.username.trim().toLowerCase(), pwd=loginForm.password.trim();
    if(!uname||!pwd){setLoginErr("Enter username and password");return;}
    setLoginLoading(true);
    const {data,error}=await supabase.from("users").select("*").eq("username",uname).eq("password",pwd).single();
    if(error||!data){setLoginErr("Invalid username or password.");setLoginLoading(false);return;}
    if(data.active===false){setLoginErr("Account inactive. Contact admin.");setLoginLoading(false);return;}
    setCurrentUser(data);
    setLoginLoading(false);
  };

  // ─── TRADERS CRUD ──────────────────────────────────────────────────────────
  const createTrader=async()=>{
    if(!newTrader.name.trim()){setTraderErr("Name is required");return;}
    const {error}=await supabase.from("traders").insert({name:newTrader.name.trim(),phone:newTrader.phone.trim(),note:newTrader.note.trim(),created_by:currentUser.username,active:true});
    if(error){setTraderErr(error.message);return;}
    setNewTrader({name:"",phone:"",note:""});setTraderErr("");
    await loadTraders();
  };
  const deleteTrader=async(id)=>{
    if(!window.confirm("Delete this trader and ALL their trades?")) return;
    await supabase.from("traders").update({active:false}).eq("id",id);
    if(selectedTrader?.id===id){setSelectedTrader(null);setTrades([]);}
    await loadTraders();
  };

  // ─── WEEKS CRUD ────────────────────────────────────────────────────────────
  const createWeek=async()=>{
    if(!newWeek.label.trim()){setWeekErr("Week label required");return;}
    const {data,error}=await supabase.from("weeks").insert({label:newWeek.label.trim(),start_date:newWeek.start_date||null,end_date:newWeek.end_date||null,created_by:currentUser.username,status:"open"}).select().single();
    if(error){setWeekErr(error.message);return;}
    setNewWeek({label:"",start_date:"",end_date:""});setWeekErr("");setShowNewWeek(false);
    await loadWeeks();
    if(data) setSelectedWeek(data);
  };

  // ─── TRADES ────────────────────────────────────────────────────────────────
  const updateTrade=(id,field,val)=>{
    setTrades(prev=>prev.map(r=>{
      if(r.id!==id) return r;
      const up={...r,[field]:val};
      if(field==="qty"||field==="price"){
        const q=field==="qty"?parseFloat(val):parseFloat(r.qty);
        const p=field==="price"?parseFloat(val):parseFloat(r.price);
        up.vol=!isNaN(q)&&!isNaN(p)?(q*p).toFixed(2):"";
      }
      return up;
    }));
  };
  const addTrade=()=>setTrades(p=>[...p,{...blankTrade(),sort_order:Date.now()}]);
  const removeTrade=(id)=>setTrades(p=>p.filter(r=>r.id!==id));

  const markAsForward=()=>{
    setTrades(prev=>prev.map(t=>selectedRows.has(t.id)?{...t,type:"FORWARD"}:t));
    setSelectedRows(new Set());
  };
  const markAsNormal=()=>{
    setTrades(prev=>prev.map(t=>selectedRows.has(t.id)?{...t,type:"NORMAL"}:t));
    setSelectedRows(new Set());
  };
  const toggleRow=(id)=>{
    setSelectedRows(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;});
  };

  // ─── EXCEL IMPORT ──────────────────────────────────────────────────────────
  const handleExcelFile=(e)=>{
    const file=e.target.files[0];if(!file)return;
    const reader=new FileReader();
    reader.onload=(ev)=>{
      const wb=XLSX.read(ev.target.result,{type:"binary"});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const data=XLSX.utils.sheet_to_json(ws,{defval:""});
      const mapped=data.map((row,i)=>{
        const R=Object.fromEntries(Object.entries(row).map(([k,v])=>[k.trim().toUpperCase(),String(v).trim()]));
        const qty=R["QTY"]||R["QUANTITY"]||"",price=R["PRICE"]||R["RATE"]||"";
        const vol=parseFloat(qty)&&parseFloat(price)?(parseFloat(qty)*parseFloat(price)).toFixed(2):"";
        return {id:uid(),trade_date:R["DATE"]||"",action:(R["ACTION"]||R["BUY/SELL"]||"BUY").toUpperCase(),qty,price,vol,script:(R["SCRIPT"]||R["SYMBOL"]||"").toUpperCase().replace(/[^A-Z0-9]/g,""),type:(R["TYPE"]||"NORMAL").toUpperCase(),exchange:(R["EXCHANGE"]||"NSE").toUpperCase(),is_settlement:false,sort_order:Date.now()+i};
      });
      setExcelPreview(mapped);setShowPreview(true);
    };
    reader.readAsBinaryString(file);e.target.value="";
  };
  const confirmImport=()=>{
    const base=trades.filter(t=>t.script||t.trade_date);
    const maxOrder=base.reduce((m,t)=>Math.max(m,t.sort_order||0),0);
    const imported=excelPreview.map((t,i)=>({...t,sort_order:maxOrder+i+1000}));
    setTrades([...base,...imported]);
    setShowPreview(false);setExcelPreview(null);
  };

  // ─── SETTLEMENT ────────────────────────────────────────────────────────────
  const runSettlement=async()=>{
    if(!settlWeek){setSettlMsg("Select a week first");return;}
    const missingRate=settlRates.find(r=>!r.rate||isNaN(parseFloat(r.rate)));
    if(missingRate){setSettlMsg(`Enter settlement rate for ${missingRate.script}`);return;}
    if(!window.confirm(`Settle week "${settlWeek.label}"? This will create settlement trades for ALL traders.`)) return;
    setSettlLoading(true);setSettlMsg("");
    try {
      // Save settlement rates to DB
      for(const r of settlRates){
        await supabase.from("settlement_rates").upsert({week_id:settlWeek.id,script:r.script,rate:parseFloat(r.rate),exchange:r.exchange||"NSE",lot_qty:parseFloat(r.lot_qty)||1},{onConflict:"week_id,script"});
      }
      // Load all traders
      const {data:allTraders}=await supabase.from("traders").select("*").eq("active",true);
      // For each trader, calculate net position per script and create settlement trade
      for(const trader of allTraders||[]) {
        const {data:traderTrades}=await supabase.from("trades").select("*")
          .eq("trader_id",trader.id).eq("week_id",settlWeek.id).eq("type","NORMAL");
        if(!traderTrades?.length) continue;
        // Net position per script
        const netPos={};
        for(const t of traderTrades){
          const s=t.script.toUpperCase();
          if(!netPos[s]) netPos[s]={buyQty:0,sellQty:0,exchange:t.exchange,script:s};
          if(t.action==="BUY") netPos[s].buyQty+=parseFloat(t.qty)||0;
          else netPos[s].sellQty+=parseFloat(t.qty)||0;
        }
        // Remove old settlement trades for this trader+week
        await supabase.from("trades").delete()
          .eq("trader_id",trader.id).eq("week_id",settlWeek.id).eq("is_settlement",true);
        // Create settlement FORWARD trades
        const settlTrades=[];
        for(const [script,pos] of Object.entries(netPos)){
          const rate=settlRates.find(r=>r.script.toUpperCase()===script);
          if(!rate) continue;
          const netQty=pos.buyQty-pos.sellQty;
          if(Math.abs(netQty)<0.001) continue; // flat position
          const settlRate=parseFloat(rate.rate);
          const settlQty=Math.abs(netQty);
          const action=netQty>0?"SELL":"BUY"; // close the position
          const vol=settlQty*settlRate;
          settlTrades.push({id:uid(),trader_id:trader.id,week_id:settlWeek.id,
            trade_date:"Settlement",action,qty:settlQty,price:settlRate,vol,
            script,type:"FORWARD",exchange:pos.exchange,is_settlement:true,
            sort_order:999999});
        }
        if(settlTrades.length) await supabase.from("trades").insert(settlTrades);
      }
      // Mark week as settled
      await supabase.from("weeks").update({status:"settled"}).eq("id",settlWeek.id);
      await loadWeeks();
      setSettlMsg(`✅ Week "${settlWeek.label}" settled successfully! Settlement trades created for all traders.`);
      // Reload current trades if viewing this week
      if(selectedWeek?.id===settlWeek.id&&selectedTrader)
        await loadTrades(selectedTrader.id,settlWeek.id);
    } catch(e){ setSettlMsg("❌ Error: "+e.message); }
    setSettlLoading(false);
  };

  // ─── BILLS ─────────────────────────────────────────────────────────────────
  const loadBills=useCallback(async(week)=>{
    if(!week) return;
    setBillsLoading(true);
    const {data:allTraders}=await supabase.from("traders").select("*").eq("active",true).order("name");
    if(!allTraders?.length){setBillsLoading(false);return;}
    const results=[];
    for(const trader of allTraders){
      const {data:td}=await supabase.from("trades").select("*")
        .eq("trader_id",trader.id).eq("week_id",week.id).order("sort_order");
      if(td?.length){
        const rep=buildReport(td,nseRate,mcxMap);
        const net=rep.reduce((s,r)=>s+r.net,0);
        results.push({trader,trades:td,report:rep,net});
      }
    }
    setBillsTraders(results);
    setBillsLoading(false);
  },[nseRate,mcxMap]);

  useEffect(()=>{if(billsWeek)loadBills(billsWeek);},[billsWeek,loadBills]);

  // ─── USERS CRUD ────────────────────────────────────────────────────────────
  const createUser=async()=>{
    if(!newUser.username||!newUser.password){setUserErr("Username and password required");return;}
    if(newUser.password.length<4){setUserErr("Password min 4 characters");return;}
    setUserLoading(true);
    const {error}=await supabase.from("users").insert({username:newUser.username.trim().toLowerCase(),password:newUser.password.trim(),name:newUser.name.trim(),role:newUser.role,active:true});
    if(error){setUserErr(error.code==="23505"?"Username already exists":error.message);}
    else{setNewUser({username:"",password:"",role:"USER",name:""});setUserErr("");await loadUsers();}
    setUserLoading(false);
  };
  const deleteUser=async(id)=>{if(id!==currentUser.id){await supabase.from("users").delete().eq("id",id);await loadUsers();}};
  const toggleUserActive=async(u)=>{if(u.id!==currentUser.id){await supabase.from("users").update({active:u.active===false}).eq("id",u.id);await loadUsers();}};
  const openChangePwd=(user)=>{setChangePwdTarget(user);setNewPwd("");setConfirmPwd("");setPwdErr("");setPwdSuccess("");setShowChangePwd(true);};
  const submitChangePwd=async()=>{
    if(!newPwd){setPwdErr("Enter new password");return;}
    if(newPwd!==confirmPwd){setPwdErr("Passwords don't match");return;}
    const {error}=await supabase.from("users").update({password:newPwd}).eq("id",changePwdTarget.id);
    if(error){setPwdErr(error.message);return;}
    setPwdSuccess(`Password updated for @${changePwdTarget.username}`);
    setTimeout(()=>{setShowChangePwd(false);setPwdSuccess("");},1400);await loadUsers();
  };
  const submitSelfPwd=async()=>{
    if(!selfOldPwd||!selfNewPwd||!selfConfirmPwd){setSelfPwdErr("All fields required");return;}
    if(currentUser.password!==selfOldPwd){setSelfPwdErr("Current password incorrect");return;}
    if(selfNewPwd!==selfConfirmPwd){setSelfPwdErr("Passwords don't match");return;}
    const {error}=await supabase.from("users").update({password:selfNewPwd}).eq("id",currentUser.id);
    if(error){setSelfPwdErr(error.message);return;}
    setCurrentUser({...currentUser,password:selfNewPwd});
    setSelfPwdSuccess("Password changed ✓");
    setTimeout(()=>{setShowSelfPwd(false);setSelfPwdSuccess("");setSelfOldPwd("");setSelfNewPwd("");setSelfConfirmPwd("");},1400);
  };

  // MCX helpers
  const updateMcx=(i,f,v)=>setMcxScripts(p=>p.map((s,idx)=>idx===i?{...s,[f]:v}:s));
  const addMcx=()=>setMcxScripts(p=>[...p,{script:"",lotQty:1,rate:0}]);
  const removeMcx=(i)=>setMcxScripts(p=>p.filter((_,idx)=>idx!==i));

  // ── Styles ──
  const inp={background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:5,color:"white",padding:"6px 8px",fontSize:12,width:"100%",fontFamily:"inherit",transition:"border-color 0.2s"};
  const inpLg={...inp,fontSize:13,padding:"10px 12px",borderRadius:7};
  const sel=(bg)=>({...inp,background:bg,cursor:"pointer",fontWeight:700,textAlign:"center",padding:"5px 4px"});
  const btn=(bg,c="white")=>({background:bg,border:"none",borderRadius:8,color:c,padding:"9px 16px",fontSize:13,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"});

  // ══════════════════════════════════════════════
  // LOGIN
  // ══════════════════════════════════════════════
  // ── Config check ──
  if (!supabaseConfigured) return (
    <div style={{minHeight:"100vh",background:"#070d1a",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Segoe UI',system-ui,sans-serif",padding:20}}>
      <div style={{background:"rgba(220,38,38,0.08)",border:"2px solid rgba(220,38,38,0.4)",borderRadius:20,padding:"40px 36px",width:"100%",maxWidth:560,textAlign:"center"}}>
        <div style={{fontSize:48,marginBottom:16}}>⚙️</div>
        <h2 style={{color:"#f87171",fontSize:22,fontWeight:800,marginBottom:8}}>Supabase Not Configured</h2>
        <p style={{color:"#94a3b8",fontSize:14,marginBottom:28,lineHeight:1.7}}>
          Environment variables are missing. Follow these steps to fix:
        </p>
        <div style={{textAlign:"left",background:"rgba(0,0,0,0.3)",borderRadius:12,padding:"20px 24px",marginBottom:24}}>
          {[
            {n:"1",t:"Go to Vercel → your project → Settings → Environment Variables"},
            {n:"2",t:'Add variable: VITE_SUPABASE_URL = https://xxxx.supabase.co'},
            {n:"3",t:'Add variable: VITE_SUPABASE_ANON_KEY = eyJ... (anon public key)'},
            {n:"4",t:"Get both values from: Supabase Dashboard → Settings → API"},
            {n:"5",t:"After saving → Vercel → Deployments → Redeploy"},
            {n:"6",t:"Also run supabase_setup_v2.sql in Supabase SQL Editor"},
          ].map(s=>(
            <div key={s.n} style={{display:"flex",gap:12,marginBottom:12,alignItems:"flex-start"}}>
              <div style={{width:24,height:24,background:"#ef4444",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,color:"white",flexShrink:0}}>{s.n}</div>
              <div style={{color:"#cbd5e1",fontSize:13,lineHeight:1.5}}>{s.t}</div>
            </div>
          ))}
        </div>
        <div style={{background:"rgba(99,102,241,0.1)",border:"1px solid rgba(99,102,241,0.3)",borderRadius:10,padding:"12px 16px",fontSize:12,color:"#a5b4fc",textAlign:"left"}}>
          <strong>Current status:</strong><br/>
          VITE_SUPABASE_URL: <span style={{color:import.meta.env.VITE_SUPABASE_URL?"#4ade80":"#f87171"}}>{import.meta.env.VITE_SUPABASE_URL?"✓ Set":"✗ Missing"}</span><br/>
          VITE_SUPABASE_ANON_KEY: <span style={{color:import.meta.env.VITE_SUPABASE_ANON_KEY?"#4ade80":"#f87171"}}>{import.meta.env.VITE_SUPABASE_ANON_KEY?"✓ Set":"✗ Missing"}</span>
        </div>
      </div>
    </div>
  );

  if(!currentUser) return (
    <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#070d1a,#0f1f3d,#070d1a)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Segoe UI',system-ui,sans-serif",padding:16}}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}input::placeholder{color:rgba(255,255,255,0.25)}input:focus{outline:none;border-color:#6366f1!important;box-shadow:0 0 0 2px rgba(99,102,241,0.25)}`}</style>
      <div style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(99,102,241,0.3)",borderRadius:20,padding:"48px 36px",width:"100%",maxWidth:420,textAlign:"center"}}>
        <div style={{width:64,height:64,background:"linear-gradient(135deg,#4f46e5,#7c3aed)",borderRadius:18,display:"flex",alignItems:"center",justifyContent:"center",fontSize:32,margin:"0 auto 20px"}}>📈</div>
        <h1 style={{color:"white",fontSize:26,fontWeight:800,marginBottom:6}}>Trade System</h1>
        <p style={{color:"#64748b",fontSize:13,marginBottom:32}}>Sign in to your account</p>
        {[{l:"Username",f:"username",t:"text"},{l:"Password",f:"password",t:"password"}].map(({l,f,t})=>(
          <div key={f} style={{textAlign:"left",marginBottom:16}}>
            <label style={{color:"#94a3b8",fontSize:11,fontWeight:700,display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:1}}>{l}</label>
            <input type={t} placeholder={`Enter ${l.toLowerCase()}`} value={loginForm[f]}
              onChange={e=>setLoginForm(p=>({...p,[f]:e.target.value}))}
              onKeyDown={e=>e.key==="Enter"&&handleLogin()}
              style={{...inpLg,fontSize:14}}/>
          </div>
        ))}
        {loginErr&&<div style={{color:"#f87171",fontSize:13,marginBottom:12,padding:"10px 14px",background:"rgba(220,38,38,0.1)",borderRadius:8,border:"1px solid rgba(220,38,38,0.25)",textAlign:"left"}}>⚠ {loginErr}</div>}
        <button onClick={handleLogin} disabled={loginLoading}
          style={{...btn("linear-gradient(135deg,#4f46e5,#7c3aed)"),marginTop:8,width:"100%",padding:"14px",fontSize:15,display:"flex",alignItems:"center",justifyContent:"center",gap:10,opacity:loginLoading?0.8:1}}>
          {loginLoading?<><Spin s={18} c="white"/><span>Signing in...</span></>:"Sign In →"}
        </button>
      </div>
    </div>
  );

  const isAdmin=currentUser.role==="ADMIN";
  const TABS=isAdmin?["Traders","Entry","Settlement","Bills","Settings","Users"]:["Entry","Bills","Settings"];

  // ══════════════════════════════════════════════
  // MAIN APP
  // ══════════════════════════════════════════════
  return(
    <div style={{minHeight:"100vh",background:"#070d1a",fontFamily:"'Segoe UI',system-ui,sans-serif",color:"white"}}>
      <style>{`
        *{box-sizing:border-box}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fi{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}
        @keyframes mo{from{opacity:0;transform:scale(0.96)}to{opacity:1;transform:scale(1)}}
        input::placeholder{color:rgba(255,255,255,0.2)}
        input:focus,select:focus{outline:none;border-color:#6366f1!important;box-shadow:0 0 0 2px rgba(99,102,241,0.2)}
        select option{background:#1e293b;color:white}
        .tb:hover{background:rgba(255,255,255,0.07)!important}
        .ta{background:rgba(99,102,241,0.2)!important;border-bottom:2px solid #6366f1!important;color:white!important}
        .dl:hover{background:rgba(220,38,38,0.3)!important}
        .hov:hover{opacity:0.85}
        .fi{animation:fi 0.2s ease}.mo{animation:mo 0.2s ease}
        ::-webkit-scrollbar{width:4px;height:4px}::-webkit-scrollbar-thumb{background:#1e293b;border-radius:2px}
        .entry-wrap{overflow-x:auto;width:100%}
        .eg{display:grid;grid-template-columns:26px 100px 68px 68px 80px 115px 140px 98px 76px 30px;gap:4px;align-items:center;min-width:860px;}
        .eh{display:grid;grid-template-columns:26px 100px 68px 68px 80px 115px 140px 98px 76px 30px;gap:4px;align-items:center;min-width:860px;}
        @media(max-width:900px){.tab-bar{overflow-x:auto;-webkit-overflow-scrolling:touch}.tab-bar button{white-space:nowrap;padding:11px 13px!important;font-size:12px!important}.mp{padding:14px 10px!important}}
      `}</style>

      {/* ── HEADER ── */}
      <div style={{background:"linear-gradient(135deg,#0f172a,#1e1b4b)",borderBottom:"1px solid rgba(99,102,241,0.2)",padding:"12px 16px"}}>
        <div style={{maxWidth:1400,margin:"0 auto",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <div style={{width:40,height:40,background:"linear-gradient(135deg,#4f46e5,#7c3aed)",borderRadius:11,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22}}>📈</div>
            <div>
              <div style={{fontSize:10,color:"#6366f1",fontWeight:700,letterSpacing:3,textTransform:"uppercase"}}>TRADE ENGINE</div>
              <div style={{fontSize:18,fontWeight:800}}>Trade Summary System</div>
            </div>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
            {saveStatus&&<div style={{display:"flex",alignItems:"center",gap:6,background:saveStatus==="saved"?"rgba(22,163,74,0.1)":saveStatus==="error"?"rgba(220,38,38,0.1)":"rgba(99,102,241,0.1)",border:`1px solid ${saveStatus==="saved"?"rgba(22,163,74,0.25)":saveStatus==="error"?"rgba(220,38,38,0.25)":"rgba(99,102,241,0.25)"}`,borderRadius:7,padding:"5px 12px",fontSize:12}}>
              {saveStatus==="saving"?<><Spin s={12}/><span style={{color:"#a5b4fc"}}>Saving...</span></>:saveStatus==="saved"?<span style={{color:"#4ade80"}}>✓ Saved</span>:<span style={{color:"#f87171"}}>⚠ Error</span>}
            </div>}
            {/* P&L chips */}
            {selectedTrader&&selectedWeek&&[{l:"Gross",v:totalGross},{l:"Brk",v:totalBrk,fc:"#fbbf24"},{l:"Net P&L",v:totalNet}].map(c=>(
              <div key={c.l} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:8,padding:"6px 12px",textAlign:"center"}}>
                <div style={{fontSize:9,color:"#64748b",textTransform:"uppercase",letterSpacing:1}}>{c.l}</div>
                <div style={{fontSize:13,fontWeight:800,color:c.fc||(c.v>=0?"#4ade80":"#f87171")}}>₹{fmt(c.v)}</div>
              </div>
            ))}
            {/* User info */}
            <div style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:8,padding:"6px 10px",display:"flex",alignItems:"center",gap:8}}>
              <div style={{width:30,height:30,background:`linear-gradient(135deg,${isAdmin?"#7c3aed,#4f46e5":"#0369a1,#0284c7"})`,borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>
                {isAdmin?"👑":"👤"}
              </div>
              <div>
                <div style={{fontSize:12,fontWeight:700}}>{currentUser.name||currentUser.username}</div>
                <div style={{fontSize:9,color:isAdmin?"#a78bfa":"#60a5fa",textTransform:"uppercase",letterSpacing:1}}>{currentUser.role}</div>
              </div>
              <button onClick={()=>{setShowSelfPwd(true);setSelfOldPwd("");setSelfNewPwd("");setSelfConfirmPwd("");setSelfPwdErr("");setSelfPwdSuccess("");}} style={{...btn("rgba(99,102,241,0.15)","#a5b4fc"),border:"1px solid rgba(99,102,241,0.25)",fontSize:10,padding:"3px 8px"}}>🔑 Pwd</button>
              <button onClick={()=>setCurrentUser(null)} style={{...btn("rgba(220,38,38,0.1)","#f87171"),border:"1px solid rgba(220,38,38,0.2)",fontSize:10,padding:"3px 8px"}}>Logout</button>
            </div>
          </div>
        </div>
      </div>

      {/* ── TABS ── */}
      <div className="tab-bar" style={{background:"#0c1528",borderBottom:"1px solid rgba(255,255,255,0.05)",display:"flex",padding:"0 16px"}}>
        {TABS.map(t=>(
          <button key={t} className={`tb ${tab===t?"ta":""}`} onClick={()=>setTab(t)}
            style={{background:"transparent",border:"none",borderBottom:"2px solid transparent",color:tab===t?"white":"#64748b",padding:"13px 16px",fontSize:13,fontWeight:600,cursor:"pointer",transition:"all 0.2s"}}>
            {t==="Traders"?"🧑‍💼 Traders":t==="Entry"?"📋 Entry":t==="Settlement"?"⚖️ Settlement":t==="Bills"?"🧾 Bills":t==="Settings"?"⚙️ Settings":"👥 Users"}
          </button>
        ))}
      </div>

      <div className="mp" style={{maxWidth:1400,margin:"0 auto",padding:"20px 14px"}}>

        {/* ══════ TRADERS TAB ══════ */}
        {tab==="Traders"&&(
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))",gap:20}}>
            {/* Create */}
            <div style={{background:"rgba(99,102,241,0.05)",border:"1px solid rgba(99,102,241,0.2)",borderRadius:14,padding:24}}>
              <div style={{fontSize:11,color:"#a5b4fc",fontWeight:700,letterSpacing:2,textTransform:"uppercase",marginBottom:20}}>➕ Add New Trader</div>
              {[{l:"Full Name *",f:"name",ph:"e.g. Rahul Sharma"},{l:"Phone",f:"phone",ph:"Optional"},{l:"Note",f:"note",ph:"Optional note"}].map(({l,f,ph})=>(
                <div key={f} style={{marginBottom:14}}>
                  <label style={{fontSize:11,color:"#94a3b8",display:"block",marginBottom:5,fontWeight:600,textTransform:"uppercase"}}>{l}</label>
                  <input type="text" placeholder={ph} value={newTrader[f]} onChange={e=>setNewTrader(p=>({...p,[f]:e.target.value}))} style={inpLg}/>
                </div>
              ))}
              {traderErr&&<div style={{color:"#f87171",fontSize:12,marginBottom:12,padding:"8px 12px",background:"rgba(220,38,38,0.08)",borderRadius:6}}>⚠ {traderErr}</div>}
              <button onClick={createTrader} style={{...btn("linear-gradient(135deg,#4f46e5,#7c3aed)"),width:"100%",padding:"12px",fontSize:14}}>+ Add Trader</button>
            </div>
            {/* List */}
            <div style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:14,padding:24}}>
              <div style={{fontSize:11,color:"#a5b4fc",fontWeight:700,letterSpacing:2,textTransform:"uppercase",marginBottom:20,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span>🧑‍💼 All Traders ({traders.length})</span>
                {tradersLoading&&<Spin s={14}/>}
              </div>
              {traders.length===0&&!tradersLoading&&<div style={{color:"#334155",textAlign:"center",padding:"30px 0",fontSize:13}}>No traders yet. Add one!</div>}
              {traders.map(t=>(
                <div key={t.id} style={{display:"flex",alignItems:"center",gap:10,padding:"11px 12px",background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:10,marginBottom:10,flexWrap:"wrap"}}>
                  <div style={{width:38,height:38,background:"linear-gradient(135deg,#0369a1,#0284c7)",borderRadius:9,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>🧑‍💼</div>
                  <div style={{flex:1,minWidth:100}}>
                    <div style={{fontWeight:700,color:"white",fontSize:14}}>{t.name}</div>
                    {t.phone&&<div style={{fontSize:11,color:"#64748b"}}>📞 {t.phone}</div>}
                    {t.note&&<div style={{fontSize:11,color:"#475569"}}>{t.note}</div>}
                  </div>
                  <button onClick={()=>{setSelectedTrader(t);setTab("Entry");}} style={{...btn("rgba(99,102,241,0.15)","#a5b4fc"),border:"1px solid rgba(99,102,241,0.25)",fontSize:11,padding:"4px 10px"}}>📋 Entry</button>
                  <button onClick={()=>{setSelectedTrader(t);setBillsWeek(selectedWeek);setTab("Bills");}} style={{...btn("rgba(22,163,74,0.12)","#4ade80"),border:"1px solid rgba(22,163,74,0.2)",fontSize:11,padding:"4px 10px"}}>🧾 Bills</button>
                  <button onClick={()=>deleteTrader(t.id)} style={{...btn("rgba(220,38,38,0.08)","#f87171"),border:"1px solid rgba(220,38,38,0.2)",width:28,height:28,padding:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13}}>✕</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ══════ ENTRY TAB ══════ */}
        {tab==="Entry"&&(
          <div>
            {/* Trader + Week selector bar */}
            <div style={{display:"flex",gap:10,marginBottom:14,alignItems:"center",flexWrap:"wrap",background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:12,padding:"12px 14px"}}>
              {/* Trader */}
              <div style={{display:"flex",alignItems:"center",gap:8,flex:1,minWidth:200}}>
                <span style={{fontSize:12,color:"#94a3b8",fontWeight:700,whiteSpace:"nowrap"}}>🧑‍💼 Trader:</span>
                <select value={selectedTrader?.id||""} onChange={e=>{const t=traders.find(x=>x.id===e.target.value);setSelectedTrader(t||null);}} style={{...inpLg,color:"#fbbf24",fontWeight:700,flex:1}}>
                  <option value="">-- Select Trader --</option>
                  {traders.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              {/* Week */}
              <div style={{display:"flex",alignItems:"center",gap:8,flex:1,minWidth:220}}>
                <span style={{fontSize:12,color:"#94a3b8",fontWeight:700,whiteSpace:"nowrap"}}>📅 Week:</span>
                <select value={selectedWeek?.id||""} onChange={e=>{const w=weeks.find(x=>x.id===e.target.value);setSelectedWeek(w||null);}} style={{...inpLg,color:"#a5b4fc",fontWeight:700,flex:1}}>
                  <option value="">-- Select Week --</option>
                  {weeks.map(w=><option key={w.id} value={w.id}>{w.label}{w.status==="settled"?" ✓":""}</option>)}
                </select>
                <button onClick={()=>setShowNewWeek(true)} style={{...btn("rgba(99,102,241,0.15)","#a5b4fc"),border:"1px solid rgba(99,102,241,0.25)",fontSize:11,padding:"6px 10px",whiteSpace:"nowrap"}}>+ New Week</button>
              </div>
              {/* Actions */}
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleExcelFile} style={{display:"none"}}/>
                <button onClick={()=>fileRef.current.click()} disabled={!selectedTrader||!selectedWeek}
                  style={{...btn("rgba(22,163,74,0.12)","#4ade80"),border:"1px solid rgba(22,163,74,0.28)",opacity:(!selectedTrader||!selectedWeek)?0.4:1,fontSize:12,padding:"8px 12px"}}>📤 Import Excel</button>
                <div style={{display:"flex",alignItems:"center",gap:6,background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:7,padding:"5px 10px"}}>
                  <span style={{fontSize:11,color:"#64748b"}}>PDF:</span>
                  <button onClick={()=>setPdfTheme(p=>p==="dark"?"light":"dark")}
                    style={{background:pdfTheme==="dark"?"#0f172a":"#f0f4f8",border:`2px solid ${pdfTheme==="dark"?"#6366f1":"#2563eb"}`,borderRadius:20,padding:"3px 12px",fontSize:11,fontWeight:700,cursor:"pointer",color:pdfTheme==="dark"?"white":"#1e293b"}}>
                    {pdfTheme==="dark"?"🌑":"☀️"}
                  </button>
                </div>
                <button onClick={()=>selectedTrader&&selectedWeek&&generateBillPDF(selectedTrader.name,selectedWeek.label,trades,nseRate,mcxMap,pdfTheme)}
                  disabled={!selectedTrader||!selectedWeek}
                  style={{...btn("#0369a1"),opacity:(!selectedTrader||!selectedWeek)?0.4:1,fontSize:12,padding:"8px 12px"}}>⬇ Export PDF</button>
              </div>
            </div>

            {!selectedTrader||!selectedWeek?(
              <div style={{textAlign:"center",padding:"60px 20px",background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:14}}>
                <div style={{fontSize:32,marginBottom:12}}>🧑‍💼</div>
                <div style={{color:"#475569",fontSize:15,marginBottom:8}}>Select a Trader and Week to start entering trades</div>
                <div style={{color:"#334155",fontSize:12}}>Go to <strong style={{color:"#6366f1"}}>Traders</strong> tab to create traders · Click <strong style={{color:"#4ade80"}}>+ New Week</strong> to create a week</div>
              </div>
            ):(
              <>
                {/* Mark as Forward toolbar */}
                {selectedRows.size>0&&(
                  <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:10,padding:"10px 14px",background:"rgba(99,102,241,0.08)",border:"1px solid rgba(99,102,241,0.2)",borderRadius:10}}>
                    <span style={{fontSize:12,color:"#a5b4fc"}}>{selectedRows.size} row{selectedRows.size>1?"s":""} selected</span>
                    <button onClick={markAsForward} style={{...btn("rgba(168,85,247,0.2)","#c084fc"),border:"1px solid rgba(168,85,247,0.35)",fontSize:12,padding:"6px 12px"}}>🔄 Mark as FORWARD</button>
                    <button onClick={markAsNormal} style={{...btn("rgba(99,102,241,0.2)","#a5b4fc"),border:"1px solid rgba(99,102,241,0.35)",fontSize:12,padding:"6px 12px"}}>↩ Mark as NORMAL</button>
                    <button onClick={()=>setSelectedRows(new Set())} style={{...btn("rgba(255,255,255,0.07)","#64748b"),fontSize:12,padding:"6px 10px"}}>✕ Clear</button>
                  </div>
                )}

                {/* Trade table */}
                <div style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:14,overflow:"hidden"}}>
                  {/* Week info bar */}
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 14px",background:"rgba(30,58,138,0.3)",borderBottom:"1px solid rgba(255,255,255,0.06)",flexWrap:"wrap",gap:6}}>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <span style={{fontSize:13,fontWeight:700,color:"white"}}>🧑‍💼 {selectedTrader.name}</span>
                      <span style={{fontSize:11,color:"#94a3b8"}}>|</span>
                      <span style={{fontSize:12,color:"#a5b4fc"}}>📅 {selectedWeek.label}</span>
                      {selectedWeek.status==="settled"&&<span style={{background:"rgba(22,163,74,0.2)",border:"1px solid rgba(22,163,74,0.3)",borderRadius:5,padding:"2px 8px",fontSize:10,color:"#4ade80",fontWeight:700}}>✓ SETTLED</span>}
                    </div>
                    <div style={{fontSize:12,color:"#64748b"}}>{trades.length} trades · Normal: {trades.filter(t=>t.type==="NORMAL").length} · Forward: {trades.filter(t=>t.type==="FORWARD").length}</div>
                  </div>

                  <div className="entry-wrap">
                    <div className="eh" style={{background:"rgba(99,102,241,0.15)",borderBottom:"1px solid rgba(99,102,241,0.2)",padding:"9px 12px"}}>
                      <div style={{color:"#a5b4fc",fontSize:10,fontWeight:700,textTransform:"uppercase"}}>✓</div>
                      {["Date","Action","Qty","Price ₹","Vol (Auto)","Script","Type","Exch",""].map(h=>(
                        <div key={h} style={{color:"#a5b4fc",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{h}</div>
                      ))}
                    </div>
                    {tradesLoading?(
                      <div style={{display:"flex",alignItems:"center",justifyContent:"center",padding:30,gap:10}}>
                        <Spin s={20}/><span style={{color:"#64748b"}}>Loading trades...</span>
                      </div>
                    ):trades.map((row,idx)=>(
                      <div key={row.id} className={`eg fi`}
                        style={{borderBottom:"1px solid rgba(255,255,255,0.04)",padding:"5px 12px",
                          background:selectedRows.has(row.id)?"rgba(99,102,241,0.1)":row.type==="FORWARD"?"rgba(168,85,247,0.05)":"transparent"}}>
                        {/* Checkbox */}
                        <div style={{display:"flex",alignItems:"center",justifyContent:"center"}}>
                          <input type="checkbox" checked={selectedRows.has(row.id)} onChange={()=>toggleRow(row.id)}
                            style={{width:14,height:14,cursor:"pointer",accentColor:"#6366f1"}}/>
                        </div>
                        <input type="text" placeholder="DD/MM/YYYY" value={row.trade_date} onChange={e=>updateTrade(row.id,"trade_date",e.target.value)} style={inp}/>
                        <select value={row.action} onChange={e=>updateTrade(row.id,"action",e.target.value)} style={sel(row.action==="BUY"?"rgba(22,163,74,0.3)":"rgba(220,38,38,0.3)")}>
                          <option>BUY</option><option>SELL</option>
                        </select>
                        <input type="number" placeholder="0" value={row.qty} onChange={e=>updateTrade(row.id,"qty",e.target.value)} style={{...inp,color:"#fde68a"}}/>
                        <input type="number" placeholder="0.00" step="0.01" value={row.price} onChange={e=>updateTrade(row.id,"price",e.target.value)} style={{...inp,color:"#fde68a"}}/>
                        <div style={{background:"rgba(99,102,241,0.1)",border:"1px solid rgba(99,102,241,0.2)",borderRadius:5,padding:"5px 7px",fontSize:11,color:"#a5b4fc",fontWeight:700,minHeight:30,display:"flex",alignItems:"center",overflow:"hidden"}}>
                          {row.vol?`₹ ${Number(row.vol).toLocaleString("en-IN")}`:<span style={{color:"rgba(148,163,184,0.3)",fontWeight:400,fontSize:10}}>Auto</span>}
                        </div>
                        <input type="text" placeholder="e.g. GOLD" value={row.script} onChange={e=>updateTrade(row.id,"script",e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,""))} style={{...inp,color:"#fbbf24",fontWeight:700}}/>
                        <select value={row.type} onChange={e=>updateTrade(row.id,"type",e.target.value)} style={sel(row.type==="FORWARD"?"rgba(168,85,247,0.25)":"rgba(255,255,255,0.06)")}>
                          <option>NORMAL</option><option>FORWARD</option>
                        </select>
                        <select value={row.exchange} onChange={e=>updateTrade(row.id,"exchange",e.target.value)} style={sel(row.exchange==="MCX"?"rgba(234,179,8,0.25)":"rgba(59,130,246,0.25)")}>
                          <option>NSE</option><option>MCX</option>
                        </select>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"center"}}>
                          <button className="dl" onClick={()=>removeTrade(row.id)} disabled={trades.length===1}
                            style={{...btn("rgba(220,38,38,0.08)","#f87171"),border:"1px solid rgba(220,38,38,0.2)",width:26,height:26,padding:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,opacity:trades.length===1?0.3:1}}>✕</button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",background:"rgba(0,0,0,0.25)",borderTop:"1px solid rgba(255,255,255,0.04)",flexWrap:"wrap",gap:8}}>
                    <div style={{display:"flex",gap:8,alignItems:"center"}}>
                      <button onClick={addTrade} style={{...btn("#4f46e5"),fontSize:12,padding:"8px 14px"}}>+ Add Row</button>
                      {selectedRows.size===0&&<button onClick={()=>{const all=new Set(trades.map(t=>t.id));setSelectedRows(all);}} style={{...btn("rgba(99,102,241,0.15)","#a5b4fc"),border:"1px solid rgba(99,102,241,0.25)",fontSize:11,padding:"6px 10px"}}>Select All</button>}
                    </div>
                    <div style={{display:"flex",gap:8,alignItems:"center"}}>
                      <button onClick={()=>setTab("Bills")} style={{...btn("rgba(22,163,74,0.12)","#4ade80"),border:"1px solid rgba(22,163,74,0.2)",fontSize:12,padding:"8px 12px"}}>🧾 View Bill →</button>
                    </div>
                  </div>
                </div>
                <div style={{marginTop:8,background:"rgba(168,85,247,0.04)",border:"1px solid rgba(168,85,247,0.12)",borderRadius:8,padding:"8px 14px",fontSize:12,color:"#64748b"}}>
                  <span style={{color:"#c084fc",fontWeight:700}}>💡 Tip: </span>
                  Check rows → click <strong style={{color:"#c084fc"}}>Mark as FORWARD</strong> to convert selected trades to Forward type · Excel: <code style={{color:"#fde68a",background:"rgba(255,255,255,0.05)",padding:"0 5px",borderRadius:3}}>Date|Action|Qty|Price|Script|Type|Exchange</code>
                </div>
              </>
            )}
          </div>
        )}

        {/* ══════ SETTLEMENT TAB ══════ */}
        {tab==="Settlement"&&(
          <div>
            <div style={{marginBottom:16,padding:"12px 16px",background:"rgba(251,191,36,0.05)",border:"1px solid rgba(251,191,36,0.2)",borderRadius:12,fontSize:13,color:"#94a3b8",lineHeight:1.7}}>
              <strong style={{color:"#fbbf24"}}>⚖️ Settlement Process:</strong> Select week → Enter settlement rate for each script → Click <strong style={{color:"#4ade80"}}>Settle Week</strong>. The system will automatically create <strong style={{color:"#c084fc"}}>FORWARD settlement trades</strong> for ALL traders to close their open positions.
            </div>

            {/* Week selector */}
            <div style={{display:"flex",gap:12,marginBottom:18,alignItems:"center",flexWrap:"wrap"}}>
              <div style={{display:"flex",alignItems:"center",gap:8,background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:10,padding:"10px 14px",flex:1,minWidth:260}}>
                <span style={{fontSize:12,color:"#94a3b8",fontWeight:700,whiteSpace:"nowrap"}}>📅 Select Week:</span>
                <select value={settlWeek?.id||""} onChange={e=>{const w=weeks.find(x=>x.id===e.target.value);setSettlWeek(w||null);setSettlRates([]);setSettlMsg("");}} style={{...inpLg,color:"#a5b4fc",fontWeight:700,flex:1}}>
                  <option value="">-- Select Week --</option>
                  {weeks.map(w=><option key={w.id} value={w.id}>{w.label}{w.status==="settled"?" ✓ Settled":""}</option>)}
                </select>
              </div>
              {settlWeek&&<div style={{background:settlWeek.status==="settled"?"rgba(22,163,74,0.1)":"rgba(251,191,36,0.1)",border:`1px solid ${settlWeek.status==="settled"?"rgba(22,163,74,0.3)":"rgba(251,191,36,0.3)"}`,borderRadius:8,padding:"8px 14px",fontSize:12,fontWeight:700,color:settlWeek.status==="settled"?"#4ade80":"#fbbf24"}}>
                {settlWeek.status==="settled"?"✅ Already Settled":"⏳ Open — Ready to Settle"}
              </div>}
            </div>

            {settlWeek&&(
              <div style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:14,overflow:"hidden"}}>
                <div style={{background:"linear-gradient(90deg,rgba(30,58,138,0.9),rgba(37,99,235,0.4))",padding:"12px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontSize:15,fontWeight:800}}>📊 Settlement Rates — {settlWeek.label}</span>
                  <span style={{color:"#93c5fd",fontSize:12}}>{settlRates.length} scripts</span>
                </div>
                <div style={{padding:16}}>
                  {settlRates.length===0&&<div style={{color:"#475569",textAlign:"center",padding:20,fontSize:13}}>Loading scripts... or no trades found for this week.</div>}
                  {/* Header */}
                  {settlRates.length>0&&<div style={{display:"grid",gridTemplateColumns:"1.5fr 1fr 1fr 1fr 30px",gap:8,marginBottom:8,padding:"0 4px"}}>
                    {["Script","Exchange","Settlement Rate ₹","Lot Qty",""].map(h=><div key={h} style={{fontSize:10,color:"#fbbf24",fontWeight:700,textTransform:"uppercase"}}>{h}</div>)}
                  </div>}
                  {settlRates.map((r,i)=>(
                    <div key={i} style={{display:"grid",gridTemplateColumns:"1.5fr 1fr 1fr 1fr 30px",gap:8,marginBottom:8}}>
                      <input type="text" value={r.script} onChange={e=>setSettlRates(p=>p.map((x,idx)=>idx===i?{...x,script:e.target.value.toUpperCase()}:x))} style={{...inpLg,color:"#fbbf24",fontWeight:700}}/>
                      <select value={r.exchange||"NSE"} onChange={e=>setSettlRates(p=>p.map((x,idx)=>idx===i?{...x,exchange:e.target.value}:x))} style={{...inpLg,color:r.exchange==="MCX"?"#fbbf24":"#60a5fa",fontWeight:700}}>
                        <option>NSE</option><option>MCX</option>
                      </select>
                      <input type="number" placeholder="0.00" step="0.01" value={r.rate} onChange={e=>setSettlRates(p=>p.map((x,idx)=>idx===i?{...x,rate:e.target.value}:x))} style={{...inpLg,color:"#4ade80",fontWeight:700}}/>
                      <input type="number" placeholder="1" value={r.lot_qty||1} onChange={e=>setSettlRates(p=>p.map((x,idx)=>idx===i?{...x,lot_qty:parseFloat(e.target.value)||1}:x))} style={inpLg}/>
                      <button onClick={()=>setSettlRates(p=>p.filter((_,idx)=>idx!==i))} style={{...btn("rgba(220,38,38,0.08)","#f87171"),border:"1px solid rgba(220,38,38,0.2)",width:30,height:38,padding:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13}}>✕</button>
                    </div>
                  ))}
                  <button onClick={()=>setSettlRates(p=>[...p,{script:"",rate:"",exchange:"NSE",lot_qty:1}])} style={{...btn("rgba(234,179,8,0.08)","#fbbf24"),border:"1px dashed rgba(234,179,8,0.3)",width:"100%",marginTop:4,fontSize:12}}>+ Add Script</button>
                </div>
                <div style={{padding:"14px 16px",borderTop:"1px solid rgba(255,255,255,0.06)",background:"rgba(0,0,0,0.2)",display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
                  <button onClick={runSettlement} disabled={settlLoading||settlRates.length===0}
                    style={{...btn("linear-gradient(135deg,#059669,#047857)"),padding:"11px 28px",fontSize:14,opacity:settlLoading||settlRates.length===0?0.5:1,display:"flex",alignItems:"center",gap:8}}>
                    {settlLoading?<><Spin s={16} c="white"/><span>Settling...</span></>:"⚖️ Settle Week — Generate Bills"}
                  </button>
                  <div style={{fontSize:12,color:"#64748b"}}>This will create settlement FORWARD trades for all traders and mark the week as settled.</div>
                </div>
                {settlMsg&&<div style={{margin:"0 16px 16px",padding:"10px 14px",background:settlMsg.startsWith("✅")?"rgba(22,163,74,0.1)":"rgba(220,38,38,0.1)",border:`1px solid ${settlMsg.startsWith("✅")?"rgba(22,163,74,0.3)":"rgba(220,38,38,0.3)"}`,borderRadius:8,fontSize:13,color:settlMsg.startsWith("✅")?"#4ade80":"#f87171"}}>{settlMsg}</div>}
              </div>
            )}
          </div>
        )}

        {/* ══════ BILLS TAB ══════ */}
        {tab==="Bills"&&(
          <div>
            {/* Controls */}
            <div style={{display:"flex",gap:10,marginBottom:16,alignItems:"center",flexWrap:"wrap",background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:12,padding:"12px 14px"}}>
              <span style={{fontSize:12,color:"#94a3b8",fontWeight:700,whiteSpace:"nowrap"}}>📅 Select Week:</span>
              <select value={billsWeek?.id||""} onChange={e=>{const w=weeks.find(x=>x.id===e.target.value);setBillsWeek(w||null);setBillsTraders([]);}} style={{...inpLg,color:"#a5b4fc",fontWeight:700,flex:1,minWidth:200}}>
                <option value="">-- Select Week --</option>
                {weeks.map(w=><option key={w.id} value={w.id}>{w.label}{w.status==="settled"?" ✓":""}</option>)}
              </select>
              <div style={{display:"flex",alignItems:"center",gap:8,background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:7,padding:"5px 10px"}}>
                <span style={{fontSize:11,color:"#64748b"}}>PDF:</span>
                <button onClick={()=>setPdfTheme(p=>p==="dark"?"light":"dark")}
                  style={{background:pdfTheme==="dark"?"#0f172a":"#f0f4f8",border:`2px solid ${pdfTheme==="dark"?"#6366f1":"#2563eb"}`,borderRadius:20,padding:"3px 12px",fontSize:11,fontWeight:700,cursor:"pointer",color:pdfTheme==="dark"?"white":"#1e293b"}}>
                  {pdfTheme==="dark"?"🌑 Dark":"☀️ Light"}
                </button>
              </div>
              {billsWeek&&<button onClick={()=>{billsTraders.forEach(b=>generateBillPDF(b.trader.name,billsWeek.label,b.trades,nseRate,mcxMap,pdfTheme));}} style={{...btn("#0369a1"),fontSize:12,padding:"8px 14px"}}>⬇ Download All Bills</button>}
              {billsLoading&&<Spin s={20}/>}
            </div>

            {!billsWeek?(
              <div style={{textAlign:"center",padding:"60px 20px",background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:14,color:"#475569"}}>Select a week to view bills</div>
            ):billsTraders.length===0&&!billsLoading?(
              <div style={{textAlign:"center",padding:"60px 20px",background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:14,color:"#475569"}}>No trades found for this week</div>
            ):(
              <>
                {/* Summary row */}
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:10,marginBottom:16}}>
                  <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:10,padding:"12px 16px",textAlign:"center"}}>
                    <div style={{fontSize:10,color:"#64748b",textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>Traders</div>
                    <div style={{fontSize:22,fontWeight:800,color:"#a5b4fc"}}>{billsTraders.length}</div>
                  </div>
                  {[{l:"Total Gross",v:billsTraders.reduce((s,b)=>s+b.report.reduce((x,r)=>x+r.gross,0),0)},
                    {l:"Total Brk",v:billsTraders.reduce((s,b)=>s+b.report.reduce((x,r)=>x+r.totalBrk,0),0),fc:"#fbbf24"},
                    {l:"Total Net",v:billsTraders.reduce((s,b)=>s+b.net,0)}].map(c=>(
                    <div key={c.l} style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:10,padding:"12px 16px",textAlign:"center"}}>
                      <div style={{fontSize:10,color:"#64748b",textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>{c.l}</div>
                      <div style={{fontSize:18,fontWeight:800,color:c.fc||(c.v>=0?"#4ade80":"#f87171")}}>₹{fmt(c.v)}</div>
                    </div>
                  ))}
                </div>

                {/* Per trader cards */}
                {billsTraders.map(b=>(
                  <div key={b.trader.id} style={{marginBottom:14,background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:14,overflow:"hidden"}}>
                    <div style={{background:"linear-gradient(90deg,rgba(30,58,138,0.9),rgba(37,99,235,0.4))",padding:"12px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <span style={{fontSize:22}}>🧑‍💼</span>
                        <div>
                          <div style={{fontSize:16,fontWeight:800}}>{b.trader.name}</div>
                          {b.trader.phone&&<div style={{fontSize:11,color:"#93c5fd"}}>📞 {b.trader.phone}</div>}
                        </div>
                        <span style={{background:"rgba(255,255,255,0.15)",color:"white",borderRadius:5,padding:"2px 8px",fontSize:11}}>{b.trades.length} trades</span>
                      </div>
                      <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
                        <div style={{textAlign:"right"}}>
                          <div style={{fontSize:11,color:"#93c5fd"}}>Net P&L</div>
                          <div style={{fontSize:18,fontWeight:900,color:b.net>=0?"#4ade80":"#f87171"}}>₹{fmt(b.net)}</div>
                        </div>
                        <button onClick={()=>generateBillPDF(b.trader.name,billsWeek.label,b.trades,nseRate,mcxMap,pdfTheme)} style={{...btn("#0369a1"),fontSize:12,padding:"8px 14px"}}>⬇ PDF</button>
                        <button onClick={()=>setEditBill({trader:b.trader,trades:[...b.trades],weekLabel:billsWeek.label})} style={{...btn("rgba(251,191,36,0.15)","#fbbf24"),border:"1px solid rgba(251,191,36,0.3)",fontSize:12,padding:"8px 14px"}}>✏️ Edit</button>
                      </div>
                    </div>
                    {/* Script breakdown */}
                    <div style={{overflowX:"auto"}}>
                      <table style={{width:"100%",borderCollapse:"collapse",fontSize:13,minWidth:500}}>
                        <thead><tr style={{background:"rgba(0,0,0,0.3)"}}>
                          {["Exchange","Script","Trades","Total Gross","Total Brk","Net P&L"].map(h=>(
                            <th key={h} style={{padding:"9px 14px",textAlign:"left",color:"#64748b",fontWeight:700,fontSize:11,textTransform:"uppercase",whiteSpace:"nowrap"}}>{h}</th>
                          ))}
                        </tr></thead>
                        <tbody>
                          {b.report.map((g,i)=>(
                            <tr key={g.script} style={{borderTop:"1px solid rgba(255,255,255,0.05)",background:i%2===0?"transparent":"rgba(255,255,255,0.01)"}}>
                              <td style={{padding:"9px 14px"}}><span style={{background:g.exchange==="MCX"?"rgba(234,179,8,0.2)":"rgba(59,130,246,0.2)",color:g.exchange==="MCX"?"#fbbf24":"#60a5fa",borderRadius:5,padding:"2px 8px",fontSize:11,fontWeight:700}}>{g.exchange}</span></td>
                              <td style={{padding:"9px 14px",fontWeight:700,color:"#e2e8f0"}}>{g.script}</td>
                              <td style={{padding:"9px 14px",textAlign:"center",color:"#a5b4fc",fontWeight:700}}>{g.noOf}</td>
                              <td style={{padding:"9px 14px",fontWeight:700,color:g.gross>=0?"#4ade80":"#f87171"}}>₹{fmt(g.gross)}</td>
                              <td style={{padding:"9px 14px",fontWeight:700,color:"#fbbf24"}}>₹{fmt(g.totalBrk)}</td>
                              <td style={{padding:"9px 14px",fontWeight:800,fontSize:14,color:g.net>=0?"#4ade80":"#f87171"}}>₹{fmt(g.net)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr style={{background:"rgba(99,102,241,0.2)",borderTop:"2px solid rgba(99,102,241,0.4)"}}>
                            <td colSpan={2} style={{padding:"10px 14px",color:"white",fontWeight:800,fontSize:13}}>TOTAL</td>
                            <td style={{padding:"10px 14px",textAlign:"center",color:"#a5b4fc",fontWeight:800}}>{b.report.reduce((s,r)=>s+r.noOf,0)}</td>
                            <td style={{padding:"10px 14px",fontWeight:800,fontSize:14,color:b.report.reduce((s,r)=>s+r.gross,0)>=0?"#4ade80":"#f87171"}}>₹{fmt(b.report.reduce((s,r)=>s+r.gross,0))}</td>
                            <td style={{padding:"10px 14px",fontWeight:800,fontSize:14,color:"#fbbf24"}}>₹{fmt(b.report.reduce((s,r)=>s+r.totalBrk,0))}</td>
                            <td style={{padding:"10px 14px",fontWeight:900,fontSize:16,color:b.net>=0?"#4ade80":"#f87171"}}>₹{fmt(b.net)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* ══════ SETTINGS TAB ══════ */}
        {tab==="Settings"&&(
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:20}}>
            <div style={{background:"rgba(59,130,246,0.05)",border:"1px solid rgba(59,130,246,0.2)",borderRadius:14,padding:24}}>
              <div style={{fontSize:11,color:"#60a5fa",fontWeight:700,letterSpacing:2,textTransform:"uppercase",marginBottom:16}}>🔵 NSE Brokerage</div>
              <label style={{fontSize:12,color:"#94a3b8",display:"block",marginBottom:6}}>Rate per Crore (₹)</label>
              <input type="number" value={nseRate} onChange={e=>setNseRate(parseFloat(e.target.value)||0)} style={{...inpLg,color:"#60a5fa",fontWeight:700}}/>
              <div style={{marginTop:14,background:"rgba(59,130,246,0.07)",border:"1px solid rgba(59,130,246,0.12)",borderRadius:8,padding:12,fontSize:12,color:"#94a3b8"}}>
                <code style={{color:"#7dd3fc"}}>Brk = Vol × (Rate ÷ 1,00,00,000)</code>
                <div style={{marginTop:6,color:"#64748b"}}>₹5,00,000 @ 3000 = <strong style={{color:"#4ade80"}}>₹150</strong></div>
              </div>
            </div>
            <div style={{background:"rgba(234,179,8,0.04)",border:"1px solid rgba(234,179,8,0.2)",borderRadius:14,padding:24}}>
              <div style={{fontSize:11,color:"#fbbf24",fontWeight:700,letterSpacing:2,textTransform:"uppercase",marginBottom:16}}>🟡 MCX Scripts</div>
              <div style={{display:"grid",gridTemplateColumns:"1.5fr 1fr 1fr 34px",gap:8,marginBottom:8}}>
                {["Script","Lot Qty","Rate/Lot ₹",""].map(h=><div key={h} style={{fontSize:10,color:"#fbbf24",fontWeight:700,textTransform:"uppercase"}}>{h}</div>)}
              </div>
              {mcxScripts.map((s,i)=>(
                <div key={i} style={{display:"grid",gridTemplateColumns:"1.5fr 1fr 1fr 34px",gap:8,marginBottom:7}}>
                  <input type="text" value={s.script} onChange={e=>updateMcx(i,"script",e.target.value.toUpperCase())} style={{...inp,color:"#fbbf24",fontWeight:700}} placeholder="SYMBOL"/>
                  <input type="number" value={s.lotQty} onChange={e=>updateMcx(i,"lotQty",parseFloat(e.target.value)||1)} style={inp}/>
                  <input type="number" value={s.rate} onChange={e=>updateMcx(i,"rate",parseFloat(e.target.value)||0)} style={{...inp,color:"#4ade80"}}/>
                  <button onClick={()=>removeMcx(i)} style={{...btn("rgba(220,38,38,0.08)","#f87171"),border:"1px solid rgba(220,38,38,0.2)",width:30,height:30,padding:0,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
                </div>
              ))}
              <button onClick={addMcx} style={{marginTop:8,background:"rgba(234,179,8,0.08)",border:"1px dashed rgba(234,179,8,0.3)",borderRadius:8,color:"#fbbf24",padding:"8px 16px",fontSize:12,fontWeight:600,cursor:"pointer",width:"100%"}}>+ Add MCX Script</button>
            </div>
          </div>
        )}

        {/* ══════ USERS TAB ══════ */}
        {tab==="Users"&&isAdmin&&(
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))",gap:20}}>
            <div style={{background:"rgba(99,102,241,0.05)",border:"1px solid rgba(99,102,241,0.2)",borderRadius:14,padding:24}}>
              <div style={{fontSize:11,color:"#a5b4fc",fontWeight:700,letterSpacing:2,textTransform:"uppercase",marginBottom:20}}>➕ Create New User</div>
              {[{l:"Full Name",f:"name",ph:"e.g. Rahul",t:"text"},{l:"Username",f:"username",ph:"e.g. rahul01",t:"text"},{l:"Password",f:"password",ph:"Min 4 chars",t:"password"}].map(({l,f,ph,t})=>(
                <div key={f} style={{marginBottom:14}}>
                  <label style={{fontSize:11,color:"#94a3b8",display:"block",marginBottom:5,fontWeight:600,textTransform:"uppercase"}}>{l}</label>
                  <input type={t} placeholder={ph} value={newUser[f]} onChange={e=>setNewUser(p=>({...p,[f]:e.target.value}))} style={inpLg}/>
                </div>
              ))}
              <div style={{marginBottom:16}}>
                <label style={{fontSize:11,color:"#94a3b8",display:"block",marginBottom:5,fontWeight:600,textTransform:"uppercase"}}>Role</label>
                <select value={newUser.role} onChange={e=>setNewUser(p=>({...p,role:e.target.value}))} style={{...inpLg,background:newUser.role==="ADMIN"?"rgba(168,85,247,0.2)":"rgba(59,130,246,0.2)",fontWeight:700}}>
                  <option value="USER">USER</option><option value="ADMIN">ADMIN</option>
                </select>
              </div>
              {userErr&&<div style={{color:"#f87171",fontSize:12,marginBottom:12,padding:"8px 12px",background:"rgba(220,38,38,0.08)",borderRadius:6}}>⚠ {userErr}</div>}
              <button onClick={createUser} disabled={userLoading} style={{...btn("linear-gradient(135deg,#4f46e5,#7c3aed)"),width:"100%",padding:"12px",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
                {userLoading?<><Spin s={16} c="white"/><span>Creating...</span></>:"Create User"}
              </button>
            </div>
            <div style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:14,padding:24}}>
              <div style={{fontSize:11,color:"#a5b4fc",fontWeight:700,letterSpacing:2,textTransform:"uppercase",marginBottom:20}}>👥 All Users ({users.length})</div>
              {users.map(u=>(
                <div key={u.id} style={{display:"flex",alignItems:"center",gap:8,padding:"10px 12px",background:"rgba(255,255,255,0.03)",border:`1px solid ${u.active===false?"rgba(220,38,38,0.2)":"rgba(255,255,255,0.06)"}`,borderRadius:10,marginBottom:10,flexWrap:"wrap"}}>
                  <div style={{width:36,height:36,background:`linear-gradient(135deg,${u.active===false?"#374151,#1f2937":u.role==="ADMIN"?"#7c3aed,#4f46e5":"#0369a1,#0284c7"})`,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,flexShrink:0,opacity:u.active===false?0.5:1}}>
                    {u.role==="ADMIN"?"👑":"👤"}
                  </div>
                  <div style={{flex:1,minWidth:80}}>
                    <div style={{fontWeight:700,color:u.active===false?"#475569":"white",fontSize:13}}>{u.name||u.username}</div>
                    <div style={{fontSize:11,color:"#64748b"}}>@{u.username}</div>
                  </div>
                  <span style={{background:u.role==="ADMIN"?"rgba(168,85,247,0.2)":"rgba(59,130,246,0.2)",color:u.role==="ADMIN"?"#c084fc":"#60a5fa",borderRadius:5,padding:"2px 7px",fontSize:10,fontWeight:700}}>{u.role}</span>
                  {u.id!==currentUser.id?(
                    <button onClick={()=>toggleUserActive(u)} style={{background:u.active===false?"rgba(220,38,38,0.12)":"rgba(22,163,74,0.12)",border:`1px solid ${u.active===false?"rgba(220,38,38,0.3)":"rgba(22,163,74,0.3)"}`,borderRadius:6,color:u.active===false?"#f87171":"#4ade80",padding:"3px 8px",fontSize:10,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>
                      {u.active===false?"⛔ Inactive":"✅ Active"}
                    </button>
                  ):<span style={{background:"rgba(22,163,74,0.1)",border:"1px solid rgba(22,163,74,0.2)",borderRadius:6,color:"#4ade80",padding:"3px 8px",fontSize:10,fontWeight:700}}>✅ You</span>}
                  <button onClick={()=>openChangePwd(u)} style={{...btn("rgba(99,102,241,0.15)","#a5b4fc"),border:"1px solid rgba(99,102,241,0.25)",fontSize:10,padding:"3px 8px"}}>🔑 Pwd</button>
                  <button onClick={()=>deleteUser(u.id)} disabled={u.id===currentUser.id} style={{...btn("rgba(220,38,38,0.08)","#f87171"),border:"1px solid rgba(220,38,38,0.2)",width:26,height:26,padding:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,opacity:u.id===currentUser.id?0.3:1}}>✕</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ══════ NEW WEEK MODAL ══════ */}
      {showNewWeek&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999,padding:16}} onClick={e=>e.target===e.currentTarget&&setShowNewWeek(false)}>
          <div className="mo" style={{background:"#0f172a",border:"1px solid rgba(99,102,241,0.3)",borderRadius:16,width:"100%",maxWidth:440,padding:32}}>
            <div style={{fontSize:16,fontWeight:800,marginBottom:4}}>📅 Create New Week</div>
            <div style={{fontSize:13,color:"#64748b",marginBottom:24}}>e.g. "Week 1 | 24 Feb – 28 Feb 2026"</div>
            <div style={{marginBottom:14}}>
              <label style={{fontSize:11,color:"#94a3b8",display:"block",marginBottom:5,fontWeight:600,textTransform:"uppercase"}}>Week Label *</label>
              <input type="text" placeholder="Week 1 | 24 Feb – 28 Feb 2026" value={newWeek.label} onChange={e=>setNewWeek(p=>({...p,label:e.target.value}))} style={inpLg}/>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
              <div>
                <label style={{fontSize:11,color:"#94a3b8",display:"block",marginBottom:5,fontWeight:600,textTransform:"uppercase"}}>Start Date</label>
                <input type="date" value={newWeek.start_date} onChange={e=>setNewWeek(p=>({...p,start_date:e.target.value}))} style={inpLg}/>
              </div>
              <div>
                <label style={{fontSize:11,color:"#94a3b8",display:"block",marginBottom:5,fontWeight:600,textTransform:"uppercase"}}>End Date</label>
                <input type="date" value={newWeek.end_date} onChange={e=>setNewWeek(p=>({...p,end_date:e.target.value}))} style={inpLg}/>
              </div>
            </div>
            {weekErr&&<div style={{color:"#f87171",fontSize:12,marginBottom:12,padding:"8px 12px",background:"rgba(220,38,38,0.08)",borderRadius:6}}>⚠ {weekErr}</div>}
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>{setShowNewWeek(false);setWeekErr("");}} style={{flex:1,...btn("rgba(255,255,255,0.06)","#94a3b8"),border:"1px solid rgba(255,255,255,0.1)"}}>Cancel</button>
              <button onClick={createWeek} style={{flex:2,...btn("linear-gradient(135deg,#4f46e5,#7c3aed)"),padding:"11px"}}>Create Week</button>
            </div>
          </div>
        </div>
      )}

      {/* ══════ EDIT BILL MODAL ══════ */}
      {editBill&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.9)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999,padding:16}} onClick={e=>e.target===e.currentTarget&&setEditBill(null)}>
          <div className="mo" style={{background:"#0f172a",border:"1px solid rgba(99,102,241,0.3)",borderRadius:16,width:"100%",maxWidth:1000,maxHeight:"90vh",display:"flex",flexDirection:"column"}}>
            <div style={{padding:"16px 22px",borderBottom:"1px solid rgba(255,255,255,0.07)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontSize:16,fontWeight:800}}>✏️ Edit Bill — {editBill.trader.name}</div>
                <div style={{fontSize:12,color:"#64748b",marginTop:3}}>{editBill.weekLabel} · {editBill.trades.length} trades</div>
              </div>
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>generateBillPDF(editBill.trader.name,editBill.weekLabel,editBill.trades,nseRate,mcxMap,pdfTheme)} style={{...btn("#0369a1"),fontSize:12,padding:"8px 14px"}}>⬇ PDF</button>
                <button onClick={()=>setEditBill(null)} style={{background:"rgba(255,255,255,0.07)",border:"none",borderRadius:8,color:"#94a3b8",width:32,height:32,fontSize:16,cursor:"pointer"}}>✕</button>
              </div>
            </div>
            <div style={{overflowY:"auto",flex:1}}>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:700}}>
                  <thead><tr style={{background:"rgba(99,102,241,0.15)"}}>
                    {["Date","Action","Qty","Price","Vol","Script","Type","Exchange","Brk",""].map(h=>(
                      <th key={h} style={{padding:"9px 11px",textAlign:"left",color:"#a5b4fc",fontWeight:700,fontSize:11,textTransform:"uppercase",whiteSpace:"nowrap"}}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {editBill.trades.map((t,i)=>(
                      <tr key={t.id} style={{borderTop:"1px solid rgba(255,255,255,0.04)",background:i%2===0?"transparent":"rgba(255,255,255,0.02)"}}>
                        {["trade_date","qty","price","script"].map(f=>(
                          <td key={f} style={{padding:"4px 6px"}}>
                            <input type={f==="qty"||f==="price"?"number":"text"} value={t[f]} step="0.01"
                              onChange={e=>{const v=e.target.value;setEditBill(prev=>{const ts=[...prev.trades];const tr={...ts[i],[f]:v};if(f==="qty"||f==="price"){const q=f==="qty"?parseFloat(v):parseFloat(tr.qty);const p=f==="price"?parseFloat(v):parseFloat(tr.price);tr.vol=!isNaN(q)&&!isNaN(p)?(q*p).toFixed(2):tr.vol;}ts[i]=tr;return {...prev,trades:ts};});}}
                              style={{...inp,width:"100%",fontSize:11,padding:"4px 6px"}}/>
                          </td>
                        ))}
                        <td style={{padding:"4px 6px",color:"#a5b4fc",fontSize:11,fontWeight:600}}>₹{fmt(parseFloat(t.vol))}</td>
                        <td style={{padding:"4px 6px"}}>
                          <select value={t.action} onChange={e=>{setEditBill(prev=>{const ts=[...prev.trades];ts[i]={...ts[i],action:e.target.value};return {...prev,trades:ts};});}} style={{...sel(t.action==="BUY"?"rgba(22,163,74,0.3)":"rgba(220,38,38,0.3)"),width:60,fontSize:11}}>
                            <option>BUY</option><option>SELL</option>
                          </select>
                        </td>
                        <td style={{padding:"4px 6px"}}>
                          <select value={t.type} onChange={e=>{setEditBill(prev=>{const ts=[...prev.trades];ts[i]={...ts[i],type:e.target.value};return {...prev,trades:ts};});}} style={{...sel(t.type==="FORWARD"?"rgba(168,85,247,0.25)":"rgba(255,255,255,0.06)"),width:80,fontSize:11}}>
                            <option>NORMAL</option><option>FORWARD</option>
                          </select>
                        </td>
                        <td style={{padding:"4px 6px"}}>
                          <select value={t.exchange} onChange={e=>{setEditBill(prev=>{const ts=[...prev.trades];ts[i]={...ts[i],exchange:e.target.value};return {...prev,trades:ts};});}} style={{...sel(t.exchange==="MCX"?"rgba(234,179,8,0.25)":"rgba(59,130,246,0.25)"),width:60,fontSize:11}}>
                            <option>NSE</option><option>MCX</option>
                          </select>
                        </td>
                        <td style={{padding:"4px 6px",color:"#fbbf24",fontSize:11,fontWeight:600,whiteSpace:"nowrap"}}>₹{fmt(calcBrk(t,nseRate,mcxMap))}</td>
                        <td style={{padding:"4px 6px"}}>
                          <button onClick={()=>setEditBill(prev=>({...prev,trades:prev.trades.filter((_,idx)=>idx!==i)}))} style={{...btn("rgba(220,38,38,0.1)","#f87171"),border:"1px solid rgba(220,38,38,0.2)",width:24,height:24,padding:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11}}>✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {/* Edit bill summary */}
            {(()=>{const r=buildReport(editBill.trades,nseRate,mcxMap);const g=r.reduce((s,x)=>s+x.gross,0),b=r.reduce((s,x)=>s+x.totalBrk,0),n=r.reduce((s,x)=>s+x.net,0);return(
              <div style={{padding:"12px 22px",borderTop:"1px solid rgba(255,255,255,0.07)",display:"flex",gap:20,alignItems:"center",flexWrap:"wrap",background:"rgba(0,0,0,0.2)"}}>
                <button onClick={()=>setEditBill(p=>({...p,trades:[...p.trades,{...blankTrade(),trader_id:editBill.trader.id}]}))} style={{...btn("rgba(99,102,241,0.15)","#a5b4fc"),border:"1px solid rgba(99,102,241,0.25)",fontSize:12}}>+ Add Row</button>
                <span style={{color:"#94a3b8",fontSize:13}}>Gross: <strong style={{color:"#e2e8f0"}}>₹{fmt(g)}</strong></span>
                <span style={{color:"#94a3b8",fontSize:13}}>Brk: <strong style={{color:"#fbbf24"}}>₹{fmt(b)}</strong></span>
                <strong style={{fontSize:15,color:n>=0?"#4ade80":"#f87171"}}>Net: ₹{fmt(n)} {n>=0?"▲":"▼"}</strong>
                <div style={{marginLeft:"auto",display:"flex",gap:10}}>
                  <button onClick={async()=>{
                    // Save edited trades back to DB
                    await supabase.from("trades").delete().eq("trader_id",editBill.trader.id).eq("week_id",billsWeek.id);
                    const ins=editBill.trades.map(t=>({id:t.id,trader_id:editBill.trader.id,week_id:billsWeek.id,trade_date:t.trade_date||"",action:t.action||"BUY",qty:parseFloat(t.qty)||0,price:parseFloat(t.price)||0,vol:parseFloat(t.vol)||0,script:(t.script||"").toUpperCase(),type:t.type||"NORMAL",exchange:t.exchange||"NSE",is_settlement:t.is_settlement||false,sort_order:t.sort_order||0}));
                    if(ins.length) await supabase.from("trades").insert(ins);
                    await loadBills(billsWeek);setEditBill(null);
                  }} style={{...btn("linear-gradient(135deg,#059669,#047857)"),fontSize:13}}>💾 Save Changes</button>
                </div>
              </div>
            );})()}
          </div>
        </div>
      )}

      {/* ══════ EXCEL PREVIEW ══════ */}
      {showPreview&&excelPreview&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999,padding:16}} onClick={e=>e.target===e.currentTarget&&setShowPreview(false)}>
          <div className="mo" style={{background:"#0f172a",border:"1px solid rgba(99,102,241,0.3)",borderRadius:16,width:"100%",maxWidth:940,maxHeight:"88vh",display:"flex",flexDirection:"column"}}>
            <div style={{padding:"16px 22px",borderBottom:"1px solid rgba(255,255,255,0.07)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div><div style={{fontSize:16,fontWeight:800}}>📤 Excel Import Preview</div><div style={{fontSize:12,color:"#64748b",marginTop:3}}>{excelPreview.length} rows · will be appended below existing trades</div></div>
              <button onClick={()=>setShowPreview(false)} style={{background:"rgba(255,255,255,0.07)",border:"none",borderRadius:8,color:"#94a3b8",width:32,height:32,fontSize:16,cursor:"pointer"}}>✕</button>
            </div>
            <div style={{overflowY:"auto",padding:"14px 18px",flex:1}}>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:600}}>
                  <thead><tr style={{background:"rgba(99,102,241,0.15)"}}>{["#","Date","Action","Qty","Price","Vol","Script","Type","Exchange"].map(h=><th key={h} style={{padding:"9px 11px",textAlign:"left",color:"#a5b4fc",fontWeight:700,fontSize:11,textTransform:"uppercase"}}>{h}</th>)}</tr></thead>
                  <tbody>{excelPreview.map((r,i)=>(
                    <tr key={i} style={{borderTop:"1px solid rgba(255,255,255,0.04)",background:i%2===0?"transparent":"rgba(255,255,255,0.02)"}}>
                      <td style={{padding:"8px 11px",color:"#475569"}}>{i+1}</td>
                      <td style={{padding:"8px 11px",color:"#cbd5e1"}}>{r.trade_date}</td>
                      <td style={{padding:"8px 11px"}}><span style={{background:r.action==="BUY"?"rgba(22,163,74,0.2)":"rgba(220,38,38,0.2)",color:r.action==="BUY"?"#4ade80":"#f87171",borderRadius:4,padding:"2px 8px",fontWeight:700,fontSize:11}}>{r.action}</span></td>
                      <td style={{padding:"8px 11px",color:"#fde68a"}}>{r.qty}</td>
                      <td style={{padding:"8px 11px",color:"#fde68a"}}>{r.price}</td>
                      <td style={{padding:"8px 11px",color:"#a5b4fc"}}>{r.vol?`₹${Number(r.vol).toLocaleString("en-IN")}`:"—"}</td>
                      <td style={{padding:"8px 11px",color:"#fbbf24",fontWeight:700}}>{r.script}</td>
                      <td style={{padding:"8px 11px"}}><span style={{background:r.type==="FORWARD"?"rgba(168,85,247,0.15)":"rgba(99,102,241,0.1)",color:r.type==="FORWARD"?"#c084fc":"#a5b4fc",borderRadius:4,padding:"2px 7px",fontSize:10,fontWeight:700}}>{r.type}</span></td>
                      <td style={{padding:"8px 11px",color:r.exchange==="MCX"?"#fbbf24":"#60a5fa",fontWeight:700}}>{r.exchange}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
            <div style={{padding:"14px 22px",borderTop:"1px solid rgba(255,255,255,0.07)",display:"flex",gap:10,justifyContent:"flex-end"}}>
              <button onClick={()=>setShowPreview(false)} style={{...btn("rgba(255,255,255,0.06)","#94a3b8"),border:"1px solid rgba(255,255,255,0.1)"}}>Cancel</button>
              <button onClick={confirmImport} style={{...btn("linear-gradient(135deg,#059669,#047857)"),padding:"10px 26px"}}>✓ Append {excelPreview.length} Rows</button>
            </div>
          </div>
        </div>
      )}

      {/* ══════ CHANGE PWD MODALS ══════ */}
      {showChangePwd&&changePwdTarget&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999,padding:16}} onClick={e=>e.target===e.currentTarget&&setShowChangePwd(false)}>
          <div className="mo" style={{background:"#0f172a",border:"1px solid rgba(99,102,241,0.3)",borderRadius:16,width:"100%",maxWidth:400,padding:32}}>
            <div style={{fontSize:16,fontWeight:800,marginBottom:4}}>🔑 Change Password</div>
            <div style={{fontSize:13,color:"#64748b",marginBottom:24}}>For: <strong style={{color:"#a5b4fc"}}>@{changePwdTarget.username}</strong></div>
            {[{l:"New Password",v:newPwd,s:setNewPwd,ph:"New password"},{l:"Confirm",v:confirmPwd,s:setConfirmPwd,ph:"Confirm"}].map(({l,v,s,ph})=>(
              <div key={l} style={{marginBottom:14}}>
                <label style={{fontSize:11,color:"#94a3b8",display:"block",marginBottom:5,fontWeight:600,textTransform:"uppercase"}}>{l}</label>
                <input type="password" placeholder={ph} value={v} onChange={e=>s(e.target.value)} style={inpLg}/>
              </div>
            ))}
            {pwdErr&&<div style={{color:"#f87171",fontSize:12,marginBottom:12,padding:"8px 12px",background:"rgba(220,38,38,0.08)",borderRadius:6}}>⚠ {pwdErr}</div>}
            {pwdSuccess&&<div style={{color:"#4ade80",fontSize:12,marginBottom:12,padding:"8px 12px",background:"rgba(22,163,74,0.08)",borderRadius:6}}>✓ {pwdSuccess}</div>}
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>setShowChangePwd(false)} style={{flex:1,...btn("rgba(255,255,255,0.06)","#94a3b8"),border:"1px solid rgba(255,255,255,0.1)"}}>Cancel</button>
              <button onClick={submitChangePwd} style={{flex:1,...btn("linear-gradient(135deg,#4f46e5,#7c3aed)"),padding:"11px"}}>Save</button>
            </div>
          </div>
        </div>
      )}
      {showSelfPwd&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999,padding:16}} onClick={e=>e.target===e.currentTarget&&setShowSelfPwd(false)}>
          <div className="mo" style={{background:"#0f172a",border:"1px solid rgba(99,102,241,0.3)",borderRadius:16,width:"100%",maxWidth:400,padding:32}}>
            <div style={{fontSize:16,fontWeight:800,marginBottom:24}}>🔑 Change My Password</div>
            {[{l:"Current",v:selfOldPwd,s:setSelfOldPwd,ph:"Current password"},{l:"New Password",v:selfNewPwd,s:setSelfNewPwd,ph:"New password"},{l:"Confirm New",v:selfConfirmPwd,s:setSelfConfirmPwd,ph:"Confirm"}].map(({l,v,s,ph})=>(
              <div key={l} style={{marginBottom:14}}>
                <label style={{fontSize:11,color:"#94a3b8",display:"block",marginBottom:5,fontWeight:600,textTransform:"uppercase"}}>{l}</label>
                <input type="password" placeholder={ph} value={v} onChange={e=>s(e.target.value)} style={inpLg}/>
              </div>
            ))}
            {selfPwdErr&&<div style={{color:"#f87171",fontSize:12,marginBottom:12,padding:"8px 12px",background:"rgba(220,38,38,0.08)",borderRadius:6}}>⚠ {selfPwdErr}</div>}
            {selfPwdSuccess&&<div style={{color:"#4ade80",fontSize:12,marginBottom:12,padding:"8px 12px",background:"rgba(22,163,74,0.08)",borderRadius:6}}>✓ {selfPwdSuccess}</div>}
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>setShowSelfPwd(false)} style={{flex:1,...btn("rgba(255,255,255,0.06)","#94a3b8"),border:"1px solid rgba(255,255,255,0.1)"}}>Cancel</button>
              <button onClick={submitSelfPwd} style={{flex:1,...btn("linear-gradient(135deg,#4f46e5,#7c3aed)"),padding:"11px"}}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
