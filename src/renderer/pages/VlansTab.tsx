import React, { useState, useEffect } from 'react';
import type { Vlan } from '@types/ipc';

const S = {
  btn: (variant: 'primary' | 'ghost' | 'danger' = 'ghost', disabled = false): React.CSSProperties => ({
    padding: '6px 14px',
    backgroundColor: variant === 'primary' ? '#ffffff' : variant === 'danger' ? 'rgba(239,68,68,0.1)' : 'transparent',
    color: variant === 'primary' ? '#1f2228' : variant === 'danger' ? '#fca5a5' : '#ffffff',
    border: `1px solid ${variant === 'primary' ? '#ffffff' : variant === 'danger' ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.2)'}`,
    fontFamily: 'Geist Mono, monospace',
    fontSize: '11px',
    textTransform: 'uppercase' as const,
    letterSpacing: '1px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    borderRadius: 0,
    whiteSpace: 'nowrap',
    flexShrink: 0,
  }),
  input: (): React.CSSProperties => ({
    width: '100%',
    padding: '8px 10px',
    backgroundColor: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.2)',
    color: '#ffffff',
    fontSize: '13px',
    borderRadius: 0,
    outline: 'none',
    boxSizing: 'border-box' as const,
  }),
  label: (): React.CSSProperties => ({
    display: 'block',
    marginBottom: '6px',
    color: 'rgba(255,255,255,0.6)',
    fontSize: '11px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.8px',
    fontFamily: 'Geist Mono, monospace',
  }),
};

interface Props {
  vlans: Vlan[];
  onRefresh: () => void;
}

export default function VlansTab({ vlans, onRefresh }: Props) {
  const [selectedVlan, setSelectedVlan] = useState<Vlan | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showPortModal, setShowPortModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Create form
  const [newVlanId, setNewVlanId] = useState('');
  const [newVlanName, setNewVlanName] = useState('');

  // Rename form
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');

  // Port assignment form
  const [portInput, setPortInput] = useState('');
  const [portTagged, setPortTagged] = useState(false);
  const [removePortInput, setRemovePortInput] = useState('');

  // IP config form
  const [editingIp, setEditingIp] = useState(false);
  const [ipMode, setIpMode] = useState<'manual' | 'dhcp' | 'disabled'>('manual');
  const [ipAddress, setIpAddress] = useState('');
  const [subnetMask, setSubnetMask] = useState('');

  // Detail view
  const [detailVlan, setDetailVlan] = useState<Vlan | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const flash = (msg: string, isError = false) => {
    if (isError) { setError(msg); setTimeout(() => setError(null), 4000); }
    else { setSuccess(msg); setTimeout(() => setSuccess(null), 3000); }
  };

  const loadDetail = async (vlan: Vlan) => {
    setSelectedVlan(vlan);
    setDetailLoading(true);
    setDetailVlan(null);
    try {
      const d = await window.ipc.switchGetVlanDetail(vlan.id);
      setDetailVlan(d);
    } catch { setDetailVlan(vlan); }
    finally { setDetailLoading(false); }
  };

  const handleCreate = async () => {
    const id = parseInt(newVlanId, 10);
    if (!id || id < 1 || id > 4094) return flash('VLAN ID must be 1–4094', true);
    if (!newVlanName.trim()) return flash('VLAN name required', true);
    if (vlans.find(v => v.id === id)) return flash(`VLAN ${id} already exists`, true);

    setLoading(true);
    try {
      await window.ipc.switchCreateVlan({ vlanId: id, name: newVlanName.trim() });
      setShowCreateModal(false);
      setNewVlanId('');
      setNewVlanName('');
      flash(`VLAN ${id} created`);
      onRefresh();
    } catch (e: any) {
      flash(String(e), true);
    } finally { setLoading(false); }
  };

  const handleDelete = async (vlan: Vlan) => {
    if (!confirm(`Delete VLAN ${vlan.id} (${vlan.name})?`)) return;
    setLoading(true);
    try {
      await window.ipc.switchDeleteVlan(vlan.id);
      if (selectedVlan?.id === vlan.id) { setSelectedVlan(null); setDetailVlan(null); }
      flash(`VLAN ${vlan.id} deleted`);
      onRefresh();
    } catch (e: any) {
      flash(String(e), true);
    } finally { setLoading(false); }
  };

  const handleRename = async () => {
    if (!selectedVlan || !editName.trim()) return;
    setLoading(true);
    try {
      await window.ipc.switchRenameVlan({ vlanId: selectedVlan.id, name: editName.trim() });
      setEditing(false);
      flash(`VLAN ${selectedVlan.id} renamed`);
      onRefresh();
    } catch (e: any) {
      flash(String(e), true);
    } finally { setLoading(false); }
  };

  const handleAddPort = async () => {
    if (!selectedVlan || !portInput.trim()) return;
    const ports = portInput.split(',').map(p => p.trim()).filter(Boolean);
    setLoading(true);
    try {
      await window.ipc.switchAddPortToVlan({ vlanId: selectedVlan.id, ports, tagged: portTagged });
      setPortInput('');
      flash(`Port(s) added to VLAN ${selectedVlan.id}`);
      loadDetail(selectedVlan);
    } catch (e: any) {
      flash(String(e), true);
    } finally { setLoading(false); }
  };

  const handleSetIp = async () => {
    if (!selectedVlan) return;
    if (ipMode === 'manual' && (!ipAddress.trim() || !subnetMask.trim())) {
      return flash('IP address and subnet mask required', true);
    }
    setLoading(true);
    try {
      await window.ipc.switchSetVlanIp({
        vlanId: selectedVlan.id,
        mode: ipMode,
        ipAddress: ipMode === 'manual' ? ipAddress.trim() : undefined,
        subnetMask: ipMode === 'manual' ? subnetMask.trim() : undefined,
      });
      setEditingIp(false);
      flash(`VLAN ${selectedVlan.id} IP configuration updated`);
      loadDetail(selectedVlan);
    } catch (e: any) {
      flash(String(e), true);
    } finally { setLoading(false); }
  };

  const handleRemovePort = async () => {
    if (!selectedVlan || !removePortInput.trim()) return;
    const ports = removePortInput.split(',').map(p => p.trim()).filter(Boolean);
    setLoading(true);
    try {
      await window.ipc.switchRemovePortFromVlan({ vlanId: selectedVlan.id, ports });
      setRemovePortInput('');
      flash(`Port(s) removed from VLAN ${selectedVlan.id}`);
      loadDetail(selectedVlan);
    } catch (e: any) {
      flash(String(e), true);
    } finally { setLoading(false); }
  };

  const Tag = ({ children, color = 'rgba(255,255,255,0.1)' }: { children: React.ReactNode; color?: string }) => (
    <span style={{ padding: '2px 6px', backgroundColor: color, border: '1px solid rgba(255,255,255,0.15)', fontSize: '11px', fontFamily: 'Geist Mono, monospace', marginRight: 4, marginBottom: 4, display: 'inline-block' }}>
      {children}
    </span>
  );

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* VLAN list */}
      <div style={{ width: 300, borderRight: '1px solid rgba(255,255,255,0.1)', display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 }}>
        <div style={{ padding: '16px', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontFamily: 'Geist Mono, monospace', fontSize: '11px', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '1px' }}>
            {vlans.length} VLANs
          </span>
          <button style={S.btn('primary')} onClick={() => setShowCreateModal(true)}>+ Create</button>
        </div>

        <div style={{ flex: 1, overflow: 'auto' }}>
          {vlans.length === 0 ? (
            <div style={{ padding: '24px', color: 'rgba(255,255,255,0.3)', fontSize: '13px', textAlign: 'center' }}>No VLANs found</div>
          ) : vlans.map(v => (
            <div
              key={v.id}
              onClick={() => loadDetail(v)}
              style={{
                padding: '12px 16px',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                cursor: 'pointer',
                backgroundColor: selectedVlan?.id === v.id ? 'rgba(255,255,255,0.08)' : 'transparent',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ color: '#ffffff', fontSize: '13px', marginBottom: 2 }}>
                  <span style={{ fontFamily: 'Geist Mono, monospace', color: 'rgba(255,255,255,0.5)', marginRight: 8 }}>{v.id}</span>
                  {v.name}
                </div>
                <div style={{ color: v.status === 'active' ? '#10b981' : 'rgba(255,255,255,0.3)', fontSize: '11px' }}>
                  {v.status}
                </div>
              </div>
              {v.id !== 1 && (
                <button
                  style={{ ...S.btn('danger'), padding: '3px 8px', fontSize: '10px' }}
                  onClick={e => { e.stopPropagation(); handleDelete(v); }}
                >✕</button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* VLAN detail */}
      <div style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
        {/* Notifications */}
        {error && <div style={{ marginBottom: 16, padding: '10px 14px', backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#fca5a5', fontSize: '12px' }}>{error}</div>}
        {success && <div style={{ marginBottom: 16, padding: '10px 14px', backgroundColor: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)', color: '#6ee7b7', fontSize: '12px' }}>{success}</div>}

        {!selectedVlan ? (
          <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: '14px', textAlign: 'center', marginTop: 60 }}>
            Select a VLAN to view details
          </div>
        ) : (
          <>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
              <div>
                {editing ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      style={{ ...S.input(), width: 200 }}
                      onKeyDown={e => e.key === 'Enter' && handleRename()}
                      autoFocus
                    />
                    <button style={S.btn('primary', loading)} onClick={handleRename} disabled={loading}>Save</button>
                    <button style={S.btn()} onClick={() => setEditing(false)}>Cancel</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <h2 style={{ fontFamily: 'Geist Mono, monospace', fontSize: '20px', fontWeight: 300, color: '#ffffff', margin: 0 }}>
                      VLAN {selectedVlan.id} — {detailVlan?.name || selectedVlan.name}
                    </h2>
                    {selectedVlan.id !== 1 && (
                      <button style={{ ...S.btn(), fontSize: '10px', padding: '3px 8px' }} onClick={() => { setEditName(detailVlan?.name || selectedVlan.name); setEditing(true); }}>
                        Rename
                      </button>
                    )}
                  </div>
                )}
                <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '12px', marginTop: 4 }}>
                  Status: <span style={{ color: selectedVlan.status === 'active' ? '#10b981' : '#6b7280' }}>{selectedVlan.status}</span>
                </div>
              </div>
            </div>

            {detailLoading ? (
              <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '13px' }}>Loading port details…</div>
            ) : detailVlan && (
              <>
                {/* IP configuration */}
                <div style={{ padding: '16px', border: '1px solid rgba(255,255,255,0.1)', marginBottom: 24 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: editingIp ? 12 : 0 }}>
                    <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '11px', fontFamily: 'Geist Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                      IP Configuration
                    </div>
                    {!editingIp && (
                      <button
                        style={{ ...S.btn(), fontSize: '10px', padding: '3px 8px' }}
                        onClick={() => {
                          const mode = detailVlan.ipConfig === 'DHCP/Bootp' ? 'dhcp' : detailVlan.ipConfig === 'Manual' ? 'manual' : 'disabled';
                          setIpMode(mode);
                          setIpAddress(detailVlan.ipAddress || '');
                          setSubnetMask(detailVlan.subnetMask || '');
                          setEditingIp(true);
                        }}
                      >
                        Edit
                      </button>
                    )}
                  </div>

                  {!editingIp ? (
                    <div style={{ fontSize: '13px', color: '#ffffff', marginTop: 8 }}>
                      {detailVlan.ipConfig === 'Manual'
                        ? `${detailVlan.ipAddress} / ${detailVlan.subnetMask}`
                        : detailVlan.ipConfig || '—'}
                    </div>
                  ) : (
                    <div>
                      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                        {(['manual', 'dhcp', 'disabled'] as const).map(m => (
                          <button key={m} style={{ ...S.btn(ipMode === m ? 'primary' : 'ghost'), fontSize: '11px' }} onClick={() => setIpMode(m)}>
                            {m === 'manual' ? 'Manual' : m === 'dhcp' ? 'DHCP/Bootp' : 'Disabled'}
                          </button>
                        ))}
                      </div>
                      {ipMode === 'manual' && (
                        <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                          <div style={{ flex: 1 }}>
                            <label style={S.label()}>IP Address</label>
                            <input value={ipAddress} onChange={e => setIpAddress(e.target.value)} style={S.input()} placeholder="192.168.1.10" />
                          </div>
                          <div style={{ flex: 1 }}>
                            <label style={S.label()}>Subnet Mask</label>
                            <input value={subnetMask} onChange={e => setSubnetMask(e.target.value)} style={S.input()} placeholder="255.255.255.0" />
                          </div>
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button style={S.btn('primary', loading)} onClick={handleSetIp} disabled={loading}>Save</button>
                        <button style={S.btn()} onClick={() => setEditingIp(false)}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Port membership */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
                  <div style={{ padding: '16px', border: '1px solid rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.02)' }}>
                    <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '11px', fontFamily: 'Geist Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 10 }}>
                      Untagged Ports ({detailVlan.ports.untagged.length})
                    </div>
                    <div>
                      {detailVlan.ports.untagged.length === 0
                        ? <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '12px' }}>None</span>
                        : detailVlan.ports.untagged.map(p => <Tag key={p}>{p}</Tag>)}
                    </div>
                  </div>
                  <div style={{ padding: '16px', border: '1px solid rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.02)' }}>
                    <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '11px', fontFamily: 'Geist Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 10 }}>
                      Tagged Ports ({detailVlan.ports.tagged.length})
                    </div>
                    <div>
                      {detailVlan.ports.tagged.length === 0
                        ? <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '12px' }}>None</span>
                        : detailVlan.ports.tagged.map(p => <Tag key={p} color="rgba(59,130,246,0.15)">{p}</Tag>)}
                    </div>
                  </div>
                </div>

                {/* Add port form */}
                <div style={{ padding: '16px', border: '1px solid rgba(255,255,255,0.1)', marginBottom: 16 }}>
                  <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '11px', fontFamily: 'Geist Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 12 }}>
                    Add Ports to VLAN
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 150 }}>
                      <label style={S.label()}>Port(s) — e.g. 1,3,5-7</label>
                      <input value={portInput} onChange={e => setPortInput(e.target.value)} style={S.input()} placeholder="1,3,5-7" />
                    </div>
                    <div>
                      <label style={S.label()}>Mode</label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          style={{ ...S.btn(portTagged ? 'ghost' : 'primary'), fontSize: '11px' }}
                          onClick={() => setPortTagged(false)}
                        >Untagged</button>
                        <button
                          style={{ ...S.btn(portTagged ? 'primary' : 'ghost'), fontSize: '11px' }}
                          onClick={() => setPortTagged(true)}
                        >Tagged</button>
                      </div>
                    </div>
                    <button style={S.btn('primary', loading || !portInput.trim())} onClick={handleAddPort} disabled={loading || !portInput.trim()}>
                      Add
                    </button>
                  </div>
                </div>

                {/* Remove port form */}
                <div style={{ padding: '16px', border: '1px solid rgba(255,255,255,0.1)' }}>
                  <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '11px', fontFamily: 'Geist Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 12 }}>
                    Remove Ports from VLAN
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                    <div style={{ flex: 1 }}>
                      <label style={S.label()}>Port(s) — e.g. 1,3,5-7</label>
                      <input value={removePortInput} onChange={e => setRemovePortInput(e.target.value)} style={S.input()} placeholder="1,3,5-7" />
                    </div>
                    <button style={S.btn('danger', loading || !removePortInput.trim())} onClick={handleRemovePort} disabled={loading || !removePortInput.trim()}>
                      Remove
                    </button>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* Create VLAN modal */}
      {showCreateModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ width: 380, padding: '32px', backgroundColor: '#1f2228', border: '1px solid rgba(255,255,255,0.2)' }}>
            <h3 style={{ fontFamily: 'Geist Mono, monospace', fontSize: '16px', fontWeight: 300, color: '#ffffff', textTransform: 'uppercase', letterSpacing: '1.4px', marginTop: 0, marginBottom: 24 }}>
              Create VLAN
            </h3>
            <div style={{ marginBottom: 16 }}>
              <label style={S.label()}>VLAN ID (1–4094)</label>
              <input type="number" min={1} max={4094} value={newVlanId} onChange={e => setNewVlanId(e.target.value)} style={S.input()} placeholder="10" autoFocus />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={S.label()}>VLAN Name</label>
              <input value={newVlanName} onChange={e => setNewVlanName(e.target.value)} style={S.input()} placeholder="MANAGEMENT" onKeyDown={e => e.key === 'Enter' && handleCreate()} />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button style={S.btn('primary', loading)} onClick={handleCreate} disabled={loading}>
                {loading ? 'Creating…' : 'Create'}
              </button>
              <button style={S.btn()} onClick={() => setShowCreateModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
