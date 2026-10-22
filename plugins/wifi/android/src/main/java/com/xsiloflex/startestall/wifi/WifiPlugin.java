package com.xsiloflex.startestall.wifi;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.net.wifi.ScanResult;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import rikka.shizuku.Shizuku;

@CapacitorPlugin(
    name = "Wifi",
    permissions = {
        @Permission(strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }, alias = "wifiLocation"),
        @Permission(strings = { Manifest.permission.NEARBY_WIFI_DEVICES }, alias = "nearbyDevices")
    }
)
public class WifiPlugin extends Plugin {

    private static final String TAG = "StarTestAllWifi";
    private static final String SHIZUKU_PACKAGE = "moe.shizuku.privileged.api";
    private static final Pattern SSID_PATTERN = Pattern.compile("SSID:\\s*\"([^\"]*)\"");

    private ShellRunner shell;
    private PluginCall pendingPermissionCall;

    @Override
    public void load() {
        shell = new ShellRunner(getContext());
        Shizuku.addRequestPermissionResultListener((requestCode, grantResult) -> {
            PluginCall call = pendingPermissionCall;
            pendingPermissionCall = null;
            if (call == null) {
                return;
            }
            JSObject ret = new JSObject();
            ret.put("granted", grantResult == PackageManager.PERMISSION_GRANTED);
            call.resolve(ret);
        });
    }

    // ---------------------------------------------------------------- status

    @PluginMethod
    public void status(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("shizukuInstalled", isPackageInstalled(SHIZUKU_PACKAGE));
        ret.put("shizukuRunning", shizukuRunning());
        ret.put("shizukuPermission", shizukuPermissionGranted());
        ret.put("shizukuUid", shizukuUid());
        ret.put("hasLocationPermission", hasLocationPermission());
        ret.put("hasNearbyPermission", hasNearbyPermission());
        ret.put("sdkInt", Build.VERSION.SDK_INT);

        WifiManager wifiManager = wifiManager();
        ret.put("wifiEnabled", wifiManager != null && wifiManager.isWifiEnabled());
        JSObject current = currentInfo();
        Boolean connected = current.getBool("connected");
        ret.put("connected", connected != null && connected);
        ret.put("ssid", current.getString("ssid"));
        ret.put("bssid", current.getString("bssid"));
        Integer rssi = current.getInteger("rssi");
        Integer linkSpeed = current.getInteger("linkSpeed");
        ret.put("rssi", rssi == null ? 0 : rssi.intValue());
        ret.put("linkSpeed", linkSpeed == null ? 0 : linkSpeed.intValue());
        ret.put("ip", current.getString("ip"));
        call.resolve(ret);
    }

    // ------------------------------------------------------------ permissions

    @PluginMethod
    public void requestWifiPermissions(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33) {
            requestPermissionForAliases(new String[] { "nearbyDevices", "wifiLocation" }, call, "wifiLocationCallback");
        } else {
            requestPermissionForAliases(new String[] { "wifiLocation" }, call, "wifiLocationCallback");
        }
    }

    @PermissionCallback
    private void wifiLocationCallback(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", hasNearbyPermission() || hasLocationPermission());
        call.resolve(ret);
    }

    @PluginMethod
    public void requestShizukuPermission(PluginCall call) {
        if (!isPackageInstalled(SHIZUKU_PACKAGE)) {
            call.reject("Shizuku не встановлено");
            return;
        }
        if (!shizukuRunning()) {
            call.reject("Shizuku не запущено");
            return;
        }
        if (shizukuPermissionGranted()) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        pendingPermissionCall = call;
        try {
            Shizuku.requestPermission(0);
        } catch (Throwable t) {
            pendingPermissionCall = null;
            call.reject("Не вдалося надіслати запит дозволу: " + t.getMessage());
        }
    }

    private void onShizukuPermissionResult(int requestCode, int grantResult) {
        // kept for backwards compatibility, the listener is registered in load()
    }

    // ------------------------------------------------------------------ scan

    @PluginMethod
    public void scan(PluginCall call) {
        JSArray results = new JSArray();
        JSObject ret = new JSObject();
        ret.put("results", results);

        if (!hasLocationPermission() && !hasNearbyPermission()) {
            ret.put("needPermission", true);
            call.resolve(ret);
            return;
        }
        ret.put("needPermission", false);

        WifiManager wifiManager = wifiManager();
        if (wifiManager == null) {
            ret.put("error", "Wi-Fi service unavailable");
            call.resolve(ret);
            return;
        }
        try {
            wifiManager.startScan();
        } catch (Throwable t) {
            Log.d(TAG, "startScan failed: " + t.getMessage());
        }

        List<ScanResult> scanResults;
        try {
            scanResults = wifiManager.getScanResults();
        } catch (Throwable t) {
            ret.put("error", "Не вдалося отримати результати сканування: " + t.getMessage());
            call.resolve(ret);
            return;
        }
        if (scanResults == null) {
            call.resolve(ret);
            return;
        }
        for (ScanResult result : scanResults) {
            String ssid = result.SSID;
            if (ssid == null) {
                continue;
            }
            ssid = ssid.trim();
            if (ssid.isEmpty() || "<unknown>".equals(ssid)) {
                continue;
            }
            JSObject item = new JSObject();
            item.put("ssid", ssid);
            item.put("bssid", result.BSSID);
            item.put("rssi", result.level);
            item.put("frequency", result.frequency);
            item.put("capabilities", result.capabilities == null ? "" : result.capabilities);
            item.put("security", securityOf(result.capabilities));
            results.put(item);
        }
        call.resolve(ret);
    }

    // --------------------------------------------------------------- current

    @PluginMethod
    public void current(PluginCall call) {
        call.resolve(currentInfo());
    }

    private JSObject currentInfo() {
        JSObject ret = new JSObject();
        WifiManager wifiManager = wifiManager();
        String ssid = null;
        String bssid = null;
        int rssi = 0;
        int linkSpeed = 0;

        if (wifiManager != null) {
            try {
                WifiInfo info = wifiManager.getConnectionInfo();
                if (info != null) {
                    ssid = normalizeSsid(info.getSSID());
                    bssid = info.getBSSID();
                    rssi = info.getRssi();
                    linkSpeed = info.getLinkSpeed();
                }
            } catch (Throwable t) {
                Log.d(TAG, "getConnectionInfo failed: " + t.getMessage());
            }
        }
        ret.put("connected", ssid != null);
        ret.put("ssid", ssid);
        ret.put("bssid", bssid);
        ret.put("rssi", rssi);
        ret.put("linkSpeed", linkSpeed);
        ret.put("ip", currentIp());
        return ret;
    }

    // --------------------------------------------------------------- connect

    @PluginMethod
    public void connect(PluginCall call) {
        String ssid = call.getString("ssid");
        String security = call.getString("security", "wpa2");
        String password = call.getString("password", "");
        if (ssid == null || ssid.trim().isEmpty()) {
            call.reject("SSID не вказано");
            return;
        }
        if (!shell.isShizukuReady()) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("output", "Shizuku недоступний: потрібно встановити, запустити та надати дозвіл");
            call.resolve(ret);
            return;
        }
        String command = "cmd wifi connect-network " + quote(ssid) + " " + normalizeSecurity(security) + " " + quote(password == null ? "" : password);
        String output = shell.exec(command, 30000);
        JSObject ret = new JSObject();
        if (output == null) {
            ret.put("ok", false);
            ret.put("output", "Не вдалося виконати команду (Shizuku недоступний)");
        } else {
            ret.put("ok", isSuccessOutput(output));
            ret.put("output", output);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        if (!shell.isShizukuReady()) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("output", "Shizuku недоступний");
            call.resolve(ret);
            return;
        }
        String output = shell.exec("cmd wifi disconnect-network", 20000);
        JSObject ret = new JSObject();
        ret.put("ok", output != null && isSuccessOutput(output));
        ret.put("output", output == null ? "" : output);
        call.resolve(ret);
    }

    @PluginMethod
    public void waitForSsid(PluginCall call) {
        String target = call.getString("ssid");
        int timeoutMs = call.getInt("timeoutMs", 30000);
        if (target == null) {
            call.reject("SSID не вказано");
            return;
        }
        long deadline = System.currentTimeMillis() + timeoutMs;
        String found = null;
        while (System.currentTimeMillis() < deadline) {
            found = currentSsid();
            if (found != null && found.equals(target)) {
                break;
            }
            try {
                Thread.sleep(400);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            }
        }
        JSObject ret = new JSObject();
        ret.put("ok", target.equals(found));
        ret.put("ssid", found);
        call.resolve(ret);
    }

    @PluginMethod
    public void shell(PluginCall call) {
        String command = call.getString("command");
        if (command == null || command.trim().isEmpty()) {
            call.reject("Команда не вказана");
            return;
        }
        if (!shell.isShizukuReady()) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("output", "Shizuku недоступний");
            call.resolve(ret);
            return;
        }
        String output = shell.exec(command, 30000);
        JSObject ret = new JSObject();
        ret.put("ok", output != null);
        ret.put("output", output == null ? "Shizuku недоступний" : output);
        call.resolve(ret);
    }

    // ---------------------------------------------------------------- helpers

    @PluginMethod
    public void openShizuku(PluginCall call) {
        Intent intent = getContext().getPackageManager().getLaunchIntentForPackage(SHIZUKU_PACKAGE);
        JSObject ret = new JSObject();
        if (intent == null) {
            ret.put("ok", false);
            call.resolve(ret);
            return;
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        ret.put("ok", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.trim().isEmpty()) {
            call.reject("URL не вказано");
            return;
        }
        JSObject ret = new JSObject();
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            ret.put("ok", true);
        } catch (Throwable t) {
            ret.put("ok", false);
        }
        call.resolve(ret);
    }

    private WifiManager wifiManager() {
        return (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
    }

    private String currentIp() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) {
                return null;
            }
            Network network = cm.getActiveNetwork();
            if (network == null) {
                return null;
            }
            NetworkCapabilities caps = cm.getNetworkCapabilities(network);
            LinkProperties props = cm.getLinkProperties(network);
            if (caps == null || props == null) {
                return null;
            }
            for (LinkAddress address : props.getLinkAddresses()) {
                java.net.InetAddress inet = address.getAddress();
                if (inet instanceof java.net.Inet4Address) {
                    return inet.getHostAddress();
                }
            }
            return props.getLinkAddresses().isEmpty() ? null : props.getLinkAddresses().get(0).getAddress().getHostAddress();
        } catch (Throwable t) {
            return null;
        }
    }

    private String currentSsid() {
        WifiManager wifiManager = wifiManager();
        if (wifiManager != null) {
            try {
                WifiInfo info = wifiManager.getConnectionInfo();
                if (info != null) {
                    String ssid = normalizeSsid(info.getSSID());
                    if (ssid != null) {
                        return ssid;
                    }
                }
            } catch (Throwable t) {
                Log.d(TAG, "getConnectionInfo failed: " + t.getMessage());
            }
        }
        return currentSsidViaShell();
    }

    private String currentSsidViaShell() {
        if (!shell.isShizukuReady()) {
            return null;
        }
        String output = shell.exec("cmd wifi status", 15000);
        if (output == null) {
            return null;
        }
        Matcher matcher = SSID_PATTERN.matcher(output);
        if (matcher.find()) {
            String ssid = matcher.group(1).trim();
            if (!ssid.isEmpty() && !"unknown".equalsIgnoreCase(ssid)) {
                return ssid;
            }
        }
        return null;
    }

    private static String normalizeSsid(String raw) {
        if (raw == null) {
            return null;
        }
        String ssid = raw.trim();
        if (ssid.length() >= 2 && ssid.startsWith("\"") && ssid.endsWith("\"")) {
            ssid = ssid.substring(1, ssid.length() - 1);
        }
        if (ssid.isEmpty() || "<unknown>".equals(ssid) || "unknown".equalsIgnoreCase(ssid)) {
            return null;
        }
        return ssid;
    }

    private static String securityOf(String capabilities) {
        if (capabilities == null) {
            return "open";
        }
        String cap = capabilities.toLowerCase();
        if (cap.contains("sae") || cap.contains("wpa3")) {
            return "wpa3";
        }
        if (cap.contains("rsn") || cap.contains("wpa2")) {
            return "wpa2";
        }
        if (cap.contains("wep")) {
            return "wep";
        }
        if (cap.contains("wpa")) {
            return "wpa2";
        }
        return "open";
    }

    private static String normalizeSecurity(String security) {
        if (security == null) {
            return "wpa2";
        }
        String value = security.trim().toLowerCase();
        if (value.equals("open") || value.equals("wep") || value.equals("wpa2") || value.equals("wpa3") || value.equals("sae")) {
            return value;
        }
        return "wpa2";
    }

    private static String quote(String value) {
        return "'" + value.replace("'", "'\\''") + "'";
    }

    private static boolean isSuccessOutput(String output) {
        if (output == null) {
            return false;
        }
        String lower = output.toLowerCase();
        if (lower.contains("exception") || lower.contains("error") || lower.contains("failure") || lower.contains("denied")) {
            return false;
        }
        return lower.contains("initiated") || lower.contains("success") || lower.contains("connected");
    }

    private boolean isPackageInstalled(String packageName) {
        try {
            getContext().getPackageManager().getPackageInfo(packageName, 0);
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    private boolean shizukuRunning() {
        try {
            return Shizuku.pingBinder();
        } catch (Throwable t) {
            return false;
        }
    }

    private boolean shizukuPermissionGranted() {
        try {
            return Shizuku.pingBinder() && Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED;
        } catch (Throwable t) {
            return false;
        }
    }

    private int shizukuUid() {
        try {
            return Shizuku.getUid();
        } catch (Throwable t) {
            return -1;
        }
    }

    private boolean hasLocationPermission() {
        return getContext().checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasNearbyPermission() {
        if (Build.VERSION.SDK_INT < 33) {
            return false;
        }
        return getContext().checkSelfPermission(Manifest.permission.NEARBY_WIFI_DEVICES) == PackageManager.PERMISSION_GRANTED;
    }
}
