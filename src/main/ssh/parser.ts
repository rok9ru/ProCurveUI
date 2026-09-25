import type { SystemInfo, Vlan, Port, FlashInfo } from '../../types/ipc.js';

export class ProCurveParser {

  static parsePortNamesFromRunningConfig(output: string): Map<string, string> {
    const names = new Map<string, string>();
    const lines = output.split('\n');
    let currentPort: string | null = null;

    for (const rawLine of lines) {
      const line = rawLine.trim();

      const interfaceMatch = line.match(/^interface\s+(\S+)/i);
      if (interfaceMatch) {
        currentPort = interfaceMatch[1];
        continue;
      }

      // Leave current interface context when another section starts.
      if (/^(vlan|trunk|router|snmp-server|ip\s+|aaa\s+|spanning-tree|timesync|ntp\s+)/i.test(line)) {
        currentPort = null;
        continue;
      }

      if (!currentPort) continue;

      const nameMatch = line.match(/^name\s+"?(.+?)"?$/i);
      if (nameMatch) {
        names.set(currentPort, nameMatch[1].trim());
      }
    }

    return names;
  }

  // Extracts the real hardware model from the login banner, e.g.
  // "ProCurve J9279A Switch 2510G-24" -> "ProCurve 2510G-24 (J9279A)".
  // `show system`'s "System Name" is a user-editable hostname, not the model —
  // it must never be used as a fallback here.
  static parseModelFromBanner(banner?: string): string | undefined {
    if (!banner) return undefined;
    const m = banner.match(/ProCurve\s+(\S+)\s+Switch\s+(\S+)/i);
    return m ? `ProCurve ${m[2]} (${m[1]})` : undefined;
  }

  // Parses `show ip` output:
  //   Internet (IP) Service
  //   Default Gateway : 192.168.99.1
  //   VLAN         | IP Config  IP Address      Subnet Mask     Proxy ARP
  //   ------------ + ---------- --------------- --------------- ---------
  //   DEFAULT_VLAN | Manual     192.168.99.202  255.255.255.0   No
  // Note: the VLAN column is the VLAN *name*, not its numeric ID — callers
  // must cross-reference against a VLAN name->id list (e.g. from parseVlans).
  static parseIpService(output: string): {
    defaultGateway?: string;
    vlans: Array<{ vlanName: string; ipConfig: string; ipAddress?: string; subnetMask?: string }>;
  } {
    const result: { defaultGateway?: string; vlans: Array<{ vlanName: string; ipConfig: string; ipAddress?: string; subnetMask?: string }> } = { vlans: [] };
    const lines = output.split('\n');
    let inTable = false;

    for (const line of lines) {
      const gw = line.match(/Default Gateway\s*:\s*(\S+)/i);
      if (gw) result.defaultGateway = gw[1];

      if (/^[-\s]+\+[-\s]+$/.test(line)) { inTable = true; continue; }
      if (!inTable) continue;
      const trimmed = line.trim();
      if (!trimmed) continue;

      const sides = trimmed.split('|');
      if (sides.length < 2) continue;
      const vlanName = sides[0].trim();
      const cols = sides[1].trim().split(/\s+/);
      if (!vlanName || !cols[0]) continue;

      result.vlans.push({
        vlanName,
        ipConfig: cols[0],
        ipAddress: cols[1],
        subnetMask: cols[2],
      });
    }

    return result;
  }

  // Parses a `management-vlan <VID>` line out of `show running-config`.
  // Absent entirely when management access isn't restricted to one VLAN.
  static parseManagementVlan(runningConfig: string): number | undefined {
    const m = runningConfig.match(/^management-vlan\s+(\d+)/m);
    return m ? parseInt(m[1], 10) : undefined;
  }

  static parseSystemInfo(output: string, banner?: string): SystemInfo {
    const lines = output.split('\n');
    const info: Partial<SystemInfo> = {
      ports: { total: 48, active: 0, inactive: 0 },
    };

    for (const line of lines) {
      const kv = (key: string) => {
        const m = line.match(new RegExp(`${key}\\s*:\\s*(.+)$`));
        return m ? m[1].trim() : null;
      };
      // `show system-information` packs two "Label : value" columns onto one
      // physical line for several fields (e.g. "Software revision : U.11.67
      // Base MAC Addr : ..."). A greedy (.+)$ capture for the first column
      // swallows the second column's label+value too, so short token-like
      // values (versions, serials, MACs — never contain internal spaces)
      // must stop at the first run of 2+ spaces instead of at end of line.
      const kvShort = (key: string) => {
        const m = line.match(new RegExp(`${key}\\s*:\\s*(.+?)(?:\\s{2,}|$)`));
        return m ? m[1].trim() : null;
      };

      if (/System Name/i.test(line)) info.systemName = kv('System Name') ?? undefined;
      if (/System Contact/i.test(line)) info.systemContact = kv('System Contact') ?? undefined;
      if (/System Location/i.test(line)) info.systemLocation = kv('System Location') ?? undefined;
      if (/Software revision/i.test(line)) info.firmwareVersion = kvShort('Software revision') ?? undefined;
      if (/ROM Version/i.test(line) && !info.romVersion) info.romVersion = kvShort('ROM Version') ?? undefined;
      if (/Serial Number/i.test(line)) info.serialNumber = kvShort('Serial Number') ?? undefined;
      if (/MAC Addr/i.test(line)) info.macAddress = kvShort('MAC Addr') ?? undefined;
      if (/Up Time/i.test(line)) {
        const m = line.match(/Up Time\s*:\s*(.+?)(?:\s{2,}|$)/);
        if (m) info.systemUptime = m[1].trim();
      }
      if (/Memory\s*[-–]\s*Total/i.test(line)) {
        const m = line.match(/Memory\s*[-–]\s*Total\s*:\s*([\d,]+)/i);
        if (m) info.totalMemory = parseInt(m[1].replace(/,/g, ''), 10);
      }
      // Match "Free : <n>" only when NOT preceded by "Buffers" on the same line
      if (/Free\s*:\s*[\d,]+/.test(line) && !/Buffers/i.test(line) && info.totalMemory && !info.usedMemory) {
        const m = line.match(/Free\s*:\s*([\d,]+)/i);
        if (m) {
          const free = parseInt(m[1].replace(/,/g, ''), 10);
          info.usedMemory = info.totalMemory - free;
          info.memoryUsagePercent = Math.round((info.usedMemory / info.totalMemory) * 100);
        }
      }
      if (/CPU Util/i.test(line)) {
        const m = line.match(/(\d+)\s*%/);
        if (m) info.cpuUsagePercent = parseInt(m[1], 10);
      }
    }

    return {
      model: this.parseModelFromBanner(banner) || 'Unknown',
      firmwareVersion: info.firmwareVersion || 'Unknown',
      romVersion: info.romVersion,
      serialNumber: info.serialNumber || 'Unknown',
      macAddress: info.macAddress,
      systemUptime: info.systemUptime || 'Unknown',
      systemName: info.systemName || 'ProCurve Switch',
      systemContact: info.systemContact || '',
      systemLocation: info.systemLocation || '',
      totalMemory: info.totalMemory || 0,
      usedMemory: info.usedMemory || 0,
      memoryUsagePercent: info.memoryUsagePercent || 0,
      cpuUsagePercent: info.cpuUsagePercent,
      ports: info.ports || { total: 48, active: 0, inactive: 0 },
    };
  }

  // Parses `show flash`:
  //   Image           Size(Bytes)   Date   Version
  //   -----           ----------  -------- -------
  //   Primary Image   : 3434560   12/19/08 U.11.11
  //   Secondary Image : 3573695   12/07/20 U.11.67
  //   Boot Rom Version: R.10.06
  //   Current Boot    : Primary
  static parseFlashInfo(output: string): FlashInfo | undefined {
    const primary = output.match(/Primary Image\s*:\s*(\d+)\s+(\S+)\s+(\S+)/i);
    const secondary = output.match(/Secondary Image\s*:\s*(\d+)\s+(\S+)\s+(\S+)/i);
    const bootRom = output.match(/Boot Rom Version\s*:\s*(\S+)/i);
    const currentBoot = output.match(/Current Boot\s*:\s*(Primary|Secondary)/i);

    if (!primary || !secondary || !currentBoot) return undefined;

    return {
      primary: { sizeBytes: parseInt(primary[1], 10), date: primary[2], version: primary[3] },
      secondary: { sizeBytes: parseInt(secondary[1], 10), date: secondary[2], version: secondary[3] },
      bootRomVersion: bootRom?.[1],
      currentBoot: currentBoot[1] as 'Primary' | 'Secondary',
    };
  }

  static parseVlans(output: string): Vlan[] {
    const vlans: Vlan[] = [];
    const lines = output.split('\n');
    let inTable = false;

    for (const line of lines) {
      if (/VLAN\s+ID\s+Name/i.test(line)) { inTable = true; continue; }
      if (!inTable) continue;
      if (/^[-\s]+$/.test(line)) continue;
      if (line.trim() === '') continue;

      // "  1       DEFAULT_VLAN         Port-based"  (no | separator on this model)
      const m = line.match(/^\s*(\d+)\s+(\S+)\s+(\S+)/);
      if (m) {
        vlans.push({
          id: parseInt(m[1], 10),
          name: m[2],
          status: /port.based|active/i.test(m[3]) ? 'active' : 'inactive',
          ports: { tagged: [], untagged: [] },
        });
      }
    }

    return vlans;
  }

  static parseVlanDetail(output: string, vlanId: number): Vlan {
    const vlan: Vlan = {
      id: vlanId,
      name: `VLAN${vlanId}`,
      status: 'active',
      ports: { tagged: [], untagged: [] },
    };

    const lines = output.split('\n');

    for (const line of lines) {
      if (/Name\s*:/i.test(line)) {
        const m = line.match(/Name\s*:\s*(.+)$/);
        if (m) vlan.name = m[1].trim();
      }
      if (/Status\s*:/i.test(line)) {
        vlan.status = /active|port-based/i.test(line) ? 'active' : 'inactive';
      }
    }

    // Port membership is a per-port table, not a "Tagged: 1-4,10" summary line:
    //   Port Information Mode     Unknown VLAN Status
    //   ---------------- -------- ------------ ----------
    //   1                Untagged Learn        Up
    //   2                Tagged   Learn        Up
    //   3                No       Learn        Down
    let inTable = false;
    for (const line of lines) {
      if (/^[-\s]+$/.test(line) && line.includes('-')) { inTable = true; continue; }
      if (!inTable) continue;
      const trimmed = line.trim();
      if (!trimmed) continue;

      const [portId, mode] = trimmed.split(/\s+/);
      if (!portId || !mode) continue;

      if (/^untagged$/i.test(mode)) vlan.ports.untagged.push(portId);
      else if (/^tagged$/i.test(mode)) vlan.ports.tagged.push(portId);
      // "No" means the port isn't a member of this VLAN at all.
    }

    return vlan;
  }

  static parsePorts(output: string): Port[] {
    const ports: Port[] = [];
    const lines = output.split('\n');
    let inTable = false;

    for (const line of lines) {
      // Header separator line
      if (/[-]{3,}\s*\+/.test(line)) { inTable = true; continue; }
      if (!inTable) continue;
      if (line.trim() === '') continue;

      // "  1       10/100TX  | Yes     Up     No       100FDx  off   0"
      // Split on | or + to separate port info from link info
      const sides = line.split(/[|+]/);
      if (sides.length < 2) continue;

      const left = sides[0].trim().split(/\s+/);
      const right = sides[1].trim().split(/\s+/);

      const portId = left[0];
      if (!portId || !/^\d+[A-Z]?$/.test(portId)) continue;

      // Columns after | on ProCurve 2510G-48:
      // [0]=FlowCtrl(No/Yes)  [1]=Enabled(Yes/No)  [2]=Status(Up/Down)  [3]=SpeedDuplex
      const enabled = right[1]?.toLowerCase() === 'yes';
      const linkState = right[2]?.toLowerCase() || 'down';
      const mode = right[3] || '';

      let speed = 'auto';
      let duplex: 'auto' | 'full' | 'half' = 'auto';

      if (/(\d+)(fdx|hdx)/i.test(mode)) {
        const m = mode.match(/(\d+)(fdx|hdx)/i);
        if (m) {
          speed = m[1];
          duplex = m[2].toLowerCase() === 'fdx' ? 'full' : 'half';
        }
      }

      ports.push({
        id: portId,
        index: parseInt(portId, 10) || 0,
        type: left[1] || '',
        enabled,
        status: linkState === 'up' ? 'up' : 'down',
        speed,
        duplex,
        vlans: { tagged: [], untagged: undefined },
      });
    }

    return ports;
  }

  static parsePortDetails(output: string, portId: string): Partial<Port> {
    const details: Partial<Port> = {
      id: portId,
      vlans: { tagged: [], untagged: undefined },
    };

    const lines = output.split('\n');

    for (const line of lines) {
      if (/Enabled\s*:/i.test(line)) details.enabled = /yes|enable/i.test(line);
      if (/Link Status\s*:|Status\s*:/i.test(line))
        details.status = /up/i.test(line) ? 'up' : 'down';
      if (/Speed\s*:/i.test(line)) {
        const m = line.match(/(\d+)\s*Mbps/i);
        if (m) details.speed = m[1];
      }
      if (/Duplex\s*:/i.test(line)) {
        details.duplex = /full/i.test(line) ? 'full' : /half/i.test(line) ? 'half' : 'auto';
      }
      if (/Name\s*:/i.test(line) || /Description\s*:/i.test(line)) {
        const m = line.match(/:\s*(.+)$/);
        if (m) details.description = m[1].trim();
      }
      if (/Untagged VLAN\s*:/i.test(line)) {
        const m = line.match(/(\d+)/);
        if (m) details.vlans!.untagged = parseInt(m[1], 10);
      }
      if (/Tagged VLAN\s*:/i.test(line)) {
        const m = line.match(/(\d+)/);
        if (m) details.vlans!.tagged.push(parseInt(m[1], 10));
      }
    }

    return details;
  }

  // `show interfaces <port>` (no "brief") is traffic counters only — no VLAN data.
  // The actual per-port VLAN membership comes from `show vlan ports <port> detail`:
  //   VLAN ID Name                 Status       Voice Jumbo Mode
  //   ------- -------------------- ------------ ----- ----- --------
  //   1       DEFAULT_VLAN         Port-based   No    No    Untagged
  static parsePortVlans(output: string): { tagged: number[]; untagged?: number } {
    const result: { tagged: number[]; untagged?: number } = { tagged: [] };
    const lines = output.split('\n');
    let inTable = false;

    for (const line of lines) {
      if (/^[-\s]+$/.test(line) && line.includes('-')) { inTable = true; continue; }
      if (!inTable) continue;
      const trimmed = line.trim();
      if (!trimmed) continue;

      const parts = trimmed.split(/\s+/);
      const vlanId = parseInt(parts[0], 10);
      const mode = parts[parts.length - 1];
      if (!Number.isFinite(vlanId) || !mode) continue;

      if (/^untagged$/i.test(mode)) result.untagged = vlanId;
      else if (/^tagged$/i.test(mode)) result.tagged.push(vlanId);
    }

    return result;
  }

  static hasError(output: string): boolean {
    return /invalid command|error|unknown command|permission denied|bad command/i.test(output);
  }
}

export default ProCurveParser;
