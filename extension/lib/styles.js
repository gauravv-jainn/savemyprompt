/* Liquid Glass styles for the shadow-DOM panel injected into claude.ai /
   chatgpt.com. backdrop-filter frosts the real page behind the panel. */
window.SMP_CSS = `
:host, * { box-sizing: border-box; }
:host {
  --grad: linear-gradient(135deg, #f8ce57 0%, #f3ad3e 30%, #37bda9 100%);
  --teal: #2fb3a4;
  --ink: #1b1d21; --ink2: #565b64; --ink3: #8a909b;
  --glass: rgba(247,248,251,0.90);
  --glass-header: rgba(28,29,34,0.88);
  --card: rgba(255,255,255,0.66);
  --card-hover: rgba(255,255,255,0.9);
  --hair: rgba(255,255,255,0.55);
  --stroke: rgba(20,22,28,0.10);
  --font: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif;
  all: initial;
}
.wrap { position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647; font-family: var(--font); }

/* Collapsed tab on the right edge */
.fab {
  position: fixed; right: 0; top: 50%; transform: translateY(-50%);
  width: 44px; height: 108px; display: flex; align-items: center; justify-content: center;
  background: rgba(30,31,36,0.72); -webkit-backdrop-filter: saturate(180%) blur(20px); backdrop-filter: saturate(180%) blur(20px);
  border: 1px solid rgba(255,255,255,0.14); border-right: none; border-radius: 16px 0 0 16px;
  box-shadow: -8px 10px 30px rgba(12,14,20,0.34); cursor: pointer; transition: transform .15s ease;
}
.fab:hover { transform: translateY(-50%) translateX(-2px); }
.fab svg { width: 22px; height: 22px; }

/* Expanded panel */
.panel {
  position: fixed; right: 12px; top: 50%; transform: translateY(-50%);
  width: 372px; height: min(76vh, 720px); display: flex; flex-direction: column;
  background: var(--glass); -webkit-backdrop-filter: saturate(200%) blur(40px); backdrop-filter: saturate(200%) blur(40px);
  border: 1px solid rgba(255,255,255,0.4); border-radius: 24px; overflow: hidden;
  box-shadow: 0 28px 80px rgba(12,14,20,0.42), inset 0 1px 0 rgba(255,255,255,0.6);
  color: var(--ink); animation: slidein .22s cubic-bezier(.22,1,.36,1);
}
@keyframes slidein { from { opacity:0; transform: translateY(-50%) translateX(24px);} to { opacity:1; transform: translateY(-50%) translateX(0);} }
.hidden { display: none !important; }

.header { display:flex; align-items:center; gap:9px; padding:13px 15px; background: var(--glass-header);
  -webkit-backdrop-filter: blur(20px); backdrop-filter: blur(20px); color:#fff; border-bottom:1px solid rgba(255,255,255,0.08); }
.header .logo { display:flex; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.25)); }
.wordmark { font-weight:700; font-size:15px; letter-spacing:-.2px; }
.grow { flex:1; }
.iconbtn { border:none; background:transparent; color:inherit; width:28px; height:28px; display:inline-flex; align-items:center; justify-content:center; border-radius:9px; cursor:pointer; transition: background .12s; }
.iconbtn:hover { background: rgba(255,255,255,0.16); }
.iconbtn.dark:hover { background: rgba(20,22,28,0.06); }
.iconbtn svg { width:17px; height:17px; }
.gradient-text { background: var(--grad); -webkit-background-clip:text; background-clip:text; color:transparent; }

.body { flex:1; min-height:0; display:flex; flex-direction:column; }

.collect { display:flex; align-items:center; gap:12px; margin:12px 14px 4px; padding:13px 15px; width:calc(100% - 28px);
  border:1px solid rgba(255,255,255,0.6); border-radius:15px; background: rgba(255,255,255,0.42);
  box-shadow: 0 1px 2px rgba(15,17,22,0.05); cursor:pointer; text-align:left; font-family:var(--font); transition: transform .14s, box-shadow .14s, background .14s; }
.collect:active { transform: scale(.985); }
.collect.ready { background: var(--grad); border-color: rgba(255,255,255,0.35); box-shadow: 0 10px 26px rgba(242,161,60,0.28); }
.collect.ready:hover { transform: translateY(-1px); box-shadow: 0 12px 30px rgba(242,161,60,0.36); }
.collect .cico { display:flex; color: var(--teal); }
.collect.ready .cico { color:#fff; }
.collect .ctext { display:flex; flex-direction:column; gap:2px; min-width:0; }
.collect .ctitle { font-size:14px; font-weight:700; color:var(--ink); }
.collect .chint { font-size:11.5px; color:var(--ink3); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:255px; }
.collect.ready .ctitle, .collect.ready .chint { color:#fff; }
.collect.ready .chint { color: rgba(255,255,255,0.9); }

.searchbar { display:flex; align-items:center; gap:8px; margin:8px 14px 6px; padding:10px 12px;
  background: rgba(255,255,255,0.42); border:1px solid var(--hair); border-radius:13px; }
.searchbar svg { color: var(--ink3); }
.searchbar input { flex:1; border:none; background:transparent; outline:none; font-family:var(--font); font-size:13.5px; color:var(--ink); }
.searchbar input::placeholder { color: var(--ink3); }

.crumbs { padding:2px 16px; font-size:12px; color:var(--ink3); }
.crumbs:empty { display:none; }
.crumbs b { color: var(--ink); font-weight:700; }

.content { flex:1; min-height:0; overflow-y:auto; overflow-x:hidden; padding:6px 12px 8px; display:flex; flex-direction:column; gap:9px; }
.content::-webkit-scrollbar { width:8px; }
.content::-webkit-scrollbar-thumb { background: rgba(20,22,28,0.18); border-radius:8px; }

.row { display:flex; align-items:center; gap:12px; padding:12px 13px; background:var(--card); border:1px solid var(--hair);
  border-radius:14px; cursor:pointer; transition: background .14s, transform .14s; }
.row:hover { background:var(--card-hover); transform: translateY(-1px); }
.row .fico { flex:0 0 auto; filter: drop-shadow(0 2px 4px rgba(20,22,28,0.12)); }
.row .rtext { display:flex; flex-direction:column; gap:2px; min-width:0; }
.row .rtitle { font-size:14px; font-weight:600; display:flex; align-items:center; gap:8px; }
.row .rsub { font-size:12px; color:var(--ink3); }
.pill { font-size:11px; font-weight:700; color:var(--ink3); background:#fff; border:1px solid var(--stroke); border-radius:999px; padding:1px 7px; }

.grid { display:grid; grid-template-columns: repeat(3,1fr); gap:10px; }
.gcard { background:var(--card); border:1px solid var(--hair); border-radius:14px; aspect-ratio:1/1; display:flex; flex-direction:column;
  align-items:center; justify-content:center; gap:8px; padding:8px; cursor:pointer; text-align:center; transition: background .14s, transform .14s; }
.gcard:hover { background:var(--card-hover); transform: translateY(-2px); }
.gcard .glabel { font-size:11.5px; font-weight:600; line-height:1.25; max-height:2.5em; overflow:hidden; }
.gcard svg { filter: drop-shadow(0 2px 5px rgba(20,22,28,0.14)); }

.pcard { display:flex; gap:11px; background:var(--card); border:1px solid var(--hair); border-radius:14px; padding:12px 13px; align-items:flex-start; }
.pcard .ham { flex:0 0 auto; color:var(--ink3); margin-top:1px; display:flex; }
.pcard .pbody { flex:1; min-width:0; }
.pcard .ptitle { font-size:13px; font-weight:700; margin-bottom:3px; }
.pcard .ptext { font-size:12.5px; line-height:1.45; color:var(--ink2); white-space:pre-wrap; word-break:break-word; user-select:text; }
.pcard .ptext.clamp { display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
.pcard .prow2 { display:flex; align-items:center; gap:10px; margin-top:7px; flex-wrap:wrap; }
.more { font-size:12px; font-weight:700; cursor:pointer; }
.ptags { display:flex; flex-wrap:wrap; gap:5px; }
.ptag { font-size:10.5px; font-weight:600; color:var(--ink3); background:#fff; border:1px solid var(--stroke); border-radius:999px; padding:1px 7px; }
.copybtn { margin-left:auto; border:1px solid var(--stroke); background:#fff; border-radius:9px; padding:5px 8px; color:var(--ink2);
  cursor:pointer; display:inline-flex; align-items:center; gap:5px; font-size:11.5px; font-weight:600; }
.copybtn:hover { background: var(--card); }
.delbtn { border:none; background:transparent; color:var(--ink3); cursor:pointer; padding:4px; border-radius:7px; }
.delbtn:hover { color:#c0392b; background: rgba(192,57,43,0.08); }

.empty { text-align:center; color:var(--ink3); font-size:13px; padding:28px 20px; line-height:1.5; }
.link { font-size:13px; font-weight:700; cursor:pointer; align-self:center; padding:4px 6px; }

/* Preview / edit dialog overlay */
.overlay { position: fixed; inset:0; background: rgba(15,17,22,0.28); -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px);
  display:flex; align-items:center; justify-content:center; animation: fade .15s ease; }
@keyframes fade { from {opacity:0;} to {opacity:1;} }
.dialog { width:440px; max-width:92vw; max-height:88vh; display:flex; flex-direction:column; border-radius:22px; overflow:hidden;
  background: var(--glass); -webkit-backdrop-filter: saturate(200%) blur(40px); backdrop-filter: saturate(200%) blur(40px);
  border:1px solid rgba(255,255,255,0.4); box-shadow: 0 30px 90px rgba(12,14,20,0.5); }
.fields { padding:10px 16px; overflow-y:auto; display:flex; flex-direction:column; gap:13px; }
.eyebrow { font-size:12px; font-weight:700; letter-spacing:.4px; text-transform:uppercase; color:var(--ink3); }
.frow { display:flex; align-items:baseline; justify-content:space-between; padding:12px 16px 0; }
.src { font-size:12px; color:var(--ink3); }
.field { display:flex; flex-direction:column; gap:6px; }
.flabel { font-size:12px; font-weight:700; color:var(--ink2); }
.input { width:100%; border:1px solid var(--stroke); border-radius:12px; background: rgba(255,255,255,0.55); font-family:var(--font);
  font-size:13.5px; color:var(--ink); padding:11px 13px; outline:none; user-select:text; transition: border-color .14s, background .14s; }
.input:focus { border-color: var(--teal); background:#fff; box-shadow:0 0 0 3px rgba(55,189,169,0.16); }
textarea.input { resize:vertical; line-height:1.45; min-height:64px; }
.chips { display:flex; flex-wrap:wrap; gap:7px; }
.chip { display:inline-flex; align-items:center; gap:6px; padding:5px 10px; border-radius:999px; font-size:12px; font-weight:600; background:var(--card); }
.chip .x { cursor:pointer; opacity:.5; font-weight:700; }
.chip .x:hover { opacity:1; }
.chip.suggest { cursor:pointer; background: rgba(55,189,169,0.1); color:#2b8f84; border:1px dashed #b9e0d9; }
.footer { display:flex; gap:10px; padding:12px 16px 14px; border-top:1px solid var(--stroke); }
.btn { flex:1; border:none; border-radius:12px; padding:11px 14px; font-family:var(--font); font-size:14px; font-weight:700; cursor:pointer; transition: transform .12s; }
.btn:active { transform: scale(.98); }
.btn.ghost { background: var(--card); color: var(--ink2); flex:0 0 34%; }
.btn.primary { background: var(--grad); color:#fff; box-shadow: 0 6px 16px rgba(55,189,169,0.28); }

.toast { position: fixed; left:50%; bottom:28px; transform: translateX(-50%) translateY(10px); background: rgba(28,29,34,0.9);
  -webkit-backdrop-filter: blur(20px); backdrop-filter: blur(20px); color:#fff; font-size:12.5px; font-weight:600; padding:9px 15px;
  border-radius:999px; box-shadow:0 10px 30px rgba(12,14,20,0.4); opacity:0; pointer-events:none; transition: opacity .18s, transform .18s; }
.toast.show { opacity:1; transform: translateX(-50%) translateY(0); }

/* Per-message hover save button (floats at a message's corner) */
.hoverbtn { position: fixed; width: 30px; height: 30px; border-radius: 10px; z-index: 2147483647;
  background: rgba(255,255,255,0.62); -webkit-backdrop-filter: saturate(180%) blur(18px); backdrop-filter: saturate(180%) blur(18px);
  border: 1px solid rgba(255,255,255,0.7); box-shadow: 0 6px 18px rgba(12,14,20,0.28), inset 0 1px 0 rgba(255,255,255,0.7);
  display: flex; align-items: center; justify-content: center; cursor: pointer;
  opacity: 0; transform: scale(.6); pointer-events: none; transition: opacity .15s ease, transform .18s cubic-bezier(.34,1.6,.5,1); }
.hoverbtn.show { opacity: 1; transform: scale(1); pointer-events: auto; }
.hoverbtn:hover { background: rgba(255,255,255,0.8); transform: scale(1.1); box-shadow: 0 8px 22px rgba(12,14,20,0.32), 0 0 0 3px rgba(55,189,169,0.28); }
.hoverbtn svg { width: 17px; height: 17px; filter: drop-shadow(0 1px 2px rgba(20,22,28,0.18)); }

/* Top action buttons in the panel */
.actions { display: flex; gap: 8px; margin: 12px 14px 2px; }
.actionbtn { flex: 1; display: flex; align-items: center; justify-content: center; gap: 7px; padding: 11px 12px;
  border: 1px solid var(--hair); border-radius: 13px; background: rgba(255,255,255,0.42); color: var(--ink);
  font-family: var(--font); font-size: 13px; font-weight: 700; cursor: pointer; transition: background .14s, transform .14s; }
.actionbtn:hover { background: rgba(255,255,255,0.7); }
.actionbtn:active { transform: scale(.98); }
.actionbtn.primary { background: var(--grad); color: #fff; border-color: rgba(255,255,255,0.35); box-shadow: 0 8px 20px rgba(242,161,60,0.26); }
.actionbtn .aico { display: flex; }
.actionbtn.primary .aico { color: #fff; }
.actionbtn .aico { color: var(--teal); }

/* Scan list rows */
.scanhead { display: flex; align-items: center; gap: 8px; padding: 4px 4px 2px; }
.scanhead .count { font-size: 12px; color: var(--ink3); font-weight: 700; }
.scanhead .saveall { margin-left: auto; font-size: 12px; font-weight: 700; cursor: pointer; }
.scanrow { display: flex; gap: 10px; background: var(--card); border: 1px solid var(--hair); border-radius: 13px; padding: 10px 12px; align-items: flex-start; }
.scanrow .role { flex: 0 0 auto; font-size: 9px; font-weight: 800; letter-spacing: .3px; text-transform: uppercase; color: #fff;
  background: rgba(55,189,169,0.9); border-radius: 6px; padding: 2px 5px; margin-top: 1px; }
.scanrow .role.assistant { background: rgba(120,120,130,0.8); }
.scanrow .stext { flex: 1; min-width: 0; font-size: 12.5px; line-height: 1.4; color: var(--ink2); user-select: text;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.scanrow .ssave { flex: 0 0 auto; border: none; background: var(--grad); color: #fff; border-radius: 8px; padding: 5px 10px;
  font-size: 11.5px; font-weight: 700; cursor: pointer; align-self: center; }
`;

/* Page-scoped highlight class (injected into the page, not the shadow root). */
window.SMP_PAGE_CSS = `
.smp-hover-target { outline: 2px solid rgba(55,189,169,0.6) !important; outline-offset: 2px; border-radius: 8px; transition: outline-color .12s; }
`;
