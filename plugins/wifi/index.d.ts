export declare interface ScanEntry {
  ssid: string;
  bssid: string;
  rssi: number;
  frequency: number;
  capabilities: string;
  security: 'open' | 'wpa2' | 'wpa3' | 'wep';
}

export declare interface WifiStatus {
  shizukuInstalled: boolean;
  shizukuRunning: boolean;
  shizukuPermission: boolean;
  shizukuUid: number;
  wifiEnabled: boolean;
  connected: boolean;
  ssid: string | null;
  bssid: string | null;
  rssi: number;
  linkSpeed: number;
  ip: string | null;
  hasLocationPermission: boolean;
  hasNearbyPermission: boolean;
  sdkInt: number;
}

export declare interface WifiPlugin {
  status(): Promise<WifiStatus>;
  requestWifiPermissions(): Promise<{ granted: boolean }>;
  requestShizukuPermission(): Promise<{ granted: boolean; reason?: string }>;
  scan(): Promise<{ results: ScanEntry[]; needPermission: boolean }>;
  current(): Promise<{ connected: boolean; ssid: string | null; bssid: string | null; rssi: number; linkSpeed: number; ip: string | null }>;
  connect(options: { ssid: string; security: string; password: string }): Promise<{ ok: boolean; output: string }>;
  disconnect(): Promise<{ ok: boolean; output: string }>;
  waitForSsid(options: { ssid: string; timeoutMs?: number }): Promise<{ ok: boolean; ssid: string | null }>;
  shell(options: { command: string }): Promise<{ ok: boolean; output: string }>;
  openShizuku(): Promise<{ ok: boolean }>;
  openUrl(options: { url: string }): Promise<{ ok: boolean }>;
}

export declare interface NetEntry {
  id: string;
  label: string;
  ssid: string;
  security: string;
  password: string;
  enabled: boolean;
}

export declare interface NetStorePlugin {
  list(): Promise<{ networks: NetEntry[] }>;
  save(network: NetEntry): Promise<{ ok: boolean }>;
  remove(options: { id: string }): Promise<{ ok: boolean }>;
  setEnabled(options: { id: string; enabled: boolean }): Promise<{ ok: boolean }>;
  reorder(options: { ids: string[] }): Promise<{ ok: boolean }>;
}
