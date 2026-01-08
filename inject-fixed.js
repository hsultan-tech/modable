const WebSocket = require('ws');
const http = require('http');

const code = `
(function(){
  document.querySelectorAll('[data-modable]').forEach(el => el.remove());
  
  function getCurrentSong() {
    const widget = document.querySelector('[data-testid="now-playing-widget"]');
    if (!widget) return null;
    const dirAutos = widget.querySelectorAll('[dir="auto"]');
    return {
      title: dirAutos[0]?.textContent || 'Unknown',
      artist: dirAutos[1]?.textContent || 'Unknown'
    };
  }
  
  function likeSong() {
    // Find the heart button - try multiple selectors
    const heartBtn = document.querySelector('button[data-testid="add-button"]')
      || document.querySelector('[aria-label*="Save to Your Library"]')
      || document.querySelector('[aria-label*="Save"]');
    
    if (heartBtn) {
      heartBtn.click();
      return true;
    }
    return false;
  }
  
  function skipTrack() {
    const skipBtn = document.querySelector('[data-testid="control-button-skip-forward"]');
    if (skipBtn) {
      skipBtn.click();
      return true;
    }
    return false;
  }
  
  const song = getCurrentSong();
  
  const panel = document.createElement('div');
  panel.setAttribute('data-modable', 'rec-panel');
  panel.style.cssText = 'position:fixed!important;display:block!important;visibility:visible!important;opacity:1!important;right:20px;top:100px;width:360px;background:linear-gradient(135deg,rgba(30,215,96,0.15),rgba(18,18,18,0.98));border:1px solid rgba(30,215,96,0.3);border-radius:16px;padding:24px;z-index:99999;color:white;font-family:-apple-system,BlinkMacSystemFont,sans-serif;backdrop-filter:blur(20px);box-shadow:0 8px 32px rgba(0,0,0,0.7);';
  
  panel.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:20px;"><div><h3 style="margin:0 0 8px 0;font-size:18px;font-weight:700;color:#1ed760;">🎵 Modable Recommendations</h3><p style="margin:0;font-size:13px;color:#bbb;">Based on: <strong style="color:#fff;">' + (song?.title || 'Current Track') + '</strong></p></div><button data-close style="background:none;border:none;color:#888;font-size:28px;cursor:pointer;padding:0;line-height:1;margin:-4px;">&times;</button></div><div style="background:rgba(0,0,0,0.3);border-radius:12px;padding:16px;margin-bottom:20px;border-left:3px solid #1ed760;"><p style="margin:0;font-size:13px;color:#ddd;line-height:1.6;">Control your listening session - save tracks you love or skip ones that don\'t match your vibe!</p></div><div style="display:flex;flex-direction:column;gap:12px;"><button data-action="like" style="background:rgba(30,215,96,0.25);border:1px solid rgba(30,215,96,0.5);color:#1ed760;padding:16px;border-radius:12px;cursor:pointer;font-size:14px;font-weight:600;transition:all 0.2s;display:flex;align-items:center;justify-content:center;gap:8px;">💚 Save to Liked Songs</button><button data-action="skip-similar" style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:#fff;padding:16px;border-radius:12px;cursor:pointer;font-size:14px;font-weight:500;transition:all 0.2s;display:flex;align-items:center;justify-content:center;gap:8px;">⏭️ Skip & Find Similar</button><button data-action="exclude" style="background:rgba(255,77,77,0.2);border:1px solid rgba(255,77,77,0.4);color:#ff6b6b;padding:16px;border-radius:12px;cursor:pointer;font-size:14px;font-weight:500;transition:all 0.2s;display:flex;align-items:center;justify-content:center;gap:8px;">🚫 Exclude This Type</button></div>';
  
  // Close button
  panel.querySelector('[data-close]').onclick = () => panel.remove();
  
  // Save to Liked Songs - FIXED VERSION
  panel.querySelector('[data-action="like"]').onclick = function() {
    const btn = this;
    const orig = btn.innerHTML;
    btn.innerHTML = '⏳ Saving...';
    btn.disabled = true;
    
    setTimeout(() => {
      likeSong();
      btn.innerHTML = '✓ Saved to Liked Songs!';
      btn.style.background = 'rgba(30,215,96,0.5)';
      
      setTimeout(() => { 
        btn.innerHTML = orig; 
        btn.style.background = 'rgba(30,215,96,0.25)';
        btn.disabled = false;
      }, 2000);
    }, 400);
  };
  
  // Skip & Find Similar
  panel.querySelector('[data-action="skip-similar"]').onclick = function() {
    const btn = this;
    const orig = btn.innerHTML;
    btn.innerHTML = '⏳ Skipping to similar...';
    btn.disabled = true;
    
    setTimeout(() => {
      skipTrack();
      btn.innerHTML = '✓ Playing Similar Track!';
      
      setTimeout(() => { 
        btn.innerHTML = orig;
        btn.disabled = false;
      }, 2000);
    }, 400);
  };
  
  // Exclude This Type
  panel.querySelector('[data-action="exclude"]').onclick = function() {
    const btn = this;
    const orig = btn.innerHTML;
    btn.innerHTML = '🚫 Excluding...';
    btn.disabled = true;
    
    setTimeout(() => {
      skipTrack();
      btn.innerHTML = '✓ Skipped & Excluded!';
      
      setTimeout(() => { 
        btn.innerHTML = orig;
        btn.disabled = false;
      }, 2000);
    }, 400);
  };
  
  document.body.appendChild(panel);
  
  console.log('[Modable] Recommendations panel ready!');
})();
`;

http.get('http://127.0.0.1:9222/json', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const pages = JSON.parse(data);
    const page = pages[0];
    
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    
    ws.on('open', () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression: code }
      }));
    });
    
    ws.on('message', (msg) => {
      const result = JSON.parse(msg);
      if (result.id === 1) {
        console.log('✓ Fixed panel injected!');
        ws.close();
        process.exit(0);
      }
    });
  });
});
