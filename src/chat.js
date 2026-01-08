// Minimal Chat System for Gooby Arena
// Optimized for performance, ready for WebRTC P2P

export class ChatSystem {
    constructor(game) {
        this.game = game;
        this.messages = [];
        this.maxMessages = 5;
        this.isOpen = false;
        this.inputValue = '';

        this.createUI();
        this.attachListeners();
    }

    createUI() {
        // Chat container
        this.container = document.createElement('div');
        this.container.id = 'chat-container';
        this.container.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 20px;
            width: 320px;
            max-height: 200px;
            font-family: 'Outfit', sans-serif;
            z-index: 100;
            pointer-events: none;
        `;

        // Messages list
        this.messageList = document.createElement('div');
        this.messageList.id = 'chat-messages';
        this.messageList.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 4px;
            margin-bottom: 8px;
            opacity: 0;
            transition: opacity 1.0s ease; /* Slower fade out */
            pointer-events: none; /* Let clicks pass through when fading */
        `;

        // Input container
        this.inputContainer = document.createElement('div');
        this.inputContainer.style.cssText = `
            background: rgba(15, 23, 42, 0.9); /* Darker background */
            backdrop-filter: blur(8px);
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 8px;
            padding: 8px 12px;
            display: none;
            pointer-events: auto;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5); /* Pop */
        `;

        // Input field
        this.input = document.createElement('input');
        this.input.type = 'text';
        this.input.placeholder = 'Message...';
        this.input.maxLength = 100;
        this.input.style.cssText = `
            width: 100%;
            background: transparent;
            border: none;
            outline: none;
            color: white;
            font-size: 14px;
            font-family: inherit;
        `;

        this.inputContainer.appendChild(this.input);
        this.container.appendChild(this.messageList);
        this.container.appendChild(this.inputContainer);
        document.body.appendChild(this.container);
    }

    attachListeners() {
        this.boundKeyHandler = (e) => {
            // Disable in-game chat toggle if in Attract Mode (Main Menu)
            if (this.game && this.game.attractMode) return;

            if (e.code === 'Enter') {
                e.preventDefault();
                if (this.isOpen) {
                    if (this.input.value.trim()) {
                        this.sendMessage(this.input.value.trim());
                    }
                    this.close();
                } else {
                    this.open();
                }
            } else if (e.code === 'Escape' && this.isOpen) {
                this.close();
            }
        };

        document.addEventListener('keydown', this.boundKeyHandler);
    }

    open() {
        this.isOpen = true;
        this.inputContainer.style.display = 'block';
        this.messageList.style.opacity = '1';
        this.input.value = '';
        this.input.focus();

        if (this.game) {
            this.game.chatActive = true;
        }
    }

    close() {
        this.isOpen = false;
        this.inputContainer.style.display = 'none';
        this.messageList.style.opacity = '0';
        this.input.blur();

        if (this.game) {
            this.game.chatActive = false;
        }
    }

    sendMessage(text) {
        const playerName = this.game?.player?.name || 'Player';
        const playerColor = this.game?.player?.color || '#ff5733';

        const msg = {
            sender: playerName,
            text: text,
            color: playerColor,
            timestamp: Date.now()
        };

        this.addMessage(msg);

        // BROADCAST: Send to peers via WebRTC
        if (window.networkManager && typeof window.networkManager.broadcast === 'function') {
            window.networkManager.broadcast({ type: 'CHAT_GAME', data: msg });
        }
    }

    addMessage(msg) {
        this.messages.push(msg);
        if (this.messages.length > this.maxMessages) {
            this.messages.shift();
        }
        this.render();
        this.autoFade();
    }

    render() {
        this.messageList.innerHTML = '';
        this.messages.forEach(msg => {
            const msgEl = document.createElement('div');
            msgEl.style.cssText = `
                background: rgba(0, 0, 0, 0.8); /* High contrast */
                backdrop-filter: blur(4px);
                padding: 8px 12px;
                border-radius: 6px;
                font-size: 14px; /* Larger text */
                font-weight: 500;
                border-left: 3px solid ${msg.color};
                text-shadow: 0 1px 2px black;
                box-shadow: 0 2px 4px rgba(0,0,0,0.5);
                animation: slideIn 0.3s ease;
                margin-top: 4px;
            `;

            const senderSpan = document.createElement('span');
            senderSpan.style.cssText = `
                color: ${msg.color};
                font-weight: 700;
                margin-right: 8px;
            `;
            senderSpan.textContent = msg.sender + ':';

            const textSpan = document.createElement('span');
            textSpan.style.color = '#ffffff'; // Pure white
            textSpan.textContent = msg.text;

            msgEl.appendChild(senderSpan);
            msgEl.appendChild(textSpan);
            this.messageList.appendChild(msgEl);
        });
    }

    autoFade() {
        // Show messages, then hide after 3 seconds
        if (!this.isOpen) {
            clearTimeout(this.fadeTimeout);
            this.messageList.style.opacity = '1';
            this.fadeTimeout = setTimeout(() => {
                if (!this.isOpen) {
                    this.messageList.style.opacity = '0';
                }
            }, 3000); // 3 seconds visible
        }
    }

    destroy() {
        if (this.boundKeyHandler) {
            document.removeEventListener('keydown', this.boundKeyHandler);
        }
        if (this.container && this.container.parentNode) {
            this.container.remove();
        }
        clearTimeout(this.fadeTimeout);
    }
}

// Add CSS animation
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            opacity: 0;
            transform: translateX(-20px);
        }
        to {
            opacity: 1;
            transform: translateX(0);
        }
    }
`;
document.head.appendChild(style);
