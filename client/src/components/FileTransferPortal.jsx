import React, { useEffect, useRef, useState } from 'react';
import { UploadCloud, File, CheckCircle, Download, XCircle } from 'lucide-react';

export default function FileTransferPortal({ 
    onDisconnect, 
    onSendFile, 
    transferProgress, 
    transferComplete,
    incomingFile,
    receivingProgress,
    receivingSpeed,
    receivedFileBlob,
    receivedFiles = []
}) {
    const [dragActive, setDragActive] = useState(false);
    const inputRef = useRef(null);
    const downloadedFileIds = useRef(new Set());

    const handleDrag = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === 'dragenter' || e.type === 'dragover') {
            setDragActive(true);
        } else if (e.type === 'dragleave') {
            setDragActive(false);
        }
    };

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            onSendFile(e.dataTransfer.files[0]);
        }
    };

    const handleChange = (e) => {
        e.preventDefault();
        if (e.target.files && e.target.files[0]) {
            onSendFile(e.target.files[0]);
            e.target.value = '';
        }
    };

    const onButtonClick = () => {
        inputRef.current.click();
    };

    const triggerDownload = (blob, fileMeta) => {
        if (!blob || !fileMeta) return;
        const filename = fileMeta.name || 'download';
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        console.log('[DOWNLOAD_TRIGGERED]', {
            transferId: fileMeta.id,
            filename,
            size: blob.size
        });
    };

    const handleDownload = (file = null) => {
        if (file?.blob) {
            triggerDownload(file.blob, file);
            return;
        }

        if (!receivedFileBlob || !incomingFile) return;
        triggerDownload(receivedFileBlob, incomingFile);
    };
    
    useEffect(() => {
        const completedFile = receivedFiles.find((file) => (
            file.status === 'complete' &&
            file.blob &&
            !downloadedFileIds.current.has(file.id)
        ));

        if (!completedFile) return;

        downloadedFileIds.current.add(completedFile.id);
        triggerDownload(completedFile.blob, completedFile);
    }, [receivedFiles]);

    const formatBytes = (bytes, decimals = 2) => {
        if (!+bytes) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
    };

    const formatSpeed = (speedBytes) => {
        return formatBytes(speedBytes) + '/s';
    };

    return (
        <div className="card glass-panel fade-in w-full max-w-md">
            <div className="header-status mb-4">
                <span className="status-badge connected"><CheckCircle size={14} /> Connected</span>
                <button className="btn-icon" onClick={onDisconnect} title="Disconnect"><XCircle size={20} /></button>
            </div>

            {/* Receiving file view */}
            {incomingFile && !receivedFileBlob && (
                <div className="receiving-view flex-col-center">
                    <File size={40} className="text-accent mb-2" />
                    <h3>Receiving File</h3>
                    <p className="filename">{incomingFile.name}</p>
                    <p className="subtitle">{formatBytes(incomingFile.size)}</p>
                    
                    <div className="progress-container mt-4">
                        <div className="progress-bar" style={{ width: `${receivingProgress}%` }}></div>
                    </div>
                    <div className="stats mt-2 flex-row w-full justify-between">
                        <span className="text-sm">{Math.round(receivingProgress)}%</span>
                        <span className="text-sm">{formatSpeed(receivingSpeed)}</span>
                    </div>
                </div>
            )}

            {/* File received ready to download */}
            {receivedFileBlob && (
                <div className="received-view flex-col-center">
                    <CheckCircle size={48} className="text-success mb-2" />
                    <h3>File Received</h3>
                    <p className="filename">{incomingFile.name}</p>
                    <p className="subtitle">{formatBytes(incomingFile.size)}</p>
                    <button className="btn-primary mt-4" onClick={() => handleDownload()}>
                        <Download size={18} />
                        Save File
                    </button>
                </div>
            )}

            {/* Sending / Idle View */}
            {!incomingFile && !receivedFileBlob && (
                <>
                    {transferProgress > 0 ? (
                        <div className="sending-view flex-col-center">
                            {transferProgress < 100 && !transferComplete ? (
                                <>
                                    <UploadCloud size={40} className="text-accent mb-2" />
                                    <h3>Sending File...</h3>
                                    <div className="progress-container mt-4">
                                        <div className="progress-bar" style={{ width: `${transferProgress}%` }}></div>
                                    </div>
                                    <div className="stats mt-2 flex-row w-full justify-between">
                                        <span className="text-sm">{Math.round(transferProgress)}%</span>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <CheckCircle size={48} className="text-success mb-2" />
                                    <h3>Sent Successfully</h3>
                                    <p className="subtitle mt-2">You can send another file.</p>
                                </>
                            )}
                        </div>
                    ) : (
                        <div 
                            className={`drag-drop-zone ${dragActive ? 'active' : ''}`}
                            onDragEnter={handleDrag}
                            onDragLeave={handleDrag}
                            onDragOver={handleDrag}
                            onDrop={handleDrop}
                            onClick={onButtonClick}
                        >
                            <input 
                                ref={inputRef} 
                                type="file" 
                                className="hidden-input" 
                                onChange={handleChange} 
                            />
                            <UploadCloud size={48} className="mb-2 text-primary" />
                            <h3>Select a File</h3>
                            <p className="subtitle">or drag and drop here</p>
                        </div>
                    )}
                </>
            )}

            <div className="received-files-panel">
                <div className="panel-heading">
                    <h3>Received Files</h3>
                    <span>{receivedFiles.length}</span>
                </div>

                {receivedFiles.length === 0 ? (
                    <p className="subtitle panel-empty">No received files yet</p>
                ) : (
                    <div className="received-files-list">
                        {receivedFiles.map((file) => (
                            <div className="received-file-row" key={file.id}>
                                <File size={18} className="text-accent" />
                                <div className="received-file-info">
                                    <p className="received-file-name">{file.name}</p>
                                    <p className="received-file-meta">
                                        {formatBytes(file.size)} - {file.status === 'complete' ? 'Complete' : `Receiving ${Math.round(file.progress)}%`}
                                    </p>
                                    <div className="mini-progress-container">
                                        <div className="mini-progress-bar" style={{ width: `${file.progress}%` }}></div>
                                    </div>
                                </div>
                                <button
                                    className="btn-icon"
                                    onClick={() => handleDownload(file)}
                                    disabled={file.status !== 'complete' || !file.blob}
                                    title="Download"
                                >
                                    <Download size={18} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
