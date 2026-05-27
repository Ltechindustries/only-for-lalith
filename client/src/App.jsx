import React, { useState, useEffect } from 'react';
import ConnectionLobby from './components/ConnectionLobby';
import FileTransferPortal from './components/FileTransferPortal';
import { webrtcService } from './services/WebRTCService';
import './App.css';

function App() {
  const [appState, setAppState] = useState('idle'); // idle, creating, joining, connected
  const [connectionCode, setConnectionCode] = useState(null);
  const [errorCode, setErrorCode] = useState(null);
  
  const [transferProgress, setTransferProgress] = useState(0);
  const [transferComplete, setTransferComplete] = useState(false);
  
  const [incomingFile, setIncomingFile] = useState(null);
  const [receivingProgress, setReceivingProgress] = useState(0);
  const [receivingSpeed, setReceivingSpeed] = useState(0);
  const [receivedFileBlob, setReceivedFileBlob] = useState(null);
  const [receivedFiles, setReceivedFiles] = useState([]);

  function resetTransferState() {
      setTransferProgress(0);
      setTransferComplete(false);
      setIncomingFile(null);
      setReceivingProgress(0);
      setReceivingSpeed(0);
      setReceivedFileBlob(null);
      setReceivedFiles([]);
  }

  useEffect(() => {
    // Initialize websocket connection
    webrtcService.connectSocket();

    const onRoomCreated = (code) => {
        setConnectionCode(code);
    };

    const onRoomJoined = (code) => {
        setConnectionCode(code);
    };

    const onWebRTCConnected = () => {
        setAppState('connected');
        setErrorCode(null);
        setTransferProgress(0);
        setTransferComplete(false);
        setIncomingFile(null);
        setReceivedFileBlob(null);
    };

    const onWebRTCDisconnected = () => {
        setAppState('idle');
        setConnectionCode(null);
        resetTransferState();
        setErrorCode('Peer disconnected');
        setTimeout(() => setErrorCode(null), 3000);
    };

    const onError = (msg) => {
        setErrorCode(msg);
        setTimeout(() => setErrorCode(null), 3000);
        if (appState !== 'connected') {
            setAppState('idle');
        }
    };

    // Sender events
    const onTransferProgress = (progress) => {
        setTransferProgress(progress);
    };
    const onTransferComplete = () => {
        setTransferProgress(100);
        setTransferComplete(true);
        setTimeout(() => {
            setTransferProgress(0);
            setTransferComplete(false);
        }, 5000);
    };

    // Receiver events
    const onFileIncoming = (meta) => {
        setIncomingFile(meta);
        setReceivedFileBlob(null);
        setReceivingProgress(0);
        setReceivingSpeed(0);
        setReceivedFiles((files) => [
            {
                id: meta.id,
                name: meta.name,
                size: meta.size,
                type: meta.type,
                progress: 0,
                status: 'receiving',
                blob: null
            },
            ...files
        ]);
    };
    const onFileProgress = (progress, speed, meta) => {
        setReceivingProgress(progress);
        setReceivingSpeed(speed);
        setReceivedFiles((files) => files.map((file) => (
            file.id === meta?.id
                ? { ...file, progress, status: progress >= 100 ? 'complete' : 'receiving' }
                : file
        )));
    };
    const onFileReceived = (blob, meta) => {
        setReceivingProgress(100);
        setReceivedFileBlob(blob);
        setIncomingFile(meta);
        setReceivedFiles((files) => files.map((file) => (
            file.id === meta.id
                ? { ...file, progress: 100, status: 'complete', blob, completedAt: Date.now() }
                : file
        )));
    };

    webrtcService.on('room-created', onRoomCreated);
    webrtcService.on('room-joined', onRoomJoined);
    webrtcService.on('webrtc-connected', onWebRTCConnected);
    webrtcService.on('webrtc-disconnected', onWebRTCDisconnected);
    webrtcService.on('peer-disconnected', onWebRTCDisconnected);
    webrtcService.on('error', onError);

    webrtcService.on('transfer-progress', onTransferProgress);
    webrtcService.on('transfer-complete', onTransferComplete);

    webrtcService.on('file-incoming', onFileIncoming);
    webrtcService.on('file-progress', onFileProgress);
    webrtcService.on('file-received', onFileReceived);

    return () => {
        webrtcService.off('room-created', onRoomCreated);
        webrtcService.off('room-joined', onRoomJoined);
        webrtcService.off('webrtc-connected', onWebRTCConnected);
        webrtcService.off('webrtc-disconnected', onWebRTCDisconnected);
        webrtcService.off('peer-disconnected', onWebRTCDisconnected);
        webrtcService.off('error', onError);
        
        webrtcService.off('transfer-progress', onTransferProgress);
        webrtcService.off('transfer-complete', onTransferComplete);
        
        webrtcService.off('file-incoming', onFileIncoming);
        webrtcService.off('file-progress', onFileProgress);
        webrtcService.off('file-received', onFileReceived);
    };
  }, [appState]);

  const handleCreateRoom = () => {
      setAppState('creating');
      resetTransferState();
      webrtcService.createRoom();
  };

  const handleJoinRoom = (code) => {
      if (!code) {
          setAppState('joining');
      } else {
          resetTransferState();
          webrtcService.joinRoom(code);
      }
  };

  const handleDisconnect = () => {
      webrtcService.disconnect();
      setAppState('idle');
      webrtcService.connectSocket(); // Reconnect to signaling server
  };

  const handleSendFile = (file) => {
      webrtcService.sendFile(file).catch((err) => {
          console.error('[FILE_SEND_ERROR]', err);
          setErrorCode('File send failed');
          setTimeout(() => setErrorCode(null), 3000);
      });
  };

  return (
    <div className="app-container">
        {/* Animated Background */}
        <div className="bg-shapes">
            <div className="shape shape-1"></div>
            <div className="shape shape-2"></div>
            <div className="shape shape-3"></div>
        </div>

        <div className="content-wrapper">
            {errorCode && (
                <div className="toast-err slide-down">
                    {errorCode}
                </div>
            )}

            {appState === 'connected' ? (
                <FileTransferPortal 
                    onDisconnect={handleDisconnect}
                    onSendFile={handleSendFile}
                    transferProgress={transferProgress}
                    transferComplete={transferComplete}
                    incomingFile={incomingFile}
                    receivingProgress={receivingProgress}
                    receivingSpeed={receivingSpeed}
                    receivedFileBlob={receivedFileBlob}
                    receivedFiles={receivedFiles}
                />
            ) : (
                <ConnectionLobby 
                    state={appState}
                    onCreateRoom={handleCreateRoom}
                    onJoinRoom={handleJoinRoom}
                    connectionCode={connectionCode}
                />
            )}
        </div>
    </div>
  );
}

export default App;
