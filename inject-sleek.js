const WebSocket = require('ws');
const http = require('http');

const code = `
(function(){
  document.querySelectorAll('[data-modable]').forEach(el => el.remove());
  
  function getCurrentSong() {
    const widget = document.querySelector('[data-testid="now-playing-widget"]');
    if (!widget) return { title: 'No song playing', artist: '' };
    const els = widget.querySelectorAll('[dir="auto"]');
    return { title: els[0]?.textContent || 'Unknown', artist: els[1]?.textContent || '' };
  }
  
  function getAlbumArt() {
    const img = document.querySelector('[data-testid="now-playing-widget"] img');
    return img?.src || '';
  }
  
  function likeSong() {
    const likeBtn = document.querySelector('button[aria-label="Add to Liked Songs"]');
    if (likeBtn) { likeBtn.click(); return 'liked'; }
    const unlikeBtn = document.querySelector('button[aria-label="Remove from Liked Songs"]');
    if (unlikeBtn) return 'already';
    return 'notfound';
  }
  
  function skipTrack() {
    const btn = document.querySelector('[data-testid="control-button-skip-forward"]');
    if (btn) btn.click();
  }
  
  const song = getCurrentSong();
  const albumArt = getAlbumArt();
  
  const style = document.createElement('style');
  style.setAttribute('data-modable', 'style');
  style.textContent = \`
    @keyframes modableFadeIn {
      from { opacity: 0; transform: translateY(-10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .modable-panel {
      position: fixed;
      right: 24px;
      top: 80px;
      width: 320px;
      background: #282828;
      border-radius: 8px;
      z-index: 2147483647;
      color: white;
      font-family: 'Spotify Circular', 'Helvetica Neue', Helvetica, Arial, sans-serif;
      box-shadow: 0 16px 24px rgba(0,0,0,0.3), 0 6px 8px rgba(0,0,0,0.2);
      animation: modableFadeIn 0.2s ease-out;
      overflow: hidden;
    }
    .modable-header {
      background: linear-gradient(180deg, rgba(30,215,96,0.3) 0%, transparent 100%);
      padding: 16px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .modable-album {
      width: 48px;
      height: 48px;
      border-radius: 4px;
      background: #333;
      object-fit: cover;
    }
    .modable-info { flex: 1; min-width: 0; }
    .modable-label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #1ed760;
      margin-bottom: 4px;
    }
    .modable-title {
      font-size: 14px;
      font-weight: 700;
      color: #fff;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .modable-artist {
      font-size: 12px;
      color: #b3b3b3;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .modable-close {
      background: none;
      border: none;
      color: #b3b3b3;
      font-size: 20px;
      cursor: pointer;
      padding: 4px;
      border-radius: 50%;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
    }
    .modable-close:hover { background: rgba(255,255,255,0.1); color: #fff; }
    .modable-actions { padding: 8px; }
    .modable-btn {
      width: 100%;
      padding: 12px 16px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 12px;
      transition: all 0.15s;
      margin-bottom: 4px;
      font-family: inherit;
    }
    .modable-btn:last-child { margin-bottom: 0; }
    .modable-btn-icon {
      width: 20px;
      height: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
    }
    .modable-btn-primary {
      background: #1ed760;
      color: #000;
    }
    .modable-btn-primary:hover { background: #1fdf64; transform: scale(1.02); }
    .modable-btn-secondary {
      background: rgba(255,255,255,0.07);
      color: #fff;
    }
    .modable-btn-secondary:hover { background: rgba(255,255,255,0.1); }
    .modable-btn-danger {
      background: rgba(255,255,255,0.07);
      color: #f15e6c;
    }
    .modable-btn-danger:hover { background: rgba(241,94,108,0.1); }
    .modable-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
    .modable-footer {
      padding: 12px 16px;
      border-top: 1px solid rgba(255,255,255,0.1);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .modable-badge {
      background: #1ed760;
      color: #000;
      font-size: 9px;
      font-weight: 700;
      padding: 3px 6px;
      border-radius: 2px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .modable-powered {
      font-size: 11px;
      color: #6a6a6a;
    }
  \`;
  document.head.appendChild(style);
  
  const panel = document.createElement('div');
  panel.setAttribute('data-modable', 'rec-panel');
  panel.className = 'modable-panel';
  
  const placeholderImg = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect fill="#333" width="48" height="48"/><text x="24" y="30" text-anchor="middle" fill="#666" font-size="20">♪</text></svg>');
  
  panel.innerHTML = \`
    <div class="modable-header">
      <img class="modable-album" id="m-album" src="\${albumArt || placeholderImg}" alt="">
      <div class="modable-info">
        <div class="modable-label">Now Playing</div>
        <div class="modable-title" id="m-song-title">\${song.title}</div>
        <div class="modable-artist" id="m-song-artist">\${song.artist}</div>
      </div>
      <button class="modable-close" id="m-close">×</button>
    </div>
    <div class="modable-actions">
      <button class="modable-btn modable-btn-primary" id="m-like">
        <span class="modable-btn-icon">♥</span>
        <span>Save to Liked Songs</span>
      </button>
      <button class="modable-btn modable-btn-secondary" id="m-skip">
        <span class="modable-btn-icon">⏭</span>
        <span>Skip & Find Similar</span>
      </button>
      <button class="modable-btn modable-btn-danger" id="m-exclude">
        <span class="modable-btn-icon">⊘</span>
        <span>Exclude This Type</span>
      </button>
    </div>
    <div class="modable-footer">
      <span class="modable-badge">Modable</span>
      <span class="modable-powered">AI-powered recommendations</span>
    </div>
  \`;
  
  document.body.appendChild(panel);
  
  document.getElementById('m-close').onclick = () => {
    panel.remove();
    style.remove();
  };
  
  document.getElementById('m-like').onclick = function() { 
    const btn = this;
    const result = likeSong();
    const iconSpan = btn.querySelector('.modable-btn-icon');
    const textSpan = btn.querySelector('span:last-child');
    
    if (result === 'liked') {
      iconSpan.textContent = '✓';
      textSpan.textContent = 'Added to Liked Songs!';
    } else if (result === 'already') {
      textSpan.textContent = 'Already in Liked Songs';
    } else {
      textSpan.textContent = 'Play a song first';
    }
    setTimeout(() => { 
      iconSpan.textContent = '♥';
      textSpan.textContent = 'Save to Liked Songs';
    }, 2000); 
  };
  
  document.getElementById('m-skip').onclick = function() { 
    const textSpan = this.querySelector('span:last-child');
    const iconSpan = this.querySelector('.modable-btn-icon');
    skipTrack();
    iconSpan.textContent = '✓';
    textSpan.textContent = 'Finding similar...';
    setTimeout(() => {
      iconSpan.textContent = '⏭';
      textSpan.textContent = 'Skip & Find Similar';
    }, 1500);
  };
  
  document.getElementById('m-exclude').onclick = function() {
    const textSpan = this.querySelector('span:last-child');
    const iconSpan = this.querySelector('.modable-btn-icon');
    skipTrack();
    iconSpan.textContent = '✓';
    textSpan.textContent = 'Excluded from session';
    setTimeout(() => {
      iconSpan.textContent = '⊘';
      textSpan.textContent = 'Exclude This Type';
    }, 1500);
  };
  
  // Auto-update song info
  setInterval(() => {
    const s = getCurrentSong();
    const art = getAlbumArt();
    const titleEl = document.getElementById('m-song-title');
    const artistEl = document.getElementById('m-song-artist');
    const imgEl = document.getElementById('m-album');
    if (titleEl) titleEl.textContent = s.title;
    if (artistEl) artistEl.textContent = s.artist;
    if (imgEl && art) imgEl.src = art;
  }, 1000);
  
  console.log('Modable sleek panel injected!');
})();
`;

http.get('http://127.0.0.1:9222/json', (res) => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    const page = JSON.parse(data)[0];
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    
    ws.on('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: code } }));
    });
    
    ws.on('message', (m) => {
      const r = JSON.parse(m);
      if (r.result?.exceptionDetails) {
        console.log('Error:', r.result.exceptionDetails.text);
      } else {
        console.log('✓ Sleek panel injected!');
      }
      ws.close();
      process.exit(0);
    });
  });
}).on('error', (e) => {
  console.log('Connection error:', e.message);
  process.exit(1);
});
