import React, { useEffect, useRef, useState } from 'react';
import ConnectionManager from './components/ConnectionManager';
import Dashboard from './pages/Dashboard';
import type {
  SSHProfile, SystemInfo, Vlan, Port, AuditLogEntry,
  CreateVlanCommand, AddPortToVlanCommand, RemovePortFromVlanCommand, ConfigurePortCommand,
  SetVlanIpCommand, FirmwareFileInfo, FirmwareUploadResult, FirmwareProgress,
} from '@types/ipc';

declare global {
  interface Window {
    ipc: {
      // SSH
      sshConnect: (p: SSHProfile) => Promise<void>;
      sshDisconnect: () => Promise<void>;
      sshIsConnected: () => Promise<boolean>;
      sshExecute: (cmd: string) => Promise<string>;
      // Profiles
      profileList: () => Promise<SSHProfile[]>;
      profileSave: (p: SSHProfile) => Promise<SSHProfile>;
      profileDelete: (id: string) => Promise<void>;
      profileGet: (id: string) => Promise<SSHProfile | null>;
      // Switch queries
      switchGetSystemInfo: () => Promise<SystemInfo>;
      switchGetVlans: () => Promise<Vlan[]>;
      switchGetVlanDetail: (vlanId: number) => Promise<Vlan>;
      switchGetPorts: () => Promise<Port[]>;
      switchGetPortDetails: (portId: string) => Promise<Partial<Port>>;
      switchGetRunningConfig: () => Promise<string>;
      switchGetSpanningTree: () => Promise<string>;
      switchGetLldpNeighbors: () => Promise<string>;
      // VLAN commands
      switchCreateVlan: (data: CreateVlanCommand) => Promise<void>;
      switchDeleteVlan: (vlanId: number) => Promise<void>;
      switchRenameVlan: (data: { vlanId: number; name: string }) => Promise<void>;
      switchSetVlanIp: (cmd: SetVlanIpCommand) => Promise<void>;
      switchAddPortToVlan: (cmd: AddPortToVlanCommand) => Promise<void>;
      switchRemovePortFromVlan: (cmd: RemovePortFromVlanCommand) => Promise<void>;
      // Port commands
      switchConfigurePort: (cmd: ConfigurePortCommand) => Promise<void>;
      // System
      switchSetSystemName: (name: string) => Promise<void>;
      switchSetSystemContact: (contact: string) => Promise<void>;
      switchSetDefaultGateway: (gateway: string) => Promise<void>;
      switchSetManagementVlan: (vlanId: number | null) => Promise<void>;
      switchSaveConfig: () => Promise<string>;
      // Firmware
      switchSelectFirmwareFile: () => Promise<FirmwareFileInfo | null>;
      switchUploadFirmware: (filePath: string) => Promise<FirmwareUploadResult>;
      switchActivateFirmwareBank: () => Promise<string>;
      onFirmwareProgress: (cb: (p: FirmwareProgress) => void) => void;
      removeFirmwareProgressListener: () => void;
      // Audit
      auditList: (profileId?: string) => Promise<AuditLogEntry[]>;
      auditClear: (profileId?: string) => Promise<void>;
      // Events
      onSshConnected: (cb: (data: any) => void) => void;
      onSshDisconnected: (cb: () => void) => void;
      onSshError: (cb: (err: string) => void) => void;
      onSshLog: (cb: (line: string) => void) => void;
      removeSshConnectedListener: () => void;
      removeSshDisconnectedListener: () => void;
      removeSshErrorListener: () => void;
      removeSshLogListener: () => void;
      // Window controls
      minimize: () => Promise<void>;
      maximize: () => Promise<void>;
      unmaximize: () => Promise<void>;
      closeWindow: () => Promise<void>;
      isWindowMaximized: () => Promise<boolean>;
      onWindowMaximized: (cb: () => void) => void;
      onWindowUnmaximized: (cb: () => void) => void;

      platform: string;
    };
  }
}

export default function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [currentProfile, setCurrentProfile] = useState<SSHProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);

  const [logLines, setLogLines] = useState<string[]>([]);
  const [logWidth, setLogWidth] = useState(280);
  const logResizing = useRef(false);
  const logBodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.ipc?.sshIsConnected().then(setIsConnected).catch(() => {});

    window.ipc?.onSshConnected(() => { setIsConnected(true); setError(null); });
    window.ipc?.onSshDisconnected(() => { setIsConnected(false); setCurrentProfile(null); });
    window.ipc?.onSshError(setError);
    window.ipc?.onSshLog((line: string) => {
      setLogLines(prev => (prev.length >= 1000 ? [...prev.slice(-999), line] : [...prev, line]));
    });

    // Window events
    if (typeof window.ipc?.isWindowMaximized === 'function') {
      window.ipc.isWindowMaximized().then(setIsMaximized).catch(() => {});
    } else {
      setIsMaximized(false);
    }
    window.ipc?.onWindowMaximized?.(() => setIsMaximized(true));
    window.ipc?.onWindowUnmaximized?.(() => setIsMaximized(false));

    return () => {
      window.ipc?.removeSshConnectedListener();
      window.ipc?.removeSshDisconnectedListener();
      window.ipc?.removeSshErrorListener();
      window.ipc?.removeSshLogListener();
      // No remove listeners for window events (rarely needed) - fine for now
    };
  }, []);

  // Auto-scroll the SSH log to the newest line as it grows.
  useEffect(() => {
    const el = logBodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logLines]);

  const startLogResize = (e: React.MouseEvent) => {
    e.preventDefault();
    logResizing.current = true;
    const onMove = (ev: MouseEvent) => {
      if (!logResizing.current) return;
      const newWidth = window.innerWidth - ev.clientX;
      setLogWidth(Math.min(Math.max(newWidth, 160), Math.round(window.innerWidth * 0.6)));
    };
    const onUp = () => {
      logResizing.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const handleDisconnect = async () => {
    await window.ipc?.sshDisconnect();
  };

  const handleMinimize = () => { window.ipc?.minimize(); };
  const handleMaximizeRestore = async () => {
    const maximized = await window.ipc?.isWindowMaximized();
    if (maximized) window.ipc?.unmaximize();
    else window.ipc?.maximize();
  };
  const handleClose = () => { window.ipc?.closeWindow(); };

  const isMac = window.ipc?.platform === 'darwin';

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#1f2228' }}>
      {/* Header */}
      <div style={{
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        padding: isMac ? '0 24px 0 120px' : '0 24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        height: 52,
        flexShrink: 0,
        WebkitAppRegion: 'none' as any,
      }}>
        <span style={{ fontFamily: 'Geist Mono, monospace', fontSize: '13px', fontWeight: 400, color: '#ffffff', textTransform: 'uppercase', letterSpacing: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 1, minWidth: 0 }}>
          ProCurve Manager
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16, WebkitAppRegion: 'no-drag' as any, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flexGrow: 1 }}>
            {isConnected && currentProfile && (
              <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px', fontFamily: 'Geist Mono, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 1, minWidth: 0 }}>
                {currentProfile.username}@{currentProfile.host}:{currentProfile.port}
              </span>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: isConnected ? '#10b981' : '#6b7280' }} />
              <span style={{ color: isConnected ? '#10b981' : '#6b7280', fontSize: '11px', fontFamily: 'Geist Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.8px', whiteSpace: 'nowrap' }}>
                {isConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            {isConnected && (
              <button
                onClick={handleDisconnect}
                style={{
                  padding: '4px 12px',
                  backgroundColor: 'transparent',
                  border: '1px solid rgba(255,255,255,0.15)',
                  color: 'rgba(255,255,255,0.5)',
                  fontFamily: 'Geist Mono, monospace',
                  fontSize: '10px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.8px',
                  cursor: 'pointer',
                  borderRadius: 0,
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                Disconnect
              </button>
            )}
          </div>

          {/* native window controls are used, so hide custom buttons */}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{ padding: '8px 24px', backgroundColor: 'rgba(239,68,68,0.1)', borderBottom: '1px solid rgba(239,68,68,0.2)', color: '#fca5a5', fontSize: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          {error}
          <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', fontSize: '14px' }}>✕</button>
        </div>
      )}

      {/* Main */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', minWidth: 0 }}>
          {!isConnected ? (
            <ConnectionManager onConnected={p => { setCurrentProfile(p); setIsConnected(true); }} />
          ) : (
            <Dashboard profile={currentProfile} />
          )}
        </div>

        {/* SSH log resizer */}
        <div
          onMouseDown={startLogResize}
          title="Drag to resize"
          style={{ width: 4, flexShrink: 0, cursor: 'col-resize', backgroundColor: 'rgba(255,255,255,0.08)' }}
        />

        {/* SSH log panel */}
        <div style={{ width: logWidth, flexShrink: 0, display: 'flex', flexDirection: 'column', backgroundColor: '#16181b', borderLeft: '1px solid rgba(255,255,255,0.1)' }}>
          <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
            <span style={{ fontFamily: 'Geist Mono, monospace', fontSize: '11px', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '1px' }}>
              SSH Log
            </span>
            <button
              onClick={() => setLogLines([])}
              style={{ background: 'none', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.5)', fontFamily: 'Geist Mono, monospace', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.6px', padding: '2px 8px', cursor: 'pointer' }}
            >
              Clear
            </button>
          </div>
          <div ref={logBodyRef} style={{ flex: 1, overflow: 'auto', padding: '8px 10px' }}>
            {logLines.length === 0 ? (
              <div style={{ color: 'rgba(255,255,255,0.25)', fontSize: '11px', fontFamily: 'Geist Mono, monospace' }}>No SSH activity yet.</div>
            ) : logLines.map((line, i) => (
              <div key={i} style={{ fontFamily: 'Geist Mono, monospace', fontSize: '10px', color: 'rgba(255,255,255,0.55)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginBottom: 2 }}>
                {line}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
