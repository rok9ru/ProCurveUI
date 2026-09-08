export interface SSHProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  passwordEncrypted?: string;
  savePassword?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SystemInfo {
  model: string;
  firmwareVersion: string;
  romVersion?: string;
  serialNumber: string;
  macAddress?: string;
  systemUptime: string;
  systemName: string;
  systemContact: string;
  systemLocation: string;
  totalMemory: number;
  usedMemory: number;
  memoryUsagePercent: number;
  cpuUsagePercent?: number;
  ports: { total: number; active: number; inactive: number };
  defaultGateway?: string;
  managementVlan?: number;
}

export interface Vlan {
  id: number;
  name: string;
  status: 'active' | 'inactive';
  ports: { tagged: string[]; untagged: string[] };
  voice?: boolean;
  jumbo?: boolean;
  ipConfig?: string;
  ipAddress?: string;
  subnetMask?: string;
}

export interface Port {
  id: string;
  index: number;
  type?: string;
  description?: string;
  status: 'up' | 'down';
  speed?: string;
  duplex?: 'auto' | 'full' | 'half';
  vlans: { tagged: number[]; untagged?: number };
  mtu?: number;
  flowControl?: boolean;
  enabled: boolean;
}

export interface CreateVlanCommand {
  vlanId: number;
  name: string;
}

export interface ModifyVlanCommand {
  vlanId: number;
  name?: string;
}

export interface AddPortToVlanCommand {
  vlanId: number;
  ports: string[];
  tagged?: boolean;
}

export interface RemovePortFromVlanCommand {
  vlanId: number;
  ports: string[];
}

export interface SetVlanIpCommand {
  vlanId: number;
  mode: 'manual' | 'dhcp' | 'disabled';
  ipAddress?: string;
  subnetMask?: string;
}

export interface ConfigurePortCommand {
  portId: string;
  enabled?: boolean;
  speed?: string;
  duplex?: 'auto' | 'full' | 'half';
  description?: string;
  mtu?: number;
  flowControl?: boolean;
}

export interface AuditLogEntry {
  id: number;
  profileId: string;
  command: string;
  result: string;
  success: boolean;
  timestamp: Date;
  details?: Record<string, unknown>;
}
