package com.arrshub.status;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.util.Log;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;

/**
 * Open hub/Plex stream URLs in VLC or any external video player.
 * WebView {@code <video>} often rejects Matroska/AC3/HEVC that VLC decodes fine.
 * Primary workout path: Intent to the VLC app (org.videolan.vlc).
 */
@CapacitorPlugin(name = "ExternalPlayer")
public class ExternalPlayerPlugin extends Plugin {
    private static final String TAG = "ExternalPlayer";
    private static final String VLC_PACKAGE = "org.videolan.vlc";

    private static String requireUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.trim().isEmpty()) {
            return null;
        }
        return url.trim();
    }

    private boolean isPackageInstalled(String packageName) {
        try {
            getContext().getPackageManager().getPackageInfo(packageName, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    private JSObject vlcMissingResult() {
        JSObject result = new JSObject();
        result.put("opened", false);
        result.put("vlcInstalled", false);
        result.put("message", "VLC is not installed");
        return result;
    }

    private void launchVlcView(Uri data, String mimeType, boolean grantRead)
            throws ActivityNotFoundException {
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(data, mimeType);
        intent.setPackage(VLC_PACKAGE);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        if (grantRead) {
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        }
        getContext().startActivity(intent);
    }

    @PluginMethod
    public void openInVlc(PluginCall call) {
        String url = requireUrl(call);
        if (url == null) {
            call.reject("Missing stream URL");
            return;
        }
        if (!isPackageInstalled(VLC_PACKAGE)) {
            call.resolve(vlcMissingResult());
            return;
        }

        try {
            launchVlcView(Uri.parse(url), "video/*", false);
            Log.i(TAG, "Opened in VLC: " + url);

            JSObject result = new JSObject();
            result.put("opened", true);
            result.put("vlcInstalled", true);
            call.resolve(result);
        } catch (ActivityNotFoundException err) {
            Log.e(TAG, "VLC launch failed", err);
            JSObject result = new JSObject();
            result.put("opened", false);
            result.put("vlcInstalled", false);
            result.put("message", "VLC could not open this URL");
            call.resolve(result);
        } catch (Exception err) {
            Log.e(TAG, "VLC open failed", err);
            call.reject("Could not open VLC: " + err.getMessage(), err);
        }
    }

    /**
     * Warm-up + day playlist for the VLC app.
     * Prefers a single HTTP(S) stream Intent (reliable). content:// M3U via
     * FileProvider often opens VLC to a black screen on modern Android.
     * When multiple items are passed, opens the first HTTP URL only.
     */
    @PluginMethod
    public void openPlaylistInVlc(PluginCall call) {
        JSArray items = call.getArray("items");
        if (items == null || items.length() == 0) {
            call.reject("Missing playlist items");
            return;
        }
        if (!isPackageInstalled(VLC_PACKAGE)) {
            call.resolve(vlcMissingResult());
            return;
        }

        try {
            String firstUrl = null;
            int count = 0;
            for (int i = 0; i < items.length(); i++) {
                JSONObject raw = items.getJSONObject(i);
                String url = raw.optString("url", "").trim();
                if (url.isEmpty()) continue;
                if (firstUrl == null) firstUrl = url;
                count++;
            }
            if (firstUrl == null) {
                call.reject("No stream URLs in playlist");
                return;
            }

            // Always hand VLC a real http(s) media URL — not a local M3U.
            launchVlcView(Uri.parse(firstUrl), "video/*", false);
            Log.i(
                    TAG,
                    "Opened in VLC (first of "
                            + count
                            + "): "
                            + firstUrl);

            JSObject result = new JSObject();
            result.put("opened", true);
            result.put("vlcInstalled", true);
            result.put("openedCount", 1);
            result.put("totalCount", count);
            call.resolve(result);
        } catch (ActivityNotFoundException err) {
            Log.e(TAG, "VLC playlist launch failed", err);
            JSObject result = new JSObject();
            result.put("opened", false);
            result.put("vlcInstalled", false);
            result.put("message", "VLC could not open this playlist");
            call.resolve(result);
        } catch (Exception err) {
            Log.e(TAG, "VLC playlist open failed", err);
            call.reject("Could not open VLC playlist: " + err.getMessage(), err);
        }
    }

    @PluginMethod
    public void openExternally(PluginCall call) {
        String url = requireUrl(call);
        if (url == null) {
            call.reject("Missing stream URL");
            return;
        }

        try {
            Intent view = new Intent(Intent.ACTION_VIEW);
            view.setDataAndType(Uri.parse(url), "video/*");
            view.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            Intent chooser = Intent.createChooser(view, "Open video with");
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(chooser);
            Log.i(TAG, "Opened externally: " + url);

            JSObject result = new JSObject();
            result.put("opened", true);
            call.resolve(result);
        } catch (Exception err) {
            Log.e(TAG, "External open failed", err);
            call.reject("Could not open externally: " + err.getMessage(), err);
        }
    }

    @PluginMethod
    public void openVlcStore(PluginCall call) {
        try {
            Intent market = new Intent(
                    Intent.ACTION_VIEW,
                    Uri.parse("market://details?id=" + VLC_PACKAGE));
            market.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(market);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            try {
                Intent web = new Intent(
                        Intent.ACTION_VIEW,
                        Uri.parse(
                                "https://play.google.com/store/apps/details?id="
                                        + VLC_PACKAGE));
                web.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(web);
                call.resolve();
            } catch (Exception err) {
                call.reject("Could not open Play Store for VLC", err);
            }
        }
    }
}
