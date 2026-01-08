// ═══════════════════════════════════════════════════════════
//  GAMEPAD CONTROLLER SUPPORT (PS4/PS5/Xbox)
//  Supports: Navigation, Dash, Movement
// ═══════════════════════════════════════════════════════════

export class GamepadManager {
    constructor() {
        this.gamepads = {};
        this.connected = false;
        this.deadzone = 0.15; // Ignore small stick movements

        // Button mappings (standard gamepad)
        this.buttons = {
            A: 0,        // Xbox A / PS Cross
            B: 1,        // Xbox B / PS Circle
            X: 2,        // Xbox X / PS Square
            Y: 3,        // Xbox Y / PS Triangle
            LB: 4,       // Left Bumper
            RB: 5,       // Right Bumper
            LT: 6,       // Left Trigger
            RT: 7,       // Right Trigger
            SELECT: 8,   // Back/Select
            START: 9,    // Start/Options
            L3: 10,      // Left Stick Click
            R3: 11,      // Right Stick Click
            UP: 12,      // D-Pad Up
            DOWN: 13,    // D-Pad Down
            LEFT: 14,    // D-Pad Left
            RIGHT: 15    // D-Pad Right
        };

        // Axis mappings
        this.axes = {
            LEFT_X: 0,   // Left stick horizontal
            LEFT_Y: 1,   // Left stick vertical
            RIGHT_X: 2,  // Right stick horizontal
            RIGHT_Y: 3   // Right stick vertical
        };

        this.init();
    }

    init() {
        window.addEventListener('gamepadconnected', (e) => {
            console.log(`🎮 Gamepad connected: ${e.gamepad.id}`);
            this.gamepads[e.gamepad.index] = e.gamepad;
            this.connected = true;
            this.showNotification('🎮 Controller Connected!');
        });

        window.addEventListener('gamepaddisconnected', (e) => {
            console.log(`🎮 Gamepad disconnected: ${e.gamepad.id}`);
            delete this.gamepads[e.gamepad.index];
            this.connected = Object.keys(this.gamepads).length > 0;
            this.showNotification('❌ Controller Disconnected');
        });
    }

    showNotification(message) {
        if (window.gameInstance && window.gameInstance.showToast) {
            window.gameInstance.showToast(message);
        }
    }

    update() {
        // Get latest gamepad state
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];

        for (let i = 0; i < gamepads.length; i++) {
            if (gamepads[i]) {
                this.gamepads[i] = gamepads[i];
            }
        }
    }

    getGamepad() {
        // Return first connected gamepad
        for (let key in this.gamepads) {
            if (this.gamepads[key]) return this.gamepads[key];
        }
        return null;
    }

    isButtonPressed(buttonIndex) {
        const gamepad = this.getGamepad();
        if (!gamepad) return false;

        const button = gamepad.buttons[buttonIndex];
        return button && (button.pressed || button.value > 0.5);
    }

    getAxis(axisIndex) {
        const gamepad = this.getGamepad();
        if (!gamepad) return 0;

        const value = gamepad.axes[axisIndex] || 0;

        // Apply deadzone
        if (Math.abs(value) < this.deadzone) return 0;

        return value;
    }

    getMovement() {
        // Get left stick movement
        const x = this.getAxis(this.axes.LEFT_X);
        const y = this.getAxis(this.axes.LEFT_Y);

        return { x, y };
    }

    getAim() {
        // Get right stick aim (for dash direction)
        const x = this.getAxis(this.axes.RIGHT_X);
        const y = this.getAxis(this.axes.RIGHT_Y);

        return { x, y };
    }

    // Check if dash button pressed (RT or RB)
    isDashPressed() {
        return this.isButtonPressed(this.buttons.RT) ||
            this.isButtonPressed(this.buttons.RB) ||
            this.isButtonPressed(this.buttons.A);
    }

    // Check if clone button pressed (X)
    isClonePressed() {
        return this.isButtonPressed(this.buttons.X);
    }

    // Check if taunt button pressed (Y)
    isTauntPressed() {
        return this.isButtonPressed(this.buttons.Y);
    }

    // Check if potato pass pressed (B)
    isPotatoPressed() {
        return this.isButtonPressed(this.buttons.B);
    }

    // Menu navigation
    isMenuUp() {
        return this.isButtonPressed(this.buttons.UP) || this.getAxis(this.axes.LEFT_Y) < -0.5;
    }

    isMenuDown() {
        return this.isButtonPressed(this.buttons.DOWN) || this.getAxis(this.axes.LEFT_Y) > 0.5;
    }

    isMenuConfirm() {
        return this.isButtonPressed(this.buttons.A);
    }

    isMenuBack() {
        return this.isButtonPressed(this.buttons.B) || this.isButtonPressed(this.buttons.SELECT);
    }
}

export default GamepadManager;
