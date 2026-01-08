// ═══════════════════════════════════════════════════════════
//  TOUCH/MOBILE CONTROLS - Virtual Joystick
//  Mobile-friendly on-screen joystick for movement
// ═══════════════════════════════════════════════════════════

export class TouchControls {
    constructor(container) {
        this.container = container;
        this.active = false;
        this.touchId = null;

        // Joystick position
        this.centerX = 0;
        this.centerY = 0;
        this.currentX = 0;
        this.currentY = 0;

        // Settings
        this.radius = 60; // Outer circle radius
        this.deadzone = 0.2; // Minimum movement threshold

        // Visual elements
        this.joystickOuter = null;
        this.joystickInner = null;
        this.dashButton = null;

        this.init();
    }

    init() {
        // Only initialize on touch devices
        if (!('ontouchstart' in window)) {
            console.log('📱 Touch controls disabled (not a touch device)');
            return;
        }

        console.log('📱 Touch controls enabled');

        // Create joystick UI
        this.createJoystick();

        // Touch event listeners
        this.container.addEventListener('touchstart', this.onTouchStart.bind(this), { passive: false });
        this.container.addEventListener('touchmove', this.onTouchMove.bind(this), { passive: false });
        this.container.addEventListener('touchend', this.onTouchEnd.bind(this), { passive: false });
    }

    createJoystick() {
        // Joystick container (outer circle)
        this.joystickOuter = document.createElement('div');
        Object.assign(this.joystickOuter.style, {
            position: 'fixed',
            bottom: '80px',
            left: '80px',
            width: this.radius * 2 + 'px',
            height: this.radius * 2 + 'px',
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.1)',
            border: '2px solid rgba(255,255,255,0.3)',
            display: 'none', // Hidden until touch
            zIndex: '10000',
            pointerEvents: 'none'
        });

        // Joystick inner circle (handle)
        this.joystickInner = document.createElement('div');
        Object.assign(this.joystickInner.style, {
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            background: 'rgba(250,204,21,0.8)',
            border: '2px solid rgba(255,255,255,0.6)',
            boxShadow: '0 0 20px rgba(250,204,21,0.6)',
            transition: 'transform 0.05s'
        });

        this.joystickOuter.appendChild(this.joystickInner);
        document.body.appendChild(this.joystickOuter);

        // Dash button (right side)
        this.dashButton = document.createElement('button');
        this.dashButton.innerHTML = '⚡<br><span style="font-size:0.6rem;">DASH</span>';
        Object.assign(this.dashButton.style, {
            position: 'fixed',
            bottom: '80px',
            right: '80px',
            width: '80px',
            height: '80px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #ef4444, #dc2626)',
            border: '3px solid rgba(255,255,255,0.4)',
            color: 'white',
            fontSize: '1.5rem',
            fontWeight: 'bold',
            display: 'none', // Hidden until game starts
            zIndex: '10000',
            boxShadow: '0 4px 20px rgba(239,68,68,0.6)',
            cursor: 'pointer',
            userSelect: 'none',
            WebkitTapHighlightColor: 'transparent'
        });

        this.dashButton.addEventListener('touchstart', (e) => {
            e.preventDefault();
            if (window.gameInstance && window.gameInstance.player && !window.gameInstance.player.dead) {
                // Trigger dash toward joystick direction or forward
                const player = window.gameInstance.player;
                let targetX, targetY;

                // If joystick active, dash in that direction
                if (this.active) {
                    const deltaX = (this.currentX - this.centerX) * 5;
                    const deltaY = (this.currentY - this.centerY) * 5;
                    targetX = player.x + deltaX;
                    targetY = player.y + deltaY;
                } else {
                    // No joystick, dash forward (right)
                    targetX = player.x + 100;
                    targetY = player.y;
                }

                player.dash(targetX, targetY, 1.0);

                // Visual feedback
                this.dashButton.style.transform = 'scale(0.9)';
                setTimeout(() => {
                    this.dashButton.style.transform = 'scale(1)';
                }, 100);
            }
        });

        document.body.appendChild(this.dashButton);
    }

    show() {
        if (this.joystickOuter) this.joystickOuter.style.display = 'block';
        if (this.dashButton) this.dashButton.style.display = 'flex';
    }

    hide() {
        if (this.joystickOuter) this.joystickOuter.style.display = 'none';
        if (this.dashButton) this.dashButton.style.display = 'none';
        this.active = false;
    }

    onTouchStart(e) {
        // Only handle left side of screen for joystick
        const touch = e.touches[0];
        if (touch.clientX > window.innerWidth / 2) return; // Right side = dash button

        e.preventDefault();

        this.touchId = touch.identifier;
        this.centerX = touch.clientX;
        this.centerY = touch.clientY;
        this.currentX = touch.clientX;
        this.currentY = touch.clientY;
        this.active = true;

        // Position joystick
        if (this.joystickOuter) {
            this.joystickOuter.style.left = (this.centerX - this.radius) + 'px';
            this.joystickOuter.style.top = (this.centerY - this.radius) + 'px';
            this.joystickOuter.style.display = 'block';
        }
    }

    onTouchMove(e) {
        if (!this.active || this.touchId === null) return;

        // Find our touch
        let touch = null;
        for (let i = 0; i < e.touches.length; i++) {
            if (e.touches[i].identifier === this.touchId) {
                touch = e.touches[i];
                break;
            }
        }

        if (!touch) return;
        e.preventDefault();

        this.currentX = touch.clientX;
        this.currentY = touch.clientY;

        // Update visual
        if (this.joystickInner) {
            const dx = this.currentX - this.centerX;
            const dy = this.currentY - this.centerY;
            const distance = Math.min(Math.hypot(dx, dy), this.radius - 20);
            const angle = Math.atan2(dy, dx);

            const offsetX = Math.cos(angle) * distance;
            const offsetY = Math.sin(angle) * distance;

            this.joystickInner.style.transform = `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px))`;
        }
    }

    onTouchEnd(e) {
        // Check if our touch ended
        let ended = true;
        for (let i = 0; i < e.touches.length; i++) {
            if (e.touches[i].identifier === this.touchId) {
                ended = false;
                break;
            }
        }

        if (!ended) return;

        this.active = false;
        this.touchId = null;

        // Reset visual
        if (this.joystickInner) {
            this.joystickInner.style.transform = 'translate(-50%, -50%)';
        }
        if (this.joystickOuter) {
            this.joystickOuter.style.display = 'none';
        }
    }

    getDirection() {
        if (!this.active) {
            return { x: 0, y: 0, distance: 0 };
        }

        const dx = this.currentX - this.centerX;
        const dy = this.currentY - this.centerY;
        const distance = Math.hypot(dx, dy) / this.radius;

        if (distance < this.deadzone) {
            return { x: 0, y: 0, distance: 0 };
        }

        const magnitude = Math.min(distance, 1);
        const angle = Math.atan2(dy, dx);

        return {
            x: Math.cos(angle) * magnitude,
            y: Math.sin(angle) * magnitude,
            distance: magnitude
        };
    }

    destroy() {
        if (this.joystickOuter) this.joystickOuter.remove();
        if (this.dashButton) this.dashButton.remove();
    }
}

export default TouchControls;
