import './style.css';
import { SoundManager } from './audio.js';
import { SeededRNG } from './rng.js';
import { ChatSystem } from './chat.js';
import { GamepadManager } from './gamepad.js';
import { TouchControls } from './touch.js';
import { CONFIG } from './config.js';
import { Entity, Bomb, Particle, BlackHole } from './entity.js';

// Game configuration

export class GoobyGame {
    constructor(onRoundEnd, onScoreUpdate, gameSeed = null) {
        this.canvas = null;
        this.ctx = null;
        this.isRunning = false;
        this.onRoundEnd = onRoundEnd;
        this.onScoreUpdate = onScoreUpdate;

        // DETERMINISTIC RNG for WebRTC Sync
        this.gameSeed = gameSeed || Date.now(); // Host generates, clients receive
        this.rng = new SeededRNG(this.gameSeed);
        this.frameCount = 0; // For deterministic timers // Callback for UI

        this.audio = new SoundManager();
        this.gamepad = new GamepadManager(); // Controller support

        // Initialize touch controls (will be added later in init)
        this.touchControls = null;

        // Map Types: ARENA (Center Hole), SOCCER (Goals)
        this.mapType = 'ARENA'; // Default map
        this.hasHole = true; // Center hole active by default

        this.player = null;
        this.enemies = [];
        this.bombs = [];
        this.particles = [];
        this.blackHoles = [];

        this.activeAbilities = new Set();
        this.gameStartTime = 0;
        this.isGameReady = false;

        this.roundWinner = null;

        this.roundTime = 15; // 15 second rounds
        this.timeLeft = this.roundTime;
        this.lastTime = 0;
        this.roundActive = false;

        this.bombRainTimer = 0;
        this.nextSizeChange = 0;
        this.chatActive = false; // Chat open flag

        this.width = 0;
        this.height = 0;
        this.deathZonePercent = 0.08; // Very small death zones (Wide Playable Area)

        this.shake = { x: 0, y: 0, str: 0 };

        this.keys = { space: false, e: false };
        this.mouse = { x: 0, y: 0, down: false };

        // Camera for visual effects
        this.camera = { x: 0, y: 0, zoom: 1.0 };

        // Hot Potato specific
        this.potatoTarget = null;
        this.potatoTimer = CONFIG.HOT_POTATO_TIMER;

        // Candy Collector specific
        this.candies = [];
        this.candySpawnTimer = 0;
        this.playerScores = new Map(); // playerId -> score

        // Lightning Strike specific
        this.lightningWarnings = []; // {x, y, timer}
        this.lightningSpawnTimer = 0;
        this.lightningStrike = []; // {x, y, timer}

        // Bullseye specific
        this.targets = []; // {x, y, dx, dy, radius}
        this.bullseyeScores = new Map(); // playerId -> score

        // Bomb Drop cooldown
        this.playerBombCooldown = 0; // Timestamp for next bomb drop

        // Fixed Timestep Engine
        this.accumulator = 0;
        this.fixedStep = 1 / 60;
        this.physicsTime = 0;
        this.bgCanvas = null; // Offscreen cache

        this.fps = 60;
        this.fpsFrames = 0;
        this.fpsLastTime = performance.now();
        this.showFPS = false; // Toggle with F3

        this.loop = this.loop.bind(this);

        // Bind event handlers for cleanup
        this.handleResize = this.handleResize.bind(this);
        this.resumeAudio = this.resumeAudio.bind(this);
        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.handleKeyUp = this.handleKeyUp.bind(this);
        this.handleMouseMove = this.handleMouseMove.bind(this);
        this.handleMouseDown = this.handleMouseDown.bind(this);

        this.animationFrameId = null; // Store ID to cancel later

        // BROWSER HINT: Force 60 FPS lock with fast empty frames
        this.vsyncWarmup();

        // Page reload protection: Re-warm on visibility change
        this.handleVisibilityChange = () => {
            if (!document.hidden) this.vsyncWarmup();
        };
        document.addEventListener('visibilitychange', this.handleVisibilityChange);

        this.quality = 1; // 1: High, 0: Low
        this.lowFpsFrames = 0;
    }

    vsyncWarmup() {

        // This prevents F5 refresh throttling
        let count = 0;
        const warmup = () => {
            if (count++ < 30) requestAnimationFrame(warmup);
        };
        requestAnimationFrame(warmup);
    }

    destroy() {
        this.isRunning = false;
        document.body.classList.remove('panic-mode'); // Guarantee clean state
        window.removeEventListener('resize', this.handleResize);
        window.removeEventListener('click', this.resumeAudio);
        window.removeEventListener('keydown', this.resumeAudio);
        window.removeEventListener('keydown', this.handleKeyDown);
        window.removeEventListener('keyup', this.handleKeyUp);
        if (this.handleVisibilityChange) {
            document.removeEventListener('visibilitychange', this.handleVisibilityChange);
        }

        if (this.canvas) {
            this.canvas.removeEventListener('mousedown', this.handleMouseDown);
            this.canvas.removeEventListener('mousemove', this.handleMouseMove);
            this.canvas.remove();
        }

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        if (this.audio) {
            this.audio.stopMusic();
            if (typeof this.audio.close === 'function') this.audio.close();
            this.audio = null;
        }

        if (this.chat) {
            this.chat.destroy();
            this.chat = null;
        }

        if (this.touchControls) {
            this.touchControls.destroy();
            this.touchControls = null;
        }

        // AGGRESSIVE CLEANUP for FPS
        this.enemies = [];
        this.candies = [];
        this.bombs = [];
        this.blackHoles = [];
        this.lightningWarnings = [];
        this.particles = [];
        this.vortexes = [];
        this.fogGradient = null; // Important: Clear gradient cache

        if (this.playerScores) this.playerScores.clear();
        if (this.bullseyeScores) this.bullseyeScores.clear();
        if (this.activeAbilities) this.activeAbilities.clear(); // Prevents mod leaks
        this.player = null;
    }

    handleResize() {
        this.resize();
    }

    resumeAudio() {
        if (this.audio && this.audio.ctx && this.audio.ctx.state === 'suspended') {
            this.audio.ctx.resume();
        }
    }

    handleKeyDown(e) {
        if (e.code === 'Space') {
            this.keys.space = true;
            this.inputAction = 'DASH';
        }
        if (e.code === 'KeyE') {
            this.keys.e = true;
            if (this.activeAbilities.has('HOT_POTATO') && this.potatoTarget === this.player && !this.player.dead) {
                // MULTIPLAYER: Only host processes potato logic
                if (window.state?.lobby?.isHost !== false) {
                    // Host: Find nearest and pass potato
                    let nearest = null;
                    let minDist = 150;
                    this.enemies.forEach(enemy => {
                        if (!enemy.dead) {
                            const d = Math.hypot(enemy.x - this.player.x, enemy.y - this.player.y);
                            if (d < minDist) { minDist = d; nearest = enemy; }
                        }
                    });
                    if (nearest) { this.passPotato(nearest); this.audio.playHit(1.5); }
                } else {
                    // Client: Send INPUT to host, host will handle potato logic
                    if (window.networkManager) {
                        window.networkManager.sendInput({
                            passPotatoKey: true
                        });
                        this.audio.playHit(1.5); // Audio feedback
                    }
                }
            }
            else if (this.activeAbilities.has('BOMB_DROP') && !this.player.dead) {
                if (Date.now() >= this.playerBombCooldown) {
                    this.dropBomb(this.player);
                    this.playerBombCooldown = Date.now() + 2000;
                }
            }
        }
        if (e.code === 'KeyX') {
            const isClassic = this.activeAbilities.size === 0 && this.mapType === 'ARENA';
            if (isClassic && !this.player.dead) {
                const decoy = this.spawnDecoy(this.player);

                // NETWORK BROADCAST: Notify other players about decoy spawn
                if (window.networkManager) {
                    if (window.state && window.state.lobby && window.state.lobby.isHost) {
                        if (decoy) {
                            window.networkManager.broadcast({
                                type: 'DECOY_SPAWN',
                                decoyId: decoy.id,
                                ownerId: 'host',
                                x: this.player.x,
                                y: this.player.y,
                                color: this.player.color,
                                name: this.player.name,
                                face: this.player.face,
                                hat: this.player.hat,
                                dx: this.player.dx,
                                dy: this.player.dy
                            });
                        }
                    } else if (window.networkManager.sendInput) {
                        window.networkManager.sendInput({ action: 'DECOY_SPAWN' });
                    }
                }
            }
        }
        if (e.code === 'KeyT') {
            if (!this.player.dead) {
                const emojis = ['😂', '😎', '🤡', '💀', '🔥', '💩', '👻', '🤮', '🥱', '😴', '🤓', '😈'];
                const emojiId = this.rng.randomInt(0, emojis.length);
                const emoji = emojis[emojiId];
                this.player.triggerTaunt(emoji);

                if (window.networkManager) {
                    if (window.state && window.state.lobby && window.state.lobby.isHost) {
                        window.networkManager.broadcast({
                            type: 'PLAYER_EMOJI',
                            peerId: 'host',
                            emoji: emoji
                        });
                    } else {
                        window.networkManager.sendInput({
                            val: 0, // Dummy
                            action: 'EMOJI',
                            emoji: emoji
                        });
                    }
                }
            }
        }
        if (e.code === 'F3') this.showFPS = !this.showFPS;
    }

    handleKeyUp(e) {
        if (e.code === 'Space') this.keys.space = false;
    }

    handleMouseDown() {
        this.mouse.down = true;
        this.inputAction = 'DASH';
    }

    handleMouseMove(e) {
        if (!this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        this.mouse.x = (e.clientX - rect.left) * scaleX;
        this.mouse.y = (e.clientY - rect.top) * scaleY;
    }

    init(container, playerData, allPlayers = null) {
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'game-canvas';
        this.ctx = this.canvas.getContext('2d');
        container.innerHTML = '';
        container.appendChild(this.canvas);

        // Initialize touch controls (mobile)
        if (!this.touchControls) {
            this.touchControls = new TouchControls(this.canvas);
        }

        // QUIT BUTTON (Overlay) - Only in actual gameplay, not attract mode
        if (!this.attractMode) {
            const quitBtn = document.createElement('button');
            quitBtn.innerText = 'QUIT 🚪';
            Object.assign(quitBtn.style, {
                position: 'fixed',
                bottom: '20px',
                left: 'auto',
                right: '20px',
                padding: '12px 24px',
                background: 'rgba(239, 68, 68, 0.2)',
                color: '#fca5a5',
                border: '1px solid #ef4444',
                borderRadius: '8px',
                fontFamily: "'Orbitron', sans-serif",
                fontWeight: 'bold',
                fontSize: '1rem',
                cursor: 'pointer',
                zIndex: '100',
                backdropFilter: 'blur(4px)',
                transition: 'all 0.2s'
            });

            quitBtn.onmouseenter = () => {
                quitBtn.style.background = 'rgba(239, 68, 68, 0.8)';
                quitBtn.style.color = 'white';
                quitBtn.style.transform = 'scale(1.05)';
            };
            quitBtn.onmouseleave = () => {
                quitBtn.style.background = 'rgba(239, 68, 68, 0.2)';
                quitBtn.style.color = '#fca5a5';
                quitBtn.style.transform = 'scale(1)';
            };

            quitBtn.onclick = () => {
                const isHost = (window.state && window.state.lobby && window.state.lobby.isHost);
                const msg = isHost ? "WARNING: You are the HOST. This will end the game for everyone. Quit?" : "Return to Main Menu?";

                if (confirm(msg)) {
                    // 1. Notify Network (If Host)
                    if (window.networkManager && isHost) {
                        // Broadcast quit notification immediately
                        if (typeof window.networkManager.broadcast === 'function') {
                            window.networkManager.broadcast({ type: 'HOST_QUIT' });
                        }
                    }

                    // 2. Clear Game State
                    if (this.audio) this.audio.stopMusic();
                    this.isRunning = false;

                    // 3. Force Refresh (Cleanest Exit)
                    // Small delay to ensure network message goes out
                    setTimeout(() => {
                        window.location.reload();
                    }, 100);
                }
            };

            container.appendChild(quitBtn);
        }

        // WebRTC: Initialize In-Game Chat
        if (!this.chat) {
            this.chat = new ChatSystem(this);
        }

        this.resize();
        window.addEventListener('resize', this.handleResize);

        window.addEventListener('click', this.resumeAudio);
        window.addEventListener('keydown', this.resumeAudio);

        window.addEventListener('keydown', this.handleKeyDown);
        window.addEventListener('keyup', this.handleKeyUp);

        this.vortexes = [];
        this.voteActive = false;
        this.voteTimer = 0;

        // Mouse Click Dash Support
        this.canvas.addEventListener('mousedown', this.handleMouseDown);

        // Mouse input tracking
        this.canvas.addEventListener('mousemove', this.handleMouseMove);

        this.isRunning = true;

        // Initialize chat system
        this.chat = new ChatSystem(this);

        // Frame 1: Empty (browser sees fast frame → locks to 60 FPS)
        requestAnimationFrame(() => {
            // Frame 2: Start round only (entities + timers)
            requestAnimationFrame(() => {
                this.startRound(playerData, allPlayers);

                // Show touch controls if on mobile
                if (this.touchControls) {
                    this.touchControls.show();
                }

                // Frame 3: Cache map + start loop
                requestAnimationFrame(() => {
                    this.cacheMap();
                    this.audio.playStart();
                    this.lastTime = performance.now();
                    this.animationFrameId = requestAnimationFrame(this.loop);
                });
            });
        });
    }

    // Set callback for round end
    setRoundEndCallback(callback) {
        this.onRoundEnd = callback;
    }

    resize() {
        // LOGICAL RESOLUTION (Fixed for fair multiplayer & map consistency)
        // Everyone plays on a 1920x1080 map, scaled to fit their screen
        this.width = 1920;
        this.height = 1080;

        this.canvas.width = this.width;
        this.canvas.height = this.height;

        // Canvas is scaled by CSS (width: 100%, height: 100%, object-fit: contain)

        this.fogGradient = null; // Invalidate cache

        // Re-center Void Mode Black Hole
        if (this.activeAbilities.has('VOID') && this.blackHoles.length > 0) {
            this.blackHoles[0].x = this.width / 2;
            this.blackHoles[0].y = this.height / 2;
        }

        // Cache Background
        if (!this.bgCanvas) {
            this.bgCanvas = document.createElement('canvas');
            this.bgCtx = this.bgCanvas.getContext('2d');
        }
        this.bgCanvas.width = this.width;
        this.bgCanvas.height = this.height;
        this.cacheMap();
    }

    cacheMap() {
        if (!this.bgCtx) return;
        const ctx = this.bgCtx;
        ctx.clearRect(0, 0, this.width, this.height);

        // Background
        ctx.fillStyle = '#0b1121';
        ctx.fillRect(0, 0, this.width, this.height);

        // 1. VOID MODE (Event Horizon Theme) 🕳️
        if (this.activeAbilities.has('VOID')) {
            // Deep Void Background
            ctx.fillStyle = '#020617'; // Absolute black/blue
            ctx.fillRect(0, 0, this.width, this.height);

            const cx = this.width / 2;
            const cy = this.height / 2;

            // Event Horizon Lines (Concentic Circles)
            ctx.strokeStyle = '#4c1d95'; // Violet
            ctx.lineWidth = 2;

            for (let r = 100; r < Math.max(this.width, this.height); r += 100) {
                ctx.beginPath();
                ctx.arc(cx, cy, r, 0, Math.PI * 2);
                ctx.globalAlpha = Math.max(0.05, 1 - (r / 800)); // Fade out
                ctx.stroke();
            }
            ctx.globalAlpha = 1.0;

            // Accretion Disk (Subtle Glow center)
            ctx.beginPath();
            ctx.arc(cx, cy, 80, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(139, 92, 246, 0.1)';
            ctx.fill();
            ctx.strokeStyle = '#8b5cf6';
            ctx.lineWidth = 2;
            ctx.stroke();

            // "Consumed" debris (Static noise)
            ctx.fillStyle = '#6b21a8';
            for (let i = 0; i < 50; i++) {
                const angle = Math.random() * Math.PI * 2;
                const dist = 150 + Math.random() * 600;
                ctx.globalAlpha = Math.random() * 0.5;
                ctx.fillRect(cx + Math.cos(angle) * dist, cy + Math.sin(angle) * dist, 4, 4);
            }
            ctx.globalAlpha = 1.0;
        }
        // 2. CHAOS MODE (Priority: Space Theme) 🌌
        else if (this.activeAbilities.has('CHAOS')) {
            const grad = ctx.createRadialGradient(this.width / 2, this.height / 2, 0, this.width / 2, this.height / 2, this.width);
            grad.addColorStop(0, '#4c1d95'); // Violet
            grad.addColorStop(1, '#020617'); // Deep Space
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, this.width, this.height);

            // Stars
            ctx.fillStyle = '#fff';
            for (let i = 0; i < 100; i++) {
                ctx.globalAlpha = Math.random();
                ctx.beginPath(); ctx.arc(Math.random() * this.width, Math.random() * this.height, Math.random() * 2, 0, Math.PI * 2); ctx.fill();
            }
            ctx.globalAlpha = 1.0;
        }
        // 2. CANDY COLLECTOR (Darker Contrast Theme) 🍬
        else if (this.activeAbilities.has('CANDY_COLLECTOR')) {
            const grad = ctx.createRadialGradient(this.width / 2, this.height / 2, 0, this.width / 2, this.height / 2, this.width);
            grad.addColorStop(0, '#6b21a8'); // Purple
            grad.addColorStop(1, '#3b0764'); // Dark Indigo
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, this.width, this.height);

            // Subtle Pattern
            ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
            const size = 80;
            for (let x = 0; x < this.width; x += size * 2) {
                for (let y = 0; y < this.height; y += size * 2) {
                    ctx.beginPath(); ctx.arc(x, y, 20, 0, Math.PI * 2); ctx.fill();
                    ctx.beginPath(); ctx.arc(x + size, y + size, 20, 0, Math.PI * 2); ctx.fill();
                }
            }
        }
        // 3. SIZE CHANGE (Mutator Theme) 📏
        else if (this.activeAbilities.has('SIZE_CHANGE')) {
            // Pulse Theme (Orange/Blue)
            const grad = ctx.createLinearGradient(0, 0, this.width, this.height);
            grad.addColorStop(0, '#0f172a'); // Dark Slate
            grad.addColorStop(1, '#1e1b4b'); // Dark Indigo
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, this.width, this.height);

            // "Scale" Grid (Small and Large squares to represent size change)
            ctx.strokeStyle = 'rgba(234, 88, 12, 0.1)'; // Orange (Growth)
            ctx.lineWidth = 1;

            // Small Grid
            const smallGrid = 40;
            ctx.beginPath();
            for (let x = 0; x <= this.width; x += smallGrid) { ctx.moveTo(x, 0); ctx.lineTo(x, this.height); }
            for (let y = 0; y <= this.height; y += smallGrid) { ctx.moveTo(0, y); ctx.lineTo(this.width, y); }
            ctx.stroke();

            // Large Grid Overlay
            ctx.strokeStyle = 'rgba(56, 189, 248, 0.15)'; // Blue (Shrink)
            ctx.lineWidth = 2;
            const bigGrid = 160;
            ctx.beginPath();
            for (let x = 0; x <= this.width; x += bigGrid) {
                ctx.moveTo(x, 0); ctx.lineTo(x, this.height);
                // Cross markers at intersections
                ctx.moveTo(x - 10, 50); ctx.lineTo(x + 10, 50); // Just deco
            }
            for (let y = 0; y <= this.height; y += bigGrid) { ctx.moveTo(0, y); ctx.lineTo(this.width, y); }
            ctx.stroke();
        }
        // 4. HOT POTATO / BOMB RAIN (Danger Zone) 💣
        else if (this.activeAbilities.has('HOT_POTATO')) {
            const grad = ctx.createRadialGradient(this.width / 2, this.height / 2, 0, this.width / 2, this.height / 2, this.width);
            grad.addColorStop(0, '#450a0a'); // Dark Red
            grad.addColorStop(1, '#000000'); // Black
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, this.width, this.height);

            // Hazard Stripes
            ctx.fillStyle = 'rgba(255, 200, 0, 0.05)';
            const stripeW = 100;
            for (let i = -this.height; i < this.width; i += stripeW * 2) {
                ctx.beginPath();
                ctx.moveTo(i, 0);
                ctx.lineTo(i + stripeW, 0);
                ctx.lineTo(i + stripeW - this.height, this.height);
                ctx.lineTo(i - this.height, this.height);
                ctx.fill();
            }
        }
        // 5. BOMB RAIN (War Zone Theme) 💣
        else if (this.activeAbilities.has('BOMB_DROP') || this.activeAbilities.has('BOMB_RAIN')) {
            // Apocalyptic Sky
            const grad = ctx.createLinearGradient(0, 0, 0, this.height);
            grad.addColorStop(0, '#451a03'); // Dark Amber
            grad.addColorStop(1, '#78350f'); // Reddish Brown
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, this.width, this.height);

            // Impact Craters
            ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
            for (let i = 0; i < 20; i++) {
                const x = Math.random() * this.width;
                const y = Math.random() * this.height;
                const r = 30 + Math.random() * 80;
                ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
            }
        }
        // 6. POWER MODE (Cyberpunk Neon Theme) ⚡
        else if (this.activeAbilities.has('POWERFUL_PUSH')) {
            // Cyber Gradient
            const grad = ctx.createLinearGradient(0, 0, this.width, this.height);
            grad.addColorStop(0, '#2e1065'); // Violet 900
            grad.addColorStop(1, '#0f172a'); // Slate 900
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, this.width, this.height);

            // Neon Grid
            ctx.strokeStyle = 'rgba(192, 132, 252, 0.4)'; // Purple Neon
            ctx.lineWidth = 2;

            ctx.beginPath();
            const gridSize = 80;
            // Digital Rain Grid Effect
            for (let x = 0; x <= this.width; x += gridSize) {
                ctx.moveTo(x, 0); ctx.lineTo(x, this.height);
            }
            for (let y = 0; y <= this.height; y += gridSize) {
                ctx.moveTo(0, y); ctx.lineTo(this.width, y);
            }
            ctx.stroke();

            // Glowing Nodes
            ctx.fillStyle = '#e879f9';
            for (let x = 0; x <= this.width; x += gridSize) {
                for (let y = 0; y <= this.height; y += gridSize) {
                    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
                }
            }
        }
        // 6. SLIPPERY MODE (Ice Theme) ❄️
        else if (this.activeAbilities.has('SLIPPERY_GROUND')) {
            const grad = ctx.createRadialGradient(this.width / 2, this.height / 2, 0, this.width / 2, this.height / 2, this.width);
            grad.addColorStop(0, '#0c4a6e'); // Dark Blue
            grad.addColorStop(1, '#082f49'); // Deep Dark Blue
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, this.width, this.height);

            // Cracks
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'; // Subtle cracks
            ctx.lineWidth = 2;
            ctx.beginPath();
            for (let i = 0; i < 40; i++) {
                const x = Math.random() * this.width;
                const y = Math.random() * this.height;
                const len = 30 + Math.random() * 80;
                const angle = Math.random() * Math.PI * 2;
                ctx.moveTo(x, y);
                ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
            }
            ctx.stroke();
        }
        // 7. SOCCER (Grass) ⚽
        else if (this.mapType === 'SOCCER') {
            ctx.fillStyle = '#166534';
            ctx.fillRect(0, 0, this.width, this.height);
            // Center Line
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.lineWidth = 5;
            ctx.beginPath(); ctx.moveTo(this.width / 2, 50); ctx.lineTo(this.width / 2, this.height - 50); ctx.stroke();
            // Center Circle
            ctx.beginPath(); ctx.arc(this.width / 2, this.height / 2, 80, 0, Math.PI * 2); ctx.stroke();

            // Goals
            const goalH = this.height * 0.4;
            const goalY = this.height * 0.3;
            // Left Goal Zone
            ctx.fillStyle = 'rgba(239, 68, 68, 0.2)'; ctx.fillRect(0, goalY, 60, goalH);
            ctx.strokeStyle = '#ef4444'; ctx.strokeRect(0, goalY, 60, goalH);
            // Right Goal Zone
            ctx.fillStyle = 'rgba(59, 130, 246, 0.2)'; ctx.fillRect(this.width - 60, goalY, 60, goalH);
            ctx.strokeStyle = '#3b82f6'; ctx.strokeRect(this.width - 60, goalY, 60, goalH);
        }
        // 8. STORM MODE (Lightning) ⚡
        else if (this.activeAbilities.has('LIGHTNING_STRIKE')) {
            // Stormy Sky
            const grad = ctx.createLinearGradient(0, 0, 0, this.height);
            grad.addColorStop(0, '#1e293b'); // Slate 800
            grad.addColorStop(1, '#0f172a'); // Slate 900
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, this.width, this.height);

            // Rain Lines (Static)
            ctx.strokeStyle = 'rgba(148, 163, 184, 0.1)'; // Rain color
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let i = 0; i < 100; i++) {
                const x = Math.random() * this.width;
                const y = Math.random() * this.height;
                const len = 20 + Math.random() * 30;
                ctx.moveTo(x, y);
                ctx.lineTo(x - 5, y + len); // Slanted rain
            }
            ctx.stroke();
        }
        // 9. TARGET PRACTICE (Bullseye) 🎯
        else if (this.activeAbilities.has('BULLSEYE')) {
            // Tactical Green
            ctx.fillStyle = '#064e3b'; // Emerald 900
            ctx.fillRect(0, 0, this.width, this.height);

            // Target Rings (Background decoration)
            ctx.strokeStyle = 'rgba(16, 185, 129, 0.1)'; // Emerald 500
            ctx.lineWidth = 2;
            const cx = this.width / 2;
            const cy = this.height / 2;
            for (let r = 100; r < 800; r += 150) {
                ctx.beginPath();
                ctx.arc(cx, cy, r, 0, Math.PI * 2);
                ctx.stroke();
            }

            // Crosshair Lines
            ctx.beginPath();
            ctx.moveTo(cx, 0); ctx.lineTo(cx, this.height);
            ctx.moveTo(0, cy); ctx.lineTo(this.width, cy);
            ctx.stroke();
        }
        // 10. DEFAULT CLASSIC ARENA (E-Sports Stadium V2) 🏟️
        else {
            // Background: Deep Indigo (More vibrant than Slate)
            ctx.fillStyle = '#1e1b4b';
            ctx.fillRect(0, 0, this.width, this.height);

            // Grid: Bright Indigo (Tech Look)
            ctx.strokeStyle = 'rgba(99, 102, 241, 0.15)'; // Indigo 500
            ctx.lineWidth = 2;

            ctx.beginPath();
            const gridSize = 100;

            for (let x = 0; x <= this.width; x += gridSize) {
                ctx.moveTo(x, 0); ctx.lineTo(x, this.height);
            }
            for (let y = 0; y <= this.height; y += gridSize) {
                ctx.moveTo(0, y); ctx.lineTo(this.width, y);
            }
            ctx.stroke();

            // Center Decoration (Hexagon)
            ctx.beginPath();
            const r = 150;
            const cx = this.width / 2;
            const cy = this.height / 2;
            for (let i = 0; i < 6; i++) {
                const angle = (Math.PI / 3) * i;
                const x = cx + r * Math.cos(angle);
                const y = cy + r * Math.sin(angle);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.closePath();
            ctx.strokeStyle = 'rgba(99, 102, 241, 0.3)';
            ctx.lineWidth = 4;
            ctx.stroke();

            // Corner Accents (Triangles)
            ctx.fillStyle = 'rgba(99, 102, 241, 0.1)';
            const cS = 150;

            // Top Left
            ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(cS, 0); ctx.lineTo(0, cS); ctx.fill();
            // Top Right
            ctx.beginPath(); ctx.moveTo(this.width, 0); ctx.lineTo(this.width - cS, 0); ctx.lineTo(this.width, cS); ctx.fill();
            // Bottom Left
            ctx.beginPath(); ctx.moveTo(0, this.height); ctx.lineTo(cS, this.height); ctx.lineTo(0, this.height - cS); ctx.fill();
            // Bottom Right
            ctx.beginPath(); ctx.moveTo(this.width, this.height); ctx.lineTo(this.width - cS, this.height); ctx.lineTo(this.width, this.height - cS); ctx.fill();
        }

        // HOLE (Always draw last if exists)
        if (this.hasHole) {
            const cx = this.width / 2; const cy = this.height / 2;
            const holeRadius = 80;
            const g = ctx.createRadialGradient(cx, cy, holeRadius, cx, cy, holeRadius * 2);
            g.addColorStop(0, 'rgba(0,0,0,0.5)');
            g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(cx, cy, holeRadius * 2, 0, Math.PI * 2); ctx.fill();

            ctx.fillStyle = '#000';
            ctx.beginPath(); ctx.arc(cx, cy, holeRadius, 0, Math.PI * 2); ctx.fill();

            ctx.strokeStyle = this.activeAbilities.has('SLIPPERY_GROUND') ? '#38bdf8' : '#ef4444';
            ctx.lineWidth = 5;
            ctx.stroke();
        }
    }

    initSoccerMode() {
        this.bombs = []; // No bombs in soccer
        this.scores = { RED: 0, BLUE: 0 };
        this.ball = new Ball(this.width / 2, this.height / 2);
        this.hasHole = false; // No void in soccer mode

        // MULTIPLAYER: Team assignment is done via broadcast, not here
        // Each client will apply team colors when they receive TEAM_ASSIGNMENT event
        // For now, just position players
        const allPlayers = [this.player, ...this.enemies].filter(p => p);

        allPlayers.forEach((p, idx) => {
            if (!p) return;
            p.speedMult = 0.85;
            p.isSoccerPlayer = true;
        });
    }

    applySoccerTeams(teamAssignments) {
        // Apply team assignments received from host
        // teamAssignments is a map: { peerId: 'BLUE' or 'RED' }

        if (this.player && teamAssignments['host']) {
            const myTeam = teamAssignments[window.state.network?.peerId || 'host'];
            if (myTeam) {
                this.player.team = myTeam;
                this.player.color = myTeam === 'BLUE' ? COLORS.BLUE_TEAM : COLORS.RED_TEAM;
                this.player.cacheDirty = true;
            }
        }

        this.enemies.forEach(e => {
            if (!e || !e.peerId) return;
            const team = teamAssignments[e.peerId];
            if (team) {
                e.team = team;
                e.color = team === 'BLUE' ? COLORS.BLUE_TEAM : COLORS.RED_TEAM;
                e.cacheDirty = true;
            }
        });
    }

    getSafeSpawnPos() {
        let x, y, safe = false;
        let attempts = 0;
        const border = 60;

        while (!safe && attempts < 100) {
            attempts++;
            x = border + this.rng.random() * (this.width - 2 * border);
            y = border + this.rng.random() * (this.height - 2 * border);
            safe = true;

            if (this.mapType === 'CLASSIC') {
                const deathW = this.width * this.deathZonePercent;
                if (x < deathW + border || x > this.width - deathW - border) safe = false;
            }
            // No special spawn logic for other maps
        }
        return { x, y };
    }

    startAttractMode() {
        this.attractMode = true;
        this.startRound(null);
        this.activeAbilities.clear();
        this.timeLeft = Infinity; // Infinite time for attract mode
        this.roundActive = true;

        this.player = new Entity(100, 100, '#ffffff', 'Demobot', false, 0);
        this.player.isPlayer = false;
        this.player.invulnTimer = 0;
        this.player.speedMult = 0.5;
        this.spawnBot(); this.spawnBot(); // Only 2 bots + Demobot

        // Wake up call
        [this.player, ...this.enemies].forEach(e => {
            e.dx = (this.rng.random() - 0.5) * 2;
            e.dy = (this.rng.random() - 0.5) * 2;
        });
    }

    // AI Logic for Bots
    updateAI(e, dt) {
        // ATTRACT MODE: Random Wandering (Visuals Only)
        if (this.attractMode) {
            // Initialize wander state
            if (!e.wanderTimer) e.wanderTimer = 0;

            e.wanderTimer--;
            if (e.wanderTimer <= 0) {
                e.wanderTimer = 60 + this.rng.random() * 120; // 1-3 seconds
                const angle = this.rng.random() * Math.PI * 2;
                e.targetDX = Math.cos(angle);
                e.targetDY = Math.sin(angle);
            }

            // Gentle boundary turn
            const margin = 100;
            if (e.x < margin) e.targetDX = Math.abs(e.targetDX) || 0.5;
            if (e.x > this.width - margin) e.targetDX = -Math.abs(e.targetDX) || -0.5;
            if (e.y < margin) e.targetDY = Math.abs(e.targetDY) || 0.5;
            if (e.y > this.height - margin) e.targetDY = -Math.abs(e.targetDY) || -0.5;

            // Slow down attract mode movement for aesthetics & performance
            e.applyInput((e.targetDX || 0) * 0.3, (e.targetDY || 0) * 0.3);
            return;
        }

        // VOTE MODE AI: Disable movement (handled by UI votes)
        if (this.voteActive) return;

        // PERFORMANCE: Throttle AI updates (every 3 frames)
        if (!e.aiThrottle) e.aiThrottle = 0;
        e.aiThrottle++;
        if (e.aiThrottle < 3) return;
        e.aiThrottle = 0;

        // TARGET FINDING
        if (!e.target || e.target.dead) {
            let target = null;
            let minD = 9999;
            const all = [this.player, ...this.enemies].filter(o => o); // Filter null
            all.forEach(other => {
                if (other !== e && !other.dead) {
                    const d = Math.hypot(other.x - e.x, other.y - e.y);
                    if (d < minD) { minD = d; target = other; }
                }
            });

            if (target) {
                const dx = target.x - e.x;
                const dy = target.y - e.y;
                // Apply input normalized
                const dist = minD || 1;
                e.applyInput(dx / dist, dy / dist);

                // Dash if close and facing
                if (dist < 150 && dist > 60 && this.rng.random() < 0.005) { // Deterministic dash chance
                    e.dash(target.x, target.y, 25); // Dash attack
                }
            }
        }
    }

    // P2P HOOK: Call this when receiving weather data
    setRoundWeather(type) {
        this.weather = type;
        // Reset or init weather particles if needed
    }

    startRound(playerData, allPlayers = null) {
        // CLEANUP: Prevent memory leaks
        this.killFeed = [];
        this.timeLeft = this.roundTime;
        this.roundActive = true;
        this.bombs = [];
        this.particles = [];
        this.blackHoles = [];
        this.candies = [];
        this.lightningWarnings = [];
        this.lightningStrike = [];
        this.targets = [];
        this.playerScores.clear();
        this.bullseyeScores.clear();

        // Reset timers
        this.frameCount = 0;
        this.lightningSpawnTimer = 0;
        this.candySpawnTimer = 0;
        this.playerBombCooldown = 0;

        // Reset map hazards
        this.hasHole = true; // Default
        if (this.activeAbilities.has('BULLSEYE') || this.mapType === 'SOCCER' || this.activeAbilities.has('HOT_POTATO') || this.activeAbilities.has('LIGHTNING_STRIKE')) {
            this.hasHole = false;
        }

        if (this.activeAbilities.has('SOCCER_MODE')) {
            this.mapType = 'SOCCER';
            this.setRoundWeather('CLEAR');
        } else {
            // HOST LOGIC: Decide weather (Deterministic)
            const rand = this.rng.random();
            let w = 'CLEAR';
            if (this.activeAbilities.has('VOID_EATER')) w = 'SPACE_FOG';
            else if (rand > 0.8) w = 'FOG';
            else if (rand > 0.6) w = 'WIND';

            // In P2P: Host sends { weather: w } to clients
            this.setRoundWeather(w);
        }
        // CLASSIC is default

        // Setup based on Map
        if (this.mapType === 'SOCCER') {
            if (playerData) {
                this.spawnPlayer(playerData);
            } else if (!this.player) {
                // Attract mode - spawn dummy
                this.spawnPlayer({ name: 'Demo', color: '#888888' });
            }
            this.initSoccerMode();
            [this.player, ...this.enemies].filter(e => e).forEach(e => e.isSoccerPlayer = true);

            // HOST AUTHORITY: Assign teams
            if (window.state?.lobby?.isHost !== false && window.networkManager) {
                setTimeout(() => {
                    const teamAssignments = {};
                    const allPeerIds = ['host', ...window.state.lobby.players.filter(p => p.id !== 'host').map(p => p.id)];
                    const mid = Math.floor(allPeerIds.length / 2);

                    allPeerIds.forEach((peerId, idx) => {
                        teamAssignments[peerId] = idx < mid ? 'BLUE' : 'RED';
                    });

                    this.applySoccerTeams(teamAssignments);
                    window.networkManager.broadcast({
                        type: 'TEAM_ASSIGNMENT',
                        teams: teamAssignments
                    });
                }, 200);
            }
        } else {
            // Spawn player if data provided OR if it doesn't exist yet
            if (playerData) {
                this.spawnPlayer(playerData);
            } else if (!this.player) {
                // Attract mode - always ensure player exists
                this.spawnPlayer({ name: 'Demo', color: '#888888', face: 'normal', hat: 'none' });
            }

            // Check for networked players
            const hasNetworkedPlayers = this.enemies.some(e => e.peerId);
            if (!hasNetworkedPlayers && !this.attractMode) {
                this.enemies = [];
                this.spawnBot();
            }

            // Initialize Round Timer by Mode
            if (this.activeAbilities.has('HOT_POTATO') || this.activeAbilities.has('CANDY_COLLECTOR') || this.activeAbilities.has('BULLSEYE') || this.activeAbilities.has('LIGHTNING_STRIKE')) {
                this.timeLeft = 999; // Infinite (Hidden) - Game ends by objective/elimination
                this.roundEndTime = null;
            } else if (this.mapType === 'SOCCER') {
                this.timeLeft = Infinity; // Ends on score limit (5)
                this.roundEndTime = null;
            } else {
                this.timeLeft = 90; // 90s for Bomb Drop & Classic
                // REAL-TIME TIMER FIX: Use Date.now() to prevent pausing when tab is inactive
                this.roundEndTime = Date.now() + (this.timeLeft * 1000);
            }

            // Standard Random Abilities
            if (this.activeAbilities.has('CHAOS')) {
                this.activeAbilities.add('POWERFUL_PUSH');
                this.activeAbilities.add('SLIPPERY_GROUND');
                this.activeAbilities.add('BOMB_RAIN'); // User requested Bomb Rain bg, so we ensure ability is active
                this.activeAbilities.add('SIZE_CHANGE'); // NEW: Random sizes for Chaos!
            }
        }

        // Black hole spawn for chaos mode
        if (this.activeAbilities.has('CHAOS') && this.rng.random() < 0.5) this.spawnBlackHole(); // 50% chance

        // CRITICAL FOR VOID MODE: Spawn actual physics black hole at center (DETERMINISTIC)
        if (this.activeAbilities.has('VOID')) {
            // Spawn directly on both Host and Client
            const bh = new BlackHole(this.width / 2, this.height / 2);
            bh.pullRadius = 300;
            this.blackHoles.push(bh);
            // No broadcast needed since position is fixed/deterministic
        }

        // Size change ability
        if (this.activeAbilities.has('SIZE_CHANGE')) {
            this.nextSizeChange = this.roundTime - 10;
            this.triggerSizeChange();
        }

        // Hot Potato initial assignment (HOST ONLY to prevent desync)
        if (this.activeAbilities.has('HOT_POTATO')) {
            // Only Host picks the initial target
            if (window.state?.lobby?.isHost !== false) { // Host or single player
                const allChars = [this.player, ...this.enemies];
                if (allChars.length > 0) {
                    this.passPotato(allChars[this.rng.randomInt(0, allChars.length)]);
                    // TODO: Broadcast initial potato target to clients
                }
            }
            // Clients: Will receive potato target via network packet
        }

        // Candy Collector initialization
        if (this.activeAbilities.has('CANDY_COLLECTOR')) {
            this.candies = [];
            this.candySpawnTimer = 0;
            this.playerScores.clear();
            [this.player, ...this.enemies].forEach(e => {
                this.playerScores.set(e.id, 0);
            });
        }

        // Lightning Strike initialization
        if (this.activeAbilities.has('LIGHTNING_STRIKE')) {
            this.lightningWarnings = [];
            this.lightningStrike = [];
            this.lightningSpawnTimer = 120; // Start after 2 seconds
        }

        // Bullseye initialization
        if (this.activeAbilities.has('BULLSEYE')) {
            this.targets = [];
            this.bullseyeScores.clear();
            [this.player, ...this.enemies].forEach(e => {
                this.bullseyeScores.set(e.id, 0);
            });
            // Spawn 3 targets
            for (let i = 0; i < 3; i++) {
                this.spawnTarget();
            }
        }

        // Mode Name Logic Removed
        // Mode Name Toast removed as requested
    }

    showToast(text) {
        const toast = document.createElement('div');
        toast.className = 'ability-toast';
        toast.innerText = text;
        document.body.appendChild(toast);
        setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 3500);
    }
    // SERVER RECONCILIATION
    // Called by NetworkManager when a state update arrives
    reconcile(serverState, lastProcessedSeq, pendingInputs) {
        if (!this.player) return;

        // 1. Snap to Server State
        // This puts us "back in time" to where the server saw us
        this.player.x = serverState.x;
        this.player.y = serverState.y;
        this.player.dx = serverState.dx; // Sync velocity too
        this.player.dy = serverState.dy;

        // 2. Re-Simulate Pending Inputs
        // This brings us "back to the future" accurately
        const dt = 0.016; // Fixed 60Hz step

        pendingInputs.forEach(input => {
            // Apply Movement Input
            this.player.applyInput(input.dirX, input.dirY);

            // Advance Physics
            this.player.updatePhysics(this, dt);

            // Constrain
            this.checkBoundaries(this.player);
        });
    }

    spawnPlayer(data) {
        // PROFILE PERSISTENCE: Always use current player's face and hat if not provided
        // This ensures profile from main menu is preserved across mode changes
        const pName = data ? data.name : "Player";
        let pColor = data ? data.color : "#ff5733";
        const pFace = data ? data.face : 'normal';
        const pHat = data ? data.hat : 'none';
        const pId = data ? data.id : null;
        const pTeam = data ? data.team : null;

        let pos = (data && data.spawnPos) ? data.spawnPos : this.getSafeSpawnPos();

        // SOCCER MODE: Enforce Team Colors & Positions
        // NOTE: We override COLOR but preserve FACE and HAT
        if (this.mapType === 'SOCCER' && pTeam) {
            if (pTeam === 'RED') {
                pColor = '#ef4444';
                pos = { x: this.width * 0.75, y: this.height / 2 };
            } else if (pTeam === 'BLUE') {
                pColor = '#3b82f6';
                pos = { x: this.width * 0.25, y: this.height / 2 };
            }
        }

        // Create new player entity
        this.player = new Entity(pos.x, pos.y, pColor, pName, true, pFace, pHat, pTeam);
        if (pId) this.player.id = pId; // Persist ID
        this.player.potatoImmunity = 0; // Initialize potato immunity
    }

    // Spawn a networked player (Host or Client)
    spawnNetworkedPlayer(playerData) {
        let pos = playerData.spawnPos || this.getSafeSpawnPos();
        let color = playerData.color;

        // SOCCER MODE: Enforce Team Colors & Positions
        if (this.mapType === 'SOCCER') {
            if (playerData.team === 'RED') {
                color = '#ef4444'; // Red Team Color
                pos = { x: this.width * 0.75, y: this.height / 2 };
            } else if (playerData.team === 'BLUE') {
                color = '#3b82f6'; // Blue Team Color 
                pos = { x: this.width * 0.25, y: this.height / 2 };
            }
        }

        const networkedPlayer = new Entity(
            pos.x,
            pos.y,
            color,
            playerData.name,
            false, // not isPlayer (controlled remotely)
            playerData.face,
            playerData.hat,
            playerData.team // Add team property
        );

        // Tag for network sync
        networkedPlayer.peerId = playerData.peerId;
        networkedPlayer.isHost = playerData.isHost || false;
        networkedPlayer.potatoImmunity = 0;
        networkedPlayer.invulnTimer = 3000; // Spawn protection

        this.enemies.push(networkedPlayer);
        return networkedPlayer;
    }

    spawnBot() {
        // AI REMOVED for Multiplayer (except Attract Mode)
        if (!this.attractMode) return;

        // Limit total entities for performance (10 players max + 5 bots max = 15 total)
        if (this.enemies.length >= 14) return;

        const names = ["Bot_Alpha", "KillerGooby", "NoobSlayer", "ProGamer"];
        const colors = ["#ff3333", "#33ff33", "#ffff33", "#ff33ff"];
        // Force name Gooby for attract mode
        const name = this.attractMode ? "Gooby" : this.rng.choice(names);
        const color = this.rng.choice(colors);
        const face = 'angry'; // Bots match anger
        const hat = this.rng.choice(['none', 'hat', 'sunglasses', 'cowboy', 'horns']);
        const pos = this.getSafeSpawnPos();
        const newBot = new Entity(pos.x, pos.y, color, name, false, face, hat);
        newBot.potatoImmunity = 0;

        // Attract Mode Tweaks
        if (this.attractMode) {
            newBot.invulnTimer = 0; // No flicker
            newBot.speedMult = 0.5; // Slow Motion
        }

        this.enemies.push(newBot);
    }
    spawnBlackHole(inputX, inputY) {
        // In VOID MODE, we already have a massive central black hole. Do not spawn random ones.
        if (this.activeAbilities.has('VOID')) return;

        let x = inputX, y = inputY;

        // HOST LOGIC: Determine position if not provided
        if (x === undefined || y === undefined) {
            if (window.state?.lobby?.isHost === false) return; // Client waits for packet
            const pos = this.getSafeSpawnPos();
            x = pos.x; y = pos.y;

            // Broadcast
            if (window.networkManager) {
                window.networkManager.broadcast({
                    type: 'BLACK_HOLE_SPAWN',
                    x, y,
                    pullRadius: 200
                });
            }
        }

        const bh = new BlackHole(x, y);
        this.blackHoles.push(bh);
    }

    dropBomb(owner) {
        this.bombs.push(new Bomb(owner.x, owner.y, owner));

        // Broadcast
        if (window.state?.lobby?.isHost !== false && window.networkManager) {
            window.networkManager.broadcast({
                type: 'BOMB_SPAWN',
                x: owner.x,
                y: owner.y,
                ownerId: owner.id
            });
        }
    }

    triggerSizeChange(inputAssignments = null, speedBoost = 1.0) {
        let assignments = inputAssignments;

        // HOST LOGIC: Generate assignments if not provided
        if (!assignments) {
            // Check Authority: Only Host should generate
            if (window.state?.lobby?.isHost === false) return; // Client waits for packet

            assignments = [];
            [this.player, ...this.enemies].forEach(e => {
                // Use RNG or Math.random, doesn't matter since we broadcast result
                const mode = Math.random() > 0.5 ? 'BIG' : 'SMALL';
                assignments.push({ id: e.id, mode: mode });
            });

            // Broadcast assignments
            if (window.networkManager) {
                window.networkManager.broadcast({
                    type: 'SIZE_CHANGE_EVENT',
                    assignments: assignments
                });
            }
        }

        // APPLY ASSIGNMENTS
        assignments.forEach(assign => {
            // Find entity (Player or Enemy)
            let e = null;
            if (this.player && this.player.id === assign.id) e = this.player;
            else if (this.enemies) e = this.enemies.find(en => en.id === assign.id);

            if (!e) return;

            if (assign.mode === 'BIG') {
                e.speedMult = CONFIG.BIG_GOOBY_SPEED_MULT * speedBoost * 0.9;
                e.radius = 115; e.targetRadius = 115;
                e.mass = 115 * 115;
            } else { // SMALL
                e.speedMult = CONFIG.SMALL_GOOBY_SPEED_MULT * speedBoost;

                // CHAOS MODE SPECIFIC NERF
                if (this.activeAbilities.has('CHAOS')) {
                    e.speedMult = 0.85;
                }

                e.radius = 15; e.targetRadius = 15;
                e.mass = 15 * 15;
            }
            e.cacheDirty = true;
        });

        this.nextSizeChange = this.timeLeft - CONFIG.SIZE_CHANGE_DURATION / 1000;
    }

    attemptDash() {
        if (this.player && !this.player.dead) {
            let force = CONFIG.BASE_DASH_POWER * CONFIG.PHYSICS_SCALE;

            // TODO: Mode-specific adjustments (will be customized later)
            // if (this.activeAbilities.has('POWERFUL_PUSH')) force *= CONFIG.POWERFUL_PUSH_DASH_MULT;
            // if (this.activeAbilities.has('SIZE_CHANGE') && this.player.targetRadius > 50) {
            //     force = CONFIG.BIG_GOOBY_DASH_FORCE * CONFIG.PHYSICS_SCALE;
            // }

            if (this.player.dash(this.mouse.x, this.mouse.y, force)) {
                this.addParticles(this.player.x, this.player.y, 5, this.player.color);
            }
        }
    }

    addScreenShake(intensity) { this.shake.str = intensity * 0.4; }
    // addParticles moved to line 1246 (optimized with pool)

    handleKill(victim, killer) {
        // ANTI-CHEAT: HOST AUTHORITY
        const isMultiplayer = window.networkManager && typeof window.networkManager.broadcast === 'function';
        const isHost = !isMultiplayer || (window.state && window.state.lobby && window.state.lobby.isHost);

        if (isMultiplayer && !isHost) return;

        if (victim.dead) return;

        // Broadcast (If Host)
        if (isMultiplayer && isHost) {
            const vPeerId = victim.peerId || (victim === this.player ? 'host' : null);
            const kPeerId = killer ? (killer.peerId || (killer === this.player ? 'host' : null)) : null;
            window.networkManager.broadcast({
                type: 'KILL_EVENT',
                victimPeerId: vPeerId,
                killerPeerId: kPeerId
            });
        }
        victim.dead = true;
        victim.respawnTimer = Date.now() + 2000;
        this.audio.playKill();
        this.addScreenShake(10);
        this.addParticles(victim.x, victim.y, 3, victim.color); // Reduced from 15 to 3

        if (killer && !killer.dead && !victim.isDecoy) {
            killer.kills++;
            // Kill Streak Logic (tracking only, no announcer sounds)
            killer.killStreak = (killer.killStreak || 0) + 1;
            killer.streakTimer = 5000; // 5s to keep streak

            if (this.killFeed) {
                this.killFeed.push({
                    killer: killer.name,
                    killerColor: killer.color,
                    victim: victim.name,
                    victimColor: victim.color,
                    time: Date.now()
                });
            }

            if (this.onScoreUpdate) {
                const scores = [this.player, ...this.enemies].map(e => ({ name: e.name, kills: e.kills, color: e.color }));
                scores.sort((a, b) => b.kills - a.kills);
                this.onScoreUpdate(scores.slice(0, 5));
            }
        }
    }

    update(dt) {
        // Update gamepad state every frame
        if (this.gamepad) {
            this.gamepad.update();

            // Gamepad button actions (if connected and not dead)
            if (this.gamepad.connected && this.player && !this.player.dead && !this.chatActive) {
                // Dash (RT/RB/A button)
                if (this.gamepad.isDashPressed()) {
                    this.keys.space = true;
                    this.inputAction = 'DASH';
                }

                // Clone (X button)
                if (this.gamepad.isClonePressed()) {
                    this.keys.x = true;
                }

                // Taunt (Y button)
                if (this.gamepad.isTauntPressed()) {
                    this.keys.t = true;
                }

                // Potato pass (B button)
                if (this.gamepad.isPotatoPressed()) {
                    this.keys.e = true;
                }
            }
        }

        if (this.voteActive) {
            // New UI-based voting logic
            this.updateVortexLogic(dt);
            return;
        }

        if (!this.roundActive) return;

        // INTERPOLATION: Save state before any physics
        const entitiesToSave = [this.player, ...this.enemies];
        entitiesToSave.forEach(e => {
            if (e) { e.prevX = e.x; e.prevY = e.y; }
        });

        // Hot Potato: Allow respawn EXCEPT for bomb deaths
        // Storm Dodge: NO respawn at all (last survivor wins)
        if (!this.attractMode) {
            if (this.activeAbilities.has('HOT_POTATO')) {
                // Respawn everyone except bomb victims
                [this.player, ...this.enemies].forEach(e => {
                    if (e && e.dead && e.deathByBomb !== true && Date.now() > e.respawnTimer) {
                        const pos = this.getSafeSpawnPos();
                        e.x = pos.x; e.y = pos.y;
                        e.dx = 0; e.dy = 0;
                        e.dead = false;
                        e.deathTimer = 0;
                        e.deathByBomb = false;
                        e.invulnTimer = 3000;
                        e.cacheDirty = true;
                        this.addParticles(e.x, e.y, 20, e.color);
                        this.addScreenShake(5);
                    }
                });
            } else if (!this.activeAbilities.has('LIGHTNING_STRIKE')) {
                // Other modes: Normal respawn (but NOT Storm mode)
                [this.player, ...this.enemies].forEach(e => {
                    if (e && e.dead && Date.now() > e.respawnTimer) {
                        const pos = this.getSafeSpawnPos();
                        e.x = pos.x; e.y = pos.y;
                        e.dx = 0; e.dy = 0;
                        e.dead = false;
                        e.deathTimer = 0;
                        e.deathByBomb = false;
                        e.invulnTimer = this.attractMode ? 0 : 3000;
                        if (this.attractMode) e.speedMult = 0.5;

                        // CHAOS MODE FIX: Reset SIZE_CHANGE effects
                        if (this.activeAbilities.has('SIZE_CHANGE') || this.activeAbilities.has('CHAOS')) {
                            e.speedMult = 1.0;
                            e.sizeMultiplier = 1.0;
                        }

                        e.cacheDirty = true;
                        this.addParticles(e.x, e.y, 20, e.color);
                        this.addScreenShake(5);

                        // BROADCAST RESPAWN
                        if (window.networkManager) {
                            window.networkManager.broadcast({
                                type: 'RESPAWN',
                                playerId: e.id || e.peerId,
                                x: pos.x,
                                y: pos.y
                            });
                        }
                    }
                });
            }
        }
        // Timer Logic
        if (this.activeAbilities.has('HOT_POTATO') || this.activeAbilities.has('CANDY_COLLECTOR') || this.activeAbilities.has('LIGHTNING_STRIKE')) {
            this.timeLeft = 999; // Timer disabled (Win by objective or last man standing)
        } else if (!this.attractMode && !this.voteActive && this.mapType !== 'SOCCER') {
            // Normal Timer (except Attract/Vote/Soccer)

            // REAL-TIME TIMER FIX: Use Date.now() if available
            if (this.roundEndTime) {
                this.timeLeft = Math.max(0, (this.roundEndTime - Date.now()) / 1000);
            } else {
                this.timeLeft -= dt; // Fallback
            }

            if (this.timeLeft <= 0) {
                // Time Over
                this.roundActive = false;

                // MULTIPLAYER: Only Host determines winner
                if (window.state?.lobby?.isHost !== false) { // Host or single player
                    // Determine winner by Kills
                    if (this.onRoundEnd) {
                        let winner = this.player;
                        let maxKills = this.player.kills;
                        if (this.enemies) {
                            this.enemies.forEach(e => { if (e.kills > maxKills) { maxKills = e.kills; winner = e; } });
                        }
                        this.onRoundEnd(winner);
                    }
                }
                // Clients: Wait for Host to send winner via ROUND_END packet
                return;
            }
        }

        // Hot Potato Countdown
        if (this.potatoTarget && this.potatoTimer > 0) {
            this.potatoTimer -= dt;
            if (this.potatoTimer < 3) this.addScreenShake(2);
            if (this.potatoTimer <= 0) {
                // EXPLODE - Mark as bomb death (NO RESPAWN!)
                this.potatoTarget.dead = true;
                this.potatoTarget.deathByBomb = true;
                this.addExplosionEffect(this.potatoTarget.x, this.potatoTarget.y, 200);
                this.addScreenShake(15);
                this.potatoTarget = null;

                // Check win condition
                const alive = [this.player, ...this.enemies].filter(e => !e.dead);
                if (alive.length <= 1) {
                    this.roundActive = false;
                    this.roundWinner = alive.length > 0 ? alive[0] : null;
                    if (this.onRoundEnd) this.onRoundEnd(this.roundWinner);
                }
            }
        }

        // LIGHTNING_STRIKE: Check if only one survives (Battle Royale logic)
        // Only applies if there are actual enemies (Multiplayer/Bots)
        if (this.activeAbilities.has('LIGHTNING_STRIKE') && !this.attractMode && this.enemies.length > 0) {
            const alive = [this.player, ...this.enemies].filter(e => e && !e.dead);
            // If only one left AND game has started (timer < 999 to allow spawn time? No, rely on enemies.length)
            if (alive.length === 1 && this.roundActive) {
                // IMPORTANT: Ensure we don't end immediately on spawn
                // Check if others are actually dead vs just not spawned?
                // enemies.length check covers it.
                this.roundActive = false;
                if (this.onRoundEnd) this.onRoundEnd(alive[0]);
            }
        }

        // Screen Shake
        if (this.shake.str > 0) {
            this.shake.x = (Math.random() - 0.5) * this.shake.str;
            this.shake.y = (Math.random() - 0.5) * this.shake.str;
            this.shake.str *= 0.9;
        }

        const allChars = [this.player, ...this.enemies].filter(e => e); // Remove null/undefined

        allChars.forEach(e => {
            if (e.dead) return;
            // AI LOGIC: Only run on Host (for bots) or Attract Mode.
            // Client should NEVER run AI on any entity (including self or remote players).
            // This prevents "Forced Host Follow" bug if isPlayer flag gets corrupted.
            const isClient = window.state?.lobby?.isHost === false;
            if (this.attractMode || (!isClient && !e.isPlayer)) {
                this.updateAI(e, dt);
            }

            // Friction logic moved to Entity.update()

            // Decrement potato immunity
            if (e.potatoImmunity > 0) e.potatoImmunity -= dt;

            // Look at Movement Direction (or Mouse for Player)
            const lookTarget = e.isPlayer ? this.mouse : { x: e.x + e.dx * 100, y: e.y + e.dy * 100 };

            e.update(dt, lookTarget, this);

            // CLIENT-SIDE INTERPOLATION (Smoothed via Buffer)
            if (window.state?.lobby?.isHost === false && e.peerId && !e.isPlayer) {
                // Try Buffered Interpolation first (Smoothest, no stutter)
                if (window.networkManager) {
                    const interp = window.networkManager.getInterpolatedState(e.peerId);
                    if (interp) {
                        e.x = interp.x;
                        e.y = interp.y;
                        e.dx = interp.dx;
                        e.dy = interp.dy;
                        if (interp.radius) e.radius = interp.radius;
                        this.checkBoundaries(e);

                        // Shadow visual effect
                        if (Math.abs(e.dx) > 1 || Math.abs(e.dy) > 1) {
                            if (!e.shadowTimer) e.shadowTimer = 0;
                            e.shadowTimer -= dt * 1000;
                            if (e.shadowTimer <= 0) e.shadowTimer = 100;
                        }
                        return; // Skip fallback dead reckoning
                    }
                }

                // Fallback to Dead Reckoning if buffer empty (Startup/Lag)
                if (e.serverX !== undefined && e.serverY !== undefined) {
                    // Extrapolate server position using velocity (dead reckoning)
                    if (e.serverDx !== undefined && e.serverDy !== undefined) {
                        // Predict where server thinks entity will be
                        e.serverX += e.serverDx * dt * 60;
                        e.serverY += e.serverDy * dt * 60;
                    }

                    // Check position error - if too far, snap immediately
                    const errorDist = Math.hypot(e.serverX - e.x, e.serverY - e.y);

                    if (errorDist > 80) {
                        // Large divergence - snap to server position
                        e.x = e.serverX;
                        e.y = e.serverY;
                    } else {
                        // Normal smoothing with higher alpha for faster convergence
                        const alpha = 0.65; // Increased for tighter sync
                        e.x += (e.serverX - e.x) * alpha;
                        e.y += (e.serverY - e.y) * alpha;
                    }
                }
            }

            this.checkBoundaries(e);

            // Shadows visual effect
            if (Math.abs(e.dx) > 1 || Math.abs(e.dy) > 1) {
                if (!e.shadowTimer) e.shadowTimer = 0;
                e.shadowTimer -= dt * 1000;
                if (e.shadowTimer <= 0) {

                    e.shadowTimer = 100;
                }
            }
        });

        if (this.player && !this.player.dead && !this.attractMode && this.player.isPlayer && !this.chatActive) {
            // CRITICAL: Don't apply movement input during dash!
            if (this.player.dashAttacking <= 0) {
                let dirX = 0, dirY = 0;
                let hasInput = false;

                // PRIORITY 1: Touch Controls (if enabled)
                if (this.touchControls && this.touchControls.active) {
                    const touch = this.touchControls.getDirection();
                    if (touch.distance > 0.1) {
                        dirX = touch.x;
                        dirY = touch.y;
                        hasInput = true;
                    }
                }
                // PRIORITY 2: Gamepad (if connected and no touch)
                else if (this.gamepad && this.gamepad.connected) {
                    const movement = this.gamepad.getMovement();
                    if (Math.abs(movement.x) > 0 || Math.abs(movement.y) > 0) {
                        const mag = Math.hypot(movement.x, movement.y);
                        if (mag > 0) {
                            dirX = movement.x / mag;
                            dirY = movement.y / mag;
                            hasInput = true;
                        }
                    }
                }
                // PRIORITY 3: Mouse (default)
                else {
                    const dx = this.mouse.x - this.player.x;
                    const dy = this.mouse.y - this.player.y;
                    const dist = Math.hypot(dx, dy);

                    if (dist > 10) {
                        dirX = dx / dist;
                        dirY = dy / dist;
                        hasInput = true;
                    }
                }

                // Apply input if have any
                if (hasInput) {
                    // CLIENT PREDICTION: Apply input locally IMMEDIATELY
                    this.player.applyInput(dirX, dirY);

                    // NETWORK: Send input to Host (if not Host)
                    // THROTTLE: 33ms (~30Hz) to save bandwidth and reduce head-of-line blocking
                    const now = Date.now();
                    if (window.state?.lobby?.isHost === false && window.networkManager && (now - (this.lastInputTime || 0) > 33)) {
                        this.lastInputTime = now;
                        window.networkManager.sendInput({
                            dirX,
                            dirY,
                            dash: false,
                            mouseX: this.mouse.x,
                            mouseY: this.mouse.y
                        });

                        // SERVER RECONCILIATION: Handled via Network Event (game.reconcile)
                        // Old loop-based logic removed to prevent conflict.
                    }
                }
            }

            if (this.inputAction === 'DASH') {
                this.attemptDash();

                // NETWORK: Send dash input
                if (window.state?.lobby?.isHost === false && window.networkManager) {
                    window.networkManager.sendInput({
                        dirX: 0,
                        dirY: 0,
                        dash: true,
                        mouseX: this.mouse.x,
                        mouseY: this.mouse.y
                    });
                }

                this.inputAction = 'NONE';
            }

            // NETWORK: Send pass potato key input
            if (this.keys.e && window.state?.lobby?.isHost === false && window.networkManager) {
                window.networkManager.sendInput({
                    dirX: 0,
                    dirY: 0,
                    dash: false,
                    passPotatoKey: true,
                    mouseX: this.mouse.x,
                    mouseY: this.mouse.y
                });
            }
            this.keys.e = false; // Prevent spam
        }

        // CANDY COLLECTOR
        if (this.activeAbilities.has('CANDY_COLLECTOR')) {
            this.updateCandyCollector(dt, allChars);
        }

        if (this.activeAbilities.has('LIGHTNING_STRIKE')) {
            this.updateLightningStrike(dt, allChars);
        }

        // Bullseye Logic
        if (this.activeAbilities.has('BULLSEYE')) {
            this.updateBullseye(dt, allChars);
        }

        // Physics & Collisions (All Entities & Objects)
        if (!this.voteActive) this.updateObjects(dt, allChars);
        else this.updateVortexLogic(dt);

        // Soccer Logic
        if (this.mapType === 'SOCCER') {
            this.updateSoccer(dt, allChars);
        }
    }

    passPotato(target) {

        this.potatoTarget = target;
        this.potatoTimer = CONFIG.HOT_POTATO_TIMER;
        this.showToast(`${target.name} has the POTATO!`);
        this.addParticles(target.x, target.y, 3, '#ff0000');

        // NETWORK: Broadcast potato target to all clients (Host only)
        if (window.state?.lobby?.isHost && window.networkManager) {
            const targetId = target.peerId || (target === this.player ? 'host' : null);
            window.networkManager.broadcast({
                type: 'POTATO_ASSIGN',
                targetId: targetId,
                timer: this.potatoTimer
            });
        }
    }

    updateSoccer(dt, allChars) {
        if (!this.ball) return;

        // CLIENT SYNC & PREDICTION
        if (window.state?.lobby?.isHost === false && window.networkManager) {
            const ballState = window.networkManager.getInterpolatedBall();
            if (ballState) {
                // Soft Interpolation (20%) to allow local prediction to work
                this.ball.x += (ballState.x - this.ball.x) * 0.2;
                this.ball.y += (ballState.y - this.ball.y) * 0.2;
                this.ball.dx += (ballState.dx - this.ball.dx) * 0.2;
                this.ball.dy += (ballState.dy - this.ball.dy) * 0.2;
            }
        }

        // SHARED PHYSICS (Both Host and Client run this for responsiveness)
        this.ball.update();

        const goalTop = this.height * 0.3;
        const goalBottom = this.height * 0.7;

        // Boundary Checks (Top/Bottom)
        if (this.ball.y < this.ball.radius) {
            this.ball.y = this.ball.radius; this.ball.dy *= -0.8;
        }
        if (this.ball.y > this.height - this.ball.radius) {
            this.ball.y = this.height - this.ball.radius; this.ball.dy *= -0.8;
        }

        // GOAL & WALLS LOGIC (HOST AUTHORITATIVE FOR GOALS)
        const isHost = window.state?.lobby?.isHost !== false;

        // LEFT SIDE
        if (this.ball.x < this.ball.radius) {
            // Check Goal
            if (this.ball.y > goalTop && this.ball.y < goalBottom) {
                if (isHost) {
                    // RED SCORES (Left side goal)
                    this.scores.RED++;
                    if (window.networkManager) window.networkManager.broadcast({ type: 'GOAL', team: 'RED', score: this.scores.RED });
                    this.showToast("RED TEAM SCORES!");
                    this.audio.playWin();
                    if (this.scores.RED >= CONFIG.SOCCER_WIN_SCORE) {
                        this.roundActive = false;
                        this.roundWinner = this.enemies[1] || this.enemies[0]; // Assuming Red is enemies
                        if (this.onRoundEnd) this.onRoundEnd(this.roundWinner);
                        return;
                    }
                    this.resetSoccerPositions();
                }
            } else {
                // Wall Bounce
                this.ball.x = this.ball.radius;
                this.ball.dx *= -0.8;
            }
        }

        // RIGHT SIDE
        else if (this.ball.x > this.width - this.ball.radius) {
            // Check Goal
            if (this.ball.y > goalTop && this.ball.y < goalBottom) {
                if (isHost) {
                    // BLUE SCORES (Right side goal)
                    this.scores.BLUE++;
                    if (window.networkManager) window.networkManager.broadcast({ type: 'GOAL', team: 'BLUE', score: this.scores.BLUE });
                    this.showToast("BLUE TEAM SCORES!");
                    this.audio.playWin();
                    if (this.scores.BLUE >= CONFIG.SOCCER_WIN_SCORE) {
                        this.roundActive = false;
                        this.roundWinner = this.player; // Assuming Blue is player/host
                        if (this.onRoundEnd) this.onRoundEnd(this.roundWinner);
                        return;
                    }
                    this.resetSoccerPositions();
                }
            } else {
                // Wall Bounce
                this.ball.x = this.width - this.ball.radius;
                this.ball.dx *= -0.8;
            }
        }

        // COLLISION LOGIC (SHARED FOR RESPONSIVENESS)
        allChars.forEach(e => {
            const dbx = this.ball.x - e.x; const dby = this.ball.y - e.y;
            const d = Math.hypot(dbx, dby);
            if (d < e.radius + this.ball.radius) {
                const nx = dbx / d; const ny = dby / d;
                const force = 10;
                this.ball.dx += nx * force; this.ball.dy += ny * force;

                if (e.isDashing) {
                    this.ball.dx += nx * 50; // Increased power
                    this.ball.dy += ny * 50;
                    this.audio.playHit(2.0);
                    this.addParticles(this.ball.x, this.ball.y, 10, '#ffffff');
                }
                const pen = (e.radius + this.ball.radius) - d;
                this.ball.x += nx * pen; this.ball.y += ny * pen;
            }
        });
    }

    resetSoccerPositions() {
        if (!this.ball) return;
        this.ball.x = this.width / 2; this.ball.y = this.height / 2; this.ball.dx = 0; this.ball.dy = 0;
        this.player.x = 100; this.player.y = this.height / 2;
        if (this.enemies[0]) { this.enemies[0].x = 100; this.enemies[0].y = this.height / 3; }
        if (this.enemies[1]) { this.enemies[1].x = this.width - 100; this.enemies[1].y = this.height / 2; }
        if (this.enemies[2]) { this.enemies[2].x = this.width - 100; this.enemies[2].y = this.height / 3; }
    }

    // === CANDY COLLECTOR MODE ===
    handleCandyCollect(candyId, collectorId) {
        const idx = this.candies.findIndex(c => c.id === candyId);
        if (idx === -1) return;
        const candy = this.candies[idx];

        // Remove candy
        this.candies.splice(idx, 1);

        // Update Score
        const score = this.playerScores.get(collectorId) || 0;
        const newScore = score + 1;
        this.playerScores.set(collectorId, newScore);

        // Effects
        this.addParticles(candy.x, candy.y, 3, candy.color);
        this.audio.playCollect();

        if (window.state?.lobby?.isHost !== false) {
            if (newScore >= 15) {
                this.roundActive = false;
                // Find winner entity
                const winner = [this.player, ...this.enemies].find(e => e.id === collectorId);
                if (winner) {
                    this.roundWinner = winner;
                    if (this.onRoundEnd) this.onRoundEnd(winner);
                }
            }
        }

        const collector = [this.player, ...this.enemies].find(e => e.id === collectorId);
        if (window.state?.lobby?.isHost !== false && window.networkManager && collector) {
            window.networkManager.broadcast({
                type: 'CANDY_COLLECT',
                candyId: candyId,
                collectorPeerId: collector.peerId || (collector === this.player ? 'host' : null),
                score: newScore
            });
        }
    }

    // === CANDY COLLECTOR MODE (UPDATED) ===
    updateCandyCollector(dt, allChars) {
        const isHost = window.state?.lobby?.isHost !== false;

        // HOST: Spawn Logic
        if (isHost) {
            this.candySpawnTimer++;
            if (this.candySpawnTimer >= 180) {
                this.spawnCandy();
                this.candySpawnTimer = 0;
            }
        }

        const checkDist = (char, candy) => {
            if (!char || char.dead || candy.isHidden) return false;
            return Math.hypot(char.x - candy.x, char.y - candy.y) < char.radius + 15;
        };

        // 1. My Player Collision (Both Host & Client)
        if (this.player && !this.player.dead) {
            for (let i = this.candies.length - 1; i >= 0; i--) {
                const c = this.candies[i];
                if (checkDist(this.player, c)) {
                    if (isHost) {
                        this.handleCandyCollect(c.id, this.player.id);
                    } else {
                        // Client: Claim & Hide
                        if (!c.isHidden) {
                            c.isHidden = true; // Hide immediately
                            this.addParticles(c.x, c.y, 3, c.color);
                            this.audio.playCollect();
                            if (window.networkManager) {
                                window.networkManager.send('CANDY_CLAIM', { candyId: c.id });
                            }
                        }
                    }
                }
            }
        }

        // 2. HOST ONLY: Bot Collisions
        if (isHost) {
            for (let i = this.candies.length - 1; i >= 0; i--) {
                const c = this.candies[i];
                const bot = this.enemies.find(e => !e.isPlayer && !e.peerId && !e.dead && checkDist(e, c));
                if (bot) this.handleCandyCollect(c.id, bot.id);
            }
        }
    }

    spawnCandy() {
        const types = ['🍭', '🍬', '🍩', '🧁', '🍫'];
        const colors = ['#ff69b4', '#ffa500', '#ffd700', '#ff1493', '#da70d6'];
        const typeIdx = this.rng.randomInt(0, types.length);

        const newCandy = {
            id: Date.now() + Math.random(), // Unique ID
            x: 50 + this.rng.random() * (this.width - 100),
            y: 50 + this.rng.random() * (this.height - 100),
            type: types[typeIdx],
            color: colors[typeIdx],
            radius: 15
        };

        this.candies.push(newCandy);

        // BROADCAST SPAWN (Host only)
        if (window.state?.lobby?.isHost !== false && window.networkManager) {
            window.networkManager.broadcast({
                type: 'CANDY_SPAWN',
                candy: newCandy
            });
        }
    }

    // === LIGHTNING STRIKE MODE ===
    updateLightningStrike(dt, allChars) {
        this.lightningSpawnTimer++;
        const baseInterval = 120;
        const timeScale = Math.max(0.5, 1 - (this.frameCount / 3600));
        const interval = Math.floor(baseInterval * timeScale);

        if (this.lightningSpawnTimer >= interval) {
            this.spawnLightningWarning();
            this.lightningSpawnTimer = 0;
        }

        this.lightningWarnings = this.lightningWarnings.filter(warning => {
            warning.timer--;
            if (warning.timer <= 0) {
                this.lightningStrike.push({ x: warning.x, y: warning.y, timer: 10 });
                allChars.forEach(char => {
                    if (char.dead) return;
                    const dist = Math.hypot(char.x - warning.x, char.y - warning.y);
                    if (dist < 140) { // Increased to 140px (Massive Area)
                        this.handleKill(char, null);
                        this.addParticles(char.x, char.y, 10, '#fbbf24');
                    }
                });
                this.addScreenShake(12);
                return false;
            }
            return true;
        });

        this.lightningStrike = this.lightningStrike.filter(s => {
            s.timer--;
            return s.timer > 0;
        });

        const alive = allChars.filter(c => !c.dead);
        if (alive.length <= 1) {
            this.roundActive = false;
            this.roundWinner = alive.length === 1 ? alive[0] : this.player; // Default to player if tie
            if (this.onRoundEnd) this.onRoundEnd(this.roundWinner);
        }
    }

    spawnLightningWarning() {
        // HOST AUTHORITY: Spawn Logic
        if (window.state?.lobby?.isHost !== false) {
            if (this.lightningWarnings.length > 5) return;

            const rx = 20 + this.rng.random() * (this.width - 40);
            const ry = 20 + this.rng.random() * (this.height - 40);

            this.lightningWarnings.push({
                x: rx,
                y: ry,
                timer: 120,
                triggered: false
            });

            // BROADCAST LIGHTNING SPAWN
            if (window.networkManager) {
                window.networkManager.broadcast({
                    type: 'LIGHTNING_SPAWN',
                    x: rx,
                    y: ry
                });
            }
        }
    }

    // === BULLSEYE MODE ===
    handleTargetHit(targetId, scorerId) {
        const idx = this.targets.findIndex(t => t.id === targetId);
        if (idx === -1) return;
        const target = this.targets[idx];

        // Remove
        this.targets.splice(idx, 1);

        // Score
        const score = this.bullseyeScores.get(scorerId) || 0;
        const newScore = score + 1;
        this.bullseyeScores.set(scorerId, newScore);

        // Effects
        this.addParticles(target.x, target.y, 5, target.color);
        this.audio.playHit(2.0);

        // Win Check
        if (window.state?.lobby?.isHost !== false) {
            if (newScore >= 10) {
                this.roundActive = false;
                const winner = [this.player, ...this.enemies].find(e => e.id === scorerId);
                if (winner) {
                    this.roundWinner = winner;
                    if (this.onRoundEnd) this.onRoundEnd(winner);
                }
            }
        }

        // Host ONLY: Spawn New & Broadcast
        if (window.state?.lobby?.isHost !== false) {
            const newTarget = this.createTarget();
            newTarget.id = Date.now() + Math.random();
            this.targets.push(newTarget);

            if (window.networkManager) {
                const scorer = [this.player, ...this.enemies].find(e => e.id === scorerId);
                const scorerPid = scorer ? (scorer.peerId || (scorer === this.player ? 'host' : null)) : null;

                window.networkManager.broadcast({
                    type: 'TARGET_HIT',
                    targetId: targetId,
                    scorerPeerId: scorerPid,
                    score: newScore
                });
                window.networkManager.broadcast({
                    type: 'TARGET_SPAWN',
                    target: newTarget
                });
            }
        }
    }

    // === BULLSEYE MODE (UPDATED: CLIENT CLAIM) ===
    updateBullseye(dt, allChars) {
        // Move Targets
        this.targets.forEach(target => {
            target.x += target.dx;
            target.y += target.dy;

            if (target.x < target.radius || target.x > this.width - target.radius) {
                target.dx *= -1;
                target.x = Math.max(target.radius, Math.min(this.width - target.radius, target.x));
            }
            if (target.y < target.radius || target.y > this.height - target.radius) {
                target.dy *= -1;
                target.y = Math.max(target.radius, Math.min(this.height - target.radius, target.y));
            }
        });

        const isHost = window.state?.lobby?.isHost !== false;
        const checkDist = (char, target) => {
            if (!char || char.dead || target.isHidden) return false;
            return Math.hypot(char.x - target.x, char.y - target.y) < char.radius + target.radius + 15;
        };

        // 1. My Player Collision (Both)
        if (this.player && !this.player.dead) {
            for (let i = this.targets.length - 1; i >= 0; i--) {
                const t = this.targets[i];
                if (checkDist(this.player, t)) {
                    if (isHost) {
                        this.handleTargetHit(t.id, this.player.id);
                    } else {
                        // Client Claim
                        if (!t.isHidden) {
                            t.isHidden = true;
                            this.addParticles(t.x, t.y, 5, t.color);
                            this.audio.playHit(2.0);
                            if (window.networkManager) {
                                window.networkManager.send('TARGET_CLAIM', { targetId: t.id });
                            }
                        }
                    }
                }
            }
        }

        // 2. Host: Bots
        if (isHost) {
            for (let i = this.targets.length - 1; i >= 0; i--) {
                const t = this.targets[i];
                const bot = this.enemies.find(e => !e.isPlayer && !e.peerId && !e.dead && checkDist(e, t));
                if (bot) this.handleTargetHit(t.id, bot.id);
            }
        }
    }

    spawnTarget() {
        // HOST AUTHORITY
        if (window.state?.lobby?.isHost !== false) {
            const t = this.createTarget();
            // Add ID for sync
            t.id = Date.now() + Math.random();
            this.targets.push(t);

            // BROADCAST
            if (window.networkManager) {
                window.networkManager.broadcast({
                    type: 'TARGET_SPAWN',
                    target: t
                });
            }
        }
    }

    createTarget() {
        const colors = ['#10b981', '#3b82f6', '#f59e0b'];
        const colorIdx = this.rng.randomInt(0, colors.length);
        return {
            x: 100 + this.rng.random() * (this.width - 200),
            y: 100 + this.rng.random() * (this.height - 200),
            dx: (this.rng.random() - 0.5) * 3,
            dy: (this.rng.random() - 0.5) * 3,
            radius: 30,
            color: colors[colorIdx]
        };
    }

    updateObjects(dt, allChars) {
        // Black Hole Logic (Optimized + Throttled)
        // PERFORMANCE: Update black holes every 2 frames
        if (!this.blackHoleThrottle) this.blackHoleThrottle = 0;
        this.blackHoleThrottle++;

        if (this.blackHoleThrottle >= 2) {
            this.blackHoleThrottle = 0;

            this.blackHoles.forEach(bh => {
                bh.teleportTimer -= dt * 1000 * 2; // Compensate for throttling
                if (bh.teleportTimer <= 0) {
                    const pos = this.getSafeSpawnPos();
                    bh.x = pos.x; bh.y = pos.y;
                    bh.teleportTimer = CONFIG.BLACK_HOLE_TELEPORT_INTERVAL;
                    this.addParticles(bh.x, bh.y, 3, '#a855f7');

                    // BROADCAST BLACK HOLE TELEPORT (Host only)
                    if (window.state?.lobby?.isHost && window.networkManager) {
                        window.networkManager.broadcast({
                            type: 'BLACK_HOLE_TELEPORT',
                            x: bh.x,
                            y: bh.y
                        });
                    }
                }
                // Only pull entities within a reasonable range
                allChars.forEach(e => {
                    if (e.dead) return;
                    const dx = bh.x - e.x; const dy = bh.y - e.y;
                    const distSq = dx * dx + dy * dy; // Use squared distance
                    const pullRadiusSq = bh.pullRadius * bh.pullRadius;

                    if (distSq < pullRadiusSq && distSq > 1) { // Avoid div by zero
                        const dist = Math.sqrt(distSq);
                        // EXTREME PULL: Quadratic curve
                        const pullFactor = 1 - (dist / bh.pullRadius);
                        const pullStrength = 3.5 * (pullFactor * pullFactor); // Increased to 3.5

                        e.dx += (dx / dist) * pullStrength;
                        e.dy += (dy / dist) * pullStrength;

                        // ANTI-ESCAPE: Restrict outward velocity if close to center
                        const toPlayerX = -dx;
                        const toPlayerY = -dy;
                        const dot = e.dx * toPlayerX + e.dy * toPlayerY;

                        if (dot > 0 && dist < bh.pullRadius * 0.8) {
                            e.dx *= 0.9;
                            e.dy *= 0.9;
                        }

                        // Friction penalty (Safe multiplier)
                        if (dist < 300) e.speedMult *= 0.5; // Can barely move
                    }

                    if (distSq < CONFIG.BLACK_HOLE_DEATH_RADIUS * CONFIG.BLACK_HOLE_DEATH_RADIUS) {
                        this.handleKill(e, null);
                    }
                });
            });
        }

        if (this.activeAbilities.has('BOMB_RAIN')) {
            // HOST AUTHORITY: Spawn Logic
            if (window.state?.lobby?.isHost !== false) {
                this.bombRainTimer -= dt * 1000;
                // Limit total bombs for performance
                if (this.bombRainTimer <= 0 && this.bombs.length < 8) {
                    const bx = this.width * (0.1 + this.rng.random() * 0.8);
                    const by = this.rng.random() * this.height;

                    this.bombs.push(new Bomb(bx, by, null));

                    // BROADCAST BOMB SPAWN
                    if (window.networkManager) {
                        window.networkManager.broadcast({
                            type: 'BOMB_SPAWN',
                            x: bx,
                            y: by,
                            ownerId: null
                        });
                    }

                    this.bombRainTimer = CONFIG.BOMB_RAIN_DROP_INTERVAL * 1.5;
                }
            }
        }

        // Bombs Logic
        this.bombs = this.bombs.filter(b => {
            // Homing if BOMB_DROP ability used
            if (this.activeAbilities.has('BOMB_DROP') && b.owner) {
                let target = null; let minD = 150;
                allChars.forEach(e => {
                    if (e !== b.owner && !e.dead) {
                        const d = Math.hypot(e.x - b.x, e.y - b.y);
                        if (d < minD) { minD = d; target = e; }
                    }
                });
                if (target) {
                    b.x += (target.x - b.x) * 0.05;
                    b.y += (target.y - b.y) * 0.05;
                }
            }

            const active = b.update(dt);
            if (!active) {
                this.addParticles(b.x, b.y, 3, '#fb923c'); // Reduced from 15 to 3
                this.addScreenShake(8);
                allChars.forEach(e => {
                    if (e.dead) return;
                    const dx = e.x - b.x; const dy = e.y - b.y;
                    const dist = Math.hypot(dx, dy);
                    if (dist < CONFIG.BOMB_EXPLOSION_RADIUS) {
                        const blast = CONFIG.BOMB_EXPLOSION_FORCE * CONFIG.PHYSICS_SCALE * (1 - dist / CONFIG.BOMB_EXPLOSION_RADIUS);
                        e.dx += (dx / dist) * blast; e.dy += (dy / dist) * blast;
                        if (b.owner) {
                            e.lastHitter = b.owner;
                            e.lastHitTime = Date.now();
                        }
                    }
                });
            }
            return active;
        });

        // Duplicate Particle update removed from here (Handled in main update loop)

        // Collision iterations (reduced to 1 for better performance)
        for (let iter = 0; iter < 1; iter++) {
            for (let i = 0; i < allChars.length; i++) {
                for (let j = i + 1; j < allChars.length; j++) {
                    const c1 = allChars[i];
                    const c2 = allChars[j];
                    if (!c1.dead && !c2.dead) this.resolveCollision(c1, c2);
                }
            }
        }
    }

    getSafeSpawnPos() {
        // Limits and Fallback for 10+ Players
        const maxAttempts = 15; // Reduced from 50 for performance
        const padding = 60;

        let bestPos = { x: this.width / 2, y: this.height / 2 };
        let maxMinDist = 0;

        for (let i = 0; i < maxAttempts; i++) {
            let x, y;
            if (this.mapType === 'ARENA' && this.hasHole) {
                // Don't spawn in hole or death zone (Deterministic)
                do {
                    x = padding + this.rng.random() * (this.width - padding * 2);
                    y = padding + this.rng.random() * (this.height - padding * 2);
                    // Check hole distance
                    const distToHole = Math.hypot(x - this.width / 2, y - this.height / 2);
                    if (distToHole > 120) break; // 120 is safe from 80 radius hole
                } while (true);
            } else {
                x = padding + this.rng.random() * (this.width - padding * 2);
                y = padding + this.rng.random() * (this.height - padding * 2);
            }

            // Check distance to other entities
            let minDist = Infinity;
            [this.player, ...this.enemies].forEach(e => {
                if (e && !e.dead) {
                    const d = Math.hypot(e.x - x, e.y - y);
                    if (d < minDist) minDist = d;
                }
            });

            // If this is the best so far, keep it
            if (minDist > maxMinDist) {
                maxMinDist = minDist;
                bestPos = { x, y };
            }

            // If 'good enough', return immediately
            if (minDist > 200) return { x, y };
        }

        // If we couldn't find a perfect spot, return the best one found
        return bestPos;
    }

    addScreenShake(intensity) {
        // Only shake for significant impacts to prevent constant jitter in Classic mode
        if (intensity < 5) return;
        this.shake.str = intensity * 0.4;
    }
    addParticles(x, y, count, color) {
        if (!this.particlePool) this.particlePool = [];
        return; // PERFORMANCE: Particles Disabled
        const limit = this.quality > 0 ? 200 : 50; // Dynamic limit

        for (let i = 0; i < count; i++) {
            if (this.particles.length >= limit) break;

            let p;
            if (this.particlePool.length > 0) {
                p = this.particlePool.pop();
                p.reset(x, y, color);
            } else {
                p = new Particle(x, y, color);
            }
            this.particles.push(p);
        }
    }

    // Old checkBoundaries removed (Replaced by new Donut-specific logic below resolveCollision)

    resolveCollision(a, b) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;

        const distSq = dx * dx + dy * dy;
        const radiusSum = a.radius + b.radius;
        const radiusSumSq = radiusSum * radiusSum;

        if (distSq < radiusSumSq && distSq > 0.01) { // Safety check for dist=0
            const dist = Math.sqrt(distSq); // Only calculate root if needed

            // Force Separation (Fixes tunneling/overlap)
            const nx = dx / dist; const ny = dy / dist;
            const overlap = (radiusSum - dist) + 1; // +1 extra buffer
            // Push apart proportional to inverse mass (simplified equal here)
            a.x -= nx * overlap * 0.5; a.y -= ny * overlap * 0.5;
            b.x += nx * overlap * 0.5; b.y += ny * overlap * 0.5;

            // Hot Potato Transfer: REMOVED - only E key transfer allowed

            a.lastHitter = b; b.lastHitter = a;
            a.lastHitTime = Date.now(); b.lastHitTime = Date.now();

            const relVelX = b.dx - a.dx; const relVelY = b.dy - a.dy;
            const velAlongNormal = relVelX * nx + relVelY * ny;

            if (velAlongNormal > 0) return;

            // Check Collision Type based on Action Timer
            const aDashing = a.dashAttacking > 0;
            const bDashing = b.dashAttacking > 0;
            const isDashCollision = aDashing || bDashing;

            if (isDashCollision) {
                // Play Gooby Impact Sound
                this.audio.playGoobyHit();

                // Strong Hit
                let forceMult = 1.0;
                // Powerful Push = Normal + ~50% (approx 1.3)
                if (this.activeAbilities.has('POWERFUL_PUSH')) forceMult = CONFIG.POWERFUL_PUSH_IMPACT_MULT;

                // Size Change Big Gooby Nerf (-20%)
                // If Attacker is BIG, reduce their effective force multiplier
                if (this.activeAbilities.has('SIZE_CHANGE') && a.radius > 30 && b.radius < 30) {
                    // Big hitting Small
                    // We normally override mass, but let's reduce the violence slightly
                    forceMult *= 0.8;
                }

                let baseForce = CONFIG.IMPACT_VELOCITY * CONFIG.PHYSICS_SCALE * forceMult;

                const pMassA = (this.activeAbilities.has('SIZE_CHANGE')) ? a.radius * a.radius : 1;
                const pMassB = (this.activeAbilities.has('SIZE_CHANGE')) ? b.radius * b.radius : 1;

                if (aDashing) {
                    // A hits B
                    // SIZE_CHANGE: Calculate mass-based recoil
                    let recoilMultA = 1.0;
                    let forceMultB = 1.0;

                    if (this.activeAbilities.has('SIZE_CHANGE')) {
                        const massRatio = pMassB / pMassA;
                        // If A is small (massRatio > 1), A gets MORE recoil
                        recoilMultA = Math.pow(massRatio, 0.7);

                        // Small hitting big: VERY weak (almost no effect)
                        // Big hitting small: strong
                        if (pMassA < pMassB) {
                            // Small hitting big - almost no effect!
                            forceMultB = 0.1; // Only 10% force
                        } else {
                            // Big hitting small - full power
                            forceMultB = Math.pow(pMassA / pMassB, 0.3);
                        }
                    }

                    const recoilForce = baseForce * CONFIG.RECOIL_FACTOR * recoilMultA;
                    const victimForce = baseForce * forceMultB;

                    // Apply Force to Victim
                    b.dx += a.dx * 0.6 + (nx * victimForce);
                    b.dy += a.dy * 0.6 + (ny * victimForce);

                    // Apply Recoil to Attacker
                    a.dx = a.dx * 0.5 - (nx * recoilForce);
                    a.dy = a.dy * 0.5 - (ny * recoilForce);

                    a.dashAttacking = 0;
                    a.isDashing = false;
                    this.addScreenShake(8);
                } else if (bDashing) {
                    // B hits A
                    let recoilMultB = 1.0;
                    let forceMultA = 1.0;

                    if (this.activeAbilities.has('SIZE_CHANGE')) {
                        const massRatio = pMassA / pMassB;
                        recoilMultB = Math.pow(massRatio, 0.7);

                        // Same logic: small hitting big = weak
                        if (pMassB < pMassA) {
                            forceMultA = 0.1; // Only 10%
                        } else {
                            forceMultA = Math.pow(pMassB / pMassA, 0.3);
                        }
                    }

                    const recoilForce = baseForce * CONFIG.RECOIL_FACTOR * recoilMultB;
                    const victimForce = baseForce * forceMultA;

                    // Apply Force to Victim (A)
                    a.dx += b.dx * 0.6 - (nx * victimForce);
                    a.dy += b.dy * 0.6 - (ny * victimForce);

                    // Apply Recoil to Attacker (B)
                    b.dx = b.dx * 0.5 + (nx * recoilForce);
                    b.dy = b.dy * 0.5 + (ny * recoilForce);

                    b.dashAttacking = 0;
                    b.isDashing = false;
                    this.addScreenShake(8);
                }
            }
            // MOUSE BUMP (Weak)
            else if (this.activeAbilities.has('SIZE_CHANGE')) {
                // Standard Physics for Size Mode (Bumping)
                const ma = a.radius * a.radius;
                const mb = b.radius * b.radius;
                const restitution = 0.8;
                let j = -(1 + restitution) * velAlongNormal;
                j /= (1 / ma + 1 / mb);
                const impulseX = j * nx; const impulseY = j * ny;

                a.dx -= (impulseX / ma); a.dy -= (impulseY / ma);
                b.dx += (impulseX / mb); b.dy += (impulseY / mb);
            }
            else {
                // Normal Bump
                const restitution = 0.2;
                let j = -(1 + restitution) * velAlongNormal;
                j /= (1 / a.radius + 1 / b.radius);
                const weakImpuse = j * 0.5;
                a.dx -= weakImpuse * nx / a.radius;
                a.dy -= weakImpuse * ny / a.radius;
                b.dx += weakImpuse * nx / b.radius;
                b.dy += weakImpuse * ny / b.radius;
            }

            const midX = (a.x + b.x) / 2;
            const midY = (a.y + b.y) / 2;

            this.addParticles(midX, midY, isDashCollision ? 15 : 5, 'white');

            // BROADCAST HIT EFFECT
            if (window.state?.lobby?.isHost !== false && window.networkManager) {
                // Only broadcast relevant impacts to save bandwidth
                const impact = Math.abs(velAlongNormal);
                if (isDashCollision || impact > 5) {
                    window.networkManager.broadcast({
                        type: 'HIT_EFFECT',
                        x: midX,
                        y: midY,
                        intensity: isDashCollision ? 2 : 1
                    });
                }
            }
        }
    }

    // Safety check in update loop to ensure isDashing doesn't get stuck forever
    // This runs for all entities each frame
    checkDashStatus(e) {
        const speed = Math.hypot(e.dx, e.dy);
        if (e.isDashing && speed < 100) {
            e.isDashing = false;
        }
    }

    checkBoundaries(entity) {
        if (entity.dead) return;
        this.checkDashStatus(entity);

        // ARENA: Center hole death
        if (this.mapType === 'ARENA' && this.hasHole) {
            const cx = this.width / 2;
            const cy = this.height / 2;
            const dist = Math.hypot(entity.x - cx, entity.y - cy);
            const holeRadius = 80; // Death zone

            if (dist < holeRadius) {
                let killer = entity.lastHitter;
                // Timeout: If last hit was > 5s ago, it's a suicide (no killer credit)
                if (killer && Date.now() - (entity.lastHitTime || 0) > 5000) {
                    killer = null;
                }
                // Handle Kill: (VICTIM, KILLER) - Function signature is handleKill(victim, killer)
                // If killer is null (timeout), it's a suicide (no points attributed)
                this.handleKill(entity, killer);
                return;
            }
        }

        // Standard Bounds (All maps)
        if (entity.y < entity.radius) { entity.y = entity.radius; entity.dy *= -0.5; }
        if (entity.y > this.height - entity.radius) { entity.y = this.height - entity.radius; entity.dy *= -0.5; }
        if (entity.x < entity.radius) { entity.x = entity.radius; entity.dx *= -0.5; }
        if (entity.x > this.width - entity.radius) { entity.x = this.width - entity.radius; entity.dx *= -0.5; }
    }

    addExplosionEffect(x, y, radius) {
        // Ring Effect: Particles moving outward in a circle
        for (let i = 0; i < 36; i++) {
            const angle = (Math.PI * 2 * i) / 36;
            const speed = 12;
            this.particles.push(new Particle(x, y, '#fb923c', Math.cos(angle) * speed, Math.sin(angle) * speed));
        }
    }

    draw(alpha) {
        // Simple, stable rendering
        this.ctx.save();
        this.ctx.translate(this.shake.x, this.shake.y);

        if (this.bgCanvas) {
            this.ctx.drawImage(this.bgCanvas, 0, 0);
        } else {
            // Fallback (Shouldn't happen)
            this.ctx.fillStyle = '#0b1121';
            this.ctx.fillRect(0, 0, this.width, this.height);
        }

        // Render Kill Feed (Top Right)
        // Render Kill Feed (Top Right)
        if (!this.attractMode && this.killFeed && this.killFeed.length > 0) {
            let kfY = 20; // Moved up from 60 to 20 for tight top-right corner
            const now = Date.now();

            this.killFeed.forEach(k => {
                const age = now - k.time;
                if (age > 4000) return; // 4s max life

                let alpha = 1.0;
                if (age > 3000) alpha = 1 - ((age - 3000) / 1000);

                this.ctx.save();
                this.ctx.globalAlpha = alpha;

                this.ctx.font = "bold 14px 'Outfit', sans-serif";
                const killerW = this.ctx.measureText(k.killer).width;
                const victimW = this.ctx.measureText(k.victim).width;

                // Dynamic Width calculation
                // Padding (15) + Killer + Gap (10) + Icon (24) + Gap (10) + Victim + Padding (15)
                const totalW = 15 + killerW + 10 + 24 + 10 + victimW + 15;
                const boxW = Math.max(160, totalW); // Min width 160
                const boxH = 36;

                // Anchor to Right: (ScreenWidth - Margin - BoxWidth)
                const boxX = this.width - 20 - boxW;
                const boxY = kfY;

                // Glassmorphism Background
                this.ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
                this.ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
                this.ctx.lineWidth = 1;

                if (this.quality > 0) {
                    this.ctx.shadowColor = "rgba(0,0,0,0.3)";
                    this.ctx.shadowBlur = 10;
                }

                this.ctx.beginPath();
                this.ctx.roundRect(boxX, boxY, boxW, boxH, 10);
                this.ctx.fill();
                this.ctx.stroke();

                if (this.quality > 0) this.ctx.shadowBlur = 0;

                // Typography positioning
                this.ctx.textBaseline = "middle";
                const centerY = boxY + boxH / 2;

                // Start drawing from Left side of the box
                let cursorX = boxX + 15;

                // 1. Killer
                this.ctx.textAlign = "left";
                this.ctx.fillStyle = k.killerColor || "#4ade80";
                this.ctx.fillText(k.killer, cursorX, centerY);
                cursorX += killerW + 10;

                // 2. Icon
                this.ctx.textAlign = "center";
                this.ctx.font = "16px sans-serif";
                this.ctx.fillStyle = "#cbd5e1";
                this.ctx.fillText("⚔️", cursorX + 12, centerY + 1);
                cursorX += 24 + 10;

                // 3. Victim
                this.ctx.textAlign = "left";
                this.ctx.font = "bold 14px 'Outfit', sans-serif";
                this.ctx.fillStyle = k.victimColor || "#ef4444";
                this.ctx.fillText(k.victim, cursorX, centerY);

                this.ctx.restore();
                kfY += 44; // Spacing
            });
        }

        // Dynamic Elements (Scores, Entities, etc.)
        if (this.mapType === 'SOCCER') {
            // Scores (Dynamic!)
            this.ctx.font = "bold 60px 'Russo One', sans-serif";
            this.ctx.textAlign = "center";
            this.ctx.fillStyle = '#ef4444'; this.ctx.fillText(this.scores.RED, this.width / 2 - 80, 80);
            this.ctx.fillStyle = '#3b82f6'; this.ctx.fillText(this.scores.BLUE, this.width / 2 + 80, 80);
            this.ctx.fillStyle = 'white'; this.ctx.fillText("-", this.width / 2, 80);

            // Ball Visuals (Dynamic)
            if (this.ball) {
                // I need to make sure Ball is drawn!
                // The Ball drawing was INSIDE the IF block in previous code.
                // I should replicate it here or move it out.
                // Better to move Ball drawing OUT to main Entity loop? 
                // Or just keep it here.
                this.ctx.save();
                this.ctx.translate(this.ball.x, this.ball.y);
                this.ctx.shadowColor = 'white'; if (this.quality > 0) this.ctx.shadowBlur = 20;
                this.ctx.beginPath(); this.ctx.arc(0, 0, this.ball.radius, 0, Math.PI * 2);
                this.ctx.fillStyle = '#ffffff'; this.ctx.fill();
                this.ctx.strokeStyle = '#000000'; this.ctx.lineWidth = 3; this.ctx.stroke();
                this.ctx.beginPath(); this.ctx.arc(0, 0, this.ball.radius * 0.6, 0, Math.PI * 2);
                this.ctx.strokeStyle = '#ddd'; this.ctx.lineWidth = 2; this.ctx.stroke();
                this.ctx.restore();
            }
        }

        // Trail Shadows DISABLED for maximum 60 FPS
        // (globalAlpha too expensive for 10 players)

        this.blackHoles.forEach(bh => {
            this.ctx.fillStyle = 'black'; this.ctx.beginPath();
            this.ctx.arc(bh.x, bh.y, CONFIG.BLACK_HOLE_DEATH_RADIUS, 0, Math.PI * 2); this.ctx.fill();
            this.ctx.strokeStyle = '#a855f7'; this.ctx.beginPath();
            this.ctx.arc(bh.x, bh.y, bh.pullRadius, 0, Math.PI * 2); this.ctx.stroke();
        });

        // === CANDY COLLECTOR ===
        if (this.activeAbilities.has('CANDY_COLLECTOR')) {
            this.candies.forEach(c => {
                if (c.isHidden) {
                    if (c.hideTime && Date.now() - c.hideTime > 1000) {
                        c.isHidden = false;
                    } else {
                        return;
                    }
                }
                this.ctx.font = '30px Arial';
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                this.ctx.fillText(c.type, c.x, c.y);
            });

            // Score Display - Modern Glass HUD 🍬
            const sortedScores = [...this.playerScores.entries()].sort((a, b) => b[1] - a[1]);

            if (sortedScores.length > 0) {
                const cardW = 240;
                const cardH = sortedScores.length * 36 + 55;

                this.ctx.save();
                this.ctx.translate(15, 15); // Top-left margin

                // Glassmorphism Background (No shadow for performance)
                this.ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';

                this.ctx.strokeStyle = 'rgba(236, 72, 153, 0.3)'; // Subtle Pink Glow
                this.ctx.lineWidth = 1;

                this.ctx.beginPath();
                this.ctx.roundRect(0, 0, cardW, cardH, 16);
                this.ctx.fill();
                this.ctx.stroke();

                // Header
                this.ctx.shadowBlur = 0; // Reset shadow for text
                this.ctx.font = '800 14px Outfit';
                this.ctx.fillStyle = '#fce7f3'; // Light pink
                this.ctx.textAlign = 'left';
                this.ctx.fillText('SUGAR RUSH', 20, 30);

                this.ctx.font = '400 12px Outfit';
                this.ctx.fillStyle = '#cbd5e1';
                this.ctx.fillText('GOAL: 15 CANDIES', 20, 46);

                // Divider
                this.ctx.strokeStyle = 'rgba(255,255,255,0.1)';
                this.ctx.beginPath(); this.ctx.moveTo(0, 58); this.ctx.lineTo(cardW, 58); this.ctx.stroke();

                // Scores
                let yPos = 85;
                sortedScores.forEach(([id, score], idx) => {
                    const entity = [this.player, ...this.enemies].find(e => e.id === id);
                    if (entity && !entity.dead) {
                        // Rank #
                        this.ctx.font = '700 14px Outfit';
                        this.ctx.fillStyle = idx === 0 ? '#fbbf24' : '#64748b'; // Gold or Gray
                        this.ctx.textAlign = 'center';
                        this.ctx.fillText(`#${idx + 1}`, 25, yPos);

                        // Name
                        this.ctx.textAlign = 'left';
                        this.ctx.fillStyle = entity.color;
                        this.ctx.font = '600 15px Outfit';
                        this.ctx.fillText(entity.name, 45, yPos);

                        // Progress Bar Container
                        this.ctx.fillStyle = 'rgba(255,255,255,0.1)';
                        this.ctx.roundRect(cardW - 85, yPos - 8, 60, 6, 3);
                        this.ctx.fill();

                        // Progress Bar Fill
                        const pct = Math.min(1, score / 15);
                        this.ctx.fillStyle = entity.color; // Use player color for bar
                        this.ctx.beginPath();
                        this.ctx.roundRect(cardW - 85, yPos - 8, 60 * pct, 6, 3);
                        this.ctx.fill();

                        // Score Number
                        this.ctx.fillStyle = '#fff';
                        this.ctx.textAlign = 'right';
                        this.ctx.font = '700 14px Outfit';
                        this.ctx.fillText(score, cardW - 95, yPos + 1);

                        yPos += 36;
                    }
                });

                this.ctx.restore();
            }
        }

        // === LIGHTNING STRIKE ===
        if (this.activeAbilities.has('LIGHTNING_STRIKE')) {
            this.lightningWarnings.forEach(w => {
                const alpha = Math.min(1.0, w.timer / 60);
                this.ctx.strokeStyle = `rgba(239, 68, 68, ${alpha})`;
                this.ctx.fillStyle = `rgba(239, 68, 68, ${alpha * 0.2})`;
                this.ctx.lineWidth = 4;
                this.ctx.beginPath();
                this.ctx.arc(w.x, w.y, 140, 0, Math.PI * 2); // Increased to 140
                this.ctx.fill();
                this.ctx.stroke();
            });
            this.lightningStrike.forEach(s => {
                this.ctx.fillStyle = `rgba(251, 191, 36, ${s.timer / 10})`;
                this.ctx.beginPath();
                this.ctx.arc(s.x, s.y, 160, 0, Math.PI * 2); // Increased to 160
                this.ctx.fill();
            });
        }

        // === BULLSEYE ===
        if (this.activeAbilities.has('BULLSEYE')) {
            this.targets.forEach(t => {
                if (t.isHidden) {
                    if (t.hideTime && Date.now() - t.hideTime > 1000) {
                        t.isHidden = false; // Rollback prediction error
                    } else {
                        return;
                    }
                }
                this.ctx.fillStyle = t.color;
                this.ctx.strokeStyle = 'white';
                this.ctx.lineWidth = 4;
                this.ctx.beginPath();
                this.ctx.arc(t.x, t.y, t.radius, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.stroke();
                this.ctx.lineWidth = 2;
                this.ctx.beginPath();
                this.ctx.arc(t.x, t.y, t.radius * 0.6, 0, Math.PI * 2);
                this.ctx.stroke();
                this.ctx.beginPath();
                this.ctx.arc(t.x, t.y, t.radius * 0.3, 0, Math.PI * 2);
                this.ctx.stroke();
            });

            // Score Display - Modern Glass HUD 🎯
            const sortedScores = [...this.bullseyeScores.entries()].sort((a, b) => b[1] - a[1]);

            if (sortedScores.length > 0) {
                const cardW = 240;
                const cardH = sortedScores.length * 36 + 55;

                this.ctx.save();
                this.ctx.translate(15, 15);

                // Glassmorphism Background (No shadow for performance)
                this.ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';

                this.ctx.strokeStyle = 'rgba(16, 185, 129, 0.3)'; // Subtle Green Glow
                this.ctx.lineWidth = 1;

                this.ctx.beginPath();
                this.ctx.roundRect(0, 0, cardW, cardH, 16);
                this.ctx.fill();
                this.ctx.stroke();

                // Header
                this.ctx.shadowBlur = 0;
                this.ctx.font = '800 14px Outfit';
                this.ctx.fillStyle = '#d1fae5'; // Light green
                this.ctx.textAlign = 'left';
                this.ctx.fillText('TARGET PRACTICE', 20, 30);

                this.ctx.font = '400 12px Outfit';
                this.ctx.fillStyle = '#94a3b8';
                this.ctx.fillText('GOAL: 10 BULLSEYES', 20, 46);

                // Divider
                this.ctx.strokeStyle = 'rgba(255,255,255,0.1)';
                this.ctx.beginPath(); this.ctx.moveTo(0, 58); this.ctx.lineTo(cardW, 58); this.ctx.stroke();

                // Scores
                let yPos = 85;
                sortedScores.forEach(([id, score], idx) => {
                    const entity = [this.player, ...this.enemies].find(e => e.id === id);
                    if (entity && !entity.dead) {
                        // Rank #
                        this.ctx.font = '700 14px Outfit';
                        this.ctx.fillStyle = idx === 0 ? '#fbbf24' : '#64748b';
                        this.ctx.textAlign = 'center';
                        this.ctx.fillText(`#${idx + 1}`, 25, yPos);

                        // Name
                        this.ctx.textAlign = 'left';
                        this.ctx.fillStyle = entity.color;
                        this.ctx.font = '600 15px Outfit';
                        this.ctx.fillText(entity.name, 45, yPos);

                        // Progress Bar Container
                        this.ctx.fillStyle = 'rgba(255,255,255,0.1)';
                        this.ctx.roundRect(cardW - 85, yPos - 8, 60, 6, 3);
                        this.ctx.fill();

                        // Progress Bar Fill
                        const pct = Math.min(1, score / 10);
                        this.ctx.fillStyle = entity.color;
                        this.ctx.beginPath();
                        this.ctx.roundRect(cardW - 85, yPos - 8, 60 * pct, 6, 3);
                        this.ctx.fill();

                        // Score Number
                        this.ctx.fillStyle = '#fff';
                        this.ctx.textAlign = 'right';
                        this.ctx.font = '700 14px Outfit';
                        this.ctx.fillText(score, cardW - 95, yPos + 1);

                        yPos += 36;
                    }
                });

                this.ctx.restore();
            }
        }

        // New Bomb Visuals
        this.bombs.forEach(b => {
            this.ctx.beginPath(); this.ctx.arc(b.x, b.y, 12, 0, Math.PI * 2);
            this.ctx.fillStyle = '#ef4444'; this.ctx.fill();
            this.ctx.lineWidth = 2; this.ctx.strokeStyle = '#7f1d1d'; this.ctx.stroke();

            // Dynamic Fuse Warning Ring
            const pulse = 1 + Math.sin(Date.now() * 0.015) * 0.3;
            this.ctx.strokeStyle = `rgba(255, 200, 0, ${0.5 + Math.sin(Date.now() * 0.02) * 0.4})`;
            this.ctx.lineWidth = 3;
            this.ctx.beginPath(); this.ctx.arc(b.x, b.y, 12 * pulse, 0, Math.PI * 2); this.ctx.stroke();

            this.ctx.fillStyle = 'white'; this.ctx.font = 'bold 12px Arial'; this.ctx.textAlign = 'center';
            this.ctx.fillText("!", b.x, b.y + 4);

            // Explosion Radius Warning (Last 0.5s)
            if (b.timer < 0.5) {
                this.ctx.fillStyle = 'rgba(239, 68, 68, 0.3)';
                this.ctx.beginPath(); this.ctx.arc(b.x, b.y, CONFIG.BOMB_EXPLOSION_RADIUS, 0, Math.PI * 2); this.ctx.fill();
            }
        });

        // Hot Potato Visual Effect
        if (this.activeAbilities.has('HOT_POTATO') && this.potatoTarget && !this.potatoTarget.dead) {
            const t = this.potatoTarget;

            this.ctx.save();
            this.ctx.translate(t.x, t.y);

            // Simple red circle (Optimized: No gradient)
            this.ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
            this.ctx.beginPath();
            this.ctx.arc(0, 0, t.radius * 2, 0, Math.PI * 2);
            this.ctx.fill();

            // Skull Icon
            this.ctx.font = "bold 40px Outfit";
            this.ctx.textAlign = "center";
            this.ctx.fillStyle = "#fff";
            this.ctx.fillText("💀", 0, -t.radius - 30);

            // Timer Text (Optimized: No shadow)
            this.ctx.font = "bold 20px Outfit";
            this.ctx.fillStyle = "#fff";
            this.ctx.fillText(Math.ceil(this.potatoTimer), 0, -t.radius - 10);

            this.ctx.restore();

            // 3. Vignette Effect - Optimized: Canvas Overlay
            if (this.potatoTimer < 5 && this.potatoTarget === this.player) {
                const alpha = 0.15 + Math.sin(Date.now() * 0.015) * 0.1;
                this.ctx.fillStyle = `rgba(185, 28, 28, ${alpha})`;
                this.ctx.fillRect(0, 0, this.width, this.height);
            }
        }

        // Timer Text Display (Top Center)
        // HIDE in Candy, Potato, Bullseye, Storm Dodge
        if (!this.activeAbilities.has('CANDY_COLLECTOR') && !this.activeAbilities.has('HOT_POTATO') && !this.activeAbilities.has('BULLSEYE') && !this.activeAbilities.has('LIGHTNING_STRIKE')
            && !this.voteActive && !this.attractMode && !this.showFPS && this.mapType !== 'SOCCER') {

            this.ctx.font = "bold 30px Orbitron";
            this.ctx.fillStyle = this.timeLeft < 10 ? "#ef4444" : "#fff";
            this.ctx.textAlign = "center";
            this.ctx.shadowColor = "black";
            if (this.quality > 0) this.ctx.shadowBlur = 4;
            this.ctx.fillText(Math.ceil(this.timeLeft), this.width / 2, 50);
            this.ctx.shadowBlur = 0;
        }

        // Pass interpolation alpha
        // Pass interpolation alpha & hideUI flag (for Attract Mode)
        if (this.player && !this.player.dead) this.player.draw(this.ctx, alpha, this.attractMode);
        else if (this.player) {
            const remaining = Math.ceil((this.player.respawnTimer - Date.now()) / 1000);
            if (remaining > 0 && !this.attractMode) {
                this.ctx.fillStyle = 'white'; this.ctx.font = 'bold 40px Outfit'; this.ctx.textAlign = 'center';
                this.ctx.fillText(`Respawning in ${remaining}...`, this.width / 2, this.height / 2);
            }
        }

        // Render enemies with network interpolation
        this.enemies.forEach(e => {
            if (!e.dead) {
                // MULTIPLAYER: Networked players (identified by peerId)
                if (e.peerId) {
                    // CLIENT: Use interpolation buffer for all networked players
                    if (window.state?.lobby?.isHost === false && window.networkManager) {
                        const interpolated = window.networkManager.getInterpolatedState(e.peerId);
                        if (interpolated) {
                            const origX = e.x, origY = e.y;
                            e.x = interpolated.x;
                            e.y = interpolated.y;
                            e.draw(this.ctx, alpha, this.attractMode);
                            e.x = origX;
                            e.y = origY;
                        } else {
                            // Fallback: draw at current position
                            e.draw(this.ctx, alpha, this.attractMode);
                        }
                    }
                    // HOST: Direct render (we control their physics)
                    else {
                        e.draw(this.ctx, alpha, this.attractMode);
                    }
                }
                // SINGLE PLAYER: AI bots
                else {
                    e.draw(this.ctx, alpha, this.attractMode);
                }
            }
        });

        // ATTRACT MODE CINEMATIC OVERLAY - OPTIMIZED
        if (this.attractMode) {
            this.ctx.fillStyle = "rgba(15, 23, 42, 0.4)"; // Dark Blue Tint
            this.ctx.fillRect(0, 0, this.width, this.height);

            // Scanlines Loop Removed for Performance
            // Force disable glow effects globally
            this.ctx.shadowBlur = 0;
            this.ctx.shadowColor = 'transparent';
        }

        // WEATHER EFFECTS OVERLAY
        // WEATHER EFFECTS OVERLAY
        if (this.weather === 'FOG' || this.weather === 'SPACE_FOG') {

            if (!this.fogGradient) {
                const grad = this.ctx.createRadialGradient(this.width / 2, this.height / 2, this.width * 0.3, this.width / 2, this.height / 2, this.width);
                grad.addColorStop(0, 'rgba(0,0,0,0)');
                grad.addColorStop(1, this.weather === 'SPACE_FOG' ? 'rgba(20,0,40,0.5)' : 'rgba(200,200,200,0.3)');
                this.fogGradient = grad;
            }
            this.ctx.fillStyle = this.fogGradient;
            this.ctx.fillRect(0, 0, this.width, this.height);
        }
        if (this.weather === 'WIND') {
            // Simple wind lines
            this.ctx.strokeStyle = 'rgba(255,255,255,0.05)';
            this.ctx.lineWidth = 1;
            const time = Date.now() * 0.001;
            this.ctx.beginPath();
            for (let i = 0; i < 20; i++) {
                const x = (Date.now() * 0.5 + i * 100) % this.width;
                const y = (i * 50 + Math.sin(time + i) * 50) % this.height;
                this.ctx.moveTo(x, y);
                this.ctx.lineTo(x + 50, y + 10);
            }
            this.ctx.stroke();
        }

        if (this.voteActive) this.drawVortexes();

        // Render Active Banner
        if (this.banner) {
            this.drawBanner(this.banner.text, this.banner.subtext, this.banner.color);
            this.banner.timer -= 16; // Approx 1 frame ms
            if (this.banner.timer <= 0) this.banner = null;
        }

        // Universal Leaderboard (Top Right)
        if (!this.voteActive && !this.banner && !this.attractMode &&
            !this.activeAbilities.has('CANDY_COLLECTOR') && !this.activeAbilities.has('BULLSEYE') &&
            this.mapType !== 'SOCCER') { // Hide in Soccer
            this.drawLeaderboard();
        }

        this.ctx.restore();

        if (this.player && !this.player.dead) {
            const pct = Math.max(0, 1 - (this.player.dashCooldown - Date.now()) / CONFIG.DASH_COOLDOWN);
            if (pct < 1) {
                this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)'; this.ctx.lineWidth = 4; this.ctx.beginPath();
                this.ctx.arc(this.mouse.x, this.mouse.y, 30, 0, Math.PI * 2 * pct); this.ctx.stroke();
            }
        }

        // FPS & Ping Overlay (F3) - Standardized
        if (this.showFPS) {
            this.ctx.textAlign = 'right';
            this.ctx.font = 'bold 16px monospace'; // Monospace for alignment
            this.ctx.fillStyle = '#4ade80'; // Consistent Green Color

            const fps = Math.round(this.fps);
            let ping = 0;
            if (this.player && this.player.ping !== undefined) ping = this.player.ping;
            else if (window.state && window.state.network && window.state.network.peerId) {
                ping = (window.state.lobby && window.state.lobby.players.find(p => p.id === window.state.network.peerId)?.ping) || 0;
            }

            this.ctx.fillText(`FPS:  ${fps}`, this.width - 10, 25);
            this.ctx.fillText(`Ping: ${ping}ms`, this.width - 10, 45);
        }
    }

    // Helper for Hazard Strips
    drawHazardZone(x, y, w, h) {
        this.ctx.save();
        this.ctx.fillStyle = '#1f1212';
        return this.ctx.getImageData(0, 0, w, h);
    }

    drawHazardZone(x, y, w, h) {
        this.ctx.save();
        this.ctx.fillStyle = '#1f1212';
        this.ctx.fillRect(x, y, w, h);
        this.ctx.beginPath(); this.ctx.rect(x, y, w, h); this.ctx.clip();
        this.ctx.strokeStyle = 'rgba(239, 68, 68, 0.2)';
        this.ctx.lineWidth = 10;
        const diagStep = 40;
        for (let i = -h; i < w + h; i += diagStep) {
            this.ctx.beginPath();
            this.ctx.moveTo(x + i, y);
            this.ctx.lineTo(x + i - 30, y + h + 30);
            this.ctx.stroke();
        }
        this.ctx.restore();
    }

    loop() {
        if (!this.isRunning) return;

        // If game is logically "paused" (between round end and vote start), 
        // prevent accumulator buildup which causes "infinity glitch" in interpolation.
        if (!this.roundActive && !this.voteActive && !this.attractMode && !this.activeAbilities.has('HOT_POTATO')) {
            this.lastTime = performance.now();
            this.accumulator = 0;

            // CLEANUP: Wipe visual trails & DECOYS immediately
            if (this.player) this.player.trail = [];
            if (this.enemies) {
                // Remove Decoys instantly on round end
                this.enemies = this.enemies.filter(e => !e.isDecoy);
                this.enemies.forEach(e => e.trail = []);
            }

            // Draw one last frame static
            this.draw(0);
            this.animationFrameId = requestAnimationFrame(this.loop);
            return;
        }

        // High-precision timer (works correctly on 144Hz+ monitors)
        const now = performance.now();
        let frameTime = (now - this.lastTime) / 1000; // Convert to seconds
        this.lastTime = now;

        // CAP FRAMETIME: Prevent spiral of death (lag spike protection)
        if (frameTime > 0.1) frameTime = 0.1; // Max 100ms per frame

        // FIXED TIMESTEP: 60Hz physics (independent of monitor refresh rate)
        const FIXED_DT = 1 / 60; // 16.666ms
        this.accumulator = (this.accumulator || 0) + frameTime;

        const MAX_UPDATES = 5; // Increased for 144Hz support
        let updates = 0;

        // Update physics in fixed steps (always 60Hz, regardless of monitor)
        while (this.accumulator >= FIXED_DT && updates < MAX_UPDATES) {
            this.update(FIXED_DT); // Always 0.01666s
            this.accumulator -= FIXED_DT;
            updates++;
            this.frameCount++; // Deterministic frame counter
        }

        // NETWORK: Broadcast state at 20Hz (every 3rd frame) - OPTIMIZED for Host CPU Load
        // Interpolation handles the smoothness on clients.
        if (window.state?.lobby?.isHost && window.networkManager && this.frameCount % 3 === 0) {
            window.networkManager.broadcastState();
        }

        // If still behind, skip to catch up (prevents CPU overload on slow devices)
        if (this.accumulator >= FIXED_DT) {
            this.accumulator = 0; // Reset (frame skip)
        }

        // RENDER: Interpolation alpha for smooth animation at any Hz
        if (!this.roundActive && !this.voteActive && !this.attractMode && !this.activeAbilities.has('HOT_POTATO')) {
            if (this.player) this.player.trail = [];
            if (this.enemies) this.enemies.forEach(e => e.trail = []);
            this.accumulator = 0;
            this.draw(0);
        } else {
            // Interpolation: alpha = how far between current and next physics step
            // 60Hz monitor: alpha ~= 1.0 (one physics step per frame)
            // 144Hz monitor: alpha ~= 0.416 (2.4 frames per physics step)
            const alpha = Math.min(this.accumulator / FIXED_DT, 1.0);
            this.draw(alpha);
        }

        // FPS Tracking (actual render FPS, not physics FPS)
        this.fpsFrames++;
        const fpsNow = performance.now();
        if (fpsNow - this.fpsLastTime >= 1000) {
            this.fps = this.fpsFrames;
            this.fpsFrames = 0;
            this.fpsLastTime = fpsNow;
        }

        // Monitor Performance (Adaptive Quality - MORE AGGRESSIVE)
        if (this.fps < 55 && this.isRunning) {
            this.lowFpsFrames++;
            if (this.lowFpsFrames > 120 && this.quality > 0) {
                this.quality = 0; // Downgrade
                if (this.particles.length > 50) this.particles.length = 50;
            }
        } else if (this.fps >= 50) {
            // Faster recovery
            this.lowFpsFrames = Math.max(0, this.lowFpsFrames - 3);
            // Auto-upgrade back to high quality if stable
            if (this.lowFpsFrames === 0 && this.quality === 0 && this.fps >= 55) {
                this.quality = 1;
            }
        }

        if (this.isRunning) {
            this.animationFrameId = requestAnimationFrame(this.loop);
        }
    }

    stop() {
        this.isRunning = false;
        if (this.physicsInterval) clearInterval(this.physicsInterval);
    }

    resumeRound() {
        this.timeLeft = this.roundTime;
        this.roundActive = true;
        this.lastTime = performance.now();
        this.startRound(null);
    }
    // Trigger a banner notification
    triggerBanner(text, subtext = "", color = "#facc15") {
        this.banner = { text, subtext, color, timer: 3000 };
    }

    // Render Banner Frame
    drawBanner(text, subtext = "", color = "#facc15") {
        const cx = this.width / 2;
        const cy = this.height / 2;

        this.ctx.save();
        // Diagonal strip background
        this.ctx.translate(cx, cy);
        this.ctx.rotate(-0.05); // Slight tilt

        this.ctx.fillStyle = "rgba(0,0,0,0.8)";
        this.ctx.fillRect(-400, -60, 800, 120);

        this.ctx.fillStyle = color;
        this.ctx.fillRect(-400, -60, 800, 10); // Top Border
        this.ctx.fillRect(-400, 50, 800, 10); // Bottom Border

        this.ctx.textAlign = "center";
        this.ctx.fillStyle = "#fff";
        this.ctx.font = "bold 60px 'Russo One', sans-serif";
        this.ctx.fillText(text, 0, 15);

        if (subtext) {
            this.ctx.font = "24px 'Orbitron', monospace";
            this.ctx.fillStyle = "rgba(255,255,255,0.8)";
            this.ctx.fillText(subtext, 0, 45);
        }

        this.ctx.restore();
    }

    // Define Modes Data
    getModesData() {
        return [
            { id: 'CLASSIC', name: 'Classic Arena', icon: '⚔️', desc: 'Pure chaos! Use SPACE/CLICK to dash. Press X for decoy clones!', color: '#94a3b8' },
            { id: 'HOT_POTATO', name: 'Hot Potato', icon: '🥔', desc: 'DEADLY SPUD! Press E to pass bomb to nearby enemy. Don\'t hold it at 0!', color: '#f87171' },
            { id: 'SOCCER', name: 'Soccer Mode', icon: '⚽', desc: 'Team Football! DASH to kick the ball into goals. First team to 5 wins!', color: '#4ade80' },
            { id: 'VOID', name: 'Void Eater', icon: '🕳️', desc: 'RUN! A black hole spawns and GROWS. Stay away from the center!', color: '#a855f7' },
            { id: 'CHAOS', name: 'Chaos Mode', icon: '⚡', desc: 'MAYHEM! Random powerups, bomb rain, physics madness. Expect anything!', color: '#facc15' },
            { id: 'SIZE_CHANGE', name: 'Mutators', icon: '📏', desc: 'Size roulette! Grow GIANT (slow tank) or shrink TINY (speed demon)!', color: '#fb923c' },
            { id: 'BOMB_DROP', name: 'Bomb Rain', icon: '💣', desc: 'Explosive hailstorm! Press E to drop YOUR bomb. Dodge the rest!', color: '#ef4444' },
            { id: 'POWERFUL_PUSH', name: 'Sumo Push', icon: '🥊', desc: 'ULTRA STRENGTH! Your dash hits send enemies FLYING across the map!', color: '#e879f9' },
            { id: 'SLIPPERY', name: 'Ice Rink', icon: '❄️', desc: 'NO BRAKES! Friction = 0. Master the drift or crash into the void!', color: '#38bdf8' },
            { id: 'CANDY_COLLECTOR', name: 'Candy Hunt', icon: '🍬', desc: 'SWEET TOOTH! Collect candies before others. First to 15 wins!', color: '#ec4899' },
            { id: 'LIGHTNING_STRIKE', name: 'Storm Dodge', icon: '⚡', desc: 'SKY STRIKES! Dodge lightning warnings. Last survivor wins!', color: '#fbbf24' },
            { id: 'BULLSEYE', name: 'Target Practice', icon: '🎯', desc: 'HIT THE MARK! Dash into moving targets. First to 10 scores wins!', color: '#10b981' }
        ];
    }

    startVortexVote(winner) {
        this.voteActive = true;
        this.voteTimer = 10;
        this.accumulator = 0;

        // Reset Physics & Cleanup
        if (this.player) { this.player.trail = []; this.player.dx = 0; this.player.dy = 0; }
        this.shake = { x: 0, y: 0, str: 0 }; // Reset screen shake

        // Clear heavy objects
        this.candies = [];
        this.bombs = [];
        this.particles = [];
        this.lightningWarnings = [];

        if (this.enemies) {
            this.enemies = this.enemies.filter(e => !e.isDecoy);
            this.enemies.forEach(e => { e.trail = []; e.dx = 0; e.dy = 0; });
        }

        this.allAllModes = this.getModesData();
        this.currentVotes = {};
        this.currentVotes[this.player.id || 'player'] = -1;

        // Bots don't vote (player-only decision)

        // COMPACT LAYOUT (3 Rows for 12 modes - 4x3 grid)
        const CARD_W = 170; // Reduced for better fit
        const CARD_H = 210; // Reduced for better fit
        const GAP = 15; // Tighter spacing
        const COLS = 4; // 4 columns
        const ROWS = 3; // 3 rows

        // Screen Center logic
        const startY = 140; // Moved down to avoid overlap with timer
        const totalW = (COLS * CARD_W) + ((COLS - 1) * GAP);
        const startX = (this.width - totalW) / 2;

        this.voteCards = this.allAllModes.map((m, i) => {
            const col = i % COLS;
            const row = Math.floor(i / COLS);

            return {
                x: startX + col * (CARD_W + GAP),
                y: startY + row * (CARD_H + GAP),
                w: CARD_W,
                h: CARD_H,
                mode: m,
                index: i,
                hoverScale: 1.0
            };
        });
    }

    updateVortexLogic(dt) {
        this.voteTimer -= dt;

        // Mouse Interaction
        if (this.mouse.down) {
            // Check clicks
            this.voteCards.forEach(card => {
                if (this.mouse.x > card.x && this.mouse.x < card.x + card.w &&
                    this.mouse.y > card.y && this.mouse.y < card.y + card.h) {

                    // Vote Locally
                    const pid = (this.player && this.player.id) ? this.player.id : 'player';
                    this.currentVotes[pid] = card.index;
                    this.audio.playUIClick();
                    this.mouse.down = false; // Debounce

                    // NETWORK: Broadcast Vote
                    if (window.networkManager && typeof window.networkManager.broadcast === 'function') {
                        window.networkManager.broadcast({
                            type: 'VOTE_CAST',
                            playerId: pid,
                            voteIndex: card.index
                        });
                    }
                }
            });
        }

        // End logic
        if (this.voteTimer <= 0) {
            this.endVote();
        }
    }

    endVote() {
        this.voteActive = false;

        // MULTIPLAYER SYNC CHECK
        const isMultiplayer = window.networkManager && typeof window.networkManager.broadcast === 'function'; // Simple check
        const isHost = !isMultiplayer || (window.state && window.state.lobby && window.state.lobby.isHost);

        if (isMultiplayer && !isHost) {
            return; // Halt! Wait for network 'GAME_START' message.
        }

        // HOST / LOCAL LOGIC
        // Count votes (ignore invalid -1 votes)
        const counts = new Array(this.allAllModes.length).fill(0);
        Object.values(this.currentVotes).forEach(idx => {
            if (idx >= 0 && idx < counts.length) counts[idx]++;
        });

        // Find winner
        let max = -1;
        let candidates = [];

        counts.forEach((c, i) => {
            if (c > max) { max = c; candidates = [i]; }
            else if (c === max) { candidates.push(i); }
        });

        const winnerIdx = candidates[this.rng.randomInt(0, candidates.length)]; // Deterministic tie-break
        const winnerMode = this.allAllModes[winnerIdx];

        // Broadcast Decision
        if (isMultiplayer && isHost) {
            window.networkManager.broadcast({ type: 'GAME_START', mode: winnerMode.id });
        }

        // Restart Local
        if (this.onVoteComplete) this.onVoteComplete(winnerMode.id);
    }

    drawLeaderboard() {
        if (this.activeAbilities.has('CANDY_COLLECTOR') || this.activeAbilities.has('BULLSEYE')) return;

        const getScore = (e) => {
            if (this.activeAbilities.has('CANDY_COLLECTOR')) return this.playerScores.get(e.id) || 0;
            if (this.activeAbilities.has('BULLSEYE')) return this.bullseyeScores.get(e.id) || 0;
            return e.kills;
        };

        const label = this.activeAbilities.has('CANDY_COLLECTOR') ? 'Candies' : (this.activeAbilities.has('BULLSEYE') ? 'Hits' : 'Kills');

        const scores = [this.player, ...this.enemies]
            .filter(e => !e.isDecoy)
            .map(e => ({ name: e.name, score: getScore(e), color: e.color, dead: e.dead }));

        scores.sort((a, b) => b.score - a.score);
        const top5 = scores.slice(0, 5);

        const cardW = 200;
        const cardH = top5.length * 30 + 40;
        const margin = 15;

        // Draw lower to avoid overlapping player list or other UI
        const topY = 100;

        this.ctx.save();
        // Position: Top-Left (If Candy HUD is present, push down)
        let lbX = 20;
        let lbY = 20;
        if (this.activeAbilities.has('CANDY_COLLECTOR')) lbY = 220; // Below Candy HUD
        this.ctx.translate(lbX, lbY);

        // Glassmorphism Background (Optimized: No blur, simple opacity)
        this.ctx.fillStyle = 'rgba(15, 23, 42, 0.6)';
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        this.ctx.lineWidth = 1;

        this.ctx.beginPath();
        this.ctx.roundRect(0, 0, cardW, cardH, 12);
        this.ctx.fill();
        this.ctx.stroke();

        // Header
        this.ctx.font = '700 14px Outfit';
        this.ctx.fillStyle = '#fff';
        this.ctx.textAlign = 'center';
        this.ctx.fillText(label.toUpperCase(), cardW / 2, 25);

        // Divider
        this.ctx.beginPath(); this.ctx.moveTo(10, 35); this.ctx.lineTo(cardW - 10, 35); this.ctx.stroke();

        let yPos = 55;
        this.ctx.textAlign = 'left';
        this.ctx.font = '500 14px Outfit';

        top5.forEach((s, i) => {
            this.ctx.fillStyle = s.dead ? '#94a3b8' : s.color;
            this.ctx.fillText(`${i + 1}. ${s.name}`, 15, yPos);

            this.ctx.textAlign = 'right';
            this.ctx.fillStyle = '#fff';
            this.ctx.fillText(s.score, cardW - 15, yPos);
            this.ctx.textAlign = 'left'; // Reset

            if (s.dead) {
                this.ctx.lineWidth = 1;
                this.ctx.strokeStyle = '#64748b';
                this.ctx.beginPath(); this.ctx.moveTo(15, yPos - 4); this.ctx.lineTo(130, yPos - 4); this.ctx.stroke();
            }

            yPos += 30;
        });

        this.ctx.restore();
    }

    drawVortexes() { // Vote Menu Render
        // 1. Frosted Glass Background
        this.ctx.fillStyle = "rgba(10, 15, 30, 0.85)"; // Deep blue-black
        this.ctx.fillRect(0, 0, this.width, this.height);

        // Header
        this.ctx.textAlign = "center";
        this.ctx.shadowColor = "rgba(0,0,0,0.5)";
        this.ctx.shadowBlur = 10;

        this.ctx.fillStyle = "#fff";
        this.ctx.font = "800 50px 'Outfit', sans-serif";
        this.ctx.fillText("VOTE NEXT MODE", this.width / 2, 50); // Moved up to 50

        // Tips
        this.ctx.font = "16px 'Outfit', sans-serif";
        this.ctx.fillStyle = "#94a3b8";
        this.ctx.fillText("💡 Tips: Press T for taunts 🤡 | Press ENTER for chat 💬", this.width / 2, 80); // Moved to 80

        // Timer Bar (below emoji tip)
        const timerPct = this.voteTimer / 10;
        this.ctx.fillStyle = "#1e293b";
        this.ctx.fillRect(this.width / 2 - 200, 110, 400, 10); // Moved to 110
        this.ctx.fillStyle = "#facc15";
        this.ctx.fillRect(this.width / 2 - 200, 110, 400 * timerPct, 10);

        this.ctx.shadowBlur = 0; // Reset

        // Draw Cards
        this.voteCards.forEach(card => {
            const isSelected = this.currentVotes[this.player.id || 'player'] === card.index;
            const isHovered = this.mouse.x > card.x && this.mouse.x < card.x + card.w &&
                this.mouse.y > card.y && this.mouse.y < card.y + card.h;

            // Animation Target
            const targetScale = isHovered || isSelected ? 1.05 : 1.0;
            card.hoverScale += (targetScale - card.hoverScale) * 0.2; // Smooth lerp

            const w = card.w * card.hoverScale;
            const h = card.h * card.hoverScale;
            const x = card.x - (w - card.w) / 2;
            const y = card.y - (h - card.h) / 2;

            this.ctx.save();
            // Shadow
            this.ctx.shadowColor = isSelected ? card.mode.color : "rgba(0,0,0,0.5)";
            this.ctx.shadowBlur = isSelected ? 30 : 15;
            this.ctx.shadowOffsetY = 10;

            // Card BG (Glass)
            this.ctx.fillStyle = isSelected ? "rgba(255, 255, 255, 0.1)" : "rgba(30, 41, 59, 0.6)";

            // Border
            this.ctx.strokeStyle = isSelected ? card.mode.color : "rgba(255, 255, 255, 0.1)";
            this.ctx.lineWidth = isSelected ? 3 : 1;

            if (this.ctx.roundRect) {
                this.ctx.beginPath();
                this.ctx.roundRect(x, y, w, h, 16);
                this.ctx.fill();
                this.ctx.stroke();
            } else {
                this.ctx.fillRect(x, y, w, h);
                this.ctx.strokeRect(x, y, w, h);
            }
            this.ctx.restore(); // Drop shadow off

            // Icon Bubble
            this.ctx.beginPath();
            this.ctx.arc(x + w / 2, y + 65, 45, 0, Math.PI * 2); // Smaller & moved up
            this.ctx.fillStyle = "rgba(0,0,0,0.2)";
            this.ctx.fill();

            this.ctx.fillStyle = "#fff";
            this.ctx.font = "50px Arial"; // Smaller emoji
            this.ctx.textAlign = "center";
            this.ctx.fillText(card.mode.icon, x + w / 2, y + 82);

            // Title
            this.ctx.font = "bold 18px 'Outfit', sans-serif"; // Smaller
            this.ctx.fillStyle = isSelected ? "#fff" : "#e2e8f0";
            this.ctx.fillText(card.mode.name.toUpperCase(), x + w / 2, y + 145); // Moved up

            // Description
            this.ctx.font = "12px 'Outfit', sans-serif"; // Smaller
            this.ctx.fillStyle = "#94a3b8";
            this.wrapText(this.ctx, card.mode.desc, x + w / 2, y + 165, w - 30, 16); // Adjusted

            // Votes (Avatars)
            const voters = Object.entries(this.currentVotes).filter(([id, idx]) => idx === card.index);
            if (voters.length > 0) {
                voters.forEach((v, i) => {
                    // Stack circles at bottom
                    const vx = x + 30 + (i * 25);
                    const vy = y + h - 30;
                    this.ctx.beginPath();
                    this.ctx.arc(vx, vy, 12, 0, Math.PI * 2);
                    this.ctx.fillStyle = this.getVoteColor(v[0]); // Helper needed
                    this.ctx.fill();
                    this.ctx.strokeStyle = "#fff";
                    this.ctx.lineWidth = 2;
                    this.ctx.stroke();
                });
            }
        });
    }

    // Helper for avatar colors
    getVoteColor(id) {
        if (id === 'player' || (this.player && id === this.player.id)) return this.player.color;
        // Check both id and peerId for networked players
        const enemy = this.enemies.find(e => e.id === id || e.peerId === id);
        return enemy ? enemy.color : '#fff';
    }

    // Wrap text helper
    wrapText(ctx, text, x, y, maxWidth, lineHeight) {
        const words = text.split(' ');
        let line = '';
        let currentY = y;

        words.forEach(word => {
            const testLine = line + word + ' ';
            const metrics = ctx.measureText(testLine);
            if (metrics.width > maxWidth && line !== '') {
                ctx.fillText(line, x, currentY);
                line = word + ' ';
                currentY += lineHeight;
            } else {
                line = testLine;
            }
        });
        ctx.fillText(line, x, currentY);
    }

    spawnDecoy(owner) {
        if (owner.stealthTimer > 0) return; // Cooldown/Active

        // 1. Make Owner Invisible (Stealth)
        owner.stealthTimer = 2000; // 2s Stealth
        owner.opacity = 0.3; // Ghostly

        // 2. Create Decoy at current pos
        const decoy = new Entity(owner.x, owner.y, owner.color, owner.name, false, owner.face, owner.hat, owner.team);
        decoy.isDecoy = true;
        decoy.decoyTimer = 3000; // Lasts 3s
        decoy.radius = owner.radius;
        decoy.prevX = owner.x; decoy.prevY = owner.y; // For interpolation

        // Decoy runs forward (fake momentum)
        const speed = 8;
        // If owner is moving, use that dir, else random
        let angle = Math.atan2(owner.dy, owner.dx);
        if (Math.abs(owner.dx) < 0.1 && Math.abs(owner.dy) < 0.1) angle = this.rng.random() * Math.PI * 2;

        decoy.dx = Math.cos(angle) * speed;
        decoy.dy = Math.sin(angle) * speed;

        // Add to enemies list so physic engine handles collisions (fake body)
        this.enemies.push(decoy);

        this.addParticles(owner.x, owner.y, 10, '#ffffff'); // Poof effect
        return decoy;
    }

}

const COLORS = {
    RED_TEAM: '#ef4444',
    BLUE_TEAM: '#3b82f6',
    BALL: '#ffffff',
    GRASS: '#1e293b' // Keeping dark theme but maybe slightly greener? Let's stick to theme: Dark Tech
};

class Ball {
    constructor(x, y) {
        this.x = x; this.y = y;
        this.prevX = x; // For interpolation
        this.prevY = y; // For interpolation
        this.radius = 35;
        this.dx = 0; this.dy = 0;
        this.friction = 0.98;
        this.restitution = 0.8;
    }
    update() {
        this.x += this.dx; this.y += this.dy;
        this.dx *= this.friction; this.dy *= this.friction;
    }
}

