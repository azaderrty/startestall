package com.xsiloflex.startestall.wifi;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKeys;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.UUID;

/**
 * Stores the list of authorized networks. Passwords are kept in an encrypted
 * preferences file (AES-256 keys backed by the Android Keystore) and never
 * leave the device.
 */
@CapacitorPlugin(name = "NetStore")
public class NetStorePlugin extends Plugin {

    private static final String TAG = "StarTestAllStore";
    private static final String FILE_NAME = "star_networks";
    private static final String KEY_NETWORKS = "networks";

    private SharedPreferences prefs;

    @Override
    public void load() {
        try {
            String masterKeyAlias = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC);
            prefs = EncryptedSharedPreferences.create(
                    FILE_NAME,
                    masterKeyAlias,
                    getContext(),
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            );
        } catch (Throwable t) {
            Log.w(TAG, "encrypted storage unavailable, falling back to plain preferences", t);
            prefs = getContext().getSharedPreferences(FILE_NAME, Context.MODE_PRIVATE);
        }
    }

    @PluginMethod
    public void list(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("networks", readAll());
        call.resolve(ret);
    }

    @PluginMethod
    public void save(PluginCall call) {
        String id = call.getString("id");
        String label = call.getString("label");
        String ssid = call.getString("ssid");
        String security = call.getString("security", "wpa2");
        String password = call.getString("password", "");
        Boolean enabled = call.getBoolean("enabled", Boolean.TRUE);

        if (ssid == null || ssid.trim().isEmpty()) {
            call.reject("SSID не вказано");
            return;
        }
        if (id == null || id.trim().isEmpty()) {
            id = UUID.randomUUID().toString();
        }
        if (label == null || label.trim().isEmpty()) {
            label = ssid.trim();
        }

        JSONArray all = readRaw();
        JSONObject entry = null;
        for (int i = 0; i < all.length(); i++) {
            JSONObject item = all.optJSONObject(i);
            if (item != null && id.equals(item.optString("id"))) {
                entry = item;
                break;
            }
        }
        if (entry == null) {
            entry = new JSONObject();
            entry.put("id", id);
            all.put(entry);
        }
        try {
            entry.put("id", id);
            entry.put("label", label.trim());
            entry.put("ssid", ssid.trim());
            entry.put("security", security);
            entry.put("password", password == null ? "" : password);
            entry.put("enabled", enabled);
        } catch (Exception e) {
            call.reject("Не вдалося зберегти: " + e.getMessage());
            return;
        }
        writeRaw(all);

        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("id", id);
        call.resolve(ret);
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String id = call.getString("id");
        if (id == null) {
            call.reject("id не вказано");
            return;
        }
        JSONArray all = readRaw();
        JSONArray kept = new JSONArray();
        for (int i = 0; i < all.length(); i++) {
            JSONObject item = all.optJSONObject(i);
            if (item != null && !id.equals(item.optString("id"))) {
                kept.put(item);
            }
        }
        writeRaw(kept);
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        String id = call.getString("id");
        Boolean enabled = call.getBoolean("enabled", Boolean.TRUE);
        if (id == null) {
            call.reject("id не вказано");
            return;
        }
        JSONArray all = readRaw();
        for (int i = 0; i < all.length(); i++) {
            JSONObject item = all.optJSONObject(i);
            if (item != null && id.equals(item.optString("id"))) {
                try {
                    item.put("enabled", enabled);
                } catch (Exception ignored) {
                    // ignore
                }
            }
        }
        writeRaw(all);
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void reorder(PluginCall call) {
        JSArray ids = call.getArray("ids");
        if (ids == null) {
            call.reject("ids не вказано");
            return;
        }
        JSONArray all = readRaw();
        JSONArray ordered = new JSONArray();
        for (int i = 0; i < ids.length(); i++) {
            String id = ids.optString(i);
            for (int j = 0; j < all.length(); j++) {
                JSONObject item = all.optJSONObject(j);
                if (item != null && id.equals(item.optString("id"))) {
                    ordered.put(item);
                    break;
                }
            }
        }
        for (int j = 0; j < all.length(); j++) {
            JSONObject item = all.optJSONObject(j);
            if (item != null && !ordered.toString().contains(item.optString("id"))) {
                ordered.put(item);
            }
        }
        writeRaw(ordered);
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    private JSArray readAll() {
        JSArray out = new JSArray();
        JSONArray all = readRaw();
        for (int i = 0; i < all.length(); i++) {
            JSONObject item = all.optJSONObject(i);
            if (item == null) {
                continue;
            }
            JSObject entry = new JSObject();
            entry.put("id", item.optString("id"));
            entry.put("label", item.optString("label"));
            entry.put("ssid", item.optString("ssid"));
            entry.put("security", item.optString("security", "wpa2"));
            entry.put("password", item.optString("password", ""));
            entry.put("enabled", item.optBoolean("enabled", true));
            out.put(entry);
        }
        return out;
    }

    private JSONArray readRaw() {
        try {
            String raw = prefs.getString(KEY_NETWORKS, "[]");
            if (raw == null || raw.trim().isEmpty()) {
                return new JSONArray();
            }
            return new JSONArray(raw);
        } catch (Throwable t) {
            Log.w(TAG, "failed to read networks", t);
            return new JSONArray();
        }
    }

    private void writeRaw(JSONArray array) {
        prefs.edit().putString(KEY_NETWORKS, array.toString()).apply();
    }
}
