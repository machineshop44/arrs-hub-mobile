package com.arrshub.status;

import android.content.Intent;
import android.util.Log;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Capacitor bridge for in-app libVLC ({@link VlcPlayerActivity}).
 * Primary path for hub workout media; Intent-to-VLC remains a separate fallback.
 */
@CapacitorPlugin(name = "VlcPlayer")
public class VlcPlayerPlugin extends Plugin {
    private static final String TAG = "VlcPlayer";
    private static VlcPlayerPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    static void notifyClosed(boolean finished) {
        VlcPlayerPlugin plugin = instance;
        if (plugin == null) return;
        JSObject data = new JSObject();
        data.put("finished", finished);
        plugin.notifyListeners("closed", data);
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject result = new JSObject();
        try {
            Class.forName("org.videolan.libvlc.LibVLC");
            result.put("available", true);
        } catch (Throwable err) {
            Log.w(TAG, "libVLC not available", err);
            result.put("available", false);
            result.put("message", err.getMessage());
        }
        call.resolve(result);
    }

    @PluginMethod
    public void play(PluginCall call) {
        JSArray items = call.getArray("items");
        if (items == null || items.length() == 0) {
            call.reject("Missing playlist items");
            return;
        }

        try {
            // Validate at least one URL before launching.
            JSONArray validated = new JSONArray();
            for (int i = 0; i < items.length(); i++) {
                JSONObject raw = items.getJSONObject(i);
                String url = raw.optString("url", "").trim();
                if (url.isEmpty()) continue;
                JSONObject item = new JSONObject();
                item.put("url", url);
                item.put("title", raw.optString("title", "").trim());
                validated.put(item);
            }
            if (validated.length() == 0) {
                call.reject("No stream URLs in playlist");
                return;
            }

            Class.forName("org.videolan.libvlc.LibVLC");

            int startIndex = call.getInt("startIndex", 0);
            Intent intent = new Intent(getContext(), VlcPlayerActivity.class);
            intent.putExtra(VlcPlayerActivity.EXTRA_ITEMS_JSON, validated.toString());
            intent.putExtra(VlcPlayerActivity.EXTRA_START_INDEX, startIndex);
            if (getActivity() != null) {
                getActivity().startActivity(intent);
            } else {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            }

            JSObject result = new JSObject();
            result.put("started", true);
            result.put("count", validated.length());
            call.resolve(result);
        } catch (ClassNotFoundException err) {
            call.reject("Embedded libVLC is not packaged in this build", err);
        } catch (Exception err) {
            Log.e(TAG, "play failed", err);
            call.reject("Could not start embedded VLC: " + err.getMessage(), err);
        }
    }
}
