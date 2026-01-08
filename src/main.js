import './style.css';
import './mobile.css'; // Mobile optimizations
import { GoobyGame } from './game.js';
import { NetworkManager } from './network.js';
import { CookieConsent } from './cookieConsent.js';
import { SoundManager } from './audio.js';
import './keepalive.js'; // Prevent Render.com sleep

// VSync Warmup removed to prevent thread contention with Attract Mode initialization.
// The game loop itself serves as sufficient warmup.

const app = document.querySelector('#app');

// State (Global for Network Access)
window.state = {
  player: {
    name: localStorage.getItem('ba_name') || 'Player',
    color: localStorage.getItem('ba_color') || '#ff5733',
    face: localStorage.getItem('ba_face') || 'normal',
    hat: localStorage.getItem('ba_hat') || 'none'
  },
  // MULTIPLAYER STATE
  lobby: {
    id: null,
    isHost: false,
    players: [], // { id, name, color, face, hat, isHost, ping }
    messages: []
  },
  network: {} // Empty object instead of null
};

// Local alias for convenience
const state = window.state;

// SECURITY: XSS Sanitizer
const escapeHtml = (text) => {
  return text ? String(text).replace(/[&<>"']/g, function (m) {
    switch (m) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#039;';
    }
  }) : '';
};

// Global Instance
window.gameInstance = null;
window.networkManager = new NetworkManager(); // Auto-connect to Signalling

function renderMainMenu() {
  window.renderMainMenu = renderMainMenu; // Ensure global access
  // FORCE GLOBAL CSS RESETS
  document.documentElement.style.margin = '0';
  document.documentElement.style.padding = '0';
  document.documentElement.style.overflow = 'hidden';

  document.body.style.margin = '0';
  document.body.style.padding = '0';
  document.body.style.overflow = 'hidden';
  document.body.style.display = 'block';

  // Reset App Container (Canvas Holder)
  app.innerHTML = '';
  app.removeAttribute('style');
  Object.assign(app.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '100%',
    height: '100%',
    margin: '0',
    padding: '0',
    zIndex: '1',
    display: 'block'
  });

  // Check if game instance is running and stop it
  if (window.gameInstance) {
    if (typeof window.gameInstance.destroy === 'function') window.gameInstance.destroy();
    else if (typeof window.gameInstance.stop === 'function') window.gameInstance.stop();
    window.gameInstance = null;
  }

  // Cleanup Network Session (Leave Room but keep Socket)
  if (window.networkManager) {
    if (typeof window.networkManager.leaveSession === 'function') {
      window.networkManager.leaveSession();
    }
    // Delay refresh to allow server to process leaveRoom
    setTimeout(() => {
      if (window.networkManager && typeof window.networkManager.refreshList === 'function') {
        window.networkManager.refreshList();
      }
    }, 200);
  }

  // START ATTRACT MODE (Background Animation)
  let attractGame;
  try {
    attractGame = new GoobyGame(() => { });
    window.attractGame = attractGame; // GLOBAL EXPOSURE FOR CLEANUP

    // CRITICAL: Set attract mode BEFORE init (so quit button logic sees it)
    attractGame.attractMode = true;
    attractGame.mapType = 'CLASSIC';
    attractGame.hasHole = false;
    attractGame.deathZonePercent = 0;

    attractGame.init(app, { name: 'Demo', color: '#888888', face: 0 });

    // CRITICAL: Force resize to ensure canvas has correct dimensions
    attractGame.resize();
    attractGame.width = window.innerWidth;
    attractGame.height = window.innerHeight;
    // EXTRA SAFETY: Force canvas buffer size
    if (attractGame.canvas) {
      attractGame.canvas.width = window.innerWidth;
      attractGame.canvas.height = window.innerHeight;
      attractGame.canvas.style.width = '100%';
      attractGame.canvas.style.height = '100%';
    }

    // PERFORMANCE: Force Low Quality for Attract Mode
    attractGame.quality = 0;

    // Ensure player exists (for bot AI)
    if (!attractGame.player) {
      attractGame.spawnPlayer({ name: 'DemoBot', color: '#888888' });
    }

    // Spawn multiple bots for visual effect
    attractGame.enemies = [];

    // Limits max background Goobys to 2 (optimized for FPS)
    for (let i = 0; i < 2; i++) {
      attractGame.spawnBot();
    }

    // Start game loop AFTER spawning
    attractGame.roundActive = true;
    requestAnimationFrame(() => attractGame.loop());

    window.gameInstance = attractGame;
    window.attractGame = attractGame; // Store for later

    // Audio - Resume on user interaction
    const resumeAudioOnInteraction = () => {
      if (attractGame.audio) {
        attractGame.audio.resumeAudio();
        // Menu music disabled as per request
      }
    };
    document.addEventListener('click', resumeAudioOnInteraction, { once: true });
    document.addEventListener('keydown', resumeAudioOnInteraction, { once: true });

  } catch (err) {
  }

  // REMOVE OLD UI LAYER IF EXISTS
  const oldUI = document.getElementById('gooby-arena-ui-layer');
  if (oldUI) oldUI.remove();

  // UI LAYER (Append to BODY to be safe from App/Canvas stacking)
  const uiLayer = document.createElement('div');
  uiLayer.id = 'gooby-arena-ui-layer';
  Object.assign(uiLayer.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '100%',
    height: '100%',
    zIndex: '9999',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    pointerEvents: 'none' // Click-through empty space
  });

  const colors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#d946ef', '#f43f5e', '#64748b', '#1e293b', '#ffffff'];

  // HTML-Based Face Definitions (CSS Classes could be better but inline is easier for dynamic injection here)
  const faceDefs = {
    'normal': `<div style="display:flex; gap:20px;"><div style="width:12px; height:20px; background:black; border-radius:50%;"></div><div style="width:12px; height:20px; background:black; border-radius:50%;"></div></div><div style="width:20px; height:10px; border-bottom:3px solid black; border-radius:50%; margin-top:5px;"></div>`,
    'angry': `<div style="display:flex; gap:15px; align-items:flex-end;"><div style="width:15px; height:8px; background:black; transform:rotate(20deg);"></div><div style="width:15px; height:8px; background:black; transform:rotate(-20deg);"></div></div><div style="width:20px; height:10px; border-top:3px solid black; border-radius:50%; margin-top:10px;"></div>`,
    'happy': `<div style="display:flex; gap:20px;"><div style="width:15px; height:15px; border-top:4px solid black; border-radius:50%;"></div><div style="width:15px; height:15px; border-top:4px solid black; border-radius:50%;"></div></div><div style="width:20px; height:15px; background:black; border-bottom-left-radius:10px; border-bottom-right-radius:10px; margin-top:5px;"></div>`,
    'dead': `<div style="display:flex; gap:20px; font-family:monospace; font-weight:bold; font-size:24px;"><span>X</span><span>X</span></div><div style="width:15px; height:5px; background:black; margin-top:10px;"></div>`,
    'cyclops': `<div style="width:30px; height:30px; background:white; border:4px solid black; border-radius:50%; display:flex; align-items:center; justify-content:center;"><div style="width:10px; height:10px; background:black; border-radius:50%;"></div></div>`,
    'ninja': `<div style="width:90%; height:40px; background:#1e293b; position:absolute; top:30px; z-index:1;"></div><div style="display:flex; gap:25px; z-index:2; position:relative; top:-5px;"><div style="width:15px; height:5px; background:white;"></div><div style="width:15px; height:5px; background:white;"></div></div>`
  };

  const hatDefs = {
    'none': '',
    'crown': '👑',
    'bow': '🎀',
    'sunglasses': '🕶️',
    'hat': '🧢',
    'horns': '😈',
    'halo': '😇',
    'mask': '😷',
    'cowboy': '🤠'
  };

  // CONTENT WRAPPER

  // ██████╗ ███████╗██╗  ██╗██╗      █████╗ ███╗   ███╗    ███████╗██╗      ██████╗ ████████╗
  // ██╔══██╗██╔════╝██║ ██╔╝██║     ██╔══██╗████╗ ████║    ██╔════╝██║     ██╔═══██╗╚══██╔══╝
  // ██████╔╝█████╗  █████╔╝ ██║     ███████║██╔████╔██║    ███████╗██║     ██║   ██║   ██║   
  // ██╔══██╗██╔══╝  ██╔═██╗ ██║     ██╔══██║██║╚██╔╝██║    ╚════██║██║     ██║   ██║   ██║   
  // ██║  ██║███████╗██║  ██╗███████╗██║  ██║██║ ╚═╝ ██║    ███████║███████╗╚██████╔╝   ██║   
  // ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝    ╚══════╝╚══════╝ ╚═════╝    ╚═╝   
  //
  // 🔍 SEARCH FOR: "INSERT_AD_HERE" TO FIND ALL AD SLOTS
  // 📦 BOTTOM BANNER: 728x90 (Desktop) / 320x50 (Mobile)

  const adContainer = document.createElement('div');
  adContainer.id = 'ad-banner-main';
  adContainer.className = 'ad-slot';
  Object.assign(adContainer.style, {
    position: 'absolute',
    bottom: '10px',
    left: '50%',
    transform: 'translateX(-50%)',
    width: '728px',
    height: '90px',
    background: 'transparent',
    border: 'none',
    display: 'none', // HIDDEN BY DEFAULT - only show when ad script loads content
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: '10',
    pointerEvents: 'auto'
  });

  // Responsive sizing
  if (window.innerWidth < 740) {
    adContainer.style.width = '320px';
    adContainer.style.height = '50px';
  }

  // ╔══════════════════════════════════════════════════════════════╗
  // ║  INSERT_AD_HERE: BOTTOM BANNER AD CODE                       ║
  // ║  Size: 728x90 (Desktop) / 320x50 (Mobile)                    ║
  // ║  Example: Google AdSense, custom banner, etc.                ║
  // ║                                                               ║
  // ║  PASTE YOUR AD CODE BELOW THIS LINE:                         ║
  // ╚══════════════════════════════════════════════════════════════╝

  // adContainer.innerHTML = 'YOUR AD CODE HERE';

  uiLayer.appendChild(adContainer);

  // ██╗   ██╗███████╗██████╗ ████████╗██╗ ██████╗ █████╗ ██╗         █████╗ ██████╗ ███████╗
  // ██║   ██║██╔════╝██╔══██╗╚══██╔══╝██║██╔════╝██╔══██╗██║        ██╔══██╗██╔══██╗██╔════╝
  // ██║   ██║█████╗  ██████╔╝   ██║   ██║██║     ███████║██║        ███████║██║  ██║███████╗
  // ╚██╗ ██╔╝██╔══╝  ██╔══██╗   ██║   ██║██║     ██╔══██║██║        ██╔══██║██║  ██║╚════██║
  //  ╚████╔╝ ███████╗██║  ██║   ██║   ██║╚██████╗██║  ██║███████╗   ██║  ██║██████╔╝███████║
  //   ╚═══╝  ╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝ ╚═════╝╚═╝  ╚═╝╚══════╝   ╚═╝  ╚═╝╚═════╝ ╚══════╝
  //
  // 🔍 SEARCH FOR: "INSERT_AD_HERE" TO FIND ALL AD SLOTS
  // 📦 SKYSCRAPER ADS: 160x600 (Left & Right)

  const createSkyscraper = (side) => {
    const el = document.createElement('div');
    el.id = `ad-sky-${side}`;
    el.className = 'ad-slot';
    Object.assign(el.style, {
      position: 'absolute',
      top: '50%',
      transform: 'translateY(-50%)',
      width: '160px',
      height: '600px',
      background: 'transparent',
      border: 'none',
      display: 'none', // HIDDEN BY DEFAULT
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: '10',
      pointerEvents: 'auto'
    });
    if (side === 'left') el.style.left = '20px';
    else el.style.right = '20px';

    // ╔══════════════════════════════════════════════════════════════╗
    // ║  INSERT_AD_HERE: VERTICAL SKYSCRAPER AD CODE                 ║
    // ║  Size: 160x600                                                ║
    // ║  Side: ${side.toUpperCase()} (Left or Right)                 ║
    // ║                                                               ║
    // ║  PASTE YOUR AD CODE BELOW THIS LINE:                         ║
    // ╚══════════════════════════════════════════════════════════════╝

    // el.innerHTML = 'YOUR AD CODE HERE';

    return el;
  };

  uiLayer.appendChild(createSkyscraper('left'));
  uiLayer.appendChild(createSkyscraper('right'));

  // END OF AD SLOTS - Search "INSERT_AD_HERE" to modify ads

  const chatContainer = document.createElement('div');
  Object.assign(chatContainer.style, {
    position: 'absolute',
    top: '50%',
    left: '200px', // Space reserved for potential left ad (even if hidden) skyscraper (20px + 160px + 20px gap)
    transform: 'translateY(-50%)',
    width: '260px',
    height: '400px', // Taller for better chat view
    background: 'rgba(15, 23, 42, 0.8)',
    backdropFilter: 'blur(10px)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '12px',
    display: 'flex',
    flexDirection: 'column',
    zIndex: '50',
    boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
    overflow: 'hidden',
    transition: 'opacity 0.3s',
    pointerEvents: 'auto' // Allow interaction with chat
  });

  // Chat Header
  const chatHeader = document.createElement('div');
  Object.assign(chatHeader.style, {
    padding: '10px 15px',
    background: 'rgba(255,255,255,0.05)',
    borderBottom: '1px solid rgba(255,255,255,0.1)',
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#cbd5e1',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  });
  chatHeader.innerHTML = '<span>💬 Global Lobby</span> <span style="font-size:10px; color:#22c55e;">● Online</span>';
  chatContainer.appendChild(chatHeader);

  // Messages Area
  const chatMessages = document.createElement('div');
  Object.assign(chatMessages.style, {
    flex: '1',
    overflowY: 'auto',
    padding: '10px',
    fontSize: '13px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    scrollbarWidth: 'thin'
  });

  // Welcome Message
  const welcomeMsg = document.createElement('div');
  welcomeMsg.style.color = '#fbbf24';
  welcomeMsg.innerText = "System: Welcome to Gooby Arena! Share lobby codes here to play together.";
  chatMessages.appendChild(welcomeMsg);
  chatContainer.appendChild(chatMessages);

  // Input Area
  const chatInputWrapper = document.createElement('div');
  Object.assign(chatInputWrapper.style, {
    padding: '10px',
    background: 'rgba(0,0,0,0.2)',
    display: 'flex',
    gap: '5px'
  });

  const chatInput = document.createElement('input');
  chatInput.placeholder = "Type a message...";
  Object.assign(chatInput.style, {
    width: '100%',
    padding: '8px',
    borderRadius: '6px',
    border: '1px solid rgba(255,255,255,0.2)',
    background: 'rgba(255,255,255,0.05)',
    color: 'white',
    fontSize: '12px',
    outline: 'none',
    marginBottom: '0' // Override global input margin
  });

  const sendBtn = document.createElement('button');
  sendBtn.innerText = '➤';
  Object.assign(sendBtn.style, {
    padding: '0 12px',
    borderRadius: '6px',
    border: 'none',
    background: '#6366f1',
    color: 'white',
    cursor: 'pointer',
    fontSize: '14px'
  });

  // DYNAMIC CHAT SYSTEM (WebRTC Ready)
  const updateChatUI = () => {
    chatMessages.innerHTML = '';
    const welcome = document.createElement('div');
    welcome.style.color = '#fbbf24';
    welcome.innerText = "System: Welcome to Gooby Arena! Share lobby codes here.";
    chatMessages.appendChild(welcome);

    state.lobby.messages.forEach(msg => {
      const div = document.createElement('div');
      div.innerHTML = `<span style="color:${escapeHtml(msg.color)}; font-weight:bold;">${escapeHtml(msg.name)}:</span> <span style="color:#e2e8f0;">${escapeHtml(msg.text)}</span>`;
      chatMessages.appendChild(div);
    });
    chatMessages.scrollTop = chatMessages.scrollHeight;
  };
  window.updateChatUI = updateChatUI; // Expose for Network

  const sendMessage = () => {
    const text = chatInput.value.trim();
    if (!text) return;

    const msg = {
      name: state.player.name || "Guest",
      color: state.player.color || "#fff",
      text: text,
      timestamp: Date.now()
    };

    state.lobby.messages.push(msg); // Add to local state
    updateChatUI(); // Update UI
    chatInput.value = '';

    // Broadcast via NetworkManager (Future)
    if (window.networkManager && typeof window.networkManager.sendGlobalChat === 'function') {
      window.networkManager.sendGlobalChat(msg);
    }
  };

  sendBtn.onclick = sendMessage;
  chatInput.onkeydown = (e) => {
    e.stopPropagation(); // Prevent game from capturing keys
    if (e.key === 'Enter') sendMessage();
  };

  chatInputWrapper.appendChild(chatInput);
  chatInputWrapper.appendChild(sendBtn);
  chatContainer.appendChild(chatInputWrapper);

  // Hide chat on very small screens to save space
  if (window.innerWidth < 600) chatContainer.style.display = 'none';

  uiLayer.appendChild(chatContainer);

  /* Mute Button removed */

  const wrapper = document.createElement('div');
  Object.assign(wrapper.style, {
    width: '90%',
    maxWidth: '500px',
    height: 'auto',
    maxHeight: '90vh',
    position: 'relative',
    pointerEvents: 'auto',
    overflow: 'auto'
  });

  // 1. MAIN MENU WRAPPER
  wrapper.innerHTML = `
      <div class="tilt-container" style="perspective: 1000px; width: 100%; height: 100%;">
          <div class="glass-panel tilt-panel" id="mainMenuPanel" 
               style="width: 100%; height: auto; position: relative; overflow-y: auto; max-height: 90vh; padding: 20px; box-sizing: border-box;
                      background: rgba(15, 23, 42, 0.9); 
                      border: 1px solid rgba(255,255,255,0.1); border-radius: 20px; box-shadow: 0 0 50px rgba(0,0,0,0.5);
                      will-change: transform; transform: translateZ(0);">
              
              <!-- === MAIN UI CONTENT (Visible by default) === -->
              <div id="mainUIContent" style="width: 100%; height: auto; display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 1; position: relative;">
                  
                  <h1 class="liquid-text" style="font-size: 4rem; margin-bottom: 5px; font-weight: 800; letter-spacing: -2px; line-height: 1;">GOOBY ARENA</h1>
                  <p style="opacity: 0.8; margin-bottom: 10px; font-size: 1.1rem; letter-spacing: 4px; font-family: 'Orbitron'; color: #cbd5e1;">WEB RTC MULTIPLAYER</p>
                  
                  <!-- ONLINE PLAYERS COUNTER -->
                  <div id="onlineCounter" style="display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 8px; padding: 8px 16px; background: rgba(34, 197, 94, 0.1); border-radius: 50px; border: 1px solid rgba(34, 197, 94, 0.3);">
                      <div style="width: 8px; height: 8px; background: #22c55e; border-radius: 50%; box-shadow: 0 0 10px #22c55e; animation: pulse 2s infinite;"></div>
                      <span id="onlineCount" style="font-family: 'Orbitron'; font-weight: bold; color: #22c55e; font-size: 0.9rem;">--</span>
                      <span style="font-family: 'Orbitron'; font-size: 0.75rem; color: rgba(34, 197, 94, 0.8);">ONLINE</span>
                  </div>
                  
                  <!-- CONNECTION QUALITY INDICATOR -->
                  <div id="connectionQuality" style="display: flex; align-items: center; justify-content: center; gap: 6px; margin-bottom: 15px; padding: 6px 12px; background: rgba(255,255,255,0.03); border-radius: 50px; border: 1px solid rgba(255,255,255,0.1); font-size: 0.7rem;">
                      <div id="pingIndicator" style="width: 6px; height: 6px; background: #22c55e; border-radius: 50%; box-shadow: 0 0 8px currentColor;"></div>
                      <span id="pingText" style="font-family: 'Orbitron'; color: rgba(255,255,255,0.6);">Checking...</span>
                  </div>
                  
                  <style>
                      @keyframes pulse {
                          0%, 100% { opacity: 1; }
                          50% { opacity: 0.5; }
                      }
                  </style>
                  
                  <!-- PLATFORM SUPPORT ICONS -->
                  <div style="display: flex; align-items: center; justify-content: center; gap: 15px; margin-bottom: 25px; padding: 10px 20px; background: rgba(255,255,255,0.03); border-radius: 50px; border: 1px solid rgba(255,255,255,0.1);">
                      <div style="text-align: center; opacity: 0.8;">
                          <div style="font-size: 1.5rem; margin-bottom: 3px;">🖥️</div>
                          <div style="font-size: 0.6rem; color: #94a3b8; letter-spacing: 1px;">PC</div>
                      </div>
                      <div style="width: 1px; height: 30px; background: rgba(255,255,255,0.1);"></div>
                      <div style="text-align: center; opacity: 0.8;">
                          <div style="font-size: 1.5rem; margin-bottom: 3px;">🎮</div>
                          <div style="font-size: 0.6rem; color: #94a3b8; letter-spacing: 1px;">GAMEPAD</div>
                      </div>
                      <div style="width: 1px; height: 30px; background: rgba(255,255,255,0.1);"></div>
                      <div style="text-align: center; opacity: 0.8;">
                          <div style="font-size: 1.5rem; margin-bottom: 3px;">📱</div>
                          <div style="font-size: 0.6rem; color: #94a3b8; letter-spacing: 1px;">MOBILE</div>
                      </div>
                  </div>
                  
                  <!-- PROFILE CARD -->
                  <div id="mainProfileCard" style="display: flex; align-items: center; gap: 15px; background: rgba(255,255,255,0.05); padding: 8px 20px; border-radius: 50px; margin-bottom: 30px; cursor: pointer; border: 1px solid rgba(255,255,255,0.1); transition: all 0.2s; width: fit-content;">
                      <div id="mainAvatar" style="width: 36px; height: 36px; background: ${state.player.color}; border-radius: 50%; box-shadow: 0 0 10px ${state.player.color}; display:flex; align-items:center; justify-content:center; font-size: 1rem;">${(hatDefs[state.player.hat] || '') + '😐'}</div>
                      <div style="text-align: left;">
                          <div id="mainName" style="font-family: 'Orbitron'; font-weight: bold; color: white; letter-spacing: 1px; font-size: 0.9rem;">${state.player.name}</div>
                          <div style="font-size: 0.6rem; color: #94a3b8; letter-spacing: 0.5px;">EDIT PROFILE ✏️</div>
                      </div>
                  </div>

                  <!-- MENU BUTTONS -->
                  <div id="menuButtons" style="display: flex; flex-direction: column; gap: 12px; width: 80%; max-width: 280px;">
                      <button class="btn" id="btnQuick" style="font-size: 1.1rem; padding: 1rem; border-radius: 8px; border: none; background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); color: white; cursor: pointer; box-shadow: 0 4px 15px rgba(99, 102, 241, 0.4);">
                          QUICK START ⚡
                      </button>
                      <button class="btn" id="btnCreate" style="font-size: 1.1rem; padding: 1rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.05); color: white; cursor: pointer;">
                          CREATE LOBBY 🏠
                      </button>
                      <button class="btn" id="btnJoin" style="font-size: 1.1rem; padding: 1rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.05); color: white; cursor: pointer;">
                          LOBBY LIST 📜
                      </button>
                      <button class="btn" id="btnHowToPlay" style="font-size: 1.1rem; padding: 1rem; border-radius: 8px; border: 1px solid rgba(250,204,21,0.3); background: rgba(250,204,21,0.05); color: #facc15; cursor: pointer;">
                          HOW TO PLAY 📖
                      </button>
                  </div>
              </div>

              <!-- === OVERLAYS / MODALS CONTAINER (Absolute on top) === -->
              
              <!-- HOW TO PLAY MODAL -->
              <div id="howToPlayModal" style="display: none; position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(15, 23, 42, 0.98); z-index: 50; flex-direction: column; align-items: center; padding: 30px; backdrop-filter: blur(10px); overflow-y: auto;">
                  <h2 style="font-family: 'Orbitron'; color: #facc15; margin-bottom: 10px; letter-spacing: 2px; font-size: 2rem;">📖 HOW TO PLAY</h2>
                  <p style="color: #94a3b8; margin-bottom: 25px; font-size: 0.9rem;">Master the controls and dominate the arena!</p>
                  
                  <!-- Controls Section -->
                  <div style="width: 100%; max-width: 450px; background: rgba(255,255,255,0.03); border-radius: 12px; padding: 20px; margin-bottom: 15px; border: 1px solid rgba(255,255,255,0.1);">
                      <h3 style="color: #3b82f6; font-family: 'Orbitron'; margin-bottom: 15px; font-size: 1.2rem;">⌨️ CONTROLS</h3>
                      <div style="display: grid; grid-template-columns: 140px 1fr; gap: 10px; color: #cbd5e1; font-size: 0.9rem; line-height: 1.8;">
                          <div style="color: #facc15; font-weight: bold;">🖱️ MOUSE</div>
                          <div>Move your gooby</div>
                          
                          <div style="color: #facc15; font-weight: bold;">🖱️ CLICK / SPACE</div>
                          <div>Dash attack</div>
                          
                          <div style="color: #facc15; font-weight: bold;">⌨️ T</div>
                          <div>Send emoji taunt</div>
                          
                          <div style="color: #facc15; font-weight: bold;">⌨️ X</div>
                          <div>Spawn decoy clone</div>
                          
                          <div style="color: #facc15; font-weight: bold;">⌨️ E</div>
                          <div>Pass hot potato</div>
                          
                          <div style="color: #facc15; font-weight: bold;">⌨️ ENTER</div>
                          <div>Open chat</div>
                      </div>
                  </div>
                  
                  <!-- Gamepad Controls Section -->
                  <div style="width: 100%; max-width: 450px; background: rgba(99,102,241,0.05); border-radius: 12px; padding: 20px; margin-bottom: 15px; border: 1px solid rgba(99,102,241,0.2);">
                      <h3 style="color: #6366f1; font-family: 'Orbitron'; margin-bottom: 15px; font-size: 1.2rem;">🎮 GAMEPAD (PS/XBOX)</h3>
                      <div style="display: grid; grid-template-columns: 140px 1fr; gap: 10px; color: #cbd5e1; font-size: 0.9rem; line-height: 1.8;">
                          <div style="color: #8b5cf6; font-weight: bold;">🕹️ LEFT STICK</div>
                          <div>Move your gooby</div>
                          
                          <div style="color: #8b5cf6; font-weight: bold;">🕹️ RIGHT STICK</div>
                          <div>Aim dash direction</div>
                          
                          <div style="color: #8b5cf6; font-weight: bold;">🎮 RT / RB / A</div>
                          <div>Dash attack</div>
                          
                          <div style="color: #8b5cf6; font-weight: bold;">🎮 X (Square)</div>
                          <div>Spawn decoy clone</div>
                          
                          <div style="color: #8b5cf6; font-weight: bold;">🎮 Y (Triangle)</div>
                          <div>Send emoji taunt</div>
                          
                          <div style="color: #8b5cf6; font-weight: bold;">🎮 B (Circle)</div>
                          <div>Pass hot potato</div>
                          
                          <div style="color: #8b5cf6; font-weight: bold;">🎮 D-PAD</div>
                          <div>Menu navigation</div>
                      </div>
                  </div>
                  
                  <!-- Features Section -->
                  <div style="width: 100%; max-width: 450px; background: rgba(255,255,255,0.03); border-radius: 12px; padding: 20px; margin-bottom: 15px; border: 1px solid rgba(255,255,255,0.1);">
                      <h3 style="color: #10b981; font-family: 'Orbitron'; margin-bottom: 15px; font-size: 1.2rem;">🎮 GAME MODES (12 Total)</h3>
                      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; color: #cbd5e1; font-size: 0.8rem; line-height: 1.6;">
                          <div><span style="color: #3b82f6;">⚡ CLASSIC:</span> Battle Royale</div>
                          <div><span style="color: #ef4444;">🔥 HOT POTATO:</span> Pass the bomb</div>
                          <div><span style="color: #facc15;">⚽ SOCCER:</span> Team goals</div>
                          <div><span style="color: #ec4899;">🍬 CANDY HUNT:</span> Collect candies</div>
                          <div><span style="color: #a855f7;">🕳️ VOID:</span> Black holes</div>
                          <div><span style="color: #f97316;">💥 CHAOS:</span> Random sizes</div>
                          <div><span style="color: #06b6d4;">⚡ LIGHTNING:</span> Dodge strikes</div>
                          <div><span style="color: #ec4899;">🎯 BULLSEYE:</span> Hit targets</div>
                          <div><span style="color: #fb923c;">💣 BOMB RAIN:</span> Falling bombs</div>
                          <div><span style="color: #8b5cf6;">🔵 SOCCER BATTLE:</span> Ball game</div>
                          <div><span style="color: #10b981;">💪 POWERFUL PUSH:</span> Super dash</div>
                          <div><span style="color: #6366f1;">🧊 SLIPPERY:</span> Ice physics</div>
                      </div>
                  </div>
                  
                  <!-- Tips Section -->
                  <div style="width: 100%; max-width: 450px; background: rgba(250,204,21,0.05); border-radius: 12px; padding: 20px; border: 1px solid rgba(250,204,21,0.2);">
                      <h3 style="color: #facc15; font-family: 'Orbitron'; margin-bottom: 12px; font-size: 1.2rem;">💡 PRO TIPS</h3>
                      <ul style="color: #cbd5e1; font-size: 0.85rem; line-height: 1.8; padding-left: 20px; list-style: none;">
                          <li style="margin-bottom: 6px;">✓ Use dash to knock enemies into holes</li>
                          <li style="margin-bottom: 6px;">✓ Bigger gooby = stronger push, slower speed</li>
                          <li style="margin-bottom: 6px;">✓ Decoy clones confuse enemies</li>
                          <li style="margin-bottom: 6px;">✓ Team up in multiplayer for epic battles</li>
                          <li>✓ Watch the timer and plan your moves!</li>
                      </ul>
                  </div>
                  
                  <button id="btnCloseHowToPlay" style="margin-top: 20px; padding: 12px 40px; background: linear-gradient(135deg, #ef4444, #dc2626); border: none; color: white; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 1rem; box-shadow: 0 4px 15px rgba(239,68,68,0.4);">
                      CLOSE
                  </button>
              </div>
              
              
              <!-- 1. CUSTOMIZE MODAL -->
              <div id="customizeModal" style="display: none; position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(15, 23, 42, 0.98); z-index: 50; flex-direction: column; align-items: center; justify-content: center; backdrop-filter: blur(10px);">
                  <h2 style="font-family: 'Orbitron'; color: #fff; margin-bottom: 20px; letter-spacing: 2px;">CUSTOMIZE GOOBY 🎨</h2>
                  
                  <!-- PREVIEW GOOBY -->
                  <div id="previewGooby" style="width: 100px; height: 100px; background: ${state.player.color}; border-radius: 50%; box-shadow: 0 0 30px ${state.player.color}; margin-bottom: 20px; display: flex; align-items: center; justify-content: center; position: relative;">
                      <!-- Face Layer -->
                      <div id="previewFace" style="width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center;">
                          ${faceDefs[state.player.face] || faceDefs['normal']} 
                      </div>
                      <!-- Hat Layer -->
                      <div id="previewHat" style="position: absolute; top: -20px; font-size: 3rem; pointer-events: none;">
                          ${state.player.hat && state.player.hat !== 'none' ? hatDefs[state.player.hat] : ''}
                      </div>
                  </div>

                  <!-- NAME INPUT -->
                  <div style="margin-bottom: 15px; width: 80%; max-width: 260px;">
                      <input type="text" id="editNameInput" value="${state.player.name}" maxlength="12" placeholder="NAME" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.5); color: white; outline: none; text-align: center; font-family: 'Orbitron';">
                  </div>

                  <!-- TABS -->
                  <div style="display: flex; gap: 10px; margin-bottom: 15px;">
                      <button id="btnTabColor" style="padding: 8px 12px; background: rgba(255,255,255,0.1); border: none; border-radius: 6px; color: white; cursor: pointer; font-family: 'Orbitron'; font-size: 0.8rem;">COLOR</button>
                      <button id="btnTabFace" style="padding: 8px 12px; background: rgba(255,255,255,0.1); border: none; border-radius: 6px; color: white; cursor: pointer; font-family: 'Orbitron'; font-size: 0.8rem; opacity: 0.5;">FACE</button>
                      <button id="btnTabHat" style="padding: 8px 12px; background: rgba(255,255,255,0.1); border: none; border-radius: 6px; color: white; cursor: pointer; font-family: 'Orbitron'; font-size: 0.8rem; opacity: 0.5;">HAT</button>
                  </div>

                  <!-- CONTENT AREA (Grids) -->
                  <div style="margin-bottom: 20px; min-height: 120px; display: flex; align-items: center; justify-content: center;">
                       <div id="tabColor" style="display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; max-width: 280px;">
                           <div id="colorGrid" style="display: contents;"></div>
                       </div>
                       <div id="tabFace" style="display: none; gap: 8px; justify-content: center; flex-wrap: wrap; max-width: 280px;">
                           <div id="faceGrid" style="display: contents;"></div>
                       </div>
                       <div id="tabHat" style="display: none; gap: 8px; justify-content: center; flex-wrap: wrap; max-width: 280px;">
                           <div id="hatGrid" style="display: contents;"></div>
                       </div>
                  </div>

                  <div style="display: flex; gap: 10px; width: 80%; max-width: 260px;">
                      <button id="btnCancelModify" style="flex: 1; padding: 0.8rem; background: transparent; border: 1px solid #cbd5e1; border-radius: 8px; color: #cbd5e1; cursor: pointer; font-family: 'Orbitron';">CANCEL</button>
                      <button id="btnSaveProfile" style="flex: 2; padding: 0.8rem; background: #22c55e; border: none; border-radius: 8px; color: white; font-weight: bold; cursor: pointer; font-family: 'Orbitron';">SAVE</button>
                  </div>
              </div>

              <!-- 2. CREATE OPTIONS MODAL -->
              <div id="createOptionsModal" style="display: none; position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(15, 23, 42, 0.98); z-index: 40; flex-direction: column; align-items: center; justify-content: center; backdrop-filter: blur(10px);">
                  <h2 style="font-family: 'Orbitron'; color: #fff; margin-bottom: 30px; letter-spacing: 2px;">LOBBY SETTINGS ⚙️</h2>
                  <div style="width: 80%; max-width: 300px; text-align: left; margin-bottom: 30px;">
                      <label style="display: block; font-size: 0.8rem; color: #94a3b8; margin-bottom: 8px;">LOBBY PASSWORD (OPTIONAL)</label>
                      <div style="display: flex; gap: 10px;">
                          <input type="password" id="lobbyPasswordInput" placeholder="No password" style="flex: 1; padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.3); color: white; outline: none;">
                          <button id="btnTogglePwd" style="padding: 0 12px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; cursor: pointer; color: #cbd5e1;">👁️</button>
                      </div>
                  </div>
                  <div style="display: flex; gap: 15px; width: 80%; max-width: 300px;">
                      <button id="btnCancelCreate" style="flex: 1; padding: 1rem; background: transparent; border: 1px solid #64748b; border-radius: 8px; color: #cbd5e1; cursor: pointer;">CANCEL</button>
                      <button id="btnConfirmCreate" style="flex: 2; padding: 1rem; background: #6366f1; border: none; border-radius: 8px; color: white; font-weight: bold; cursor: pointer;">CREATE</button>
                  </div>
              </div>

              <!-- 3. LOBBY SCREEN -->
              <div id="lobbyScreen" style="display: none; width: 100%; height: 100%; flex-direction: column; align-items: center; justify-content: center; position: absolute; top:0; left:0; background: rgba(15, 23, 42, 0.98); border-radius: 20px; z-index: 30; padding: 2rem;">
                   <h2 style="margin-bottom: 10px; font-family: 'Orbitron'; color: #facc15; font-size: 2rem; display: flex; align-items: center; gap: 10px;">
                       LOBBY #<span id="lobbyCodeDisplay">----</span>
                       <span id="btnCopyCode" title="Copy Code" style="cursor: pointer; font-size: 0.6em; opacity: 0.8;">📋</span>
                       <span id="iconLocked" style="display:none; font-size: 0.6em; color: #ef4444;">🔒</span>
                   </h2>
                   <div id="lobbyPwdDisplay" style="display: none; margin-bottom: 20px; font-size: 0.9rem; color: #94a3b8; background: rgba(255,255,255,0.05); padding: 5px 15px; border-radius: 20px;">
                       PWD: <span id="lobbyPwdValue" style="color: #facc15; font-family: monospace; filter: blur(6px); cursor: pointer;">SECRET</span>
                   </div>
                   <div style="width: 100%; margin-bottom: 10px; display:flex; justify-content:space-between; font-size: 0.8rem; opacity:0.6;"><span>PLAYER</span><span>PING</span></div>
                   <div id="playerList" style="width: 100%; flex-grow: 1; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.05); border-radius: 12px; margin-bottom: 20px; padding: 15px; overflow-y: auto;"></div>
                   <div style="display: flex; gap: 15px; width: 100%;">
                       <button id="btnLobbyBack" style="flex: 1; padding: 1rem; background: rgba(239, 68, 68, 0.2); border: 1px solid #ef4444; border-radius: 8px; color: #fca5a5; cursor: pointer;">LEAVE</button>
                       <button id="btnLobbyStart" style="flex: 2; padding: 1rem; background: #22c55e; border: none; border-radius: 8px; color: white; cursor: pointer; font-weight: bold;">START GAME 🚀</button>
                   </div>
              </div>

              <!-- 4. LOBBY LIST SCREEN -->
              <div id="lobbyListScreen" style="display: none; width: 100%; height: 100%; flex-direction: column; align-items: center; justify-content: center; position: absolute; top:0; left:0; background: rgba(15, 23, 42, 0.98); z-index: 35; padding: 2rem; border-radius: 20px;">
                  
                  <!-- NESTED: PASSWORD PROMPT -->
                  <div id="passwordPromptModal" style="display: none; position: absolute; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.9); z-index: 50; flex-direction: column; align-items: center; justify-content: center;">
                      <h3 style="color: #ef4444; margin-bottom: 20px;">ENTER PASSWORD 🔒</h3>
                      <input type="password" id="joinPwdInput" style="padding: 10px; border-radius: 8px; margin-bottom: 20px;">
                      <div style="display: flex; gap: 10px;">
                          <button id="btnCancelJoinPrompt" style="padding: 8px 16px;">CANCEL</button>
                          <button id="btnConfirmJoinPrompt" style="padding: 8px 16px;">JOIN</button>
                      </div>
                      <p id="joinErrorMsg" style="color: #ef4444; margin-top: 10px; display: none;">Invalid!</p>
                  </div>
                  
                  <!-- NESTED: JOIN PRIVATE -->
                  <div id="joinPrivateModal" style="display: none; position: absolute; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.9); z-index: 50; flex-direction: column; align-items: center; justify-content: center;">
                      <h3 style="color: #6366f1; margin-bottom: 20px;">JOIN BY CODE 🕵️</h3>
                      <input type="number" id="privateCodeInput" placeholder="Code" style="margin-bottom:10px; padding:10px;">
                      <input type="password" id="privatePwdInput" placeholder="Password" style="margin-bottom:20px; padding:10px;">
                      <div style="display: flex; gap: 10px;">
                          <button id="btnCancelPrivateJoin" style="padding: 8px 16px;">CANCEL</button>
                          <button id="btnConfirmPrivateJoin" style="padding: 8px 16px;">JOIN</button>
                      </div>
                  </div>

                  <div style="width: 100%; display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                      <h2 style="color: #6366f1; font-size: 1.8rem; margin:0;">LOBBY BROWSER</h2>
                      <button id="btnOpenJoinPrivate" style="padding: 6px 12px; font-size: 0.8rem;">🔑 JOIN CODE</button>
                  </div>
                  
                  <div id="publicLobbyList" style="width: 100%; flex-grow: 1; background: rgba(0,0,0,0.3); border-radius: 12px; margin-bottom: 20px; padding: 10px; overflow-y: auto;"></div>
                  
                  <div style="display: flex; gap: 15px; width: 100%;">
                      <button id="btnListBack" style="flex: 1; padding: 1rem; cursor:pointer;">BACK</button>
                      <button id="btnListRefresh" style="flex: 2; padding: 1rem; cursor:pointer;">REFRESH 🔄</button>
                  </div>
              </div>

          </div>
      </div>
  `;

  uiLayer.appendChild(wrapper);
  document.body.appendChild(uiLayer); // Append to BODY

  const els = {
    // Main Menu
    mainProfileCard: uiLayer.querySelector('#mainProfileCard'),
    customizeModal: uiLayer.querySelector('#customizeModal'),
    btnQuick: uiLayer.querySelector('#btnQuick'),
    btnCreate: uiLayer.querySelector('#btnCreate'),
    btnJoin: uiLayer.querySelector('#btnJoin'),
    // Customize Elements
    previewGooby: uiLayer.querySelector('#previewGooby'),
    previewFace: uiLayer.querySelector('#previewFace'),
    previewHat: uiLayer.querySelector('#previewHat'),
    editNameInput: uiLayer.querySelector('#editNameInput'),

    // Grids
    colorGrid: uiLayer.querySelector('#colorGrid'),
    faceGrid: uiLayer.querySelector('#faceGrid'),
    hatGrid: uiLayer.querySelector('#hatGrid'),

    // Tab Buttons
    btnTabColor: uiLayer.querySelector('#btnTabColor'),
    btnTabFace: uiLayer.querySelector('#btnTabFace'),
    btnTabHat: uiLayer.querySelector('#btnTabHat'),

    // Containers
    tabColor: uiLayer.querySelector('#tabColor'),
    tabFace: uiLayer.querySelector('#tabFace'),
    tabHat: uiLayer.querySelector('#tabHat'),

    btnSaveProfile: uiLayer.querySelector('#btnSaveProfile'),
    btnCancelModify: uiLayer.querySelector('#btnCancelModify'),
    mainAvatar: uiLayer.querySelector('#mainAvatar'),
    mainName: uiLayer.querySelector('#mainName'),

    // Lobby Elements
    createOptionsModal: uiLayer.querySelector('#createOptionsModal'),
    lobbyPasswordInput: uiLayer.querySelector('#lobbyPasswordInput'),
    btnTogglePwd: uiLayer.querySelector('#btnTogglePwd'),
    btnCancelCreate: uiLayer.querySelector('#btnCancelCreate'),
    btnConfirmCreate: uiLayer.querySelector('#btnConfirmCreate'),
    lobbyScreen: uiLayer.querySelector('#lobbyScreen'),
    playerList: uiLayer.querySelector('#playerList'),
    btnLobbyStart: uiLayer.querySelector('#btnLobbyStart'),
    btnLobbyBack: uiLayer.querySelector('#btnLobbyBack'),
    lobbyCodeDisplay: uiLayer.querySelector('#lobbyCodeDisplay'),
    btnCopyCode: uiLayer.querySelector('#btnCopyCode'),
    iconLocked: uiLayer.querySelector('#iconLocked'),
    lobbyPwdDisplay: uiLayer.querySelector('#lobbyPwdDisplay'),
    lobbyPwdValue: uiLayer.querySelector('#lobbyPwdValue'),
    lobbyListScreen: uiLayer.querySelector('#lobbyListScreen'),
    publicLobbyList: uiLayer.querySelector('#publicLobbyList'),
    btnListBack: uiLayer.querySelector('#btnListBack'),
    btnListRefresh: uiLayer.querySelector('#btnListRefresh'),
    btnOpenJoinPrivate: uiLayer.querySelector('#btnOpenJoinPrivate'),
    passwordPromptModal: uiLayer.querySelector('#passwordPromptModal'),
    joinPwdInput: uiLayer.querySelector('#joinPwdInput'),
    btnCancelJoinPrompt: uiLayer.querySelector('#btnCancelJoinPrompt'),
    btnConfirmJoinPrompt: uiLayer.querySelector('#btnConfirmJoinPrompt'),
    joinErrorMsg: uiLayer.querySelector('#joinErrorMsg'),
    joinPrivateModal: uiLayer.querySelector('#joinPrivateModal'),
    privateCodeInput: uiLayer.querySelector('#privateCodeInput'),
    privatePwdInput: uiLayer.querySelector('#privatePwdInput'),
    btnCancelPrivateJoin: uiLayer.querySelector('#btnCancelPrivateJoin'),
    btnConfirmPrivateJoin: uiLayer.querySelector('#btnConfirmPrivateJoin')
  };

  // GLOBAL LOBBY RENDERER (shared by Host & Client)
  const renderLobbyPlayers = () => {

    const list = els.playerList;
    if (!list) {
      return;
    }

    // CLEANUP: Remove players no longer in the list
    const currentPlayerIds = new Set(state.lobby.players.map(p => p.id));
    const existingElements = list.querySelectorAll('[id^="lobby-p-"]');
    existingElements.forEach(el => {
      const playerId = el.id.replace('lobby-p-', '');
      if (!currentPlayerIds.has(playerId)) {
        el.remove();
      }
    });

    // RENDER: Add or update current players
    state.lobby.players.forEach(p => {
      const domId = `lobby-p-${p.id}`;
      let el = document.getElementById(domId);
      if (!el) {
        el = document.createElement('div');
        el.id = domId;
        el.style.cssText = `display: flex; justify-content: space-between; align-items: center; padding: 12px; background: rgba(255,255,255,0.05); margin-bottom: 8px; border-radius: 8px; border-left: 4px solid ${p.color}; transition: all 0.3s;`;
        list.appendChild(el);
      }

      // Update Styling
      el.style.borderLeftColor = p.color;

      // Update Content
      el.innerHTML = `
              <div style="display: flex; align-items: center; gap: 10px;">
                   <div style="width: 30px; height: 30px; background: ${p.color}; border-radius: 50%; display: flex; align-items: center; justify-content: center; overflow: hidden;">
                      <div style="transform: scale(0.5);">${faceDefs[p.face] || ''}</div>
                   </div>
                   <span style="font-weight: bold;">${escapeHtml(p.name)} <span style="opacity: 0.5; font-size: 0.8em;">${p.isHost ? '(HOST)' : ''} ${p.id === 'self' || p.id === window.state?.network?.peerId ? '(YOU)' : ''}</span></span>
              </div>
              <span style="color: ${(!p.ping || p.ping < 50) ? '#4ade80' : p.ping < 150 ? '#facc15' : '#ef4444'}; font-family: monospace;">${p.ping || 0}ms</span>
           `;
    });

    // Remove Disconnected
    Array.from(list.children).forEach(child => {
      if (child.id.startsWith('lobby-p-') && !state.lobby.players.find(p => `lobby-p-${p.id}` === child.id)) {
        child.remove();
      }
    });

    // Host Control
    if (state.lobby.isHost) els.btnLobbyStart.style.display = 'block';
    else els.btnLobbyStart.style.display = 'none';
  };

  // EXPOSE GLOBALLY (for Network callbacks)
  window.updateLobbyUI = renderLobbyPlayers;

  // Helper to add hover sounds
  const addAudio = (btn) => {
    btn.onmouseenter = () => { if (window.gameInstance?.audio) try { window.gameInstance.audio.playUIHover(); } catch (e) { } };
    btn.onclick = (e) => {
      if (window.gameInstance?.audio) try { window.gameInstance.audio.playUIClick(); } catch (e) { }
    };
  };
  document.querySelectorAll('button').forEach(b => addAudio(b));
  if (els.mainProfileCard) els.mainProfileCard.onclick = () => openCustomization();

  // Duplicate definitions removed. 
  // Code continues using the definitions at the top of the function.

  let tempProfile = { ...state.player };
  if (!tempProfile.hat) tempProfile.hat = 'none';

  const renderGrid = (grid, items, currentVal, onSelect) => {
    grid.innerHTML = '';
    items.forEach(item => {
      const btn = document.createElement('button');
      btn.style.width = '45px'; btn.style.height = '45px';
      btn.style.borderRadius = '8px'; btn.style.border = '1px solid rgba(255,255,255,0.2)';
      btn.style.background = 'rgba(255,255,255,0.05)'; btn.style.cursor = 'pointer';
      btn.style.fontSize = '1.5rem'; btn.style.display = 'flex'; btn.style.alignItems = 'center'; btn.style.justifyContent = 'center';

      if (grid.id === 'colorGrid') {
        btn.style.background = item;
        if (item === currentVal) btn.style.border = '3px solid white';
      } else if (grid.id === 'hatGrid') {
        btn.innerText = hatDefs[item] || item;
        if (item === currentVal) { btn.style.background = 'rgba(255,255,255,0.2)'; btn.style.border = '1px solid white'; }
      } else {
        // Face Preview in button (simplified)
        btn.innerText = '😐';
        if (item === 'angry') btn.innerText = '😠';
        if (item === 'happy') btn.innerText = '😃';
        if (item === 'dead') btn.innerText = '✖️';
        if (item === 'ninja') btn.innerText = '🥷';
        if (item === 'cyclops') btn.innerText = '👁️';
        if (item === currentVal) { btn.style.background = 'rgba(255,255,255,0.2)'; btn.style.border = '1px solid white'; }
      }

      btn.onclick = () => onSelect(item);
      grid.appendChild(btn);
    });
  };

  const updatePreview = () => {
    els.previewGooby.style.background = tempProfile.color;
    els.previewGooby.style.boxShadow = `0 0 30px ${tempProfile.color}`;

    // Render Face
    els.previewFace.innerHTML = faceDefs[tempProfile.face] || faceDefs['normal'];

    // Render Hat
    els.previewHat.innerHTML = hatDefs[tempProfile.hat] !== undefined ? hatDefs[tempProfile.hat] : '';
    // Adjust hat position based on type
    if (tempProfile.hat === 'sunglasses') els.previewHat.style.top = '10px'; // Align with eyes (was 35px)
    else if (tempProfile.hat === 'halo') els.previewHat.style.top = '-35px';
    else els.previewHat.style.top = '-20px';
  };

  const switchTab = (tab) => {
    const tabs = {
      color: uiLayer.querySelector('#tabColor'),
      face: uiLayer.querySelector('#tabFace'),
      hat: uiLayer.querySelector('#tabHat')
    };
    const btns = {
      color: uiLayer.querySelector('#btnTabColor'),
      face: uiLayer.querySelector('#btnTabFace'),
      hat: uiLayer.querySelector('#btnTabHat')
    };

    // Hide all contents
    Object.values(tabs).forEach(t => { if (t) t.style.display = 'none'; });
    // Dim all buttons
    Object.values(btns).forEach(b => { if (b) b.style.opacity = '0.5'; });

    // Activate selected
    if (tabs[tab]) tabs[tab].style.display = 'flex';
    if (btns[tab]) btns[tab].style.opacity = '1';
  };

  const openCustomization = () => {
    try {
      // Re-query elements to be 100% sure we have the correct DOM nodes
      const modal = uiLayer.querySelector('#customizeModal');
      const nameInput = uiLayer.querySelector('#editNameInput');
      const cGrid = uiLayer.querySelector('#colorGrid');
      const fGrid = uiLayer.querySelector('#faceGrid');
      const hGrid = uiLayer.querySelector('#hatGrid');

      if (!modal) {
        // Visual feedback on the card itself if modal fails
        const nameDisplay = uiLayer.querySelector('#mainName');
        if (nameDisplay) nameDisplay.innerText = "ERROR L1";
        return;
      }

      tempProfile = { ...state.player };
      if (!tempProfile.hat) tempProfile.hat = 'none';
      if (nameInput) nameInput.value = tempProfile.name;

      updatePreview();
      switchTab('color');
      modal.style.display = 'flex';

      // Render Grids with Named Callbacks
      const onSelectColor = (c) => {
        tempProfile.color = c;
        updatePreview();
        if (cGrid) renderGrid(cGrid, colors, c, onSelectColor);
      };
      const onSelectFace = (f) => {
        tempProfile.face = f;
        updatePreview();
        if (fGrid) renderGrid(fGrid, Object.keys(faceDefs), f, onSelectFace);
      };
      const onSelectHat = (h) => {
        tempProfile.hat = h;
        updatePreview();
        if (hGrid) renderGrid(hGrid, Object.keys(hatDefs), h, onSelectHat);
      };

      if (cGrid) renderGrid(cGrid, colors, tempProfile.color, onSelectColor);
      if (fGrid) renderGrid(fGrid, Object.keys(faceDefs), tempProfile.face, onSelectFace);
      if (hGrid) renderGrid(hGrid, Object.keys(hatDefs), tempProfile.hat, onSelectHat);

    } catch (e) {
      alert("Error: " + e.message); // Show alert to user
    }
  };

  // Bind Tabs
  els.btnTabColor.onclick = () => switchTab('color');
  els.btnTabFace.onclick = () => switchTab('face');
  els.btnTabHat.onclick = () => switchTab('hat');

  els.editNameInput.oninput = (e) => { tempProfile.name = e.target.value; };
  els.btnCancelModify.onclick = () => els.customizeModal.style.display = 'none';

  els.btnSaveProfile.onclick = () => {
    // Validate
    if (!tempProfile.name.trim()) tempProfile.name = "Gooby";
    state.player = { ...tempProfile };
    localStorage.setItem('gooby_profile', JSON.stringify(state.player));

    // Update Main Menu UI
    els.mainAvatar.style.background = state.player.color;
    els.mainAvatar.style.boxShadow = `0 0 10px ${state.player.color}`;
    // Simplified avatar for small card
    let faceIcon = '😐';
    if (state.player.face === 'angry') faceIcon = '😠';
    if (state.player.face === 'happy') faceIcon = '😃';
    if (state.player.hat !== 'none') faceIcon = hatDefs[state.player.hat] + faceIcon;
    els.mainAvatar.innerText = faceIcon.substring(0, 4);

    els.mainName.innerText = state.player.name;
    els.customizeModal.style.display = 'none';
  };

  // 1. QUICK START MATCHMAKING
  // 1. QUICK PLAY -> INSTANT HOST (P2P: No central matchmaking)
  els.btnQuick.onclick = () => {
    // QUICK START: Auto-join available lobby OR create new one

    // Request lobby list from server
    if (window.networkManager && window.networkManager.socket) {
      window.networkManager.socket.emit('getRoomList');

      // Listen for room list response
      const onRoomList = (rooms) => {

        // Find first available lobby (not full, not locked)
        const availableLobby = rooms.find(room =>
          !room.hasPassword &&
          (room.players || 0) < (room.max || 10)
        );

        if (availableLobby) {
          // Join existing lobby
          joinLobby(availableLobby.id, 50, false);
        } else {
          // No lobby found - create new one

          els.lobbyScreen.style.display = 'flex';
          const code = Math.floor(1000 + Math.random() * 9000);
          els.lobbyCodeDisplay.innerText = code;

          if (els.iconLocked) els.iconLocked.style.display = 'none';
          if (els.lobbyPwdDisplay) els.lobbyPwdDisplay.style.display = 'none';

          state.lobby.isHost = true;
          state.lobby.id = code;
          state.lobby.players = [{
            id: 'self',
            name: state.player.name,
            color: state.player.color,
            face: state.player.face,
            hat: state.player.hat,
            isHost: true,
            ping: 0
          }];
          state.lobby.messages = [];

          if (window.updateLobbyUI) window.updateLobbyUI();
          if (window.updateChatUI) window.updateChatUI();

          if (window.networkManager && typeof window.networkManager.host === 'function') {
            window.networkManager.host(code);
          }
        }

        // Remove listener to avoid duplicates
        window.networkManager.socket.off('roomList', onRoomList);
      };

      window.networkManager.socket.on('roomList', onRoomList);

      if (window.gameInstance?.audio) try { window.gameInstance.audio.playUIClick(); } catch (e) { }
    } else {
      alert('Sunucuya bağlanılamadı. Lütfen sayfayı yenileyin.');
    }
  };

  // 2. CREATE LOBBY FLOW
  if (els.btnCreate) {
    els.btnCreate.onclick = () => {
      els.createOptionsModal.style.display = 'flex'; // Show modal
      els.lobbyPasswordInput.value = ''; // Reset
      els.lobbyPasswordInput.type = 'password';
    };
  }

  els.btnTogglePwd.onclick = () => {
    els.lobbyPasswordInput.type = els.lobbyPasswordInput.type === 'password' ? 'text' : 'password';
  };

  els.btnCancelCreate.onclick = () => {
    els.createOptionsModal.style.display = 'none';
  };

  els.btnConfirmCreate.onclick = () => {
    const pwd = els.lobbyPasswordInput.value.trim();
    const code = Math.floor(1000 + Math.random() * 9000); // Mock Code

    // Update Lobby UI
    els.lobbyCodeDisplay.innerText = code;

    if (pwd) {
      els.iconLocked.style.display = 'inline-block';
      els.lobbyPwdDisplay.style.display = 'block';
      els.lobbyPwdValue.innerText = pwd;
      els.lobbyPwdValue.style.filter = 'blur(6px)'; // Secure default
    } else {
      els.iconLocked.style.display = 'none';
      els.lobbyPwdDisplay.style.display = 'none';
    }

    // Hide Modal, Show Lobby
    els.createOptionsModal.style.display = 'none';
    els.lobbyScreen.style.display = 'flex';

    // HOST LOGIC: ALWAYS SHOW START BUTTON
    // DYNAMIC LOBBY RENDERING (Optimized & Exposed)
    // EXPOSE FOR NETWORK
    window.updateLobbyUI = renderLobbyPlayers;

    // Initialize Local Lobby State
    state.lobby.isHost = true;
    state.lobby.players = [{
      id: 'self',
      name: state.player.name,
      color: state.player.color,
      face: state.player.face,
      hat: state.player.hat,
      isHost: true,
      ping: 0
    }];
    renderLobbyPlayers();

    // NETWORK: Register Room on Server & Initialize P2P Host
    if (window.networkManager && typeof window.networkManager.host === 'function') {
      window.networkManager.host(code);
    } else {
    }
  };

  // 3. LOBBY UTILS
  els.btnCopyCode.onclick = () => {
    navigator.clipboard.writeText(els.lobbyCodeDisplay.innerText);
    // Could show toast here
    if (window.gameInstance?.audio) try { window.gameInstance.audio.playTick(); } catch (e) { }
  };

  els.lobbyPwdValue.onclick = () => {
    // Toggle Blur
    els.lobbyPwdValue.style.filter = els.lobbyPwdValue.style.filter === 'none' ? 'blur(6px)' : 'none';
  };

  // (Removed erroneous function block)

  els.btnLobbyStart.onclick = () => {

    // Hide UI and Start Game
    const ui = document.getElementById('gooby-arena-ui-layer') || document.getElementById('game-ui');
    if (ui) {
      ui.remove();
    }

    if (window.gameInstance?.audio) try { window.gameInstance.audio.playWin(); } catch (e) { }

    requestAnimationFrame(() => {
      startMode('CLASSIC', false); // false = Host initiated, not remote
    });
  };

  els.btnLobbyBack.onclick = () => {
    els.lobbyScreen.style.display = 'none';
  };

  // 4. LOBBY LIST & JOIN Logic
  let currentJoinTarget = null; // Store pending join data
  let lobbyRefreshInterval = null; // Auto-refresh for mobile

  const showMainMenu = () => {
    // Stop Lobby Polling
    if (lobbyRefreshInterval) clearInterval(lobbyRefreshInterval);

    // FORCE RELOAD to fix FPS issues on quit
    if (window.gameInstance) {
      window.location.reload();
      return;
    }

    els.mainMenu.style.display = 'flex';
    els.lobbyListScreen.style.display = 'none';
    els.lobbyScreen.style.display = 'none';
    els.createOptionsModal.style.display = 'none';
    els.customizeModal.style.display = 'none';
    els.howToPlayModal.style.display = 'none';
    els.joinPrivateModal.style.display = 'none';

    // Show footer and cookie banner when back to menu
    const footer = document.getElementById('copyrightFooter');
    if (footer) footer.style.display = 'flex';
    const cookieBanner = document.getElementById('cookieConsentBanner');
    if (cookieBanner) cookieBanner.style.display = 'block';

    app.style.display = 'block';

    // Start attract mode for background animation
    if (!window.attractGame) {
      window.attractGame = new GoobyGame();
      window.attractGame.init(app);
      window.attractGame.quality = 0; // Force Low Quality
    }
  };

  const joinLobby = (code, ping, isLocked, password = null) => {
    els.lobbyListScreen.style.display = 'none';
    els.joinPrivateModal.style.display = 'none';
    els.lobbyScreen.style.display = 'flex';

    els.lobbyCodeDisplay.innerText = code;

    // UI State
    if (els.iconLocked) els.iconLocked.style.display = isLocked ? 'inline-block' : 'none';
    if (els.lobbyPwdDisplay) els.lobbyPwdDisplay.style.display = 'none';

    // CLIENT STATE SETUP
    state.lobby.isHost = false;
    state.lobby.id = code;
    state.lobby.players = [{
      id: 'self',
      name: state.player.name,
      color: state.player.color,
      face: state.player.face,
      hat: state.player.hat,
      isHost: false, // Guest
      ping: 0
    }];
    state.lobby.messages = []; // Clear chat

    // Render Initial State
    if (window.updateLobbyUI) window.updateLobbyUI();
    if (window.updateChatUI) window.updateChatUI(); // Clear chat UI

    // NETWORK CONNECT
    if (window.networkManager && typeof window.networkManager.connect === 'function') {
      window.networkManager.connect(code, password);
    } else {
      // Fallback Mock for testing UI flow without NetworkManager
      setTimeout(() => {
        // Simulate Host Appearing
        state.lobby.players.unshift({ id: 'mock_host', name: 'Host (Offline)', color: '#888888', face: 'normal', isHost: true, ping: 99 });
        if (window.updateLobbyUI) window.updateLobbyUI();
      }, 500);
    }
  };

  els.btnOpenJoinPrivate.onclick = () => {
    els.joinPrivateModal.style.display = 'flex';
    els.privateCodeInput.value = '';
    els.privatePwdInput.value = '';
    els.privateCodeInput.focus();
  };

  els.btnCancelPrivateJoin.onclick = () => els.joinPrivateModal.style.display = 'none';

  els.btnConfirmPrivateJoin.onclick = () => {
    const code = els.privateCodeInput.value.trim();
    const pwd = els.privatePwdInput.value.trim();

    if (code.length >= 4) {
      // Allow join if code is valid (Password optional or required based on logic, here assume ok)
      joinLobby(code, Math.floor(Math.random() * 30 + 10), pwd.length > 0, pwd);
    } else {
      els.privateCodeInput.style.borderColor = 'red';
      setTimeout(() => els.privateCodeInput.style.borderColor = 'rgba(255,255,255,0.2)', 300);
    }
  };

  // Confirm/Cancel Prompt Buttons
  els.btnCancelJoinPrompt.onclick = () => {
    els.passwordPromptModal.style.display = 'none';
    els.joinPwdInput.value = '';
    els.joinErrorMsg.style.display = 'none';
    currentJoinTarget = null;
  };

  els.btnConfirmJoinPrompt.onclick = () => {
    const pwd = els.joinPwdInput.value;
    // Mock validation
    if (pwd.length > 0) {
      els.passwordPromptModal.style.display = 'none';
      els.joinPwdInput.value = '';
      els.joinErrorMsg.style.display = 'none';
      if (currentJoinTarget) joinLobby(currentJoinTarget.code, currentJoinTarget.ping, true, pwd);
    } else {
      els.joinErrorMsg.style.display = 'block';
      els.joinPwdInput.style.borderColor = 'red';
      setTimeout(() => els.joinPwdInput.style.borderColor = '#ef4444', 200);
    }
  };

  // LOBBY LIST HANDLER
  window.renderLobbyList = (rooms) => {
    if (!els.publicLobbyList) return;
    els.publicLobbyList.innerHTML = '';

    if (!rooms || rooms.length === 0) {
      els.publicLobbyList.innerHTML = '<div style="padding:40px; text-align:center; color:#64748b; font-style:italic;">No active lobbies found.<br><span style="font-size:0.8em">Be the first to create one!</span></div>';
      return;
    }

    rooms.forEach(room => {
      const code = room.id;
      const players = room.players || '?';
      const max = room.max || 10;
      const isLocked = room.hasPassword;

      const row = document.createElement('div');
      Object.assign(row.style, {
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '12px', background: 'rgba(255,255,255,0.05)', marginBottom: '8px',
        borderRadius: '8px', transition: 'background 0.2s', cursor: 'pointer'
      });

      row.innerHTML = `
               <div>
                  <span style="font-weight:bold; color: #e2e8f0;">Lobby #${code}</span>
                  ${isLocked ? '<span style="margin-left:8px; font-size:12px; background:rgba(255,0,0,0.2); color:#fca5a5; padding:2px 6px; border-radius:4px;">PRIVATE</span>' : ''}
               </div>
               <div style="font-size: 14px; color: #94a3b8;">
                   ${players}/${max} Players
               </div>
           `;

      row.onclick = () => {
        if (isLocked) {
          currentJoinTarget = { code, ping: 50 };
          els.passwordPromptModal.style.display = 'flex';
          els.joinPwdInput.focus();
        } else {
          joinLobby(code, 50, false);
        }
      };

      row.onmouseenter = () => row.style.background = 'rgba(255,255,255,0.1)';
      row.onmouseleave = () => row.style.background = 'rgba(255,255,255,0.05)';

      els.publicLobbyList.appendChild(row);
    });
  };

  const refreshLobbies = () => {
    els.publicLobbyList.innerHTML = '<div style="padding:20px; text-align:center; color:#94a3b8;">Scanning for lobbies...</div>';
    if (window.networkManager) window.networkManager.refreshList();
  };

  if (els.btnJoin) els.btnJoin.onclick = () => {
    els.lobbyListScreen.style.display = 'flex';
    refreshLobbies();

    // Start Polling (Mobile Connectivity Fix)
    if (lobbyRefreshInterval) clearInterval(lobbyRefreshInterval);
    lobbyRefreshInterval = setInterval(() => {
      if (els.lobbyListScreen.style.display !== 'none' && window.networkManager) {
        window.networkManager.refreshList();
      }
    }, 3000);
  };

  // HOW TO PLAY MODAL
  els.btnHowToPlay = uiLayer.querySelector('#btnHowToPlay');
  els.howToPlayModal = uiLayer.querySelector('#howToPlayModal');
  els.btnCloseHowToPlay = uiLayer.querySelector('#btnCloseHowToPlay');

  els.btnHowToPlay.onclick = () => {
    els.howToPlayModal.style.display = 'flex';
    if (window.gameInstance?.audio) try { window.gameInstance.audio.playUIClick(); } catch (e) { }
  };

  els.btnCloseHowToPlay.onclick = () => {
    els.howToPlayModal.style.display = 'none';
    if (window.gameInstance?.audio) try { window.gameInstance.audio.playUIClick(); } catch (e) { }
  };

  els.btnListRefresh.onclick = () => {
    if (els.btnListRefresh.disabled) return;

    // Anti-Spam Cooldown
    els.btnListRefresh.disabled = true;
    els.btnListRefresh.style.opacity = '0.5';
    const oldText = els.btnListRefresh.innerHTML;
    els.btnListRefresh.innerHTML = 'WAIT ⏳';

    els.publicLobbyList.innerHTML = '<div style="padding:20px; text-align:center; color:#94a3b8;">Refreshing...</div>';

    // Call existing refresh function
    setTimeout(refreshLobbies, 500);

    setTimeout(() => {
      if (els.btnListRefresh) {
        els.btnListRefresh.disabled = false;
        els.btnListRefresh.style.opacity = '1';
        els.btnListRefresh.innerHTML = oldText;
      }
    }, 2000);
  };

  els.btnListBack.onclick = () => {
    els.lobbyListScreen.style.display = 'none';
  };
  /* 
   const panel = document.getElementById('mainMenuPanel');
   // Disabled tilt effect to prevent flickering issues on some systems
  */
}

// Global Alias for Game Start (Used by UI and Network)
window.startMode = (mode, isRemote) => startGame(mode, isRemote);

function startGame(mode, isRemote = false) {

  // NETWORK: Broadcast Game Start (If Host and not a remote trigger)
  if (!isRemote && state.lobby.isHost && window.networkManager && typeof window.networkManager.broadcast === 'function') {
    let payload = { type: 'GAME_START', mode: mode };

    // SOCCER TEAM ASSIGNMENT (Host Authority)
    if (mode === 'SOCCER') {
      // Assign teams to all lobby players
      // We iterate state.lobby.players directly to modify the objects
      // Simple assignment: Alternating teams
      // TODO: Could add shuffle here for randomness
      state.lobby.players.forEach((p, idx) => {
        p.team = (idx % 2 === 0) ? 'BLUE' : 'RED';
      });

      // Include updated player list with teams in the broadcast
      payload.playersWithTeams = state.lobby.players;
    }

    window.networkManager.broadcast(payload);
  }

  try {
    // 1. Cleanup previous game instance
    if (window.gameInstance) {
      if (typeof window.gameInstance.destroy === 'function') window.gameInstance.destroy();
      window.gameInstance = null;
    }
    // 1.1 Cleanup Attract Mode
    if (window.attractGame) {
      if (typeof window.attractGame.destroy === 'function') window.attractGame.destroy();
      window.attractGame = null;
    }

    // 2. Remove UI Layer from BODY
    const uiLayer = document.getElementById('gooby-arena-ui-layer');
    if (uiLayer) uiLayer.remove();

    // 3. Reset App Canvas Container
    app.innerHTML = '';
    app.removeAttribute('style');
    Object.assign(app.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100vw',
      height: '100vh',
      margin: '0',
      padding: '0',
      zIndex: '1',
      display: 'block'
    });

    // Hide footer during gameplay
    const footer = document.getElementById('copyrightFooter');
    if (footer) footer.style.display = 'none';

    // 4. Create New Game Instance

    if (window.gameInstance) {
      if (typeof window.gameInstance.destroy === 'function') {
        window.gameInstance.destroy();
      }
      window.gameInstance = null;
    }

    // Force garbage collection hint (if available)
    if (window.gc) window.gc();

    const game = new GoobyGame((winner) => {
      // NETWORK: Broadcast winner to all clients (Host only)
      if (window.state?.lobby?.isHost && window.networkManager) {
        const winnerData = winner ? {
          name: winner.name,
          color: winner.color,
          peerId: winner.peerId || (winner === game.player ? 'host' : null),
          team: winner.team
        } : null;

        window.networkManager.broadcast({
          type: 'ROUND_END',
          winner: winnerData,
          mapType: game.mapType
        });
      }

      if (game && winner) {
        if (game.mapType === 'SOCCER') {
          const teamName = winner.team === 'RED' ? 'RED TEAM' : 'BLUE TEAM';
          const color = winner.team === 'RED' ? '#ef4444' : '#3b82f6';
          game.triggerBanner(`${teamName} WINS!`, "GET READY TO VOTE!", color);
        } else {
          game.triggerBanner(`${winner.name} WINS!`, "GET READY TO VOTE!", winner.color);
        }
        if (game.audio) game.audio.playWin();
        setTimeout(() => { game.startVortexVote(winner); }, 3000);
      } else if (game && !winner) {
        // No winner (draw)
        game.triggerBanner("ROUND OVER", "GET READY TO VOTE!", "#888");
        setTimeout(() => { game.startVortexVote(null); }, 3000);
      }
    });

    game.onVoteComplete = (modeId) => {
      startMode(modeId);
    };

    window.gameInstance = game;

    // 5. Config Game Mode
    if (mode === 'CLASSIC') {
      game.mapType = 'ARENA';
      game.hasHole = true;
    } else if (mode === 'HOT_POTATO') {
      game.activeAbilities.add('HOT_POTATO');
      game.mapType = 'ARENA';
      game.hasHole = false;
    } else if (mode === 'SOCCER') {
      game.activeAbilities.add('SOCCER_MODE');
      game.mapType = 'SOCCER';
    } else if (mode === 'VOID') {
      game.activeAbilities.add('VOID'); // Fixed: was VOID_MODE
      game.mapType = 'ARENA';
      game.hasHole = true;
    } else if (mode === 'CHAOS') {
      game.activeAbilities.add('CHAOS'); // Fixed: was CHAOS_MODE
      game.mapType = 'ARENA';
      game.hasHole = true;
    } else if (mode === 'SIZE_CHANGE') {
      game.activeAbilities.add('SIZE_CHANGE');
      game.mapType = 'ARENA';
      game.hasHole = true;
    } else if (mode === 'BOMB_DROP') {
      game.activeAbilities.add('BOMB_DROP');
      game.activeAbilities.add('BOMB_RAIN');
      game.mapType = 'ARENA';
      game.hasHole = true;
    } else if (mode === 'POWERFUL_PUSH') {
      game.activeAbilities.add('POWERFUL_PUSH');
      game.mapType = 'ARENA';
      game.hasHole = true;
    } else if (mode === 'SLIPPERY') {
      game.activeAbilities.add('SLIPPERY_GROUND');
      game.mapType = 'ARENA';
      game.hasHole = true;
    } else if (mode === 'CANDY_COLLECTOR') {
      game.activeAbilities.add('CANDY_COLLECTOR');
      game.mapType = 'ARENA';
      game.hasHole = false; // No hole - need space for candies!
    } else if (mode === 'LIGHTNING_STRIKE') {
      game.activeAbilities.add('LIGHTNING_STRIKE');
      game.mapType = 'ARENA';
      game.hasHole = false; // No hole - need full arena
    } else if (mode === 'BULLSEYE') {
      game.activeAbilities.add('BULLSEYE');
      game.mapType = 'ARENA';
      game.hasHole = false; // No hole - targets need space
    } else {
      game.mapType = 'ARENA';
      game.hasHole = true;
    }

    // 6. Initialize Canvas
    game.init(app, { ...state.player });

    // 7. Spawn Networked Players (MULTIPLAYER)

    if (window.state?.lobby?.isHost && window.networkManager?.connections.length > 0) {
      // HOST: Spawn connected clients as enemies

      state.lobby.players.forEach(lobbyPlayer => {
        if (lobbyPlayer.id !== 'self' && lobbyPlayer.id !== window.networkManager.peerId) {
          const enemy = game.spawnNetworkedPlayer({
            name: lobbyPlayer.name,
            color: lobbyPlayer.color,
            face: lobbyPlayer.face,
            hat: lobbyPlayer.hat,
            peerId: lobbyPlayer.id
          });
        }
      });
    } else if (window.state?.lobby?.isHost === false && window.networkManager?.isConnected) {
      // CLIENT: Spawn host as enemy

      const hostPlayer = state.lobby.players.find(p => p.isHost);
      if (hostPlayer) {
        const enemy = game.spawnNetworkedPlayer({
          name: hostPlayer.name,
          color: hostPlayer.color,
          face: hostPlayer.face,
          hat: hostPlayer.hat,
          peerId: 'host',
          isHost: true
        });
      }

      // Also spawn other clients
      state.lobby.players.forEach(p => {
        if (!p.isHost && p.id !== window.state.network?.peerId) {
          const enemy = game.spawnNetworkedPlayer({
            name: p.name,
            color: p.color,
            face: p.face,
            hat: p.hat,
            peerId: p.id
          });
        }
      });
    }

    // 8. Spawn AI Entities (SINGLE PLAYER ONLY)
    const isMultiplayer = window.state?.lobby?.players?.length > 1;
    if (!isMultiplayer) {
      if (mode === 'VOID') game.spawnBlackHole();
      if (mode !== 'SOCCER') game.spawnBot();
    }

    // Debug: Verify spawned entities
    game.enemies.forEach((e, idx) => {
    });

    // 9. START THE ROUND

  } catch (error) {
    alert("Error starting game! Check console.");
  }
}

// Expose functions globally
// (startMode already defined above with isRemote parameter)
window.renderMainMenu = renderMainMenu;

// GLOBAL ERROR HANDLER FOR SOCKET
if (window.networkManager && window.networkManager.socket) {
  window.networkManager.socket.on('connect_error', (err) => {
    const list = document.getElementById('publicLobbyList');
    if (list) {
      list.innerHTML = `<div style="padding:20px; color:#ef4444; text-align:center; background:rgba(255,0,0,0.1); border-radius:8px;">
                 <strong>⚠️ Server Error</strong><br>
                 Cannot connect to Signalling Server (Render Server).<br>
                 <span style="font-size:0.8em; opacity:0.8;">Make sure 'node server.js' is running.</span>
            </div>`;
    }
  });
}

// Start App
renderMainMenu();

// ═══════════════════════════════════════════════════════════
//  GAMEPAD MENU NAVIGATION
// ═══════════════════════════════════════════════════════════
let selectedButtonIndex = 0;
let lastGamepadInput = 0;
const gamepadInputDelay = 200; // ms between inputs

function updateMenuGamepad() {
  if (!window.attractGame?.gamepad?.connected) return;

  const now = Date.now();
  if (now - lastGamepadInput < gamepadInputDelay) return;

  const mainButtons = document.querySelectorAll('#menuButtons .btn');
  if (mainButtons.length === 0) return;

  // Navigation (D-pad or Left Stick)
  if (window.attractGame.gamepad.isMenuDown()) {
    lastGamepadInput = now;
    selectedButtonIndex = (selectedButtonIndex + 1) % mainButtons.length;
    highlightButton(mainButtons);
  } else if (window.attractGame.gamepad.isMenuUp()) {
    lastGamepadInput = now;
    selectedButtonIndex = (selectedButtonIndex - 1 + mainButtons.length) % mainButtons.length;
    highlightButton(mainButtons);
  }

  // Confirm (A button)
  if (window.attractGame.gamepad.isMenuConfirm()) {
    lastGamepadInput = now;
    mainButtons[selectedButtonIndex]?.click();
  }
}

function highlightButton(buttons) {
  buttons.forEach((btn, idx) => {
    if (idx === selectedButtonIndex) {
      btn.style.transform = 'scale(1.05)';
      btn.style.boxShadow = '0 0 20px rgba(99, 102, 241, 0.8)';
    } else {
      btn.style.transform = 'scale(1)';
      btn.style.boxShadow = '';
    }
  });
}

// Poll gamepad for menu navigation
setInterval(updateMenuGamepad, 50);
