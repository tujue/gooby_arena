import { CONFIG } from './config.js';
export class Entity {
    constructor(x, y, color, name, isPlayer, face, hat = 'none', team = 'NONE') {
        this.id = Math.random().toString(36).substr(2, 9);
        this.x = x;
        this.y = y;
        this.prevX = x; // For interpolation
        this.prevY = y; // For interpolation
        this.color = color;
        this.name = name;
        this.isPlayer = isPlayer;
        this.face = face;
        this.hat = hat;
        this.team = team;

        this.radius = 30; // Base size
        this.targetRadius = 30;
        this.mass = 30 * 30;

        this.dead = false;
        this.dx = 0; this.dy = 0;
        this.friction = 0.90;
        this.speed = 0.6;
        this.dashAttacking = 0;
        this.dashCooldown = 0;
        this.trail = [];

        this.speedMult = 1.0;
        this.sizeMultiplier = 1.0;
        this.powerMult = 1.0;
        this.respawnTimer = 0;
        this.isDashing = false;
        this.shadowTimer = 0;
        this.kills = 0;
        this.lastHitter = null;

        // Spawn Protection
        this.invulnTimer = 0; // ms

        // Sprite Caching
        this.spriteCanvas = document.createElement('canvas');
        this.spriteCanvas.width = this.radius * 2 + 10;
        this.spriteCanvas.height = this.radius * 2 + 10;
        this.spriteCtx = this.spriteCanvas.getContext('2d');
        this.cacheDirty = true; // Flag to redraw cache

        // VISUALS: Neon Trail & Taunt
        this.trail = []; // {x, y, alpha}
        this.trailTimer = 0;
        this.tauntTimer = 0;
        this.tauntEmoji = '';
        this.killStreak = 0;
        this.streakTimer = 0;

        // DECOY / STEALTH (Mechanic)
        this.isDecoy = false;
        this.vortexes = [];
        this.voteActive = false;
        this.voteTimer = 0;
        this.banner = null; // { text, subtext, color, timer }
    }

    // P2P HOOK: Call this when receiving taunt event
    triggerTaunt(emoji) {
        this.tauntEmoji = emoji;
        this.tauntTimer = 2000;
        // Optional: Play sound?
    }

    cacheSprite() {
        if (!this.cacheDirty) return;

        const r = this.radius;
        const pad = 20; // Increased padding for hats
        const canvasSize = (r + pad) * 2;

        if (this.spriteCanvas.width !== canvasSize || this.spriteCanvas.height !== canvasSize) {
            this.spriteCanvas.width = canvasSize;
            this.spriteCanvas.height = canvasSize;
        }

        const ctx = this.spriteCtx;
        const cx = r + pad;
        const cy = r + pad;

        ctx.clearRect(0, 0, this.spriteCanvas.width, this.spriteCanvas.height);

        // Body
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = this.color; ctx.fill();
        ctx.strokeStyle = '#000000'; ctx.lineWidth = 3; ctx.stroke();

        // Inner Shine
        ctx.beginPath();
        ctx.arc(cx - r * 0.3, cy - r * 0.3, r * 0.2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.fill();

        ctx.fillStyle = 'black';
        ctx.strokeStyle = 'black';
        ctx.lineCap = 'round';

        if (this.face === 'angry') {
            // Eyes (Slanted)
            ctx.save();
            ctx.translate(cx - r * 0.4, cy - r * 0.1); ctx.rotate(20 * Math.PI / 180);
            ctx.fillRect(-8, -4, 16, 8);
            ctx.restore();

            ctx.save();
            ctx.translate(cx + r * 0.4, cy - r * 0.1); ctx.rotate(-20 * Math.PI / 180);
            ctx.fillRect(-8, -4, 16, 8);
            ctx.restore();

            // Mouth (Frown)
            ctx.beginPath();
            ctx.arc(cx, cy + r * 0.5, r * 0.2, 1.1 * Math.PI, 1.9 * Math.PI);
            ctx.lineWidth = 3; ctx.stroke();
        }
        else if (this.face === 'happy') {
            // Eyes (Arches)
            ctx.beginPath(); ctx.arc(cx - r * 0.3, cy - r * 0.1, r * 0.15, 1.1 * Math.PI, 1.9 * Math.PI); ctx.lineWidth = 3; ctx.stroke();
            ctx.beginPath(); ctx.arc(cx + r * 0.3, cy - r * 0.1, r * 0.15, 1.1 * Math.PI, 1.9 * Math.PI); ctx.lineWidth = 3; ctx.stroke();

            // Mouth (Smile)
            ctx.beginPath();
            ctx.arc(cx, cy, r * 0.5, 0.2 * Math.PI, 0.8 * Math.PI);
            ctx.fill();
        }
        else if (this.face === 'cyclops') {
            // One Big Eye
            ctx.fillStyle = 'white';
            ctx.beginPath(); ctx.arc(cx, cy - r * 0.1, r * 0.4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            ctx.fillStyle = 'black';
            ctx.beginPath(); ctx.arc(cx, cy - r * 0.1, r * 0.15, 0, Math.PI * 2); ctx.fill();

            // Mouth
            ctx.beginPath(); ctx.moveTo(cx - r * 0.2, cy + r * 0.5); ctx.lineTo(cx + r * 0.2, cy + r * 0.5); ctx.lineWidth = 3; ctx.stroke();
        }
        else if (this.face === 'ninja') {
            // Mask
            ctx.fillStyle = '#1e293b';
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2); // Full circle clip would be better but simple overlay works
            ctx.clip(); // Clip to body
            ctx.fillRect(cx - r, cy, r * 2, r); // Bottom half

            // Eyes (Narrow slit)
            ctx.fillStyle = 'white';
            ctx.beginPath(); ctx.rect(cx - r * 0.6, cy - r * 0.2, r * 1.2, r * 0.3); ctx.fill();

            ctx.fillStyle = 'black';
            ctx.beginPath(); ctx.arc(cx - r * 0.3, cy - r * 0.05, 3, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(cx + r * 0.3, cy - r * 0.05, 3, 0, Math.PI * 2); ctx.fill();

            // Reset Clip (Requires save/restore usually, but cacheSprite is isolated)
        }
        else if (this.face === 'dead') {
            ctx.font = "bold 24px monospace";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("X   X", cx, cy - r * 0.1);
            ctx.beginPath(); ctx.moveTo(cx - r * 0.2, cy + r * 0.4); ctx.lineTo(cx + r * 0.2, cy + r * 0.4); ctx.stroke();
        }
        else {
            // Normal / Default
            ctx.fillStyle = 'black';
            ctx.beginPath(); ctx.arc(cx - r * 0.3, cy - r * 0.2, 4, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(cx + r * 0.3, cy - r * 0.2, 4, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(cx, cy + r * 0.2, r * 0.2, 0.1 * Math.PI, 0.9 * Math.PI); ctx.stroke();
        }

        if (this.hat && this.hat !== 'none') {
            const hats = {
                'crown': '👑', 'bow': '🎀', 'sunglasses': '🕶️', 'hat': '🧢',
                'horns': '😈', 'halo': '😇', 'mask': '😷', 'cowboy': '🤠'
            };
            const emoji = hats[this.hat];
            if (emoji) {
                ctx.textAlign = "center";
                ctx.textBaseline = "middle"; // Changed from bottom to middle for better control

                // Default Hat Position (Top of head)
                let fontSize = r * 1.5;
                let yOff = -r * 0.75;

                // Specific Adjustments
                if (this.hat === 'sunglasses') {
                    fontSize = r * 1.3;
                    yOff = -r * 0.2; // Optimized visual center for game
                }
                if (this.hat === 'mask') {
                    fontSize = r;
                    yOff = r * 0.4; // Mouth area
                }
                if (this.hat === 'halo') {
                    yOff = -r * 1.1; // Floating above
                }
                if (this.hat === 'crown' || this.hat === 'hat' || this.hat === 'cowboy') {
                    yOff = -r * 0.8; // On top
                }

                ctx.font = `${fontSize}px serif`;
                ctx.fillText(emoji, cx, cy + yOff);
            }
        }

        this.cacheDirty = false;
    }

    applyInput(dirX, dirY) {
        // Note: Dash check is handled in game loop, not here
        this.dx += dirX * this.speed * this.speedMult;
        this.dy += dirY * this.speed * this.speedMult;
    }
    dash(targetX, targetY, force, ignoreCooldown = false) {
        if (!ignoreCooldown && Date.now() < this.dashCooldown) return false;

        let activeForce = force;
        // COMPACT BURST
        let activeDuration = 0.48; // 12% shorter

        const a = Math.atan2(targetY - this.y, targetX - this.x);
        this.dx = Math.cos(a) * activeForce;
        this.dy = Math.sin(a) * activeForce;

        this.isDashing = true;
        this.dashAttacking = activeDuration;

        // TODO: Mode-specific multipliers (will be customized later)
        // if (this.isSoccerPlayer) {
        //     this.dx *= 1.2;
        //     this.dy *= 1.2;
        //     this.dashAttacking *= 1.2;
        // }

        this.dashCooldown = Date.now() + CONFIG.DASH_COOLDOWN;
        return true;
    }

    updatePhysics(game, dt) {
        // RESPONSIVE FRICTION (60Hz optimized)
        const speed = Math.hypot(this.dx, this.dy);

        if (this.dashAttacking > 0) {
            this.friction = 0.99995; // Minimal friction for dash
        } else {
            // Base friction values
            let baseFriction;
            if (speed > 10) baseFriction = 0.985;
            else if (speed > 6) baseFriction = 0.975;
            else if (speed > 3) baseFriction = 0.965;
            else if (speed > 1.5) baseFriction = 0.955;
            else baseFriction = 0.93;

            // SLIPPERY MODE
            if (game && game.activeAbilities && game.activeAbilities.has('SLIPPERY_GROUND')) {
                const gap = 1.0 - baseFriction;
                baseFriction = baseFriction + (gap * 0.875);
            }
            // POWERFUL_PUSH
            if (game && game.activeAbilities && game.activeAbilities.has('POWERFUL_PUSH')) {
                const gap = 1.0 - baseFriction;
                baseFriction = baseFriction + (gap * 0.15);
            }
            // BOMB_DROP
            if (game && game.activeAbilities && game.activeAbilities.has('BOMB_DROP')) {
                const gap = 1.0 - baseFriction;
                baseFriction = baseFriction + (gap * 0.25);
            }
            // SOCCER MODE
            if (game && game.mapType === 'SOCCER') {
                baseFriction -= 0.035;
            }
            this.friction = baseFriction;
        }

        // Apply friction
        this.dx *= this.friction;
        this.dy *= this.friction;

        // SIZE_CHANGE Logic (Persist)
        if (game && game.activeAbilities && game.activeAbilities.has('SIZE_CHANGE')) {
            // Keep existing speedMult
        } else {
            this.speedMult = 1.0;
        }

        // POWERFUL_PUSH Speed Boost
        if (game && game.activeAbilities && game.activeAbilities.has('POWERFUL_PUSH')) {
            if (!game.activeAbilities.has('SIZE_CHANGE')) this.speedMult = 1.2;
        }

        // Move
        this.x += this.dx; this.y += this.dy;

        // Dash State
        if (this.dashAttacking > 0) {
            this.dashAttacking -= dt;
            if (this.dashAttacking < 0) this.dashAttacking = 0;
            this.isDashing = true;
        } else {
            this.isDashing = false;
        }
    }

    update(dt, mouse, game) {
        // Respawn logic
        if (this.dead) {
            if (this.respawnTimer && Date.now() >= this.respawnTimer) {
                // Respawn!
                this.dead = false;
                this.respawnTimer = 0;
                const pos = game.getSafeSpawnPos();
                this.x = pos.x;
                this.y = pos.y;
                this.dx = 0;
                this.dy = 0;
                game.addParticles(this.x, this.y, 5, this.color);
            } else {
                return; // Still dead
            }
        }

        // DELEGATE PHYSICS
        this.updatePhysics(game, dt);

        // TRAIL LOGIC
        // Add point every frame for smoothness
        this.trail.push({ x: this.x, y: this.y, alpha: 1.0 });
        if (this.trail.length > 20) this.trail.shift(); // Limit length

        // Decrement taunt & streak
        if (this.tauntTimer > 0) this.tauntTimer -= dt * 1000;
        if (this.streakTimer > 0) {
            this.streakTimer -= dt * 1000;
            if (this.streakTimer <= 0) this.killStreak = 0;
        }

        // DECREMENT SPAWN PROTECTION
        if (this.invulnTimer > 0) this.invulnTimer -= dt * 1000;

        // DECOY / STEALTH LOGIC
        if (this.stealthTimer > 0) {
            this.stealthTimer -= dt * 1000;
            if (this.stealthTimer <= 0) this.opacity = 1.0; // Reveal
        }
        if (this.isDecoy) {
            this.decoyTimer -= dt * 1000;
            // Flicker before death
            if (this.decoyTimer < 500) this.opacity = (Math.floor(Date.now() / 50) % 2 === 0) ? 0.5 : 1.0;
            if (this.decoyTimer <= 0) {
                this.dead = true;
                // Silent death (no kill feed)
            }
        }
    }

    // Interpolated Rendering
    draw(ctx, alpha = 1.0, hideUI = false) {
        if (this.dead) return;

        // Spawn Protection Blink (Invisible 50% of time)
        if (this.invulnTimer > 0) {
            if (Math.floor(Date.now() / 100) % 2 === 0) return;
        }

        // Cache Sprite if needed
        if (this.cacheDirty) this.cacheSprite();

        // INTERPOLATION: Smooth movement between physics steps
        const renderX = this.prevX + (this.x - this.prevX) * alpha;
        const renderY = this.prevY + (this.y - this.prevY) * alpha;

        // Reset Transform (Just in case)
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        // We handle camera outside, so here we assume camera transform is applied... 
        // Wait, GoobyGame applies camera transform before calling draw.
        // But here loop logic? No, GoobyGame.draw() calls ctx.translate(-cam.x, -cam.y).
        // So we just draw at renderX, renderY.

        // SHADOW
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        // Ellipse shadow
        ctx.ellipse(renderX, renderY + this.radius * 0.8, this.radius, this.radius * 0.4, 0, 0, Math.PI * 2);
        ctx.fill();

        // 0. NEON TRAIL (Render First behind) - OPTIMIZED
        // Skip trails in Attract Mode (hideUI) or Low Quality
        const showTrails = !hideUI && (!window.gameInstance || window.gameInstance.quality > 0);

        if (showTrails && this.trail.length > 2) {
            ctx.beginPath();
            ctx.moveTo(this.trail[0].x, this.trail[0].y);
            for (let i = 1; i < this.trail.length; i++) {
                ctx.lineTo(this.trail[i].x, this.trail[i].y);
            }
            ctx.lineTo(renderX, renderY);

            ctx.strokeStyle = this.team === 'RED' ? 'rgba(239, 68, 68, 0.4)' : (this.team === 'BLUE' ? 'rgba(59, 130, 246, 0.4)' : 'rgba(0, 255, 255, 0.4)');
            if (this.color === '#ff4500') ctx.strokeStyle = 'rgba(255, 69, 0, 0.6)'; // Hot Potato
            ctx.lineWidth = this.radius * 0.8;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.stroke();
        }

        // Draw Cached Body
        const offset = -this.radius - 5;
        if (this.spriteCanvas) ctx.drawImage(this.spriteCanvas, renderX + offset, renderY + offset);

        // PUPILS REMOVED as per request

        // Highlight Player
        if (this.isPlayer && !hideUI) {
            // Halo Removed as per request

            // Arrow indicator
            ctx.fillStyle = 'white';
            ctx.beginPath();
            ctx.moveTo(renderX, renderY - this.radius - 20);
            ctx.lineTo(renderX - 10, renderY - this.radius - 35);
            ctx.lineTo(renderX + 10, renderY - this.radius - 35);
            ctx.fill();
        }

        // Name & Health (Hide in UI Mode)
        if (!hideUI) {
            ctx.fillStyle = "white";
            ctx.font = "bold 14px Outfit";
            ctx.textAlign = "center";
            ctx.fillText(this.name, renderX, renderY - this.radius - 15);
        }

        // Taunt Emoji
        if (this.tauntTimer > 0) {
            ctx.font = "30px serif";
            ctx.textAlign = "center";
            ctx.fillText(this.tauntEmoji, renderX, renderY - this.radius - 40);
        }
    }
}

export class Bomb {
    constructor(x, y, owner) {
        this.x = x; this.y = y; this.owner = owner;
        this.timer = CONFIG.BOMB_TIMER;
    }
    update(dt) { this.timer -= dt; return this.timer > 0; }
}

export class Particle {
    constructor(x, y, color) {
        this.reset(x, y, color);
    }
    reset(x, y, color) {
        this.x = x; this.y = y; this.color = color;
        this.dx = (Math.random() - 0.5) * 5; this.dy = (Math.random() - 0.5) * 5;
        this.life = 1.0; this.size = Math.random() * 5 + 2;
    }
    update() { this.x += this.dx; this.y += this.dy; this.life -= 0.05; return this.life > 0; }
}

export class BlackHole {
    constructor(x, y) {
        this.x = x; this.y = y;
        this.pullRadius = 200; // Decreased by 20% (Was 250, erroneous 300 fixed)
        this.killRadius = CONFIG.BLACK_HOLE_DEATH_RADIUS;
        this.teleportTimer = CONFIG.BLACK_HOLE_TELEPORT_INTERVAL;
    }
}

