package com.arrshub.status;

import android.content.SharedPreferences;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Push dashboard numbers + WoL target into the home-screen widget. */
@CapacitorPlugin(name = "HubWidget")
public class HubWidgetPlugin extends Plugin {

    /** { streams?, downloads?, ombiPending? (number | null), updatedAt? (ms) } — absent keys are kept. */
    @PluginMethod
    public void update(PluginCall call) {
        JSObject data = call.getData();
        SharedPreferences.Editor e = HubWidgetProvider.prefs(getContext()).edit();
        putCount(e, data, "streams", HubWidgetProvider.KEY_STREAMS);
        putCount(e, data, "downloads", HubWidgetProvider.KEY_DOWNLOADS);
        putCount(e, data, "ombiPending", HubWidgetProvider.KEY_OMBI);
        Long updatedAt = call.getLong("updatedAt");
        e.putLong(
                HubWidgetProvider.KEY_UPDATED,
                updatedAt != null && updatedAt > 0 ? updatedAt : System.currentTimeMillis());
        e.apply();
        HubWidgetProvider.refreshAll(getContext());
        JSObject out = new JSObject();
        out.put("ok", true);
        call.resolve(out);
    }

    private static void putCount(SharedPreferences.Editor e, JSObject data, String field, String key) {
        if (data == null || !data.has(field)) return;
        if (data.isNull(field)) {
            e.putInt(key, -1);
            return;
        }
        double v = data.optDouble(field, Double.NaN);
        e.putInt(key, Double.isNaN(v) || v < 0 ? -1 : (int) Math.round(v));
    }

    /** { mac, broadcast?, port? } — empty/invalid mac clears the target (button opens the app). */
    @PluginMethod
    public void setWol(PluginCall call) {
        String mac = call.getString("mac", "");
        byte[] parsed = HubWidgetProvider.parseMac(mac);
        String broadcast = call.getString("broadcast", "255.255.255.255");
        if (broadcast == null || broadcast.trim().isEmpty()) broadcast = "255.255.255.255";
        Integer port = call.getInt("port", 9);
        SharedPreferences.Editor e = HubWidgetProvider.prefs(getContext()).edit();
        if (parsed == null) {
            e.remove(HubWidgetProvider.KEY_MAC);
        } else {
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < parsed.length; i++) {
                if (i > 0) sb.append(':');
                sb.append(String.format("%02X", parsed[i]));
            }
            e.putString(HubWidgetProvider.KEY_MAC, sb.toString());
        }
        e.putString(HubWidgetProvider.KEY_BROADCAST, broadcast.trim());
        e.putInt(HubWidgetProvider.KEY_PORT, port != null && port > 0 && port <= 65535 ? port : 9);
        e.apply();
        HubWidgetProvider.refreshAll(getContext());
        JSObject out = new JSObject();
        out.put("ok", true);
        out.put("configured", parsed != null);
        call.resolve(out);
    }
}
