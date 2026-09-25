import React, { useState, useEffect } from 'react';
import type { SystemInfo, Vlan, FirmwareFileInfo, FirmwareProgress } from '@types/ipc';
import SwitchCatalogBadge from '../components/SwitchCatalogBadge';

const S = {
  btn: (variant: 'primary' | 'ghost' | 'danger' = 'ghost', disabled = false): React.CSSProperties => ({
    padding: '8px 18px',
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
    padding: '9px 12px',
    backgroundColor: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.2)',
    color: '#ffffff',
    fontSize: '13px',
    borderRadius: 0,
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box' as const,
  }),
  label: (): React.CSSProperties => ({
    display: 'block',
    marginBottom: '6px',
    color: 'rgba(255,255,255,0.5)',
    fontSize: '11px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.8px',
    fontFamily: 'Geist Mono, monospace',
  }),
  row: (): React.CSSProperties => ({
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: '12px 0',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  }),
  key: (): React.CSSProperties => ({
    color: 'rgba(255,255,255,0.4)',
    fontSize: '12px',
    fontFamily: 'Geist Mono, monospace',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    flex: '0 0 180px',
  }),
  val: (): React.CSSProperties => ({
    color: '#ffffff',
    fontSize: '13px',
    textAlign: 'right' as const,
    flex: 1,
  }),
};

interface Props {
  systemInfo: SystemInfo | null;
  vlans: Vlan[];
  onRefresh: () => void;
}

export default function SystemTab({ systemInfo, vlans, onRefresh }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [editName, setEditName] = useState('');
  const [editContact, setEditContact] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [editingContact, setEditingContact] = useState(false);

  const [editGateway, setEditGateway] = useState('');
  const [editingGateway, setEditingGateway] = useState(false);
  const [editingMgmtVlan, setEditingMgmtVlan] = useState(false);
  const [mgmtVlanChoice, setMgmtVlanChoice] = useState('');

  // Quick Setup: pick a VLAN, set its IP+mask and the switch's gateway in one go.
  const [quickVlanId, setQuickVlanId] = useState('');
  const [quickIp, setQuickIp] = useState('');
  const [quickMask, setQuickMask] = useState('');
  const [quickGateway, setQuickGateway] = useState('');
  const [quickDetailLoading, setQuickDetailLoading] = useState(false);

  useEffect(() => {
    if (systemInfo?.defaultGateway && !quickGateway) setQuickGateway(systemInfo.defaultGateway);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemInfo?.defaultGateway]);

  const [runningConfig, setRunningConfig] = useState<string | null>(null);
  const [configLoading, setConfigLoading] = useState(false);

  // Firmware update — always targets the secondary flash bank; activating it
  // (the reboot) is a deliberately separate step from uploading.
  const [fwFile, setFwFile] = useState<FirmwareFileInfo | null>(null);
  const [fwUploading, setFwUploading] = useState(false);
  const [fwProgress, setFwProgress] = useState<FirmwareProgress | null>(null);
  const [fwActivating, setFwActivating] = useState(false);

  useEffect(() => {
    window.ipc.onFirmwareProgress((p) => setFwProgress(p));
    return () => { window.ipc.removeFirmwareProgressListener(); };
  }, []);

  const flash = (msg: string, isError = false) => {
    if (isError) { setError(msg); setTimeout(() => setError(null), 4000); }
    else { setSuccess(msg); setTimeout(() => setSuccess(null), 3000); }
  };

  const saveConfig = async () => {
    setLoading(true);
    try {
      await window.ipc.switchSaveConfig();
      flash('Configuration saved to startup (write memory)');
    } catch (e: any) { flash(String(e), true); }
    finally { setLoading(false); }
  };

  const pickFirmwareFile = async () => {
    try {
      const file = await window.ipc.switchSelectFirmwareFile();
      if (file) setFwFile(file);
    } catch (e: any) { flash(String(e), true); }
  };

  const uploadFirmware = async () => {
    if (!fwFile) return;
    if (!confirm(`Upload "${fwFile.name}" to the SECONDARY flash bank? This overwrites whatever is currently in secondary. Primary is left untouched.`)) return;
    setFwUploading(true);
    setFwProgress(null);
    try {
      const result = await window.ipc.switchUploadFirmware(fwFile.path);
      flash(`Uploaded to secondary${result.flash?.secondary.version ? `: ${result.flash.secondary.version}` : ''}`);
      setFwFile(null);
      onRefresh();
    } catch (e: any) {
      flash(String(e), true);
    } finally {
      setFwUploading(false);
      setFwProgress(null);
    }
  };

  const activateSecondary = async () => {
    if (!confirm('Reboot the switch from the SECONDARY flash bank now? The switch will be unreachable for about a minute while it reboots.')) return;
    setFwActivating(true);
    try {
      await window.ipc.switchActivateFirmwareBank();
      flash('Switch is rebooting into secondary — reconnect once it comes back up.');
    } catch (e: any) {
      flash(String(e), true);
    } finally {
      setFwActivating(false);
    }
  };

  const setSystemName = async () => {
    if (!editName.trim()) return;
    setLoading(true);
    try {
      await window.ipc.switchSetSystemName(editName.trim());
      setEditingName(false);
      flash('System name updated');
      onRefresh();
    } catch (e: any) { flash(String(e), true); }
    finally { setLoading(false); }
  };

  const setContact = async () => {
    setLoading(true);
    try {
      await window.ipc.switchSetSystemContact(editContact.trim());
      setEditingContact(false);
      flash('System contact updated');
      onRefresh();
    } catch (e: any) { flash(String(e), true); }
    finally { setLoading(false); }
  };

  const setGateway = async () => {
    if (!editGateway.trim()) return;
    setLoading(true);
    try {
      await window.ipc.switchSetDefaultGateway(editGateway.trim());
      setEditingGateway(false);
      flash('Default gateway updated');
      onRefresh();
    } catch (e: any) { flash(String(e), true); }
    finally { setLoading(false); }
  };

  const setManagementVlan = async (vlanId: number | null) => {
    setLoading(true);
    try {
      await window.ipc.switchSetManagementVlan(vlanId);
      setEditingMgmtVlan(false);
      flash(vlanId === null ? 'Management VLAN restriction disabled' : `Management VLAN set to ${vlanId}`);
      onRefresh();
    } catch (e: any) { flash(String(e), true); }
    finally { setLoading(false); }
  };

  const handleQuickVlanChange = async (vlanId: string) => {
    setQuickVlanId(vlanId);
    if (!vlanId) { setQuickIp(''); setQuickMask(''); return; }
    setQuickDetailLoading(true);
    try {
      const detail = await window.ipc.switchGetVlanDetail(parseInt(vlanId, 10));
      setQuickIp(detail.ipAddress || '');
      setQuickMask(detail.subnetMask || '');
    } catch {
      setQuickIp('');
      setQuickMask('');
    } finally { setQuickDetailLoading(false); }
  };

  const applyQuickSetup = async () => {
    if (!quickVlanId) return flash('Select a VLAN', true);
    if (!quickIp.trim() || !quickMask.trim()) return flash('IP address and subnet mask required', true);
    setLoading(true);
    try {
      await window.ipc.switchSetVlanIp({
        vlanId: parseInt(quickVlanId, 10),
        mode: 'manual',
        ipAddress: quickIp.trim(),
        subnetMask: quickMask.trim(),
      });
      if (quickGateway.trim()) {
        await window.ipc.switchSetDefaultGateway(quickGateway.trim());
      }
      flash(`VLAN ${quickVlanId} IP${quickGateway.trim() ? ' and gateway' : ''} updated`);
      onRefresh();
    } catch (e: any) {
      flash(String(e), true);
    } finally { setLoading(false); }
  };

  const loadRunningConfig = async () => {
    setConfigLoading(true);
    try {
      const cfg = await window.ipc.switchGetRunningConfig();
      setRunningConfig(cfg);
    } catch (e: any) { flash(String(e), true); }
    finally { setConfigLoading(false); }
  };

  const memPct = systemInfo?.memoryUsagePercent ?? 0;
  const memColor = memPct > 80 ? '#ef4444' : memPct > 60 ? '#f59e0b' : '#10b981';

  return (
    <div style={{ overflow: 'auto', padding: '32px', maxWidth: 800 }}>
      {error && <div style={{ marginBottom: 16, padding: '10px 14px', backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#fca5a5', fontSize: '12px' }}>{error}</div>}
      {success && <div style={{ marginBottom: 16, padding: '10px 14px', backgroundColor: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)', color: '#6ee7b7', fontSize: '12px' }}>{success}</div>}

      {!systemInfo ? (
        <div style={{ color: 'rgba(255,255,255,0.3)' }}>Loading system info…</div>
      ) : (
        <>
          {/* Hardware info */}
          <div style={{ marginBottom: 32 }}>
            <h3 style={{ fontFamily: 'Geist Mono, monospace', fontSize: '13px', fontWeight: 400, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '1.2px', marginBottom: 16, marginTop: 0 }}>Hardware</h3>
            <div style={{ border: '1px solid rgba(255,255,255,0.1)', padding: '0 16px' }}>
              {[
                ['Model', systemInfo.model],
                ['Serial Number', systemInfo.serialNumber],
                ['MAC Address', systemInfo.macAddress || '—'],
                ['Firmware', systemInfo.firmwareVersion],
                ['ROM Version', systemInfo.romVersion || '—'],
                ['Uptime', systemInfo.systemUptime],
                ...(systemInfo.flash ? [
                  ['Active Image', systemInfo.flash.currentBoot],
                  ['Primary Image', `${systemInfo.flash.primary.version}${systemInfo.flash.primary.date ? ` (${systemInfo.flash.primary.date})` : ''}`],
                  ['Secondary Image', `${systemInfo.flash.secondary.version}${systemInfo.flash.secondary.date ? ` (${systemInfo.flash.secondary.date})` : ''}`],
                ] as [string, string][] : []),
              ].map(([k, v]) => (
                <div key={k} style={S.row()}>
                  <span style={S.key()}>{k}</span>
                  <span style={S.val()}>{v}</span>
                </div>
              ))}
            </div>
          </div>

          {systemInfo.catalog && <SwitchCatalogBadge catalog={systemInfo.catalog} />}

          {/* Firmware update */}
          <div style={{ marginBottom: 32 }}>
            <h3 style={{ fontFamily: 'Geist Mono, monospace', fontSize: '13px', fontWeight: 400, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '1.2px', marginBottom: 16, marginTop: 0 }}>Firmware Update</h3>
            <div style={{ border: '1px solid rgba(255,255,255,0.1)', padding: '16px' }}>
              <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px', marginBottom: 14, lineHeight: 1.5 }}>
                Uploads always go to the <strong style={{ color: 'rgba(255,255,255,0.7)' }}>secondary</strong> flash bank over TFTP — primary is never touched. Activating (rebooting into secondary) is a separate step below.
              </div>

              {!fwFile ? (
                <button style={S.btn('ghost', fwUploading)} onClick={pickFirmwareFile} disabled={fwUploading}>
                  Choose Firmware File (.swi)
                </button>
              ) : (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: '13px', color: '#ffffff', marginBottom: 4 }}>{fwFile.name}</div>
                  <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>{(fwFile.size / 1024).toFixed(0)} KB</div>
                </div>
              )}

              {fwFile && (
                <div style={{ display: 'flex', gap: 10, marginBottom: fwUploading ? 14 : 0 }}>
                  <button style={S.btn('primary', fwUploading)} onClick={uploadFirmware} disabled={fwUploading}>
                    {fwUploading ? 'Uploading…' : 'Upload to Secondary'}
                  </button>
                  <button style={S.btn('ghost', fwUploading)} onClick={() => setFwFile(null)} disabled={fwUploading}>Cancel</button>
                </div>
              )}

              {fwUploading && fwProgress && (
                <div>
                  <div style={{ height: 4, backgroundColor: 'rgba(255,255,255,0.1)', marginBottom: 6 }}>
                    <div style={{ height: '100%', width: `${Math.round((fwProgress.bytesSent / fwProgress.totalBytes) * 100)}%`, backgroundColor: '#10b981', transition: 'width 0.2s' }} />
                  </div>
                  <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', fontFamily: 'Geist Mono, monospace' }}>
                    {(fwProgress.bytesSent / 1024).toFixed(0)} / {(fwProgress.totalBytes / 1024).toFixed(0)} KB
                  </div>
                </div>
              )}

              <div style={{ marginTop: 18, paddingTop: 18, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                <button style={S.btn('danger', fwActivating)} onClick={activateSecondary} disabled={fwActivating}>
                  {fwActivating ? 'Rebooting…' : 'Activate Secondary (Reboot)'}
                </button>
                {systemInfo.flash && (
                  <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', marginTop: 8 }}>
                    Secondary currently holds {systemInfo.flash.secondary.version}
                    {systemInfo.flash.secondary.date ? ` (${systemInfo.flash.secondary.date})` : ''}.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Resources */}
          <div style={{ marginBottom: 32 }}>
            <h3 style={{ fontFamily: 'Geist Mono, monospace', fontSize: '13px', fontWeight: 400, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '1.2px', marginBottom: 16, marginTop: 0 }}>Resources</h3>
            <div style={{ border: '1px solid rgba(255,255,255,0.1)', padding: '16px' }}>
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '12px', fontFamily: 'Geist Mono, monospace', textTransform: 'uppercase' }}>Memory</span>
                  <span style={{ color: memColor, fontSize: '12px', fontFamily: 'Geist Mono, monospace' }}>{memPct}%</span>
                </div>
                <div style={{ height: 4, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 0 }}>
                  <div style={{ height: '100%', width: `${memPct}%`, backgroundColor: memColor, transition: 'width 0.3s' }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                  <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '11px' }}>{(systemInfo.usedMemory / 1024).toFixed(0)} KB used</span>
                  <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '11px' }}>{(systemInfo.totalMemory / 1024).toFixed(0)} KB total</span>
                </div>
              </div>
              {systemInfo.cpuUsagePercent !== undefined && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '12px', fontFamily: 'Geist Mono, monospace', textTransform: 'uppercase' }}>CPU</span>
                    <span style={{ color: '#ffffff', fontSize: '12px', fontFamily: 'Geist Mono, monospace' }}>{systemInfo.cpuUsagePercent}%</span>
                  </div>
                  <div style={{ height: 4, backgroundColor: 'rgba(255,255,255,0.1)' }}>
                    <div style={{ height: '100%', width: `${systemInfo.cpuUsagePercent}%`, backgroundColor: '#3b82f6' }} />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Editable settings */}
          <div style={{ marginBottom: 32 }}>
            <h3 style={{ fontFamily: 'Geist Mono, monospace', fontSize: '13px', fontWeight: 400, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '1.2px', marginBottom: 16, marginTop: 0 }}>Settings</h3>
            <div style={{ border: '1px solid rgba(255,255,255,0.1)', padding: '16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* System Name */}
              <div>
                <label style={S.label()}>System Name</label>
                {editingName ? (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input value={editName} onChange={e => setEditName(e.target.value)} style={S.input()} onKeyDown={e => e.key === 'Enter' && setSystemName()} autoFocus />
                    <button style={S.btn('primary', loading)} onClick={setSystemName} disabled={loading}>Save</button>
                    <button style={S.btn()} onClick={() => setEditingName(false)}>Cancel</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: '#ffffff', fontSize: '14px' }}>{systemInfo.systemName}</span>
                    <button style={S.btn()} onClick={() => { setEditName(systemInfo.systemName); setEditingName(true); }}>Edit</button>
                  </div>
                )}
              </div>

              {/* System Contact */}
              <div>
                <label style={S.label()}>System Contact</label>
                {editingContact ? (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input value={editContact} onChange={e => setEditContact(e.target.value)} style={S.input()} onKeyDown={e => e.key === 'Enter' && setContact()} autoFocus />
                    <button style={S.btn('primary', loading)} onClick={setContact} disabled={loading}>Save</button>
                    <button style={S.btn()} onClick={() => setEditingContact(false)}>Cancel</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: '#ffffff', fontSize: '14px' }}>{systemInfo.systemContact || '—'}</span>
                    <button style={S.btn()} onClick={() => { setEditContact(systemInfo.systemContact || ''); setEditingContact(true); }}>Edit</button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Network */}
          <div style={{ marginBottom: 32 }}>
            <h3 style={{ fontFamily: 'Geist Mono, monospace', fontSize: '13px', fontWeight: 400, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '1.2px', marginBottom: 16, marginTop: 0 }}>Network</h3>
            <div style={{ border: '1px solid rgba(255,255,255,0.1)', padding: '16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Quick Setup */}
              <div style={{ padding: '14px', border: '1px solid rgba(255,255,255,0.12)', backgroundColor: 'rgba(255,255,255,0.02)' }}>
                <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '11px', fontFamily: 'Geist Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 12 }}>
                  Quick Setup
                </div>
                <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 160px' }}>
                    <label style={S.label()}>VLAN</label>
                    <select value={quickVlanId} onChange={e => handleQuickVlanChange(e.target.value)} style={{ ...S.input(), appearance: 'none' as any }}>
                      <option value="">— Select —</option>
                      {vlans.map(v => (
                        <option key={v.id} value={v.id}>VLAN {v.id} — {v.name}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ flex: '1 1 140px' }}>
                    <label style={S.label()}>IP Address</label>
                    <input value={quickIp} onChange={e => setQuickIp(e.target.value)} style={S.input()} placeholder="192.168.1.10" disabled={quickDetailLoading} />
                  </div>
                  <div style={{ flex: '1 1 140px' }}>
                    <label style={S.label()}>Subnet Mask</label>
                    <input value={quickMask} onChange={e => setQuickMask(e.target.value)} style={S.input()} placeholder="255.255.255.0" disabled={quickDetailLoading} />
                  </div>
                  <div style={{ flex: '1 1 140px' }}>
                    <label style={S.label()}>Gateway</label>
                    <input value={quickGateway} onChange={e => setQuickGateway(e.target.value)} style={S.input()} placeholder="192.168.1.1" />
                  </div>
                </div>
                <button style={S.btn('primary', loading || !quickVlanId)} onClick={applyQuickSetup} disabled={loading || !quickVlanId}>
                  {loading ? 'Applying…' : 'Apply'}
                </button>
                <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: '11px', marginTop: 8 }}>
                  Sets the IP/mask on the chosen VLAN and the switch's (single, global) default gateway together. For a switch with several VLANs each carrying their own IP, use the VLANs tab instead — this is for the common one-VLAN case.
                </div>
              </div>

              {/* Default Gateway */}
              <div>
                <label style={S.label()}>Default Gateway</label>
                {editingGateway ? (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input value={editGateway} onChange={e => setEditGateway(e.target.value)} style={S.input()} placeholder="192.168.1.1" onKeyDown={e => e.key === 'Enter' && setGateway()} autoFocus />
                    <button style={S.btn('primary', loading)} onClick={setGateway} disabled={loading}>Save</button>
                    <button style={S.btn()} onClick={() => setEditingGateway(false)}>Cancel</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: '#ffffff', fontSize: '14px' }}>{systemInfo.defaultGateway || '—'}</span>
                    <button style={S.btn()} onClick={() => { setEditGateway(systemInfo.defaultGateway || ''); setEditingGateway(true); }}>Edit</button>
                  </div>
                )}
              </div>

              {/* Management VLAN */}
              <div>
                <label style={S.label()}>Management VLAN</label>
                {editingMgmtVlan ? (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <select value={mgmtVlanChoice} onChange={e => setMgmtVlanChoice(e.target.value)} style={{ ...S.input(), appearance: 'none' as any }} autoFocus>
                      <option value="">— None (unrestricted) —</option>
                      {vlans.map(v => (
                        <option key={v.id} value={v.id}>VLAN {v.id} — {v.name}</option>
                      ))}
                    </select>
                    <button
                      style={S.btn('primary', loading)}
                      onClick={() => setManagementVlan(mgmtVlanChoice ? parseInt(mgmtVlanChoice, 10) : null)}
                      disabled={loading}
                    >
                      Save
                    </button>
                    <button style={S.btn()} onClick={() => setEditingMgmtVlan(false)}>Cancel</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: '#ffffff', fontSize: '14px' }}>
                      {systemInfo.managementVlan !== undefined ? `VLAN ${systemInfo.managementVlan}` : 'Not restricted'}
                    </span>
                    <button style={S.btn()} onClick={() => { setMgmtVlanChoice(systemInfo.managementVlan !== undefined ? String(systemInfo.managementVlan) : ''); setEditingMgmtVlan(true); }}>Edit</button>
                  </div>
                )}
                <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: '11px', marginTop: 6 }}>
                  Restricts Telnet/SSH/web/SNMP to the chosen VLAN. Verify you can reach the switch on that VLAN before saving — this can lock out the session you're using right now.
                </div>
              </div>
            </div>
          </div>

          {/* Config actions */}
          <div style={{ marginBottom: 32 }}>
            <h3 style={{ fontFamily: 'Geist Mono, monospace', fontSize: '13px', fontWeight: 400, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '1.2px', marginBottom: 16, marginTop: 0 }}>Configuration</h3>
            <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
              <button style={S.btn('primary', loading)} onClick={saveConfig} disabled={loading}>
                {loading ? 'Saving…' : 'Write Memory (Save)'}
              </button>
              <button style={S.btn('ghost', configLoading)} onClick={loadRunningConfig} disabled={configLoading}>
                {configLoading ? 'Loading…' : 'Show Running Config'}
              </button>
            </div>
            {runningConfig && (
              <div style={{ padding: '16px', backgroundColor: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', overflowX: 'auto' }}>
                <pre style={{ margin: 0, color: '#10b981', fontSize: '11px', fontFamily: 'Geist Mono, monospace', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {runningConfig}
                </pre>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
