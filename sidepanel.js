// sidepanel.js — stable editor core for Side Panel & Pop-out
(function () {
  'use strict';

  // ---------- tiny helpers
  const $ = (id) => document.getElementById(id);
  const on = (el, ev, fn, opts) => el && el.addEventListener(ev, fn, opts || false);
  const enable = (el, yes = true) => { if (el) el.disabled = !yes; };
  const deepClone = (x) => JSON.parse(JSON.stringify(x));
  const isEditor = () => location.pathname.endsWith('/editor.html');

  // ---------- DOM
  let c, ctx;
  let selectAreaBtn, captureBtn, fullPageBtn, uploadBtn, copyBtn, downloadBtn, printBtn, newTabBtn, expandBtn;
  let toolSel, colorInp, sizeInp, sizeVal, blurRange, blurVal, pixelRange, pixelVal, gridChk, snapChk, undoBtn, redoBtn, clearBtn;
  let zoomRange, zoomLabel;

  // ---------- state
  let img = new Image();
  let imgW = 0, imgH = 0;           // natural image size (px)
  let baseFit = 1;                  // fit to container (no CSS scaling)
  let zoom = isEditor() ? 2.0 : 1.0;
  let scale = 1;                    // baseFit * zoom (display px per image px)
  let shapes = [];
  const undoStack = [], redoStack = [];
  let drawing = false, curShape = null;

  // capture target window for select-area/full
  let lastTargetWindowId = null;

  // shared state (for pop-out sync)
  const instanceId = (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random());
  let saving = false;

  // ---------- init
  document.addEventListener('DOMContentLoaded', init, { once: true });

  async function init() {
    c = $('c'); if (!c) return console.error('[HNE] canvas missing');
    ctx = c.getContext('2d', { willReadFrequently: true });

    // Cache controls
    selectAreaBtn = $('selectAreaBtn');
    captureBtn    = $('captureBtn');
    fullPageBtn   = $('fullPageBtn');
    uploadBtn     = $('uploadBtn');
    copyBtn       = $('copyBtn');
    downloadBtn   = $('downloadBtn');
    printBtn      = $('printBtn');
    newTabBtn     = $('newTabBtn');
    expandBtn     = $('expandBtn');

    toolSel   = $('tool');
    colorInp  = $('color');
    sizeInp   = $('size');
    sizeVal   = $('sizeVal');
    blurRange = $('blurRange');
    blurVal   = $('blurVal');
    pixelRange= $('pixelRange');
    pixelVal  = $('pixelVal');
    gridChk   = $('gridChk');
    snapChk   = $('snapChk');
    undoBtn   = $('undoBtn');
    redoBtn   = $('redoBtn');
    clearBtn  = $('clearBtn');

    // Mirror control labels
    on(sizeInp,   'input', () => sizeVal  && (sizeVal.textContent  = sizeInp.value));
    on(blurRange, 'input', () => blurVal  && (blurVal.textContent  = `${blurRange.value}px`));
    on(pixelRange,'input', () => pixelVal && (pixelVal.textContent = `${pixelRange.value}`));
    if (sizeVal && sizeInp)  sizeVal.textContent = sizeInp.value;
    if (blurVal && blurRange)blurVal.textContent = `${blurRange.value}px`;
    if (pixelVal&& pixelRange)pixelVal.textContent= `${pixelRange.value}`;

    // Wire buttons
    on(captureBtn,    'click', () => captureVisible().catch(console.error));
    on(selectAreaBtn, 'click', () => selectArea().catch(console.error));
    on(fullPageBtn,   'click', () => fullPage().catch(console.error));

    on(downloadBtn, 'click', () => downloadImage().catch(console.error));
    on(copyBtn,     'click', () => copyImage().catch(console.error));
    on(printBtn,    'click', () => printImage().catch(console.error));
    on(newTabBtn,   'click', () => openImageTab().catch(console.error));
    on(expandBtn,   'click', () => { chrome.tabs.create({ url: chrome.runtime.getURL('editor.html') }); });

    on(undoBtn, 'click', () => { doUndo(); saveState('undo'); });
    on(redoBtn, 'click', () => { doRedo(); saveState('redo'); });
    on(clearBtn,'click', async () => { await clearAll(true); });

    // Draw interactions
    on(c,      'mousedown', startDraw);
    on(window, 'mousemove', moveDraw, { passive:false });
    on(window, 'mouseup',   endDraw);
    on(window, 'keydown',   keyHandler);

    // Messages (for area-select)
    chrome.runtime.onMessage.addListener(onSelectionMessage);

    // Not exported until an image is loaded
    setExportEnabled(false);

    // Zoom control (25–400%)
    injectZoom();

    // Try to restore last state (so pop-out has content)
    try {
      const v = await chrome.storage.session.get('HNE_STATE');
      const st = v && v.HNE_STATE;
      if (st && st.imgDataUrl) {
        await loadImageDataUrl(st.imgDataUrl, /*keepShapes=*/true);
        shapes = Array.isArray(st.shapes) ? deepClone(st.shapes) : [];
        if (st.ui?.zoom) setZoom(st.ui.zoom, /*noSave*/true);
      }
    } catch {}

    recomputeScale(); draw();
    on(window, 'resize', () => { recomputeScale(); draw(); });
  }

  //Other helpers

  function wipeCanvas() {
  if (!c || !ctx) return;
  // hard clear; keeps canvas element but blanks pixels
  c.width = Math.max(1, c.width);
  c.height = Math.max(1, c.height);
  ctx.clearRect(0, 0, c.width, c.height);
}

async function broadcastClearState() {
  const ui = {
    tool:  toolSel?.value || 'rect',
    color: colorInp?.value || '#66ccff',
    size:  Number(sizeInp?.value || 4),
    blur:  Number(blurRange?.value || 14),
    pixel: Number(pixelRange?.value || 8),
    grid:  !!gridChk?.checked,
    snap:  !!snapChk?.checked,
    zoom
  };
  await chrome.storage.session.set({
    HNE_STATE: {
      version: Date.now(),
      origin:  instanceId,
      imgDataUrl: '',
      imgW: 0,
      imgH: 0,
      shapes: [],
      ui
    }
  });
}


  // ---------- UI helpers
  function setExportEnabled(yes) {
    [uploadBtn, copyBtn, downloadBtn, printBtn, newTabBtn].forEach(b => enable(b, yes));
  }

  function injectZoom() {
    const tools = document.querySelector('.tools');
    if (!tools) return;
    const label = document.createElement('label');
    label.style.display = 'flex';
    label.style.alignItems = 'center';
    label.style.gap = '6px';
    label.innerHTML = `Zoom <input id="zoomRange" type="range" min="25" max="400" value="${Math.round(zoom*100)}" step="5"><span id="zoomVal" class="pill">${Math.round(zoom*100)}%</span>`;
    tools.appendChild(label);
    zoomRange = $('zoomRange'); zoomLabel = $('zoomVal');
    on(zoomRange, 'input', () => setZoom(Number(zoomRange.value)/100));
  }

  function setZoom(z, noSave=false){
    zoom = Math.min(4.0, Math.max(0.25, z));
    if (zoomRange) zoomRange.value = Math.round(zoom*100);
    if (zoomLabel) zoomLabel.textContent = `${Math.round(zoom*100)}%`;
    recomputeScale(); draw();
    if (!noSave) saveState('zoom');
  }

  // ---------- canvas sizing (NO CSS scaling)
  function recomputeScale(){
    if (!imgW) return;
    const containerW = Math.max(120, document.documentElement.clientWidth - 20);
    baseFit = containerW / imgW;
    scale   = baseFit * zoom;

    const displayW = Math.max(1, Math.round(imgW * scale));
    const displayH = Math.max(1, Math.round(imgH * scale));

    // Important: fix CSS size == pixel size so pointer math matches
    c.style.width  = displayW + 'px';
    c.style.height = displayH + 'px';
    c.width  = displayW;
    c.height = displayH;
  }

  // ---------- drawing
  function drawBase(){
    ctx.clearRect(0,0,c.width,c.height);
    if (!imgW) return;
    ctx.drawImage(img, 0,0,imgW,imgH, 0,0, c.width,c.height);

    if (gridChk?.checked) {
      const step = Math.max(10, Math.round(50 * scale));
      ctx.save(); ctx.strokeStyle = 'rgba(102,204,255,0.12)'; ctx.lineWidth = 1;
      for (let x=0; x<c.width; x+=step){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,c.height); ctx.stroke(); }
      for (let y=0; y<c.height; y+=step){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(c.width,y); ctx.stroke(); }
      ctx.restore();
    }
  }

  function drawShape(s){
    ctx.strokeStyle = s.color; ctx.fillStyle = s.color; ctx.lineWidth = Math.max(1, s.size*scale);
    if (['rect','blur','pixel'].includes(s.type)) {
      const [x,y,w,h] = s.pts; const X=x*scale, Y=y*scale, W=w*scale, H=h*scale;
      if (W < 1 || H < 1) return;
      if (s.type==='rect') {
        ctx.strokeRect(X+0.5, Y+0.5, W-1, H-1);
      } else if (s.type==='blur') {
        const sx = Math.max(1, Math.floor(W/8)), sy = Math.max(1, Math.floor(H/8));
        const off = new OffscreenCanvas(sx, sy); const octx = off.getContext('2d');
        octx.drawImage(c, X, Y, W, H, 0, 0, sx, sy);
        const p = new OffscreenCanvas(W, H); const pctx = p.getContext('2d');
        pctx.imageSmoothingEnabled = true; pctx.drawImage(off, 0, 0, W, H);
        ctx.drawImage(p, X, Y);
        ctx.strokeStyle = 'rgba(102,204,255,0.9)'; ctx.strokeRect(X+0.5, Y+0.5, W-1, H-1);
      } else { // pixel
        const px = Number(pixelRange?.value || 8);
        const sx = Math.max(1, Math.floor(W/px)), sy = Math.max(1, Math.floor(H/px));
        const off = new OffscreenCanvas(sx, sy); const octx = off.getContext('2d');
        octx.imageSmoothingEnabled = false; octx.drawImage(c, X,Y,W,H, 0,0,sx,sy);
        ctx.imageSmoothingEnabled = false; ctx.drawImage(off, 0,0, sx,sy, X,Y,W,H);
        ctx.imageSmoothingEnabled = true;
        ctx.strokeStyle = 'rgba(102,204,255,0.9)'; ctx.strokeRect(X+0.5,Y+0.5,W-1,H-1);
      }
    }
    if (s.type==='ellipse') {
      const [x,y,w,h]=s.pts; const X=x*scale, Y=y*scale, W=w*scale, H=h*scale;
      if (W < 1 || H < 1) return;
      ctx.beginPath(); ctx.ellipse(X+W/2, Y+H/2, Math.abs(W/2), Math.abs(H/2), 0, 0, Math.PI*2); ctx.stroke();
    }
    if (['line','arrow','pen'].includes(s.type)) {
      const pts = s.pts; if (pts.length<2) return;
      ctx.beginPath(); ctx.moveTo(pts[0].x*scale, pts[0].y*scale);
      for (let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x*scale, pts[i].y*scale);
      ctx.stroke();
      if (s.type==='arrow') {
        const a=pts[pts.length-2], b=pts[pts.length-1], ang=Math.atan2(b.y-a.y,b.x-a.x), head=10*scale+s.size;
        ctx.beginPath();
        ctx.moveTo(b.x*scale, b.y*scale);
        ctx.lineTo(b.x*scale - head*Math.cos(ang - Math.PI/6), b.y*scale - head*Math.sin(ang - Math.PI/6));
        ctx.moveTo(b.x*scale, b.y*scale);
        ctx.lineTo(b.x*scale - head*Math.cos(ang + Math.PI/6), b.y*scale - head*Math.sin(ang + Math.PI/6));
        ctx.stroke();
      }
    }
    if (s.type==='text' && s.text) {
      const [x,y]=s.pts; ctx.font = `${Math.max(10, s.size*6*scale)}px system-ui,Arial`; ctx.fillText(s.text, x*scale, y*scale);
    }
  }

  function draw(){
    drawBase();
    // already-added shapes
    for (const s of shapes) drawShape(s);
    // live preview of the in-progress shape (this is what you were missing)
    if (curShape) drawShape(curShape);
  }

  // ---------- edit ops
  function pushUndo(){ undoStack.push(deepClone(shapes)); if (undoStack.length>100) undoStack.shift(); redoStack.length=0; }
  function doUndo(){ if(!undoStack.length) return; redoStack.push(deepClone(shapes)); shapes = undoStack.pop(); draw(); }
  function doRedo(){ if(!redoStack.length) return; undoStack.push(deepClone(shapes)); shapes = redoStack.pop(); draw(); }
  async function clearAll(hard = false) {
  drawing = false; curShape = null;

  if (hard) {
    // full reset: image + shapes
    shapes = [];
    undoStack.length = 0;
    redoStack.length = 0;
    img = new Image();
    imgW = 0; imgH = 0;

    wipeCanvas();
    setExportEnabled(false);

    await broadcastClearState(); // sync other view
    return;
  }

  // legacy soft clear: annotations only
  if (!shapes.length) return;
  pushUndo(); shapes = []; draw();
  saveState('clear-shapes');
}


  // ---------- pointer helpers
  const snap = (v)=> snapChk?.checked ? Math.round(v/10)*10 : v;

  function startDraw(e){
    if(!imgW) return;
    pushUndo();
    const rect = c.getBoundingClientRect();
    const sx = (e.clientX - rect.left)/scale, sy=(e.clientY - rect.top)/scale;
    const type = toolSel?.value || 'rect';
    const col  = colorInp?.value || '#66ccff';
    const sz   = Number(sizeInp?.value || 4);

    if (['rect','ellipse','blur','pixel'].includes(type)) {
      curShape = { type, color:col, size:sz, pts:[snap(sx), snap(sy), 0, 0] };
    } else if (type==='text') {
      const text = prompt('Text:'); if(text){ shapes.push({ type, color:col, size:sz, text, pts:[snap(sx), snap(sy)] }); draw(); saveState('text'); }
      return;
    } else { // line/arrow/pen
      curShape = { type, color:col, size:sz, pts:[{x:snap(sx), y:snap(sy)}] };
    }
    drawing = true; draw();
  }

  function moveDraw(e){
    if(!drawing || !curShape) return;
    const rect = c.getBoundingClientRect();
    const sx = (e.clientX - rect.left)/scale, sy=(e.clientY - rect.top)/scale;
    if (['rect','ellipse','blur','pixel'].includes(curShape.type)) {
      const [x0,y0] = curShape.pts;
      curShape.pts = [x0,y0, snap(sx - x0), snap(sy - y0)];
    } else if (['line','arrow'].includes(curShape.type)) {
      curShape.pts[1] = { x:snap(sx), y:snap(sy) };
    } else if (curShape.type==='pen') {
      curShape.pts.push({ x:snap(sx), y:snap(sy) });
    }
    draw();
  }

  function endDraw(){
    if(!drawing) return;
    drawing = false;
    if (curShape) {
      if (['rect','ellipse','blur','pixel'].includes(curShape.type)) {
        let [x,y,w,h]=curShape.pts; if (w<0){x+=w;w=-w;} if (h<0){y+=h;h=-h;}
        curShape.pts = [x,y,w,h];
      }
      shapes.push(curShape); curShape=null; draw(); saveState('draw');
    }
  }

  function keyHandler(e){
    const k = e.key.toLowerCase();
    if ((e.ctrlKey||e.metaKey) && k==='z' && !e.shiftKey) { e.preventDefault(); doUndo(); saveState('undo'); return; }
    if ((e.ctrlKey&&k==='y') || ((e.ctrlKey||e.metaKey)&&k==='z'&&e.shiftKey)) { e.preventDefault(); doRedo(); saveState('redo'); return; }
    const map = { r:'rect', a:'arrow', e:'ellipse', l:'line', p:'pen', t:'text', b:'blur', x:'pixel' };
    if (!e.ctrlKey && !e.metaKey && map[k] && toolSel){ toolSel.value = map[k]; }
    if (!e.ctrlKey && !e.metaKey && (k==='=' || k==='+')) setZoom((zoom*100 + 10)/100);
    if (!e.ctrlKey && !e.metaKey && k==='-')               setZoom((zoom*100 - 10)/100);
  }

  // ---------- active content tab
  async function activeContentTab() {
    const [active] = await chrome.tabs.query({ active:true, lastFocusedWindow:true });
    if (active && /^https?:/i.test(active.url || '')) return active;
    const tabs = await chrome.tabs.query({});
    const t = tabs.find(t => /^https?:/i.test(t.url || ''));
    if (t) return t;
    alert('Open a regular web page first (http/https).');
    throw new Error('No content tab available');
  }

  // ---------- capture actions
  async function captureVisible(){
    const tab = await activeContentTab();
    lastTargetWindowId = tab.windowId;
    const dataUrl = await chrome.tabs.captureVisibleTab(lastTargetWindowId, { format:'png' });
    await loadImageDataUrl(dataUrl);
    await saveState('visible');
  }

  async function selectArea(){
    const tab = await activeContentTab();
    lastTargetWindowId = tab.windowId; // capture from THIS window
    await chrome.scripting.executeScript({
      target:{tabId:tab.id},
      func: () => {
        if (window.__HNE_PICKER_ACTIVE__) return;
        window.__HNE_PICKER_ACTIVE__ = true;
        const dpr = window.devicePixelRatio || 1;
        const overlay = document.createElement('div');
        overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(0,0,0,0.15)";
        document.documentElement.appendChild(overlay);
        const box = document.createElement('div');
        box.style.cssText = "position:fixed;border:2px solid #66ccff;background:rgba(16,32,44,0.25);pointer-events:none;left:0;top:0;width:0;height:0";
        overlay.appendChild(box);
        let start=null; const snap=v=>Math.round(v/10)*10;
        function onDown(e){ start={x:e.clientX,y:e.clientY}; Object.assign(box.style,{left:start.x+'px',top:start.y+'px',width:'0px',height:'0px'}); }
        function onMove(e){ if(!start) return; let x=Math.min(start.x,e.clientX), y=Math.min(start.y,e.clientY); let w=Math.abs(e.clientX-start.x), h=Math.abs(e.clientY-start.y);
          if(e.shiftKey){ x=snap(x); y=snap(y); w=snap(w); h=snap(h); } Object.assign(box.style,{left:x+'px',top:y+'px',width:w+'px',height:h+'px'}); }
        function finish(ok){
          window.removeEventListener('mousedown', onDown, true);
          window.removeEventListener('mousemove', onMove, true);
          window.removeEventListener('mouseup', onUp, true);
          window.removeEventListener('keydown', onKey, true);
          const r = box.getBoundingClientRect(); // read BEFORE remove
          overlay.remove(); window.__HNE_PICKER_ACTIVE__ = false;
          if (!ok || !start) return;
          chrome.runtime.sendMessage({ type:'HNE_SELECTION_DONE', rectCss:{x:r.left,y:r.top,w:r.width,h:r.height}, dpr });
        }
        function onUp(){ finish(true); }
        function onKey(e){ if(e.key==='Escape'){ e.preventDefault(); finish(false); } }
        window.addEventListener('mousedown', onDown, true);
        window.addEventListener('mousemove', onMove, true);
        window.addEventListener('mouseup', onUp, true);
        window.addEventListener('keydown', onKey, true);
      }
    });
  }

  async function onSelectionMessage(msg){
    if (msg?.type !== 'HNE_SELECTION_DONE') return;
    if (!lastTargetWindowId) {
      const [t] = await chrome.tabs.query({ active:true, lastFocusedWindow:true });
      lastTargetWindowId = t?.windowId ?? null;
    }
    if (!lastTargetWindowId) return;

    const dataUrl = await chrome.tabs.captureVisibleTab(lastTargetWindowId, { format:'png' });
    const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());

    const dpr = msg.dpr || 1;
    // Clamp crop to screenshot bounds (prevents 0×0 and out-of-range)
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const X = clamp(Math.round(msg.rectCss.x * dpr), 0, bmp.width - 1);
    const Y = clamp(Math.round(msg.rectCss.y * dpr), 0, bmp.height - 1);
    const W = clamp(Math.round(msg.rectCss.w * dpr), 1, bmp.width  - X);
    const H = clamp(Math.round(msg.rectCss.h * dpr), 1, bmp.height - Y);

    const oc = new OffscreenCanvas(W, H), octx = oc.getContext('2d');
    octx.drawImage(bmp, X, Y, W, H, 0, 0, W, H);
    const blob = await oc.convertToBlob({ type:'image/png' });
    await loadImageDataUrl(URL.createObjectURL(blob));
    await saveState('select');
  }

  async function fullPage(){
    const tab = await activeContentTab();
    lastTargetWindowId = tab.windowId;

    const [{result:m}] = await chrome.scripting.executeScript({
      target:{tabId:tab.id},
      func:()=>{ const b=document.scrollingElement||document.body;
        return { totalW:b.scrollWidth,totalH:b.scrollHeight, vw:innerWidth,vh:innerHeight, sx:scrollX, sy:scrollY }; }
    });

    const cols = Math.ceil(m.totalW / m.vw), rows = Math.ceil(m.totalH / m.vh);
    const off = new OffscreenCanvas(Math.max(1,m.totalW), Math.max(1,m.totalH));
    const octx = off.getContext('2d');

    for (let r=0;r<rows;r++){
      for (let c=0;c<cols;c++){
        const x = c*m.vw, y=r*m.vh;
        await chrome.scripting.executeScript({ target:{tabId:tab.id}, func:(x,y)=>window.scrollTo(x,y), args:[x,y] });
        await new Promise(res=>setTimeout(res, 120));
        const shot = await chrome.tabs.captureVisibleTab(lastTargetWindowId, { format:'png' });
        const bmp  = await createImageBitmap(await (await fetch(shot)).blob());
        const sw = Math.min(bmp.width,  m.vw), sh = Math.min(bmp.height, m.vh);
        octx.drawImage(bmp, 0,0, sw,sh, x,y, sw,sh);
      }
    }
    await chrome.scripting.executeScript({ target:{tabId:tab.id}, func:(x,y)=>window.scrollTo(x,y), args:[m.sx,m.sy] });

    const blob = await off.convertToBlob({type:'image/png'});
    await loadImageDataUrl(URL.createObjectURL(blob));
    await saveState('fullpage');
  }

  // ---------- image I/O
  async function loadImageDataUrl(dataUrl, keepShapes=false){
    await new Promise((res,rej)=>{ img.onload=res; img.onerror=rej; img.src=dataUrl; });
    imgW = img.naturalWidth; imgH = img.naturalHeight;
    if (!imgW || !imgH) return;
    if (!keepShapes) { shapes = []; undoStack.length=0; redoStack.length=0; }
    recomputeScale(); draw();
    setExportEnabled(true);
  }
  window.HNE_loadImageFromDataUrl = loadImageDataUrl; // for editor restore if needed

  async function renderFinal(fmt='image/png', q=0.92){
    if(!imgW) throw new Error('No image');
    const oc = new OffscreenCanvas(imgW, imgH);
    const octx=oc.getContext('2d'); octx.drawImage(img,0,0);

    for (const s of shapes) {
      octx.lineWidth = Math.max(1, s.size);
      octx.strokeStyle = s.color; octx.fillStyle = s.color; octx.imageSmoothingEnabled = true;

      if (s.type==='rect'){ const [x,y,w,h]=s.pts; if(w>0&&h>0) octx.strokeRect(x+0.5,y+0.5,w-1,h-1); }
      if (s.type==='ellipse'){ const [x,y,w,h]=s.pts; if(w>0&&h>0){ octx.beginPath(); octx.ellipse(x+w/2,y+h/2,Math.abs(w/2),Math.abs(h/2),0,0,Math.PI*2); octx.stroke(); } }
      if (['line','arrow','pen'].includes(s.type)){
        const pts=s.pts; if(pts.length>1){ octx.beginPath(); octx.moveTo(pts[0].x,pts[0].y); for (let i=1;i<pts.length;i++) octx.lineTo(pts[i].x,pts[i].y); octx.stroke();
          if (s.type==='arrow'){ const a=pts[pts.length-2], b=pts[pts.length-1], ang=Math.atan2(b.y-a.y,b.x-a.x), head=10+s.size;
            octx.beginPath();
            octx.moveTo(b.x,b.y); octx.lineTo(b.x - head*Math.cos(ang-Math.PI/6), b.y - head*Math.sin(ang-Math.PI/6));
            octx.moveTo(b.x,b.y); octx.lineTo(b.x - head*Math.cos(ang+Math.PI/6), b.y - head*Math.sin(ang+Math.PI/6));
            octx.stroke();
          }
        }
      }
      if (s.type==='text' && s.text){ octx.font = `${Math.max(10, s.size*6)}px system-ui,Arial`; octx.fillText(s.text, s.pts[0], s.pts[1]); }
      if (s.type==='blur'){
        const [x,y,w,h]=s.pts; if(w>0&&h>0){
          const px = Number(blurRange?.value || 14);
          octx.save(); octx.filter = `blur(${px}px)`; octx.beginPath(); octx.rect(x,y,w,h); octx.clip(); octx.drawImage(img,0,0); octx.restore();
          octx.strokeStyle='#66ccff'; octx.strokeRect(x+0.5,y+0.5,w-1,h-1);
        }
      }
      if (s.type==='pixel'){
        const [x,y,w,h]=s.pts; if(w>0&&h>0){
          const down = Math.max(1, Math.floor(Number(pixelRange?.value || 8)));
          const sx = Math.max(1, Math.floor(w/down)), sy = Math.max(1, Math.floor(h/down));
          const p = new OffscreenCanvas(sx,sy); const pctx=p.getContext('2d'); pctx.imageSmoothingEnabled=false;
          pctx.drawImage(img, x,y,w,h, 0,0,sx,sy);
          octx.imageSmoothingEnabled=false; octx.drawImage(p, 0,0, sx,sy, x,y,w,h); octx.imageSmoothingEnabled=true;
          octx.strokeStyle = '#66ccff'; octx.strokeRect(x+0.5,y+0.5,w-1,h-1);
        }
      }
    }
    return await oc.convertToBlob({ type: fmt, quality: fmt==='image/jpeg' ? q : undefined });
  }

  async function downloadImage(){
    const fmt = confirm('OK = PNG, Cancel = JPG') ? 'image/png' : 'image/jpeg';
    const blob = await renderFinal(fmt);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download=`redacted.${fmt==='image/png'?'png':'jpg'}`; a.click();
    setTimeout(()=>URL.revokeObjectURL(url),2000);
  }
  async function copyImage(){
    const blob = await renderFinal('image/png');
    await navigator.clipboard.write([ new ClipboardItem({ [blob.type]: blob }) ]);
    alert('Copied image to clipboard.');
  }
  async function printImage(){
    const blob = await renderFinal('image/png'); const url = URL.createObjectURL(blob);
    const w = window.open(url,'_blank'); setTimeout(()=>{ w?.print?.(); }, 400);
  }
  async function openImageTab(){
    const blob = await renderFinal('image/png'); const url = URL.createObjectURL(blob);
    window.open(url,'_blank');
  }

  // ---------- shared state (sync with pop-out)
  chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'session') return;
  const ch = changes.HNE_STATE; if (!ch) return;
  const st = ch.newValue; if (!st || st.origin === instanceId) return;

  // NEW: handle hard-clear coming from the other view
  if (!st.imgDataUrl) {
    img = new Image();
    imgW = 0; imgH = 0;
    shapes = [];
    wipeCanvas();
    setExportEnabled(false);
    // still apply UI prefs if you like:
    if (toolSel && st.ui?.tool) toolSel.value = st.ui.tool;
    if (colorInp && st.ui?.color) colorInp.value = st.ui.color;
    if (Number.isFinite(st.ui?.zoom)) setZoom(st.ui.zoom, /*noSave*/true);
    return;
  }

  // ...your existing “load image + shapes + UI” logic...
});


  async function saveState(reason){
    if (!imgW || saving) return;
    const state = {
      version: Date.now(),
      origin: instanceId,
      imgDataUrl: img.src,
      imgW, imgH,
      shapes,
      ui: {
        tool: toolSel?.value || 'rect',
        color: colorInp?.value || '#66ccff',
        size: Number(sizeInp?.value || 4),
        blur: Number(blurRange?.value || 14),
        pixel: Number(pixelRange?.value || 8),
        grid: !!gridChk?.checked,
        snap: !!snapChk?.checked,
        zoom
      }
    };
    saving = true;
    await chrome.storage.session.set({ HNE_STATE: state });
    saving = false;
  }

})();
