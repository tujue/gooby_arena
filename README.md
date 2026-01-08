# 🍄 Gooby Arena

**Gooby Arena** is a fast-paced, physics-based multiplayer battle game played directly in your browser. It uses **P2P (Peer-to-Peer)** technology for low-latency combat.

![License](https://img.shields.io/badge/License-MIT-green.svg)
![Node](https://img.shields.io/badge/Node.js-v16+-blue.svg)
![P2P](https://img.shields.io/badge/Tech-PeerJS_%2B_Socket.io-purple.svg)

## 🔥 Features
*   **Physics Combat:** Dash, bump, and explode your friends!
*   **P2P Networking:** Direct browser-to-browser connection relative to host.
*   **LAN Support:** Play with friends on the same Wi-Fi network.
*   **Multiple Modes:** Battle Royale, Soccer, and more (in development).

## 🚀 Setup & Run

To play the game, you need to run both the **Signaling Server** (for finding players) and the **Game Client**.

### 1. Install Dependencies
Open standard terminal in project folder:
```bash
npm install
```

### 2. Start the Server (Backend)
Open a terminal window and run:
```bash
npm run server
```
*> This starts the signaling server on port 3000.*

### 3. Start the Client (Frontend)
Open a **second** terminal window and run:
```bash
npm run client
```
*> This starts the Vite dev server (usually at http://localhost:5173).*

## 🎮 How to Play on LAN
1.  Start both Server and Client on one computer (Host).
2.  Look at the `npm run client` output for your **Network IP** (e.g., `http://192.168.1.5:5173`).
3.  **Host** opens that link and creates a Lobby.
4.  **Friends** on the same Wi-Fi open that same link (`http://192.168.1.5:5173`) and join the Lobby Code.

## 🛠 Tech Stack
*   **Engine:** Custom JS Engine (Canvas API)
*   **Backend:** Node.js + Express + Socket.io
*   **P2P:** PeerJS (WebRTC)
*   **Build:** Vite

---
*Created for Chaos.* 🍄
