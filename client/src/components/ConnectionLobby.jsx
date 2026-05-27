import React, { useState } from 'react';
import { Share2, Link as LinkIcon, LogIn } from 'lucide-react';

export default function ConnectionLobby({ state, onCreateRoom, onJoinRoom, connectionCode }) {
    const [joinCode, setJoinCode] = useState('');

    if (state === 'creating') {
        return (
            <div className="card glass-panel fade-in flex-col-center">
                <div className="icon-wrapper">
                    <Share2 size={32} />
                </div>
                <h2>Your Connection Code</h2>
                <div className="code-display text-glow">
                    {connectionCode || '------'}
                </div>
                <p className="subtitle">Waiting for the other device to join...</p>
                <div className="loader mt-4"></div>
            </div>
        );
    }

    if (state === 'joining') {
        return (
            <div className="card glass-panel fade-in flex-col-center">
                <div className="icon-wrapper">
                    <LogIn size={32} />
                </div>
                <h2>Join a Connection</h2>
                <p className="subtitle">Enter the 6-digit code from the other device</p>
                <input 
                    type="text" 
                    className="code-input"
                    maxLength={6}
                    placeholder="Enter Code"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.replace(/\D/g, ''))}
                />
                <div className="flex-row mt-4">
                    <button 
                        className="btn-primary" 
                        disabled={joinCode.length !== 6}
                        onClick={() => onJoinRoom(joinCode)}
                    >
                        Connect
                    </button>
                    {/* Add a back button theoretically, kept minimal here */}
                </div>
            </div>
        );
    }

    // Default Idle State
    return (
        <div className="card glass-panel fade-in main-lobby">
            <h1 className="main-title">Only For Lalith</h1>
            <p className="main-subtitle">Direct, Fast & Secure Peer-to-Peer File Transfer</p>
            
            <div className="action-buttons flex-row">
                <button className="btn-primary" onClick={onCreateRoom}>
                    <Share2 size={20} />
                    Create Connection
                </button>
                <button className="btn-secondary" onClick={() => onJoinRoom(null)}>
                    <LinkIcon size={20} />
                    Join Connection
                </button>
            </div>
        </div>
    );
}
