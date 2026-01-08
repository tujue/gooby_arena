
import Peer from 'peerjs';
import { io } from 'socket.io-client';
import { CONFIG } from './config.js';
import { Bomb } from './entity.js';

export class NetworkManager {
    constructor() {
        // 1. Socket API (Signalling & Lobby Listing)
        // Dynamic Local/LAN Support
        // Always connect to the backend on the same hostname (port 3000)
        const signalUrl = `${window.location.protocol}//${window.location.hostname}:3000`;

        this.socket = io(signalUrl, {
            timeout: 30000, // 30 seconds (Render free tier cold start)
            reconnection: true,
            reconnectionAttempts: 5,
            reconnectionDelay: 1000
        });

        // 2. Peer P2P (Game Data)
        this.peer = null;
        this.connections = []; // Host: connected clients
        this.hostConn = null;  // Client: connection to host
        this.peerId = null;
        this.isConnected = false;

        // INPUT RECONCILIATION
        this.inputSeq = 0; // Sequence counter
        this.inputBuffer = []; // Store sent inputs for replay
        this.lastProcessedInputSeq = 0; // Last seq confirmed by server

        // INTERPOLATION BUFFER (for smooth rendering with network jitter)
        this.stateBuffer = []; // Buffer of server states with timestamps
        this.INTERPOLATION_DELAY = 150; // 150ms delay eliminates ghost lag/jitter

        // PERSISTENT ID MAPPING (Sync Fix)
        this.playerIdMap = new Map();
        this.reverseIdMap = new Map();
        this.nextNetworkId = 1;
        this.playerIdMap.set('host', 0);
        this.reverseIdMap.set(0, 'host');

        this.setupSocketListeners();

        // WATCHDOG: Detect Silent Disconnects
        this.lastPingTime = Date.now();
        setInterval(() => {
            // Only for Clients in Active Game
            if (window.state?.lobby?.isHost) return;
            if (!this.hostConn || !this.hostConn.open) return;

            // Reset if in menu (attract mode)
            if (!window.gameInstance || window.gameInstance.attractMode) {
                this.lastPingTime = Date.now();
                return;
            }

            // Timeout Check (10 seconds)
            if (Date.now() - this.lastPingTime > 10000) {
                console.error("Connection Watchdog: Timed out. Reloading...");
                window.location.reload();
            }
        }, 1000);
    }

    setupSocketListeners() {
        this.socket.on('connect', () => {
            this.socket.emit('getRoomList');
        });

        this.socket.on('roomList', (rooms) => {
            window.availableRooms = rooms;
            if (window.renderLobbyList) {
                window.renderLobbyList(rooms);
            }
        });

        // Listen for online player count updates
        this.socket.on('onlineCount', (count) => {

            const updateCounter = () => {
                const countElement = document.getElementById('onlineCount');
                if (countElement) {
                    countElement.textContent = count;
                    if (!countElement.style.transition) {
                        countElement.style.transition = 'transform 0.2s ease';
                    }
                    countElement.style.transform = 'scale(1.2)';
                    setTimeout(() => {
                        countElement.style.transform = 'scale(1)';
                    }, 200);
                } else {
                    // Retry if DOM not ready
                    setTimeout(updateCounter, 100);
                }
            };
            updateCounter();
        });

        this.socket.on('error', (err) => {
        });

        this.socket.on('roomCreated', ({ roomId }) => {
        });

        this.socket.on('roomClosed', () => {
            if (window.gameInstance) {
                window.gameInstance.showToast("Host left the game. Returning to lobby...", 3000);
            }
            setTimeout(() => {
                // Clear game state
                if (window.gameInstance) {
                    window.gameInstance.stopLoop();
                    window.gameInstance = null;
                }
                if (window.renderMainMenu) window.renderMainMenu();
                else window.location.reload();
            }, 2000);
        });

        this.socket.on('globalChat', (msg) => {
            if (window.state?.lobby?.messages) {
                const msgs = window.state.lobby.messages;
                const last = msgs[msgs.length - 1];
                if (last && last.text === msg.text && last.name === msg.name && last.timestamp === msg.timestamp) return;
                window.state.lobby.messages.push(msg);
                if (window.updateChatUI) window.updateChatUI();
            }
        });
    }

    sendGlobalChat(msg) {
        if (this.socket) {
            this.socket.emit('globalChat', msg);
        }
    }

    host(code, password = null) {
        if (this.peer) this.peer.destroy();

        const id = `gooby-arena-${code}`;

        this.peer = new Peer(id); // Use Code as ID

        this.peer.on('open', (peerId) => {
            this.peerId = peerId;
            this.isConnected = true;

            // Register on Server (Visible in List)
            this.socket.emit('createRoom', { roomId: code, password });

            // Local State
            window.state.lobby.isHost = true;
            window.state.lobby.id = code;
            this.addLocalPlayerToLobby();
        });

        this.peer.on('connection', (conn) => this.handlePeerConnection(conn));

        this.peer.on('error', (err) => {

            if (err.type === 'unavailable-id') {
                alert("Lobby Code is taken! Please try creating a new lobby.");
            } else if (err.type === 'network' || err.type === 'server-error') {
                alert("Network Error: Cannot connect to PeerJS server. Please check your internet connection and try again.");
            } else if (err.type === 'socket-error' || err.type === 'socket-closed') {
                alert("Connection lost. Refreshing the page might help.");
            } else {
                alert(`Peer Error: ${err.type}`);
            }
        });
    }

    connect(code, password = null) {

        // First, Try to Join Signal Room (Validation with Pwd)
        this.socket.emit('joinRoom', { roomId: code, password });

        // Proceed to P2P optimistically
        if (this.peer) this.peer.destroy();
        this.peer = new Peer(); // Random ID

        this.peer.on('open', (myPeerId) => {
            this.peerId = myPeerId;
            const hostPeerId = `gooby-arena-${code}`;

            const conn = this.peer.connect(hostPeerId, { reliable: true });

            conn.on('open', () => {
                this.isConnected = true;
                this.hostConn = conn;

                // Initialize ID map for binary decoding
                conn.playerIdMap = new Map();
                conn.playerIdMap.set(0, 'host');

                window.state.lobby.isHost = false;
                window.state.lobby.id = code;
                window.state.network.peerId = myPeerId;

                // Send Profile
                const joinData = {
                    type: 'JOIN_REQUEST',
                    player: { ...window.state.player }
                };
                conn.send(joinData);
            });

            conn.on('data', data => this.handleData(data, conn));

            conn.on('close', () => {
                alert("Disconnected from Host.");
                window.location.reload();
            });

            conn.on('error', err => {
                alert("Failed to connect to Host. They might be offline.");
            });
        });
    }

    handlePeerConnection(conn) {
        this.connections.push(conn);

        // Assign slot ID for binary encoding (1-based for clients, 0 is host)
        conn.slotId = this.connections.length;

        conn.on('data', data => this.handleData(data, conn));

        conn.on('open', () => {
            this.broadcastLobbyState();
            conn.send({ type: 'CHAT', data: { name: 'System', color: '#facc15', text: 'Welcome! Connection Verified.' } });

            // FULL SYNC FOR LATE JOINERS
            if (window.gameInstance && window.gameInstance.roundActive) {
                const g = window.gameInstance;
                const scores = g.playerScores ? Array.from(g.playerScores.entries()) : [];
                const bScores = g.bullseyeScores ? Array.from(g.bullseyeScores.entries()) : [];

                const pt = g.potatoTarget;
                const ptPeerId = pt ? (pt.peerId || (pt === g.player ? 'host' : null)) : null;

                conn.send({
                    type: 'FULL_GAME_SYNC',
                    mode: g.mapType,
                    candies: g.candies || [],
                    targets: g.targets || [],
                    scores: scores,
                    bullseyeScores: bScores,
                    potatoTargetPeerId: ptPeerId
                });
            }

            // VERIFICATION REQUEST: Ping Interval (1s) with LOSS TRACKING
            conn.pingStats = { sent: 0, received: 0 };

            conn.pingInterval = setInterval(() => {
                if (conn.open) {
                    const now = Date.now();
                    conn.pingStats.sent++;
                    conn.send({ type: 'PING', ts: now, seq: conn.pingStats.sent });
                }
            }, 1000);
        });

        conn.on('close', () => {
            if (conn.pingInterval) clearInterval(conn.pingInterval);
            this.connections = this.connections.filter(c => c !== conn);
            this.removePlayer(conn.peer);
            this.broadcastLobbyState();
        });
    }

    handleData(data, conn) {
        // BINARY PACKET DETECTION
        if (data instanceof ArrayBuffer) {
            const view = new DataView(data);
            const packetType = view.getUint8(0);

            if (packetType === 0x01) { // STATE_UPDATE
                // Decode binary state update
                let offset = 0;
                offset++; // Skip packet type

                const playerCount = view.getUint8(offset++);
                const lastProcessedSeq = view.getUint32(offset, true); offset += 4;

                // ACKNOWLEDGEMENT: Remove inputs processed by server
                this.inputBuffer = this.inputBuffer.filter(i => i.seq > lastProcessedSeq);

                const timestamp = view.getFloat64(offset, true); offset += 8;

                const players = [];

                // Use Persistent Reverse Map (this.reverseIdMap)
                // Decode players
                for (let i = 0; i < playerCount; i++) {
                    const idIndex = view.getUint16(offset, true); offset += 2;
                    const x = view.getFloat32(offset, true); offset += 4;
                    const y = view.getFloat32(offset, true); offset += 4;
                    const dx = view.getFloat32(offset, true); offset += 4;
                    const dy = view.getFloat32(offset, true); offset += 4;
                    const radius = view.getFloat32(offset, true); offset += 4; // NEW: radius
                    const ping = view.getUint16(offset, true); offset += 2; // NEW: ping

                    players.push({
                        id: this.reverseIdMap.get(idIndex) || `unknown-${idIndex}`,
                        x, y, dx, dy, radius, ping
                    });
                }

                // Ball Data
                let ballData = null;
                // Safety check: ensure we have enough bytes
                if (offset < view.byteLength) {
                    const hasBall = view.getUint8(offset++);
                    if (hasBall) {
                        const bx = view.getFloat32(offset, true); offset += 4;
                        const by = view.getFloat32(offset, true); offset += 4;
                        const bdx = view.getFloat32(offset, true); offset += 4;
                        const bdy = view.getFloat32(offset, true); offset += 4;
                        ballData = { x: bx, y: by, dx: bdx, dy: bdy };
                    }
                }

                // Convert to standard format and process
                data = {
                    type: 'STATE_UPDATE',
                    players,
                    ball: ballData,
                    lastProcessedSeq,
                    timestamp
                };

                // Add to Interpolation Buffer
                this.stateBuffer.push(data);
                if (this.stateBuffer.length > 60) this.stateBuffer.shift();

                // Apply server positions to entities for smooth interpolation
                if (window.gameInstance && window.state?.lobby?.isHost === false) {
                    players.forEach(p => {
                        let entity = null;
                        if (p.id === 'host') {
                            entity = window.gameInstance.enemies?.find(e => e.isHost || e.peerId === 'host');
                        } else if (p.id === window.state.network?.peerId) {
                            entity = window.gameInstance.player;
                        } else {
                            entity = window.gameInstance.enemies?.find(e => e.peerId === p.id);
                        }

                        if (entity) {
                            if (p.ping !== undefined) entity.ping = p.ping;

                            // RECONCILIATION (Local Player)
                            // Snap to server state and re-simulate pending inputs (Zero Latency)
                            if (entity === window.gameInstance.player) {
                                window.gameInstance.reconcile(p, lastProcessedSeq, this.inputBuffer);
                                return;
                            }

                        }

                        if (entity) {
                            entity.serverX = p.x;
                            entity.serverY = p.y;
                            entity.serverDx = p.dx; // Velocity for extrapolation
                            entity.serverDy = p.dy;
                            // CRITICAL: Apply radius to ALL entities (including client player)
                            if (p.radius !== undefined) {
                                const oldRadius = entity.radius;
                                entity.radius = p.radius;
                                if (Math.abs(oldRadius - p.radius) > 2) {
                                }
                                // Mark sprite cache as dirty to force re-render
                                if (entity.cacheDirty !== undefined) entity.cacheDirty = true;
                            }
                        }
                    });

                    // BALL SYNC with EXTRAPOLATION
                    if (data.ball) {
                        if (!window.gameInstance.ball && window.Ball) {
                            window.gameInstance.ball = new window.Ball(data.ball.x, data.ball.y);
                        }
                        const b = window.gameInstance.ball;
                        if (b) {
                            // Smooth blend with extrapolation
                            const alpha = 0.3;
                            b.x += (data.ball.x - b.x) * alpha;
                            b.y += (data.ball.y - b.y) * alpha;

                            // Sync velocity for better prediction
                            if (data.ball.dx !== undefined) b.dx = data.ball.dx;
                            if (data.ball.dy !== undefined) b.dy = data.ball.dy;
                            b.dx = b.dx * 0.5 + data.ball.dx * 0.5;
                            b.dy = b.dy * 0.5 + data.ball.dy * 0.5;
                        }
                    }
                }

                // DEBUG: Log decoded state (every 60 frames)
                // if (!this._decodeCounter) this._decodeCounter = 0;
                // this._decodeCounter++;
                // if (this._decodeCounter % 60 === 0) {
                // }
            }
        }

        if (!data || !data.type) return;

        const { type } = data;

        // TEST PROTOCOL
        if (type === 'PING') {
            // Client responds to Host Ping
            this.lastPingTime = Date.now(); // Keep connection alive
            conn.send({ type: 'PONG', ts: data.ts, seq: data.seq });
        }
        else if (type === 'PONG') {
            // Host calculates RTT & Loss
            const rtt = Date.now() - data.ts;

            if (conn.pingStats) {
                conn.pingStats.received++;
                const gap = conn.pingStats.sent - conn.pingStats.received;
                const lossRate = gap > 0 ? `(Gap: ${gap})` : '(No Loss)';

            }

            // Update UI
            const p = window.state.lobby.players.find(x => x.id === conn.peer);
            if (p) { p.ping = rtt; if (window.updateLobbyUI) window.updateLobbyUI(); }
        }

        else if (type === 'JOIN_REQUEST' && window.state.lobby.isHost) {
            this.addGuestToLobby(data.player, conn.peer);
            this.broadcastLobbyState();
        }
        else if (type === 'LOBBY_STATE') {
            window.state.lobby.players = data.players;

            // Update Reverse Map (Critical for Binary Sync)
            data.players.forEach(p => {
                if (p.idIndex !== undefined) {
                    this.reverseIdMap.set(p.idIndex, p.id);
                }
            });

            // Set own ping to 0 (no latency to self)
            if (window.state.network?.peerId) {
                const me = window.state.lobby.players.find(p => p.id === window.state.network.peerId);
                if (me) me.ping = 0;
            }

            if (window.updateLobbyUI) {
                window.updateLobbyUI();
            }
        }
        else if (type === 'CHAT') {
            window.state.lobby.messages.push(data.data);
            if (window.updateChatUI) window.updateChatUI();
            if (window.state.lobby.isHost) this.broadcastButExclude(data, conn);
        }
        else if (type === 'GAME_START') {

            // Remove UI before starting game
            const ui = document.getElementById('gooby-arena-ui-layer') || document.getElementById('game-ui');
            if (ui) {
                ui.remove();
            }

            // Start game

            // SOCCER: Update team info from Host
            if (data.playersWithTeams && window.state && window.state.lobby) {

                // Update local lobby players with team data
                data.playersWithTeams.forEach(hostP => {
                    const localP = window.state.lobby.players.find(p => p.id === hostP.id);
                    if (localP) {
                        localP.team = hostP.team;
                    }
                });
            }

            if (window.startMode) {
                window.startMode(data.mode, true);
            } else {
            }
        }
        else if (type === 'VOTE_CAST') {
            if (window.gameInstance?.currentVotes) {
                window.gameInstance.currentVotes[data.playerId] = data.voteIndex;
            }
            if (window.state.lobby.isHost) this.broadcastButExclude(data, conn);
        }
        else if (type === 'KILL_EVENT') {
            if (window.gameInstance) {
                // Find Victim by PeerID
                const vPid = data.victimPeerId;
                let victim = null;
                if (vPid === 'host') {
                    victim = window.gameInstance.enemies?.find(e => e.isHost || e.peerId === 'host');
                } else if (vPid === window.state.network?.peerId) {
                    victim = window.gameInstance.player;
                } else {
                    victim = window.gameInstance.enemies?.find(e => e.peerId === vPid);
                }

                if (victim) {
                    victim.dead = true;
                    victim.respawnTimer = Date.now() + 2000;
                    window.gameInstance.addParticles(victim.x, victim.y, 5, victim.color);
                    if (window.gameInstance.audio) window.gameInstance.audio.playKill();

                    // Update Killer Score
                    const kPid = data.killerPeerId;
                    let killer = null;
                    if (kPid) {
                        if (kPid === 'host') killer = window.gameInstance.enemies?.find(e => e.isHost || e.peerId === 'host');
                        else if (kPid === window.state.network?.peerId) killer = window.gameInstance.player;
                        else killer = window.gameInstance.enemies?.find(e => e.peerId === kPid);

                        if (killer) {
                            if (!killer.kills) killer.kills = 0;
                            killer.kills++;
                            // Force leaderboard redraw
                            if (window.gameInstance.drawLeaderboard) window.gameInstance.drawLeaderboard();
                        }
                    }
                }
                window.gameInstance.addScreenShake(5);
            }
        }
        else if (type === 'HOST_QUIT') {
            if (window.gameInstance) {
                window.gameInstance.showToast("Host ended session. Returning to menu...", 3000);
                setTimeout(() => {
                    if (window.gameInstance) window.gameInstance.destroy();
                    // Clean URL
                    window.history.replaceState({}, document.title, window.location.pathname);

                    if (window.renderMainMenu) {
                        window.renderMainMenu();
                    } else {
                        window.location.reload();
                    }
                }, 2000);
            } else {
                alert("Host ended session.");
                window.location.reload();
            }
        }
        else if (type === 'CHAT_GAME') {
            if (window.gameInstance?.chat) window.gameInstance.chat.addMessage(data.data);
            if (window.state.lobby.isHost) this.broadcastButExclude(data, conn);
        }
        else if (type === 'ROUND_END') {
            // Client receives winner from Host

            if (window.gameInstance) {
                // Reconstruct winner object (or null for draw)
                const winner = data.winner ? {
                    name: data.winner.name,
                    color: data.winner.color,
                    peerId: data.winner.peerId,
                    team: data.winner.team
                } : null;

                // Trigger banner
                if (winner) {
                    if (data.mapType === 'SOCCER') {
                        const teamName = winner.team === 'RED' ? 'RED TEAM' : 'BLUE TEAM';
                        const color = winner.team === 'RED' ? '#ef4444' : '#3b82f6';
                        window.gameInstance.triggerBanner(`${teamName} WINS!`, "GET READY TO VOTE!", color);
                    } else {
                        window.gameInstance.triggerBanner(`${winner.name} WINS!`, "GET READY TO VOTE!", winner.color);
                    }
                    if (window.gameInstance.audio) window.gameInstance.audio.playWin();
                    setTimeout(() => { window.gameInstance.startVortexVote(winner); }, 3000);
                } else {
                    window.gameInstance.triggerBanner("ROUND OVER", "GET READY TO VOTE!", "#888");
                    setTimeout(() => { window.gameInstance.startVortexVote(null); }, 3000);
                }
            }
        }
        else if (type === 'POTATO_ASSIGN') {
            // Client receives potato target from Host

            if (window.gameInstance) {
                // Find target by ID
                let target = null;
                if (data.targetId === 'host') {
                    target = window.gameInstance.enemies?.find(e => e.isHost) || window.gameInstance.player;
                } else if (data.targetId === window.state.network?.peerId) {
                    target = window.gameInstance.player;
                } else {
                    target = window.gameInstance.enemies?.find(e => e.peerId === data.targetId);
                }

                if (target) {
                    window.gameInstance.potatoTarget = target;
                    window.gameInstance.potatoTimer = data.timer;
                    window.gameInstance.showToast(`${target.name} has the POTATO!`);
                    window.gameInstance.addParticles(target.x, target.y, 3, '#ff0000');
                } else {
                }
            }
        }
        else if (type === 'CANDY_SPAWN') {
            if (window.gameInstance) {
                window.gameInstance.candies.push(data.candy);
            }
        }
        else if (type === 'CANDY_CLAIM') {
            // HOST ONLY: Handle Client Claim
            if (window.gameInstance && window.state?.lobby?.isHost) {
                const claimerPeerId = conn.peer;
                // Find entity ID for this peer
                const entity = window.gameInstance.enemies.find(e => e.peerId === claimerPeerId);
                if (entity) {
                    // Use helper to finalize collection
                    if (window.gameInstance.handleCandyCollect) {
                        window.gameInstance.handleCandyCollect(data.candyId, entity.id);
                    }
                }
            }
        }
        else if (type === 'TARGET_CLAIM') {
            if (window.gameInstance && window.state?.lobby?.isHost) {
                const claimerPeerId = conn.peer;
                const entity = window.gameInstance.enemies.find(e => e.peerId === claimerPeerId);
                if (entity && window.gameInstance.handleTargetHit) {
                    window.gameInstance.handleTargetHit(data.targetId, entity.id);
                }
            }
        }
        else if (type === 'CANDY_COLLECT') {
            if (window.gameInstance) {
                // Remove candy
                window.gameInstance.candies = window.gameInstance.candies.filter(c => c.id !== data.candyId);

                // Find Collector by PeerID
                const pid = data.collectorPeerId;
                let collector = null;
                if (pid === 'host') {
                    collector = window.gameInstance.enemies?.find(e => e.isHost || e.peerId === 'host');
                } else if (pid === window.state.network?.peerId) {
                    collector = window.gameInstance.player;
                } else {
                    collector = window.gameInstance.enemies?.find(e => e.peerId === pid);
                }

                if (collector) {
                    window.gameInstance.playerScores.set(collector.id, data.score);
                    // Visuals on collector?
                }

                // Visuals
                // Ideally we'd know x,y of collection, but we just need particles on collector?
                // Or just play sound
                if (window.gameInstance.audio) window.gameInstance.audio.playCollect();
            }
        }
        else if (type === 'GOAL') {
            if (window.gameInstance) {
                window.gameInstance.scores[data.team] = data.score;
                window.gameInstance.showToast(`${data.team} TEAM SCORES!`);
                if (window.gameInstance.audio) window.gameInstance.audio.playWin();
                window.gameInstance.resetSoccerPositions();
            }
        }
        else if (type === 'TARGET_SPAWN') {
            if (window.gameInstance) {
                window.gameInstance.targets.push(data.target);
            }
        }
        else if (type === 'TARGET_HIT') {
            if (window.gameInstance) {
                // Find Scorer by PeerID
                const pid = data.scorerPeerId;
                let scorer = null;
                if (pid === 'host') {
                    scorer = window.gameInstance.enemies?.find(e => e.isHost || e.peerId === 'host');
                } else if (pid === window.state.network?.peerId) {
                    scorer = window.gameInstance.player;
                } else {
                    scorer = window.gameInstance.enemies?.find(e => e.peerId === pid);
                }

                if (scorer) {
                    window.gameInstance.bullseyeScores.set(scorer.id, data.score);
                }

                const t = window.gameInstance.targets.find(x => x.id === data.targetId);
                if (t) {
                    window.gameInstance.addParticles(t.x, t.y, 5, t.color);
                    window.gameInstance.targets = window.gameInstance.targets.filter(x => x.id !== data.targetId);
                }
                if (window.gameInstance.audio) window.gameInstance.audio.playHit(2.0);
            }
        }
        else if (type === 'HIT_EFFECT') {
            if (window.gameInstance) {
                window.gameInstance.addParticles(data.x, data.y, data.intensity * 5, 'white');
                if (data.intensity > 1) {
                    if (window.gameInstance.audio) window.gameInstance.audio.playGoobyHit();
                    window.gameInstance.addScreenShake(3);
                } else {
                    if (window.gameInstance.audio) window.gameInstance.audio.playGoobyHit();
                }
            }
        }
        else if (type === 'RESPAWN') {
            if (window.gameInstance && window.gameInstance.getPlayerById) {
                const p = window.gameInstance.getPlayerById(data.playerId);
                if (p) {
                    p.dead = false;
                    p.x = data.x;
                    p.y = data.y;
                    p.dx = 0; p.dy = 0;
                    window.gameInstance.addParticles(p.x, p.y, 15, p.color);
                }
            }
        }
        else if (type === 'PLAYER_LEFT') {
            if (window.gameInstance && window.gameInstance.enemies) {
                window.gameInstance.enemies = window.gameInstance.enemies.filter(e => e.peerId !== data.playerId && e.id !== data.playerId);
                window.gameInstance.triggerBanner("PLAYER LEFT", "", "#555");
            }
        }
        else if (type === 'FULL_GAME_SYNC') {
            if (window.gameInstance) {
                if (data.candies) window.gameInstance.candies = data.candies;
                if (data.targets) window.gameInstance.targets = data.targets;
                if (data.scores) window.gameInstance.playerScores = new Map(data.scores);
                if (data.bullseyeScores) window.gameInstance.bullseyeScores = new Map(data.bullseyeScores);

                if (data.potatoTargetPeerId) {
                    const pid = data.potatoTargetPeerId;
                    let p = null;
                    if (pid === 'host') {
                        p = window.gameInstance.enemies.find(e => e.isHost) || window.gameInstance.enemies.find(e => e.peerId === 'host');
                    } else if (pid === window.state.network.peerId) {
                        p = window.gameInstance.player;
                    } else {
                        p = window.gameInstance.enemies.find(e => e.peerId === pid);
                    }
                    if (p) window.gameInstance.potatoTarget = p;
                }
            }
        }
        else if (type === 'PLAYER_EMOJI') {
            if (window.gameInstance) {
                const pid = data.peerId;
                let p = null;
                if (pid === 'host') {
                    p = window.gameInstance.enemies.find(e => e.isHost) || window.gameInstance.enemies.find(e => e.peerId === 'host');
                } else if (pid === window.state.network.peerId) {
                    p = window.gameInstance.player;
                } else {
                    p = window.gameInstance.enemies.find(e => e.peerId === pid);
                }

                if (p) p.triggerTaunt(data.emoji);
            }
        }
        else if (type === 'SPAWN_CANDY') {
            if (window.gameInstance) {
                window.gameInstance.candies.push(data.candy);
            }
        }
        else if (type === 'CANDY_COLLECT') {
            if (window.gameInstance) {
                // Remove collected candy
                window.gameInstance.candies = window.gameInstance.candies.filter(c => c.id !== data.candyId);

                // Update Score & Visuals
                // Use a simpler search or just update if ID matches known player
                const all = [window.gameInstance.player, ...window.gameInstance.enemies];
                const collector = all.find(e => {
                    if (data.collectorPeerId === 'host') return e.isHost || e.peerId === 'host' || (window.state.lobby.isHost && e === window.gameInstance.player);
                    return e.peerId === data.collectorPeerId;
                });

                if (collector) {
                    window.gameInstance.playerScores.set(collector.id, data.score);
                    window.gameInstance.addParticles(collector.x, collector.y, 5, "#ffd700");
                    if (window.gameInstance.audio) window.gameInstance.audio.playCollect();
                }
            }
        }
        else if (type === 'TEAM_ASSIGNMENT') {
            // Soccer: Apply team assignments from host
            if (window.gameInstance && data.teams) {
                window.gameInstance.applySoccerTeams(data.teams);
            }
        }
        else if (type === 'SIZE_CHANGE_EVENT') {
            // Size Swap: Apply host assignments
            if (window.gameInstance) {
                window.gameInstance.triggerSizeChange(data.assignments);
            }
        }
        else if (type === 'BOMB_SPAWN') {
            if (window.gameInstance) {
                // Find owner if any
                // const owner = data.ownerId ? window.gameInstance.getPlayerById(data.ownerId) : null;
                // For Bomb Rain, owner is null usually
                const bomb = new Bomb(data.x, data.y, null);
                window.gameInstance.bombs.push(bomb);
            }
        }
        else if (type === 'TARGET_SPAWN') {
            if (window.gameInstance) {
                if (!window.gameInstance.targets) window.gameInstance.targets = [];
                window.gameInstance.targets.push(data.target);
            }
        }
        else if (type === 'TARGET_HIT') {
            if (window.gameInstance) {
                // Remove target
                if (window.gameInstance.targets) {
                    window.gameInstance.targets = window.gameInstance.targets.filter(t => t.id !== data.targetId);
                }

                // Update Score
                // Find scorer
                const all = [window.gameInstance.player, ...window.gameInstance.enemies];
                const scorer = all.find(e => {
                    if (data.scorerPeerId === 'host') return e.isHost || e.peerId === 'host' || (window.state.lobby.isHost && e === window.gameInstance.player);
                    return e.peerId === data.scorerPeerId;
                });

                if (scorer) {
                    window.gameInstance.bullseyeScores.set(scorer.id, data.score);
                    window.gameInstance.addParticles(scorer.x, scorer.y, 5, scorer.color);
                    if (window.gameInstance.audio) window.gameInstance.audio.playHit();
                }
            }
        }
        else if (type === 'DECOY_SPAWN') {
            if (window.gameInstance && window.Entity) {
                // Spawn decoy from network data
                const decoy = new window.Entity(
                    data.x,
                    data.y,
                    data.color,
                    data.name,
                    false,
                    data.face,
                    data.hat
                );
                if (data.decoyId) decoy.id = data.decoyId;
                decoy.isDecoy = true;
                decoy.decoyTimer = 3000; // 3 seconds
                decoy.dx = data.dx || 0;
                decoy.dy = data.dy || 0;

                window.gameInstance.enemies.push(decoy);
                window.gameInstance.addParticles(data.x, data.y, 10, '#ffffff');
            }
        }
        else if (type === 'BLACK_HOLE_SPAWN') {
            if (window.gameInstance && window.BlackHole) {
                const bh = new window.BlackHole(data.x, data.y);
                bh.pullRadius = data.pullRadius || 300;
                window.gameInstance.blackHoles.push(bh);
            } else {
            }
        }
        else if (type === 'BLACK_HOLE_TELEPORT') {
            if (window.gameInstance && window.gameInstance.blackHoles && window.gameInstance.blackHoles[0]) {
                const bh = window.gameInstance.blackHoles[0];
                bh.x = data.x;
                bh.y = data.y;
                bh.teleportTimer = CONFIG.BLACK_HOLE_TELEPORT_INTERVAL;
                window.gameInstance.addParticles(data.x, data.y, 3, '#a855f7');
            }
        }
        else if (type === 'LIGHTNING_SPAWN') {
            if (window.gameInstance) {
                window.gameInstance.lightningWarnings.push({
                    x: data.x,
                    y: data.y,
                    timer: 120,
                    triggered: false
                });
            }
        }
        // ============ GAME SYNC PROTOCOL ============
        else if (type === 'INPUT' && window.state.lobby.isHost) {
            // Host receives Client input
            if (!window.gameInstance) return;

            // Find player by PeerID
            const player = window.gameInstance.enemies?.find(e => e.peerId === conn.peer);
            if (!player || player.dead) return;

            // Store last processed sequence for this player
            player.lastProcessedSeq = data.seq || 0;

            // Handle EMOJI
            if (data.action === 'EMOJI') {
                player.triggerTaunt(data.emoji);
                this.broadcast({
                    type: 'PLAYER_EMOJI',
                    peerId: player.peerId,
                    emoji: data.emoji
                });
                return;
            }

            // Handle DECOY_SPAWN (X key from client)
            if (data.action === 'DECOY_SPAWN') {
                if (window.gameInstance.spawnDecoy) {
                    const decoy = window.gameInstance.spawnDecoy(player);
                    if (decoy) {
                        this.broadcast({
                            type: 'DECOY_SPAWN',
                            decoyId: decoy.id,
                            ownerId: player.peerId,
                            x: player.x,
                            y: player.y,
                            color: player.color,
                            name: player.name,
                            face: player.face,
                            hat: player.hat,
                            dx: player.dx,
                            dy: player.dy
                        });
                    }
                }
                return;
            }

            // Apply input with HOST authority (same physics as client)
            if (data.dash) {
                // Apply dash
                player.dash(data.mouseX, data.mouseY, 1.0);
            } else if (data.dirX !== undefined) {
                // Apply movement
                player.applyInput(data.dirX, data.dirY);
            } else {
                // No movement input - dampen velocity (client is stationary)
                player.dx *= 0.85;
                player.dy *= 0.85;
            }

            // CRITICAL: Check boundaries after input (hole death, etc.)
            if (window.gameInstance.checkBoundaries) {
                window.gameInstance.checkBoundaries(player);
            }

            // HOT POTATO: Handle E key from client
            if (data.passPotatoKey && window.gameInstance?.activeAbilities?.has('HOT_POTATO')) {
                if (window.gameInstance.potatoTarget === player) {
                    // Find nearest enemy to client player
                    let nearest = null;
                    let minDist = 90;

                    const allChars = [window.gameInstance.player, ...window.gameInstance.enemies].filter(e => e && !e.dead);
                    allChars.forEach(other => {
                        if (other !== player) {
                            const dist = Math.hypot(other.x - player.x, other.y - player.y);
                            if (dist < minDist) {
                                minDist = dist;
                                nearest = other;
                            }
                        }
                    });

                    if (nearest) {
                        window.gameInstance.passPotato(nearest);
                    }
                }
            }

            // Note: We broadcast state in the main game loop, not per-input
        }
        else if (type === 'STATE_UPDATE' && !window.state.lobby.isHost) {
            // Client receives authoritative state from Host
            if (!window.gameInstance || !data.players) return;

            // ============ RECONCILIATION WITH INPUT REPLAY ============

            // 1. Remove confirmed inputs from buffer
            if (data.lastProcessedSeq) {
                this.inputBuffer = this.inputBuffer.filter(input => input.seq > data.lastProcessedSeq);
            }

            // 2. Store state in buffer for interpolation (OTHER players only)
            const stateSnapshot = {
                timestamp: data.timestamp || Date.now(),
                players: data.players,
                ball: data.ball
            };
            this.stateBuffer.push(stateSnapshot);

            // Keep buffer manageable (last 500ms of states)
            const cutoffTime = Date.now() - 500;
            this.stateBuffer = this.stateBuffer.filter(s => s.timestamp > cutoffTime);

            data.players.forEach(serverPlayer => {
                // Find local entity
                let entity;
                if (serverPlayer.id === 'host') {
                    entity = window.gameInstance.enemies?.find(e => e.isHost);
                } else if (serverPlayer.id === window.state.network?.peerId) {
                    entity = window.gameInstance.player; // Our own player
                } else {
                    entity = window.gameInstance.enemies?.find(e => e.peerId === serverPlayer.id);
                }

                if (entity) {
                    // For OUR player: Smart reconciliation with input replay
                    if (entity === window.gameInstance.player) {
                        // Calculate prediction error
                        const errorX = serverPlayer.x - entity.x;
                        const errorY = serverPlayer.y - entity.y;
                        const errorDistance = Math.hypot(errorX, errorY);

                        // SMART CORRECTION: Threshold-based reconciliation (Smoother feeling)
                        const ERROR_THRESHOLD = 50; // Reduced from 100 for tighter sync

                        if (errorDistance > ERROR_THRESHOLD) {
                            // Large error (desync or teleport): Hard correction
                            entity.x = serverPlayer.x;
                            entity.y = serverPlayer.y;
                            entity.dx = serverPlayer.dx;
                            entity.dy = serverPlayer.dy;
                        } else if (errorDistance > 2) {
                            // Small error (micro-adjust): Very smooth blend prevents jitter
                            // Use a smaller blend factor (0.15) to correct gradually
                            const blendFactor = 0.15;
                            entity.x += errorX * blendFactor;
                            entity.y += errorY * blendFactor;

                            // Velocity correction needs to be snappier to prevent 'drift'
                            entity.dx = (entity.dx * 0.8) + (serverPlayer.dx * 0.2);
                            entity.dy = (entity.dy * 0.8) + (serverPlayer.dy * 0.2);
                        }

                        // REPLAY unconfirmed inputs
                        this.inputBuffer.forEach(input => {
                            if (input.dash) {
                                entity.dash(input.mouseX, input.mouseY, 1.0, true);
                            } else if (input.dirX !== undefined) {
                                entity.applyInput(input.dirX, input.dirY);
                            }
                        });

                        entity.prevX = entity.x;
                        entity.prevY = entity.y;
                    }
                    // For OTHER players: Mark for interpolated rendering
                }
            });
        }
    }

    broadcast(data) {
        if (window.state.lobby.isHost) {
            this.connections.forEach(c => c.open && c.send(data));
        } else if (this.hostConn?.open) {
            this.hostConn.send(data);
        }
    }

    broadcastButExclude(data, senderConn) {
        this.connections.forEach(c => {
            if (c !== senderConn && c.open) c.send(data);
        });
    }

    // State Helpers
    addLocalPlayerToLobby() {
        if (!window.state.lobby.players.find(x => x.id === 'self')) {
            window.state.lobby.players.push({
                id: 'self',
                name: window.state.player.name,
                color: window.state.player.color,
                face: window.state.player.face,
                hat: window.state.player.hat,
                isHost: true,
                ping: 0
            });
            if (window.updateLobbyUI) window.updateLobbyUI();
        }
    }

    addGuestToLobby(pData, peerId) {
        if (window.state.lobby.players.find(x => x.id === peerId)) return;
        window.state.lobby.players.push({
            id: peerId,
            name: pData.name,
            color: pData.color,
            face: pData.face,
            hat: pData.hat,
            isHost: false,
            ping: Math.floor(Math.random() * 20) + 10
        });
    }

    removePlayer(peerId) {
        window.state.lobby.players = window.state.lobby.players.filter(p => p.id !== peerId);

        // Remove from Active Game
        if (window.gameInstance) {
            if (window.gameInstance.enemies) {
                window.gameInstance.enemies = window.gameInstance.enemies.filter(e => e.peerId !== peerId);
            }
            // Broadcast In-Game Leave
            this.broadcast({ type: 'PLAYER_LEFT', playerId: peerId });
        }
    }

    broadcastLobbyState() {
        if (!window.state.lobby.isHost) return;
        const payload = window.state.lobby.players.map(p => {
            const pid = p.id === 'self' ? this.peerId : p.id;
            // Ensure Mapping
            if (!this.playerIdMap.has(pid)) {
                if (p.isHost) this.playerIdMap.set(pid, 0);
                else this.playerIdMap.set(pid, this.nextNetworkId++);
            }
            return { ...p, id: pid, idIndex: this.playerIdMap.get(pid) };
        });
        this.broadcast({ type: 'LOBBY_STATE', players: payload });
    }

    // ============ GAME SYNC METHODS ============

    // Check if we have inputs not yet processed by server
    hasPendingInputs() {
        return this.inputBuffer && this.inputBuffer.length > 0;
    }

    // Client: Send input to Host
    sendInput(inputData) {
        if (!this.hostConn || !this.hostConn.open) return;

        // Assign sequence number
        this.inputSeq++;
        const seq = this.inputSeq;

        const packet = {
            type: 'INPUT',
            seq,
            ...inputData,
            timestamp: Date.now()
        };

        // Store in buffer for reconciliation
        this.inputBuffer.push({
            seq,
            ...inputData,
            timestamp: Date.now()
        });

        // Limit buffer size (keep last 60 inputs = ~1 second at 60Hz)
        if (this.inputBuffer.length > 60) {
            this.inputBuffer.shift();
        }

        this.hostConn.send(packet);
    }

    // Host: Broadcast game state to all clients (called from game loop)
    broadcastState() {
        if (!window.state.lobby.isHost || !window.gameInstance) return;

        // DEBUG: Log broadcast attempt (only every 60 frames = 1 second)
        // if (!this._broadcastCounter) this._broadcastCounter = 0;
        // this._broadcastCounter++;
        // if (this._broadcastCounter % 60 === 0) {
        // }

        // Build player ID map for binary encoding
        // const playerIdMap... REMOVED (using persistent this.playerIdMap)

        const playerData = [];

        // Add Host (self)
        if (window.gameInstance.player) {
            playerData.push({
                idIndex: 0,
                x: window.gameInstance.player.x,
                y: window.gameInstance.player.y,
                dx: window.gameInstance.player.dx,
                dy: window.gameInstance.player.dy,
                radius: window.gameInstance.player.radius || 25,
                ping: 0 // Host ping
            });
        }

        // Add Clients
        if (window.gameInstance.enemies) {
            window.gameInstance.enemies.forEach(e => {
                if (e.peerId) {
                    // ID Assignment logic
                    if (!this.playerIdMap.has(e.peerId)) this.playerIdMap.set(e.peerId, this.nextNetworkId++);

                    playerData.push({
                        idIndex: this.playerIdMap.get(e.peerId),
                        x: e.x,
                        y: e.y,
                        dx: e.dx,
                        dy: e.dy,
                        radius: e.radius || 25,
                        ping: (window.state.lobby.players.find(x => x.id === e.peerId)?.ping) || 0
                    });
                }
            });
        }

        // DEBUG: Log player count (every 60 frames)
        // if (this._broadcastCounter % 60 === 0) {
        // }

        // Send PERSONALIZED binary state to each client
        this.connections.forEach(conn => {
            if (!conn.open) return;

            const clientPlayer = window.gameInstance.enemies?.find(e => e.peerId === conn.peer);
            const lastProcessedSeq = clientPlayer?.lastProcessedSeq || 0;

            // BINARY ENCODING: [header][count][seq][timestamp] + per player: [id][x][y][dx][dy][radius]
            // Header: 1 byte (0x01 = STATE_UPDATE)
            // Count: 1 byte
            // LastSeq: 4 bytes (Uint32)
            // Timestamp: 8 bytes (Float64)
            // Count: 1 byte
            // LastSeq: 4 bytes (Uint32)
            // Timestamp: 8 bytes (Float64)
            // Per Player: 2 bytes (id) + 20 bytes (5 floats: x,y,dx,dy,radius) + 2 bytes (ping) = 24 bytes

            const headerSize = 14;
            const playerSize = 24; // Updated from 22 (added ping)

            // Check for Ball
            const ball = window.gameInstance.ball;
            const hasBall = !!ball;
            const ballSize = hasBall ? 16 : 0;

            const totalSize = headerSize + (playerData.length * playerSize) + 1 + ballSize;

            const buffer = new ArrayBuffer(totalSize);
            const view = new DataView(buffer);

            let offset = 0;

            // Header
            view.setUint8(offset++, 0x01); // Packet type: STATE_UPDATE
            view.setUint8(offset++, playerData.length); // Player count
            view.setUint32(offset, lastProcessedSeq, true); offset += 4; // Little-endian
            view.setFloat64(offset, Date.now(), true); offset += 8;

            // Player data
            playerData.forEach(p => {
                view.setUint16(offset, p.idIndex, true); offset += 2;
                view.setFloat32(offset, p.x, true); offset += 4;
                view.setFloat32(offset, p.y, true); offset += 4;
                view.setFloat32(offset, p.dx, true); offset += 4;
                view.setFloat32(offset, p.dy, true); offset += 4;
                view.setFloat32(offset, p.radius, true); offset += 4; // NEW: radius
                view.setUint16(offset, p.ping || 0, true); offset += 2; // NEW: ping
            });

            // Ball Data
            view.setUint8(offset++, hasBall ? 1 : 0);
            if (hasBall) {
                view.setFloat32(offset, ball.x, true); offset += 4;
                view.setFloat32(offset, ball.y, true); offset += 4;
                view.setFloat32(offset, ball.dx, true); offset += 4;
                view.setFloat32(offset, ball.dy, true); offset += 4;
            }

            // Store ID map on connection for decoding
            // conn.playerIdMap assignment removed (Legacy)

            conn.send(buffer);
        });
    }

    // ============ INTERPOLATION HELPER ============

    // Get interpolated state for an entity at renderTime (now - INTERPOLATION_DELAY)
    getInterpolatedState(entityId) {
        if (this.stateBuffer.length < 2) return null; // Need at least 2 states

        const renderTime = Date.now() - this.INTERPOLATION_DELAY;

        // Find two states to interpolate between
        let before = null;
        let after = null;

        for (let i = 0; i < this.stateBuffer.length; i++) {
            const state = this.stateBuffer[i];

            if (state.timestamp <= renderTime) {
                before = state;
            } else {
                after = state;
                break;
            }
        }

        // If we don't have surrounding states, use latest available
        if (!before && after) return this.findPlayerInState(after, entityId);
        if (before && !after) return this.findPlayerInState(before, entityId);
        if (!before && !after) return null;

        // Interpolate between before and after
        const playerBefore = this.findPlayerInState(before, entityId);
        const playerAfter = this.findPlayerInState(after, entityId);

        if (!playerBefore || !playerAfter) return playerBefore || playerAfter;

        // Calculate interpolation alpha
        const totalDelta = after.timestamp - before.timestamp;
        const targetDelta = renderTime - before.timestamp;
        const alpha = totalDelta > 0 ? Math.min(1, Math.max(0, targetDelta / totalDelta)) : 0;

        // Lerp position and velocity
        return {
            x: playerBefore.x + (playerAfter.x - playerBefore.x) * alpha,
            y: playerBefore.y + (playerAfter.y - playerBefore.y) * alpha,
            dx: playerBefore.dx + (playerAfter.dx - playerBefore.dx) * alpha,
            dy: playerBefore.dy + (playerAfter.dy - playerBefore.dy) * alpha
        };
    }

    getInterpolatedBall() {
        if (this.stateBuffer.length < 2) return null;

        const renderTime = Date.now() - this.INTERPOLATION_DELAY;
        let before = null;
        let after = null;

        for (let i = 0; i < this.stateBuffer.length; i++) {
            const state = this.stateBuffer[i];
            if (state.timestamp <= renderTime) {
                before = state;
            } else {
                after = state;
                break;
            }
        }

        let ballBefore = before ? before.ball : null;
        let ballAfter = after ? after.ball : null;

        if (!ballBefore && ballAfter) return ballAfter;
        if (ballBefore && !ballAfter) return ballBefore;
        if (!ballBefore && !ballAfter) return null;

        const totalDelta = after.timestamp - before.timestamp;
        const targetDelta = renderTime - before.timestamp;
        const alpha = totalDelta > 0 ? Math.min(1, Math.max(0, targetDelta / totalDelta)) : 0;

        return {
            x: ballBefore.x + (ballAfter.x - ballBefore.x) * alpha,
            y: ballBefore.y + (ballAfter.y - ballBefore.y) * alpha,
            dx: ballBefore.dx, // Velocity lerp optional
            dy: ballBefore.dy
        };
    }

    findPlayerInState(state, entityId) {
        return state.players.find(p => p.id === entityId);
    }

    refreshList() {
        if (!this.socket) return;

        // Mobile Wakeup Fix: Force reconnect if disconnected
        if (!this.socket.connected) {
            this.socket.connect();
        }

        this.socket.emit('getRoomList');
    }

    leaveSession() {
        if (this.socket) {
            // Leave room explicit
            if (window.state && window.state.lobby && window.state.lobby.id) {
                console.log(`[CLIENT] Leaving room. RoomId: ${window.state.lobby.id}, Type: ${typeof window.state.lobby.id}`);
                this.socket.emit('leaveRoom', { roomId: window.state.lobby.id });
                // Reset state
                window.state.lobby.id = null;
                window.state.lobby.isHost = false;
                window.state.lobby.players = [];
            } else {
                console.log('[CLIENT] leaveSession called but no room ID found in state');
            }
        }
        if (this.peer) {
            this.peer.destroy();
            this.peer = null;
        }
        this.connections = [];
        this.hostConn = null;
        this.isConnected = false;
        this.peerId = null;
    }
}
