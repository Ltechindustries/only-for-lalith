import Peer from 'simple-peer/simplepeer.min.js';

class EventEmitter {
    constructor() {
        this.events = {};
    }
    on(event, listener) {
        if (!this.events[event]) this.events[event] = [];
        this.events[event].push(listener);
    }
    off(event, listener) {
        if (!this.events[event]) return;
        this.events[event] = this.events[event].filter(l => l !== listener);
    }
    emit(event, ...args) {
        if (this.events[event]) {
            this.events[event].forEach(listener => listener(...args));
        }
    }
}

class WebRTCService extends EventEmitter {
    constructor(serverUrl = WebRTCService.getDefaultServerUrl()) {
        super();
        this.serverUrl = serverUrl;
        this.ws = null;
        this.peer = null;
        this.isHost = false;
        
        // File receiving state
        this.incomingFileMeta = null;
        this.receiveBuffer = [];
        this.receivedBytes = 0;
        this.startTime = 0;
        this.currentTransferId = null;

        // Configuration
        this.chunkSize = 64 * 1024;
        this.maxBufferedAmount = 1024 * 1024;
    }

    static getDefaultServerUrl() {
        if (typeof window === 'undefined') {
            return 'ws://localhost:8081';
        }

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${protocol}//${window.location.hostname}:8081`;
    }

    log(tag, payload = {}) {
        console.log(tag, payload);
    }

    warn(tag, payload = {}) {
        console.warn(tag, payload);
    }

    connectSocket() {
        if (this.ws) return;
        this.ws = new WebSocket(this.serverUrl);
        
        this.ws.onmessage = (event) => {
            const parsed = JSON.parse(event.data);
            this.handleSocketMessage(parsed);
        };
        
        this.ws.onopen = () => {
            this.emit('socket-connected');
        };

        this.ws.onclose = () => {
            this.emit('socket-disconnected');
            this.destroyPeer();
        };
    }

    handleSocketMessage({ type, payload }) {
        switch (type) {
            case 'room-created':
                this.isHost = true;
                this.emit('room-created', payload.code);
                break;
            case 'room-joined':
                this.isHost = false;
                this.emit('room-joined', payload.code);
                // The joiner initiates the WebRTC offer? 
                // Wait, it's usually the host that should initiate it when peer joins, or vice-versa.
                // We'll let the joiner initiate it to avoid race conditions.
                this.initPeer(true); 
                break;
            case 'peer-joined':
                // Host receives this when another peer joins
                this.initPeer(false);
                break;
            case 'signal':
                if (this.peer) {
                    this.peer.signal(payload.signal);
                }
                break;
            case 'peer-disconnected':
                this.emit('peer-disconnected');
                this.destroyPeer();
                break;
            case 'error':
                this.emit('error', payload.message);
                break;
            default:
                break;
        }
    }

    createRoom() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'create-room' }));
        }
    }

    joinRoom(code) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'join-room', payload: { code } }));
        }
    }

    initPeer(initiator) {
        this.destroyPeer();

        this.peer = new Peer({
            initiator,
            trickle: true,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:global.stun.twilio.com:3478' }
                ]
            }
        });

        this.peer.on('signal', (data) => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type: 'signal', payload: { signal: data } }));
            }
        });

        this.peer.on('connect', () => {
            if (this.peer?._channel) {
                this.peer._channel.binaryType = 'arraybuffer';
            }
            this.emit('webrtc-connected');
        });

        this.peer.on('data', (data) => {
            this.handleDataChannelMessage(data).catch((err) => {
                console.error('[DATACHANNEL_RECEIVE_ERROR]', err);
                this.emit('error', 'Unable to receive file data');
            });
        });

        this.peer.on('close', () => {
            this.emit('webrtc-disconnected');
            this.destroyPeer();
        });

        this.peer.on('error', (err) => {
            console.error('Peer Error:', err);
            this.emit('error', 'Connection lost');
            this.destroyPeer();
        });
    }

    async handleDataChannelMessage(data) {
        const controlMessage = await this.tryParseControlMessage(data);

        if (controlMessage) {
            this.handleControlMessage(controlMessage);
            return;
        }

        await this.handleIncomingChunk(data);
    }

    async tryParseControlMessage(data) {
        let text = null;

        if (typeof data === 'string') {
            text = data;
        } else if (data instanceof Blob) {
            text = await data.text();
        } else if (data instanceof ArrayBuffer) {
            text = this.decodePotentialJson(data);
        } else if (ArrayBuffer.isView(data)) {
            text = this.decodePotentialJson(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
        }

        if (!text || !text.trim().startsWith('{')) {
            return null;
        }

        try {
            const parsed = JSON.parse(text);
            return parsed?.type?.startsWith('file-') ? parsed : null;
        } catch {
            return null;
        }
    }

    decodePotentialJson(buffer) {
        try {
            return new TextDecoder().decode(buffer);
        } catch {
            return null;
        }
    }

    handleControlMessage(message) {
        if (message.type === 'file-meta') {
            this.incomingFileMeta = {
                id: message.meta.id,
                name: message.meta.name || 'download',
                size: Number(message.meta.size) || 0,
                type: message.meta.type || 'application/octet-stream',
                lastModified: message.meta.lastModified,
                totalChunks: Number(message.meta.totalChunks) || 0,
                chunkSize: Number(message.meta.chunkSize) || this.chunkSize
            };
            this.currentTransferId = this.incomingFileMeta.id;
            this.receiveBuffer = [];
            this.receivedBytes = 0;
            this.startTime = Date.now();

            this.log('[METADATA_RECEIVED]', this.incomingFileMeta);
            this.emit('file-incoming', this.incomingFileMeta);
            return;
        }

        if (message.type === 'file-done') {
            this.finishIncomingFile(message.transferId);
        }
    }

    async handleIncomingChunk(data) {
        if (!this.incomingFileMeta) {
            this.warn('[CHUNK_RECEIVED_WITHOUT_METADATA]', {
                byteLength: data?.byteLength || data?.size || data?.length || 0
            });
            return;
        }

        const chunk = await this.normalizeBinaryChunk(data);
        const chunkBytes = chunk.byteLength || chunk.size || 0;
        this.receiveBuffer.push(chunk);
        this.receivedBytes += chunkBytes;

        const progress = this.incomingFileMeta.size
            ? Math.min((this.receivedBytes / this.incomingFileMeta.size) * 100, 100)
            : 100;

        const timeElapsed = (Date.now() - this.startTime) / 1000;
        const speed = timeElapsed > 0 ? (this.receivedBytes / timeElapsed) : 0;

        this.log('[CHUNK_RECEIVED]', {
            transferId: this.currentTransferId,
            chunkNumber: this.receiveBuffer.length,
            chunkBytes,
            receivedBytes: this.receivedBytes,
            totalBytes: this.incomingFileMeta.size,
            progress
        });

        this.emit('file-progress', progress, speed, this.incomingFileMeta);
    }

    async normalizeBinaryChunk(data) {
        if (data instanceof ArrayBuffer || data instanceof Blob) {
            return data;
        }

        if (ArrayBuffer.isView(data)) {
            return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        }

        if (typeof data === 'string') {
            return new TextEncoder().encode(data).buffer;
        }

        throw new Error('Unsupported DataChannel message type');
    }

    finishIncomingFile(transferId) {
        if (!this.incomingFileMeta) {
            this.warn('[TRANSFER_COMPLETE_WITHOUT_METADATA]', { transferId });
            return;
        }

        if (transferId && transferId !== this.currentTransferId) {
            this.warn('[TRANSFER_ID_MISMATCH]', {
                expected: this.currentTransferId,
                received: transferId
            });
        }

        const blob = new Blob(this.receiveBuffer, {
            type: this.incomingFileMeta.type || 'application/octet-stream'
        });

        this.log('[TRANSFER_COMPLETE]', {
            transferId: this.currentTransferId,
            filename: this.incomingFileMeta.name,
            expectedBytes: this.incomingFileMeta.size,
            receivedBytes: this.receivedBytes,
            chunks: this.receiveBuffer.length
        });

        this.log('[BLOB_CREATED]', {
            transferId: this.currentTransferId,
            filename: this.incomingFileMeta.name,
            blobSize: blob.size,
            blobType: blob.type
        });

        this.emit('file-progress', 100, 0, this.incomingFileMeta);
        this.emit('file-received', blob, this.incomingFileMeta);
        this.receiveBuffer = [];
        this.receivedBytes = 0;
        this.currentTransferId = null;
    }

    async sendFile(file) {
        if (!file) return;
        if (!this.peer || !this.peer.connected) {
            this.emit('error', 'Peer is not connected yet');
            return;
        }

        const transferId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const totalChunks = Math.ceil(file.size / this.chunkSize);

        this.log('[FILE_SELECTED]', {
            transferId,
            name: file.name,
            size: file.size,
            type: file.type || 'application/octet-stream',
            totalChunks
        });

        // Send metadata
        const metadataMessage = {
            type: 'file-meta',
            meta: {
                id: transferId,
                name: file.name,
                size: file.size,
                type: file.type || 'application/octet-stream',
                lastModified: file.lastModified,
                totalChunks,
                chunkSize: this.chunkSize
            }
        };

        this.peer.send(JSON.stringify(metadataMessage));
        this.log('[METADATA_SENT]', metadataMessage.meta);

        let offset = 0;
        let chunkNumber = 0;

        while (offset < file.size) {
            const slice = file.slice(offset, offset + this.chunkSize);
            const chunk = await slice.arrayBuffer();
            chunkNumber += 1;

            this.log('[FILE_READ]', {
                transferId,
                chunkNumber,
                chunkBytes: chunk.byteLength,
                offset
            });

            await this.waitForBufferedAmount();
            this.peer.send(chunk);
            offset += chunk.byteLength;

            const progress = file.size ? Math.min((offset / file.size) * 100, 100) : 100;
            this.log('[CHUNK_SENT]', {
                transferId,
                chunkNumber,
                chunkBytes: chunk.byteLength,
                sentBytes: offset,
                totalBytes: file.size,
                progress
            });
            this.emit('transfer-progress', progress);
        }

        await this.waitForBufferedAmount();
        this.peer.send(JSON.stringify({ type: 'file-done', transferId }));
        this.log('[TRANSFER_COMPLETE]', {
            transferId,
            filename: file.name,
            sentBytes: offset,
            chunks: chunkNumber
        });
        this.emit('transfer-complete');
    }

    waitForBufferedAmount() {
        const channel = this.peer?._channel;
        if (!channel || channel.bufferedAmount <= this.maxBufferedAmount) {
            return Promise.resolve();
        }

        return new Promise((resolve) => {
            const poll = () => {
                if (!this.peer?.connected || !channel || channel.bufferedAmount <= this.maxBufferedAmount / 2) {
                    resolve();
                    return;
                }
                setTimeout(poll, 25);
            };
            poll();
        });
    }

    destroyPeer() {
        if (this.peer) {
            this.peer.destroy();
            this.peer = null;
        }
        this.incomingFileMeta = null;
        this.receiveBuffer = [];
        this.receivedBytes = 0;
        this.currentTransferId = null;
    }

    disconnect() {
        this.destroyPeer();
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}

// Singleton export
export const webrtcService = new WebRTCService();
