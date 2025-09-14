// editor.js — pop-out glue (fullscreen button + rely on shared state)
(function () {
  'use strict';
  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('fullscreenBtn');
    if (btn) {
      btn.addEventListener('click', () => {
        if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(()=>{});
        else document.exitFullscreen().catch(()=>{});
      });
    }
    // No more work here: sidepanel.js restores the shared state and draws.
  }, { once:true });
})();
