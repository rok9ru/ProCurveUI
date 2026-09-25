import { app, BrowserWindow, ipcMain, Menu, dialog } from 'electron';

// Prevent renderer DevTools from opening
try { app.commandLine.appendSwitch('disable-dev-tools'); } catch (e) { /* ignore */ }

// Destroy any devtools webContents if they are created
try {
  app.on('web-contents-created', (_event, contents) => {
    try {
      contents.on('did-frame-finish-load', () => {
        try {
          const url = contents.getURL?.() ?? '';
          if (typeof url === 'string' && url.startsWith('devtools://')) {
            // DevTools pages are hosted in their own BrowserWindow; close that window safely.
            const devtoolsWindow = BrowserWindow.fromWebContents(contents);
            try { devtoolsWindow?.close(); } catch (e) { /* ignore */ }
          }
        } catch (e) { /* ignore */ }
      });
    } catch (e) { /* ignore */ }
  });
} catch (e) { /* ignore */ }
import path from 'path';
import { fileURLToPath } from 'url';
import isDev from 'electron-is-dev';
import SSHClient from './ssh/client.js';
import ProCurveParser from './ssh/parser.js';
import DatabaseManager from './database/db.js';
import { matchSwitchCatalog } from './switchCatalog.js';
import { getLocalAddressFor } from './network.js';
import TftpServer from './tftpServer.js';
import fs from 'fs';
import type {
  SSHProfile, SystemInfo, Vlan, Port, AuditLogEntry,
  CreateVlanCommand, ModifyVlanCommand, AddPortToVlanCommand,
  RemovePortFromVlanCommand, ConfigurePortCommand, SetVlanIpCommand,
} from '../types/ipc.js';
import type { SSHConnectionConfig } from '../types/ssh.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let sshClient: SSHClient | null = null;
let db: DatabaseManager | null = null;
let currentProfile: SSHProfile | null = null;

function createWindow() {
  const preloadPath = path.join(__dirname, 'preload.js');
  const indexPath = isDev
    ? 'http://localhost:5173'
    : `file://${path.join(__dirname, '../renderer/index.html')}`;

  const iconPath = isDev
    ? path.join(__dirname, '../../assets/icon.png')
    : path.join(__dirname, '../assets/icon.png');

  // Use native frame/titlebar on all platforms to keep native controls visible
  const useFrameless = false; // set to true to enable custom titlebar

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: preloadPath,
      devTools: false,
    },
    titleBarStyle: 'default',
    frame: !useFrameless,
    backgroundColor: '#1f2228',
    icon: iconPath,
  });

  // expose whether we're using a frameless/custom titlebar
  (mainWindow as any).isFrameless = useFrameless;

  mainWindow.loadURL(indexPath);

  mainWindow.on('closed', () => { mainWindow = null; });

  // Close devtools after the page finishes loading and if they open later
  try {
    mainWindow.webContents.on('did-finish-load', () => {
      try { mainWindow?.webContents.closeDevTools(); } catch (e) { /* ignore */ }
    });
    mainWindow.webContents.on('devtools-opened', () => {
      try { setTimeout(() => mainWindow?.webContents.closeDevTools(), 50); } catch (e) { /* ignore */ }
    });
  } catch (e) { /* ignore */ }

  // Forward maximize/unmaximize events to renderer so UI can reflect state
  mainWindow.on('maximize', () => { mainWindow?.webContents.send('window:maximized'); });
  mainWindow.on('unmaximize', () => { mainWindow?.webContents.send('window:unmaximized'); });
}



app.on('ready', () => {
  db = new DatabaseManager();
  db.initialize();
  sshClient = new SSHClient();
  sshClient.on('log', (line: string) => {
    mainWindow?.webContents.send('ssh:log', line);
  });
  createWindow();
  createMenu();

  // After startup give a short delay and close any stray DevTools windows
  setTimeout(() => {
    try {
      BrowserWindow.getAllWindows().forEach((w) => {
        try {
          const url = w.webContents.getURL?.() ?? '';
          const title = w.getTitle?.() ?? '';
          if ((typeof url === 'string' && url.startsWith('devtools://')) || title.toLowerCase().includes('devtools') || title.toLowerCase().includes('developer')) {
            try { w.close(); } catch (e) { /* ignore */ }
          }
        } catch (e) { /* ignore */ }
      });
    } catch (e) { /* ignore */ }
  }, 500);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});

app.on('quit', cleanup);

// ── SSH Connection ─────────────────────────────────────────────────────────────

ipcMain.handle('ssh:connect', async (_event, profile: SSHProfile) => {
  if (!sshClient || !db) throw new Error('Initialization failed');

  let password = profile.password;
  if (!password && profile.savePassword) {
    password = db.getDecryptedPassword(profile.id) ?? undefined;
    if (!password) throw new Error('Saved password not found');
  }
  if (!password) throw new Error('Password required');

  const config: SSHConnectionConfig = {
    host: profile.host,
    port: profile.port,
    username: profile.username,
    password,
  };

  await sshClient.connect(config);
  currentProfile = profile;
  mainWindow?.webContents.send('ssh:connected', { profileId: profile.id });
  db.addAuditEntry(profile.id, `Connected to ${profile.host}`, 'Success', true);
  return { success: true };
});

ipcMain.handle('ssh:disconnect', async () => {
  if (!sshClient) return;
  await sshClient.disconnect().catch(console.error);
  if (currentProfile) db?.addAuditEntry(currentProfile.id, 'Disconnected', 'Success', true);
  currentProfile = null;
  mainWindow?.webContents.send('ssh:disconnected');
});

ipcMain.handle('ssh:isConnected', () => sshClient?.getConnectionStatus() ?? false);

ipcMain.handle('ssh:execute', async (_event, command: string) => {
  if (!sshClient) throw new Error('SSH client not initialized');
  const result = await sshClient.execute(command);
  if (currentProfile) db?.addAuditEntry(currentProfile.id, command, result.substring(0, 500), true);
  return result;
});

// ── Profile Management ─────────────────────────────────────────────────────────

ipcMain.handle('profile:list', () => {
  if (!db) throw new Error('Database not initialized');
  return db.listProfiles();
});

ipcMain.handle('profile:save', (_event, profile: SSHProfile) => {
  if (!db) throw new Error('Database not initialized');
  return db.saveProfile(profile);
});

ipcMain.handle('profile:delete', (_event, profileId: string) => {
  if (!db) throw new Error('Database not initialized');
  db.deleteProfile(profileId);
});

ipcMain.handle('profile:get', (_event, profileId: string) => {
  if (!db) throw new Error('Database not initialized');
  return db.getProfile(profileId);
});

// ── Switch Queries ─────────────────────────────────────────────────────────────

ipcMain.handle('switch:getSystemInfo', async () => {
  if (!sshClient) throw new Error('SSH not connected');
  const output = await sshClient.execute('show system');
  const info = ProCurveParser.parseSystemInfo(output, sshClient.getBanner());

  try {
    const ipOutput = await sshClient.execute('show ip');
    info.defaultGateway = ProCurveParser.parseIpService(ipOutput).defaultGateway;
  } catch (e) {
    // Keep base info usable if IP service lookup fails.
  }

  try {
    const runningConfig = await sshClient.execute('show running-config');
    info.managementVlan = ProCurveParser.parseManagementVlan(runningConfig);
  } catch (e) {
    // Keep base info usable if running-config lookup fails.
  }

  try {
    const flashOutput = await sshClient.execute('show flash');
    info.flash = ProCurveParser.parseFlashInfo(flashOutput);
  } catch (e) {
    // Keep base info usable if flash lookup fails.
  }

  info.catalog = matchSwitchCatalog(info.model);

  if (currentProfile) db?.addAuditEntry(currentProfile.id, 'show system', JSON.stringify(info), true);
  return info;
});

ipcMain.handle('switch:getVlans', async () => {
  if (!sshClient) throw new Error('SSH not connected');
  const output = await sshClient.execute('show vlan');
  const vlans = ProCurveParser.parseVlans(output);
  if (currentProfile) db?.addAuditEntry(currentProfile.id, 'show vlan', `${vlans.length} VLANs`, true);
  return vlans;
});

ipcMain.handle('switch:getVlanDetail', async (_event, vlanId: number) => {
  if (!sshClient) throw new Error('SSH not connected');
  const output = await sshClient.execute(`show vlan ${vlanId}`);
  const vlan = ProCurveParser.parseVlanDetail(output, vlanId);

  // `show vlan <id>` has no IP info; only `show ip` does, keyed by VLAN name.
  try {
    const ipOutput = await sshClient.execute('show ip');
    const match = ProCurveParser.parseIpService(ipOutput).vlans.find(v => v.vlanName === vlan.name);
    if (match) {
      vlan.ipConfig = match.ipConfig;
      vlan.ipAddress = match.ipAddress;
      vlan.subnetMask = match.subnetMask;
    }
  } catch (e) {
    // Keep base VLAN detail usable if IP service lookup fails.
  }

  return vlan;
});

ipcMain.handle('switch:getPorts', async () => {
  if (!sshClient) throw new Error('SSH not connected');
  const output = await sshClient.execute('show interfaces brief');
  const ports = ProCurveParser.parsePorts(output);

  // `show interfaces brief` does not include saved port names on ProCurve,
  // so enrich with `name` values from running-config.
  try {
    const runningConfig = await sshClient.execute('show running-config');
    const portNames = ProCurveParser.parsePortNamesFromRunningConfig(runningConfig);
    ports.forEach((port) => {
      const name = portNames.get(port.id);
      if (name) port.description = name;
    });
  } catch (e) {
    // Keep base port list usable if running-config retrieval fails.
  }

  if (currentProfile) db?.addAuditEntry(currentProfile.id, 'show interfaces brief', `${ports.length} ports`, true);
  return ports;
});

ipcMain.handle('switch:getPortDetails', async (_event, portId: string) => {
  if (!sshClient) throw new Error('SSH not connected');
  const output = await sshClient.execute(`show interfaces ${portId}`);
  const details = ProCurveParser.parsePortDetails(output, portId);

  // `show interfaces <port>` has no VLAN data at all; membership only comes
  // from `show vlan ports <port> detail`.
  try {
    const vlanOutput = await sshClient.execute(`show vlan ports ${portId} detail`);
    details.vlans = ProCurveParser.parsePortVlans(vlanOutput);
  } catch (e) {
    // Keep base details usable if the VLAN lookup fails.
  }

  return details;
});

ipcMain.handle('switch:getRunningConfig', async () => {
  if (!sshClient) throw new Error('SSH not connected');
  return sshClient.execute('show running-config');
});

ipcMain.handle('switch:getSpanningTree', async () => {
  if (!sshClient) throw new Error('SSH not connected');
  return sshClient.execute('show spanning-tree');
});

ipcMain.handle('switch:getLldpNeighbors', async () => {
  if (!sshClient) throw new Error('SSH not connected');
  return sshClient.execute('show lldp info remote-device');
});

// ── VLAN Commands ─────────────────────────────────────────────────────────────

ipcMain.handle('switch:createVlan', async (_event, data: CreateVlanCommand) => {
  if (!sshClient) throw new Error('SSH not connected');
  const result = await sshClient.executeInteractive([
    `vlan ${data.vlanId}`,
    `name "${data.name}"`,
    'exit',
  ]);
  if (currentProfile)
    db?.addAuditEntry(currentProfile.id, `Create VLAN ${data.vlanId} "${data.name}"`, result, true);
});

ipcMain.handle('switch:deleteVlan', async (_event, vlanId: number) => {
  if (!sshClient) throw new Error('SSH not connected');
  const result = await sshClient.executeInteractive([`no vlan ${vlanId}`]);
  if (currentProfile)
    db?.addAuditEntry(currentProfile.id, `Delete VLAN ${vlanId}`, result, true);
});

ipcMain.handle('switch:renameVlan', async (_event, { vlanId, name }: { vlanId: number; name: string }) => {
  if (!sshClient) throw new Error('SSH not connected');
  const result = await sshClient.executeInteractive([
    `vlan ${vlanId}`,
    `name "${name}"`,
    'exit',
  ]);
  if (currentProfile)
    db?.addAuditEntry(currentProfile.id, `Rename VLAN ${vlanId} to "${name}"`, result, true);
});

ipcMain.handle('switch:setVlanIp', async (_event, cmd: SetVlanIpCommand) => {
  if (!sshClient) throw new Error('SSH not connected');
  const cmds: string[] = [`vlan ${cmd.vlanId}`];

  if (cmd.mode === 'manual') {
    if (!cmd.ipAddress || !cmd.subnetMask) throw new Error('IP address and subnet mask are required');
    cmds.push(`ip address ${cmd.ipAddress} ${cmd.subnetMask}`);
  } else if (cmd.mode === 'dhcp') {
    cmds.push('ip address dhcp-bootp');
  } else {
    cmds.push('no ip address');
  }
  cmds.push('exit');

  const result = await sshClient.executeInteractive(cmds);
  if (currentProfile)
    db?.addAuditEntry(currentProfile.id, `Set IP on VLAN ${cmd.vlanId} (${cmd.mode})`, result, true);
});

ipcMain.handle('switch:addPortToVlan', async (_event, cmd: AddPortToVlanCommand) => {
  if (!sshClient) throw new Error('SSH not connected');
  const portList = cmd.ports.join(',');
  const tagCmd = cmd.tagged ? `tagged ${portList}` : `untagged ${portList}`;
  const result = await sshClient.executeInteractive([`vlan ${cmd.vlanId}`, tagCmd, 'exit']);
  if (currentProfile)
    db?.addAuditEntry(currentProfile.id, `Add port ${portList} to VLAN ${cmd.vlanId} (${cmd.tagged ? 'tagged' : 'untagged'})`, result, true);
});

ipcMain.handle('switch:removePortFromVlan', async (_event, cmd: RemovePortFromVlanCommand) => {
  if (!sshClient) throw new Error('SSH not connected');
  const portList = cmd.ports.join(',');
  const result = await sshClient.executeInteractive([
    `vlan ${cmd.vlanId}`,
    `no tagged ${portList}`,
    `no untagged ${portList}`,
    'exit',
  ]);
  if (currentProfile)
    db?.addAuditEntry(currentProfile.id, `Remove port ${portList} from VLAN ${cmd.vlanId}`, result, true);
});

// ── Port Commands ─────────────────────────────────────────────────────────────

ipcMain.handle('switch:configurePort', async (_event, cmd: ConfigurePortCommand) => {
  if (!sshClient) throw new Error('SSH not connected');
  const cmds: string[] = [`interface ${cmd.portId}`];

  if (cmd.enabled === true) cmds.push('enable');
  else if (cmd.enabled === false) cmds.push('disable');

  if (cmd.description !== undefined)
    cmds.push(`name "${cmd.description}"`);

  if (cmd.speed !== undefined || cmd.duplex !== undefined) {
    const speed = cmd.speed || 'auto';
    const duplex = cmd.duplex || 'auto';
    if (speed === 'auto' || duplex === 'auto') {
      cmds.push('speed-duplex auto');
    } else {
      cmds.push(`speed-duplex ${speed}-${duplex}`);
    }
  }

  if (cmd.flowControl !== undefined)
    cmds.push(cmd.flowControl ? 'flow-control' : 'no flow-control');

  cmds.push('exit');

  const result = await sshClient.executeInteractive(cmds);
  if (currentProfile)
    db?.addAuditEntry(currentProfile.id, `Configure port ${cmd.portId}`, result, true);
});

// ── System Commands ────────────────────────────────────────────────────────────

ipcMain.handle('switch:setSystemName', async (_event, name: string) => {
  if (!sshClient) throw new Error('SSH not connected');
  const result = await sshClient.executeInteractive([`hostname "${name}"`]);
  if (currentProfile)
    db?.addAuditEntry(currentProfile.id, `Set hostname to "${name}"`, result, true);
});

ipcMain.handle('switch:setSystemContact', async (_event, contact: string) => {
  if (!sshClient) throw new Error('SSH not connected');
  const result = await sshClient.executeInteractive([`snmp-server contact "${contact}"`]);
  if (currentProfile)
    db?.addAuditEntry(currentProfile.id, `Set system contact to "${contact}"`, result, true);
});

ipcMain.handle('switch:setDefaultGateway', async (_event, gateway: string) => {
  if (!sshClient) throw new Error('SSH not connected');
  const result = await sshClient.executeInteractive([`ip default-gateway ${gateway}`]);
  if (currentProfile)
    db?.addAuditEntry(currentProfile.id, `Set default gateway to ${gateway}`, result, true);
});

// vlanId of null disables the restriction (`no management-vlan`), returning
// management access (Telnet/SSH/web/SNMP) to whichever VLAN has reachable IP.
ipcMain.handle('switch:setManagementVlan', async (_event, vlanId: number | null) => {
  if (!sshClient) throw new Error('SSH not connected');
  const cmd = vlanId === null ? 'no management-vlan' : `management-vlan ${vlanId}`;
  const result = await sshClient.executeInteractive([cmd]);
  if (currentProfile)
    db?.addAuditEntry(
      currentProfile.id,
      vlanId === null ? 'Disable management VLAN' : `Set management VLAN to ${vlanId}`,
      result,
      true
    );
});

ipcMain.handle('switch:saveConfig', async () => {
  if (!sshClient) throw new Error('SSH not connected');
  const result = await sshClient.execute('write memory');
  if (currentProfile)
    db?.addAuditEntry(currentProfile.id, 'write memory', result, true);
  return result;
});

// ── Firmware ──────────────────────────────────────────────────────────────────
// Always targets the secondary flash bank — never primary. That's not a
// configurable option here: the whole point of the primary/secondary split
// is that a botched upload leaves the switch still bootable from primary,
// and this app has no business overwriting the one copy that's guaranteed
// to still work.

ipcMain.handle('switch:selectFirmwareFile', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select firmware image (.swi)',
    filters: [
      { name: 'Switch firmware', extensions: ['swi'] },
      { name: 'All files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  const stat = fs.statSync(filePath);
  return { path: filePath, name: path.basename(filePath), size: stat.size };
});

ipcMain.handle('switch:uploadFirmware', async (_event, { filePath }: { filePath: string }) => {
  if (!sshClient) throw new Error('SSH not connected');
  const host = sshClient.getHost();
  if (!host) throw new Error('No active switch connection');
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

  const filename = path.basename(filePath);
  const localIp = await getLocalAddressFor(host);

  const tftp = new TftpServer(filePath);
  tftp.on('log', (line: string) => mainWindow?.webContents.send('ssh:log', `[TFTP] ${line}`));
  tftp.on('progress', (p) => mainWindow?.webContents.send('firmware:progress', p));
  tftp.on('error', (err: Error) => mainWindow?.webContents.send('ssh:log', `[TFTP] error: ${err.message}`));

  await tftp.start(localIp);
  try {
    const result = await sshClient.execute(
      `copy tftp flash ${localIp} ${filename} secondary`,
      20 * 60 * 1000 // large images over a slow link can genuinely take minutes
    );

    const flashOutput = await sshClient.execute('show flash');
    const flash = ProCurveParser.parseFlashInfo(flashOutput);

    if (currentProfile)
      db?.addAuditEntry(currentProfile.id, `copy tftp flash secondary (${filename})`, result, true);

    return { output: result, flash };
  } finally {
    tftp.stop();
  }
});

ipcMain.handle('switch:activateFirmwareBank', async () => {
  if (!sshClient) throw new Error('SSH not connected');
  const result = await sshClient.bootFromFlash('secondary');
  if (currentProfile)
    db?.addAuditEntry(currentProfile.id, 'boot system flash secondary', result, true);
  return result;
});

// ── Audit Log ─────────────────────────────────────────────────────────────────

ipcMain.handle('audit:list', (_event, profileId?: string) => {
  if (!db) throw new Error('Database not initialized');
  return db.getAuditLog(profileId);
});

ipcMain.handle('audit:clear', (_event, profileId?: string) => {
  if (!db) throw new Error('Database not initialized');
  db.clearAuditLog(profileId);
});

// Window control handlers for custom titlebar buttons
ipcMain.handle('window:minimize', () => {
  mainWindow?.minimize();
});
ipcMain.handle('window:maximize', () => {
  if (!mainWindow) return;
  if (!mainWindow.isMaximized()) mainWindow.maximize();
});
ipcMain.handle('window:unmaximize', () => {
  mainWindow?.unmaximize();
});
ipcMain.handle('window:isMaximized', () => {
  return mainWindow?.isMaximized() ?? false;
});

ipcMain.handle('window:isFrameless', () => {
  // stored on the BrowserWindow instance when created
  return Boolean(mainWindow && (mainWindow as any).isFrameless);
});
ipcMain.handle('window:close', () => {
  mainWindow?.close();
});

// ── Menu ──────────────────────────────────────────────────────────────────────

function createMenu() {
  const template: any[] = [
    {
      label: 'File',
      submenu: [
        { label: 'Exit', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Y', role: 'redo' },
        { type: 'separator' },
        { label: 'Cut', role: 'cut' },
        { label: 'Copy', role: 'copy' },
        { label: 'Paste', role: 'paste' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', role: 'reload' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

function cleanup() {
  if (sshClient) sshClient.disconnect().catch(console.error);
  if (db) db.close();
}
