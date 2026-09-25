import React, { useState, useEffect } from 'react';
import type { SSHProfile, SystemInfo, Vlan, Port } from '@types/ipc';
import VlansTab from './VlansTab';
import PortsTab from './PortsTab';
import SystemTab from './SystemTab';
import TerminalTab from './TerminalTab';
import AuditTab from './AuditTab';
import SwitchCatalogBadge from '../components/SwitchCatalogBadge';

type Tab = 'overview' | 'ports' | 'vlans' | 'system' | 'terminal' | 'audit';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'ports', label: 'Ports' },
  { id: 'vlans', label: 'VLANs' },
  { id: 'system', label: 'System' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'audit', label: 'Audit Log' },
];

interface Props {
  profile: SSHProfile | null;
}

export default function Dashboard({ profile }: Props) {
  const [tab, setTab] = useState<Tab>('overview');
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [vlans, setVlans] = useState<Vlan[]>([]);
  const [ports, setPorts] = useState<Port[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [info, vlanList, portList] = await Promise.all([
        window.ipc.switchGetSystemInfo(),
        window.ipc.switchGetVlans(),
        window.ipc.switchGetPorts(),
      ]);
      setSystemInfo(info);
      setVlans(vlanList);
      setPorts(portList);
    } catch (e: any) {
      setError(`Failed to load switch data: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  const loadPorts = async () => {
    try { setPorts(await window.ipc.switchGetPorts()); } catch {}
  };

  const loadVlans = async () => {
    try { setVlans(await window.ipc.switchGetVlans()); } catch {}
  };

  const loadSystemInfo = async () => {
    try { setSystemInfo(await window.ipc.switchGetSystemInfo()); } catch {}
  };

  const upPorts = ports.filter(p => p.status === 'up' && p.enabled).length;
  const memPct = systemInfo?.memoryUsagePercent ?? 0;
  const memColor = memPct > 80 ? '#ef4444' : memPct > 60 ? '#f59e0b' : '#10b981';

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: '#1f2228', overflow: 'hidden' }}>
      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.1)', padding: '0 24px', flexShrink: 0, overflowX: 'auto' }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '14px 18px',
              backgroundColor: 'transparent',
              border: 'none',
              borderBottom: tab === t.id ? '2px solid #ffffff' : '2px solid transparent',
              color: tab === t.id ? '#ffffff' : 'rgba(255,255,255,0.4)',
              fontFamily: 'Geist Mono, monospace',
              fontSize: '11px',
              textTransform: 'uppercase',
              letterSpacing: '1px',
              cursor: 'pointer',
              transition: 'color 0.15s',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {t.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          onClick={loadAll}
          disabled={loading}
          style={{
            margin: '8px 0',
            padding: '4px 14px',
            backgroundColor: 'transparent',
            border: '1px solid rgba(255,255,255,0.15)',
            color: 'rgba(255,255,255,0.5)',
            fontFamily: 'Geist Mono, monospace',
            fontSize: '10px',
            textTransform: 'uppercase',
            letterSpacing: '1px',
            cursor: loading ? 'wait' : 'pointer',
            opacity: loading ? 0.4 : 1,
            borderRadius: 0,
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {loading ? '…' : '↺ Refresh'}
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{ padding: '10px 24px', backgroundColor: 'rgba(239,68,68,0.1)', borderBottom: '1px solid rgba(239,68,68,0.2)', color: '#fca5a5', fontSize: '12px', flexShrink: 0 }}>
          {error}
          <button onClick={() => setError(null)} style={{ marginLeft: 12, background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer' }}>✕</button>
        </div>
      )}

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {tab === 'overview' && (
          <div style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
            {loading ? (
              <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '13px' }}>Loading switch data…</div>
            ) : systemInfo ? (
              <>
                {/* Summary cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 32 }}>
                  {/* Ports up */}
                  <div style={{ padding: '20px', border: '1px solid rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.02)' }}>
                    <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px', fontFamily: 'Geist Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>Ports Active</div>
                    <div style={{ color: '#10b981', fontSize: '32px', fontFamily: 'Geist Mono, monospace', fontWeight: 300, lineHeight: 1 }}>{upPorts}</div>
                    <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: '12px', marginTop: 4 }}>of {ports.length} total</div>
                  </div>

                  {/* VLANs */}
                  <div style={{ padding: '20px', border: '1px solid rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.02)' }}>
                    <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px', fontFamily: 'Geist Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>VLANs</div>
                    <div style={{ color: '#ffffff', fontSize: '32px', fontFamily: 'Geist Mono, monospace', fontWeight: 300, lineHeight: 1 }}>{vlans.length}</div>
                    <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: '12px', marginTop: 4 }}>configured</div>
                  </div>

                  {/* Memory */}
                  <div style={{ padding: '20px', border: '1px solid rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.02)' }}>
                    <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px', fontFamily: 'Geist Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>Memory</div>
                    <div style={{ color: memColor, fontSize: '32px', fontFamily: 'Geist Mono, monospace', fontWeight: 300, lineHeight: 1 }}>{memPct}%</div>
                    <div style={{ height: 3, backgroundColor: 'rgba(255,255,255,0.1)', marginTop: 8, marginBottom: 4 }}>
                      <div style={{ height: '100%', width: `${memPct}%`, backgroundColor: memColor }} />
                    </div>
                    <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: '11px' }}>
                      {(systemInfo.usedMemory / 1024).toFixed(0)} / {(systemInfo.totalMemory / 1024).toFixed(0)} KB
                    </div>
                  </div>

                  {/* Uptime */}
                  <div style={{ padding: '20px', border: '1px solid rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.02)' }}>
                    <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px', fontFamily: 'Geist Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>Uptime</div>
                    <div style={{ color: '#ffffff', fontSize: '14px', lineHeight: 1.4 }}>{systemInfo.systemUptime}</div>
                  </div>
                </div>

                {systemInfo.catalog && <SwitchCatalogBadge catalog={systemInfo.catalog} />}

                {/* System details */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 32 }}>
                  <div style={{ padding: '20px', border: '1px solid rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.02)' }}>
                    <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px', fontFamily: 'Geist Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 16 }}>System</div>
                    {[
                      ['Name', systemInfo.systemName],
                      ['Contact', systemInfo.systemContact || '—'],
                      ['Model', systemInfo.model],
                      ['Firmware', systemInfo.firmwareVersion],
                    ].map(([k, v]) => (
                      <div key={k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                        <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '12px', fontFamily: 'Geist Mono, monospace' }}>{k}</span>
                        <span style={{ color: '#ffffff', fontSize: '12px' }}>{v}</span>
                      </div>
                    ))}
                  </div>

                  {/* Port status mini grid */}
                  <div style={{ padding: '20px', border: '1px solid rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.02)' }}>
                    <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px', fontFamily: 'Geist Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 12 }}>Port Map</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 4 }}>
                      {ports.map(p => (
                        <div
                          key={p.id}
                          title={`Port ${p.id}: ${!p.enabled ? 'Disabled' : p.status === 'up' ? `Up ${p.speed}` : 'Down'}`}
                          style={{
                            aspectRatio: '1',
                            backgroundColor: !p.enabled ? 'rgba(255,255,255,0.05)' : p.status === 'up' ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.2)',
                            border: `1px solid ${!p.enabled ? 'rgba(255,255,255,0.05)' : p.status === 'up' ? '#10b981' : '#ef4444'}`,
                            cursor: 'pointer',
                          }}
                          onClick={() => setTab('ports')}
                        />
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
                      {[
                        { color: '#10b981', label: 'Up' },
                        { color: '#ef4444', label: 'Down' },
                        { color: 'rgba(255,255,255,0.15)', label: 'Disabled' },
                      ].map(({ color, label }) => (
                        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <div style={{ width: 8, height: 8, backgroundColor: color }} />
                          <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)' }}>{label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* VLAN list preview */}
                <div style={{ padding: '20px', border: '1px solid rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.02)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px', fontFamily: 'Geist Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.8px' }}>VLANs</div>
                    <button
                      onClick={() => setTab('vlans')}
                      style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: '11px', fontFamily: 'Geist Mono, monospace', cursor: 'pointer', textDecoration: 'underline' }}
                    >
                      Manage →
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {vlans.map(v => (
                      <div key={v.id} style={{ padding: '4px 10px', border: '1px solid rgba(255,255,255,0.15)', backgroundColor: 'rgba(255,255,255,0.03)', fontSize: '12px', fontFamily: 'Geist Mono, monospace' }}>
                        <span style={{ color: 'rgba(255,255,255,0.4)', marginRight: 6 }}>{v.id}</span>
                        <span style={{ color: '#ffffff' }}>{v.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: '14px' }}>No data available. Click Refresh.</div>
            )}
          </div>
        )}

        {tab === 'ports' && (
          <PortsTab ports={ports} onRefresh={loadPorts} />
        )}

        {tab === 'vlans' && (
          <VlansTab vlans={vlans} onRefresh={loadVlans} />
        )}

        {tab === 'system' && (
          <SystemTab systemInfo={systemInfo} vlans={vlans} onRefresh={loadSystemInfo} />
        )}

        {tab === 'terminal' && <TerminalTab />}

        {tab === 'audit' && <AuditTab />}
      </div>
    </div>
  );
}
