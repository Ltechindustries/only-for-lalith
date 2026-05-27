const express = require('express');
const { WebSocketServer } = require('ws');
const cors = require('cors');

const app = express();
app.use(cors());

// Health check endpoint
app.get('/', (req, res) => {
    res.send('Only For Lalith Signaling Server is running.');
});

const server = app.listen(8081, () => {
    console.log('Signaling server running on port 8081');
});

const wss = new WebSocketServer({ server });

/**
 * Mapping of connection codes to room objects.
 * Room structure:
 * {
 *   host: WebSocket connection of the room creator,
 *   peer: WebSocket connection of the joining peer
 * }
 */
const rooms = new Map();

function generateCode() {
    let code;
    do {
        // Generate a random 6-digit code
        code = Math.floor(100000 + Math.random() * 900000).toString();
    } while (rooms.has(code));
    return code;
}

wss.on('connection', (ws) => {
    let currentRoom = null;
    let isHost = false;

    ws.on('message', (message) => {
        let parsedMessage;
        try {
            parsedMessage = JSON.parse(message);
        } catch (e) {
            console.error('Invalid JSON received');
            return;
        }

        const { type, payload } = parsedMessage;

        switch (type) {
            case 'create-room': {
                const code = generateCode();
                currentRoom = code;
                isHost = true;
                
                rooms.set(code, {
                    host: ws,
                    peer: null
                });
                
                ws.send(JSON.stringify({ 
                    type: 'room-created', 
                    payload: { code } 
                }));
                console.log(`Room created: ${code}`);
                break;
            }

            case 'join-room': {
                const { code } = payload;
                const room = rooms.get(code);

                if (room) {
                    if (room.peer) {
                        ws.send(JSON.stringify({ type: 'error', payload: { message: 'Room is full' } }));
                        return;
                    }
                    
                    room.peer = ws;
                    currentRoom = code;
                    isHost = false;

                    // Notify host that the peer joined so host can initiate the WebRTC offer
                    room.host.send(JSON.stringify({ type: 'peer-joined' }));
                    
                    // Notify joining peer that they successfully joined
                    ws.send(JSON.stringify({ type: 'room-joined', payload: { code } }));
                    console.log(`Peer joined room: ${code}`);
                } else {
                    ws.send(JSON.stringify({ type: 'error', payload: { message: 'Invalid code' } }));
                }
                break;
            }

            case 'signal': {
                if (currentRoom) {
                    const room = rooms.get(currentRoom);
                    if (room) {
                        // Deliver signal to the opposite party
                        const targetUser = isHost ? room.peer : room.host;
                        if (targetUser && targetUser.readyState === targetUser.OPEN) {
                            targetUser.send(JSON.stringify({
                                type: 'signal',
                                payload: { signal: payload.signal }
                            }));
                        }
                    }
                }
                break;
            }

            default:
                console.log('Unknown message type:', type);
        }
    });

    ws.on('close', () => {
        if (currentRoom) {
            const room = rooms.get(currentRoom);
            if (room) {
                const targetUser = isHost ? room.peer : room.host;
                if (targetUser && targetUser.readyState === targetUser.OPEN) {
                    targetUser.send(JSON.stringify({ type: 'peer-disconnected' }));
                }
                rooms.delete(currentRoom);
                console.log(`Room ${currentRoom} deleted due to disconnect.`);
            }
        }
    });
});
