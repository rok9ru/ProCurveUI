import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('ipc', {
  // SSH
  sshConnect: (profile: any) => ipcRenderer.invoke('ssh:connect', profile),
  sshDisconnect: () => ipcRenderer.invoke('ssh:disconnect'),
  sshIsConnected: () => ipcRenderer.invoke('ssh:isConnected'),
  sshExecute: (cmd: string) => ipcRenderer.invoke('ssh:execute', cmd),

  // Profiles
  profileList: () => ipcRenderer.invoke('profile:list'),
  profileSave: (p: any) => ipcRenderer.invoke('profile:save', p),
  profileDelete: (id: string) => ipcRenderer.invoke('profile:delete', id),
  profileGet: (id: string) => ipcRenderer.invoke('profile:get', id),

  // Switch queries
  switchGetSystemInfo: () => ipcRenderer.invoke('switch:getSystemInfo'),
  switchGetVlans: () => ipcRenderer.invoke('switch:getVlans'),
  switchGetVlanDetail: (vlanId: number) => ipcRenderer.invoke('switch:getVlanDetail', vlanId),
  switchGetPorts: () => ipcRenderer.invoke('switch:getPorts'),
  switchGetPortDetails: (portId: string) => ipcRenderer.invoke('switch:getPortDetails', portId),
  switchGetRunningConfig: () => ipcRenderer.invoke('switch:getRunningConfig'),
  switchGetSpanningTree: () => ipcRenderer.invoke('switch:getSpanningTree'),
  switchGetLldpNeighbors: () => ipcRenderer.invoke('switch:getLldpNeighbors'),

  // VLAN commands
  switchCreateVlan: (data: any) => ipcRenderer.invoke('switch:createVlan', data),
  switchDeleteVlan: (vlanId: number) => ipcRenderer.invoke('switch:deleteVlan', vlanId),
  switchRenameVlan: (data: any) => ipcRenderer.invoke('switch:renameVlan', data),
  switchSetVlanIp: (cmd: any) => ipcRenderer.invoke('switch:setVlanIp', cmd),
  switchAddPortToVlan: (cmd: any) => ipcRenderer.invoke('switch:addPortToVlan', cmd),
  switchRemovePortFromVlan: (cmd: any) => ipcRenderer.invoke('switch:removePortFromVlan', cmd),

  // Port commands
  switchConfigurePort: (cmd: any) => ipcRenderer.invoke('switch:configurePort', cmd),

  // System commands
  switchSetSystemName: (name: string) => ipcRenderer.invoke('switch:setSystemName', name),
  switchSetSystemContact: (contact: string) => ipcRenderer.invoke('switch:setSystemContact', contact),
  switchSetDefaultGateway: (gateway: string) => ipcRenderer.invoke('switch:setDefaultGateway', gateway),
  switchSetManagementVlan: (vlanId: number | null) => ipcRenderer.invoke('switch:setManagementVlan', vlanId),
  switchSaveConfig: () => ipcRenderer.invoke('switch:saveConfig'),

  // Firmware
  switchSelectFirmwareFile: () => ipcRenderer.invoke('switch:selectFirmwareFile'),
  switchUploadFirmware: (filePath: string) => ipcRenderer.invoke('switch:uploadFirmware', { filePath }),
  switchActivateFirmwareBank: () => ipcRenderer.invoke('switch:activateFirmwareBank'),
  onFirmwareProgress: (cb: (p: { block: number; totalBlocks: number; bytesSent: number; totalBytes: number }) => void) =>
    ipcRenderer.on('firmware:progress', (_e, p) => cb(p)),
  removeFirmwareProgressListener: () => ipcRenderer.removeAllListeners('firmware:progress'),

  // Audit
  auditList: (profileId?: string) => ipcRenderer.invoke('audit:list', profileId),
  auditClear: (profileId?: string) => ipcRenderer.invoke('audit:clear', profileId),

  // Events
  onSshConnected: (cb: (data: any) => void) =>
    ipcRenderer.on('ssh:connected', (_e, data) => cb(data)),
  onSshDisconnected: (cb: () => void) =>
    ipcRenderer.on('ssh:disconnected', () => cb()),
  onSshError: (cb: (err: string) => void) =>
    ipcRenderer.on('ssh:error', (_e, err) => cb(err)),
  onSshLog: (cb: (line: string) => void) =>
    ipcRenderer.on('ssh:log', (_e, line) => cb(line)),
  removeSshConnectedListener: () => ipcRenderer.removeAllListeners('ssh:connected'),
  removeSshDisconnectedListener: () => ipcRenderer.removeAllListeners('ssh:disconnected'),
  removeSshErrorListener: () => ipcRenderer.removeAllListeners('ssh:error'),
  removeSshLogListener: () => ipcRenderer.removeAllListeners('ssh:log'),

  // Window controls
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  unmaximize: () => ipcRenderer.invoke('window:unmaximize'),
  isWindowMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  onWindowMaximized: (cb: () => void) => ipcRenderer.on('window:maximized', () => cb()),
  onWindowUnmaximized: (cb: () => void) => ipcRenderer.on('window:unmaximized', () => cb()),

  // Window frameless state
  isWindowFrameless: () => ipcRenderer.invoke('window:isFrameless'),

  platform: process.platform,
});
