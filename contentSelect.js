(() => {
  if (window.__HNE_PICKER_ACTIVE__) return;
  window.__HNE_PICKER_ACTIVE__ = true;

  const dpr = window.devicePixelRatio || 1;
  const overlay = document.createElement('div');
  overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(0,0,0,0.15)";
  document.documentElement.appendChild(overlay);

  const box = document.createElement('div');
  box.style.cssText = "position:fixed;border:2px solid #66ccff;background:rgba(16,32,44,0.25);pointer-events:none;left:0;top:0;width:0;height:0";
  overlay.appendChild(box);

  let start = null;
  const snap = v => Math.round(v/10)*10;

  function onDown(e){ start={x:e.clientX,y:e.clientY}; box.style.left=start.x+'px'; box.style.top=start.y+'px'; box.style.width='0px'; box.style.height='0px'; }
  function onMove(e){
    if(!start) return;
    let x=Math.min(start.x,e.clientX), y=Math.min(start.y,e.clientY);
    let w=Math.abs(e.clientX-start.x), h=Math.abs(e.clientY-start.y);
    if(e.shiftKey){ x=snap(x); y=snap(y); w=snap(w); h=snap(h); }
    box.style.left=x+'px'; box.style.top=y+'px'; box.style.width=w+'px'; box.style.height=h+'px';
  }
  function finish(ok){
    window.removeEventListener('mousedown', onDown, true);
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('mouseup', onUp, true);
    window.removeEventListener('keydown', onKey, true);
    overlay.remove();
    window.__HNE_PICKER_ACTIVE__ = false;
    if (!ok || !start) return;
    const r = box.getBoundingClientRect();
    chrome.runtime.sendMessage({
      type: 'HNE_SELECTION_DONE',
      rectCss: {x:r.left, y:r.top, w:r.width, h:r.height},
      dpr,
      viewport: { w: innerWidth, h: innerHeight },
      scroll: { x: scrollX, y: scrollY }
    });
  }
  function onUp(){ finish(true); }
  function onKey(e){ if (e.key === 'Escape') { e.preventDefault(); finish(false); } }

  window.addEventListener('mousedown', onDown, true);
  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('mouseup', onUp, true);
  window.addEventListener('keydown', onKey, true);
})();
