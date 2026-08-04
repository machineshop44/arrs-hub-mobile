package com.arrshub.status;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Open hub/Plex stream URLs in VLC or any external video player.
 * WebView {@code <video>} often rejects Matroska/AC3/HEVC that VLC decodes fine.
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

    @PluginMethod
    public void openInVlc(PluginCall call) {
        String url = requireUrl(call);
        if (url == null) {
            call.reject("Missing stream URL");
            return;
        }
        if (!isPackageInstalled(VLC_PACKAGE)) {
            JSObject result = new JSObject();
            result.put("opened", false);
            result.put("vlcInstalled", false);
            result.put("message", "VLC is not installed");
            call.resolve(result);
            return;
        }

        try {
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(Uri.parse(url), "video/*");
            intent.setPackage(VLC_PACKAGE);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
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
