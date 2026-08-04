package com.arrshub.status;

import android.content.ClipData;
import android.content.Intent;
import android.util.Log;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;

/**
 * Share helpers: installed APK or a JSON settings file via the system share sheet
 * (Nearby Share / Quick Share, Drive, Bluetooth, Files, email, etc.).
 */
@CapacitorPlugin(name = "ApkShare")
public class ApkSharePlugin extends Plugin {
    private static final String TAG = "ApkShare";
    private static final String SHARE_NAME = "ArrsHubStatus-update.apk";
    private static final String DEFAULT_SETTINGS_NAME = "ArrsHubStatus-settings.json";

    private File ensureShareDir() throws Exception {
        File outDir = new File(getContext().getCacheDir(), "share");
        if (!outDir.exists() && !outDir.mkdirs()) {
            throw new Exception("Could not create share cache");
        }
        return outDir;
    }

    private void openShareChooser(
            File out,
            String mime,
            String subject,
            String text,
            String chooserTitle) {
        String authority = getContext().getPackageName() + ".fileprovider";
        android.net.Uri uri = FileProvider.getUriForFile(getContext(), authority, out);

        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType(mime);
        send.putExtra(Intent.EXTRA_STREAM, uri);
        send.putExtra(Intent.EXTRA_SUBJECT, subject);
        send.putExtra(Intent.EXTRA_TEXT, text);
        send.setClipData(ClipData.newUri(getContext().getContentResolver(), subject, uri));
        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

        Intent chooser = Intent.createChooser(send, chooserTitle);
        chooser.setClipData(send.getClipData());
        chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(chooser);
    }

    @PluginMethod
    public void shareInstalledApk(PluginCall call) {
        try {
            File src = new File(getContext().getApplicationInfo().sourceDir);
            if (!src.exists()) {
                call.reject("Installed APK not found");
                return;
            }

            File out = new File(ensureShareDir(), SHARE_NAME);
            try (FileInputStream in = new FileInputStream(src);
                    FileOutputStream fos = new FileOutputStream(out)) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) {
                    fos.write(buf, 0, n);
                }
            }

            // octet-stream is more often accepted by Quick Share than package-archive,
            // while keeping the .apk filename so the receiver can install it directly.
            openShareChooser(
                    out,
                    "application/octet-stream",
                    "Arrs Hub Status update",
                    "Open ArrsHubStatus-update.apk and tap Install. "
                            + "Allow installs from this app/source if Android asks.",
                    "Share Arrs Hub Status APK");
            Log.i(TAG, "Sharing APK (" + out.length() + " bytes)");

            JSObject result = new JSObject();
            result.put("bytes", out.length());
            result.put("fileName", SHARE_NAME);
            call.resolve(result);
        } catch (Exception err) {
            Log.e(TAG, "Share failed", err);
            call.reject("Could not share app: " + err.getMessage(), err);
        }
    }

    @PluginMethod
    public void shareJsonFile(PluginCall call) {
        try {
            String content = call.getString("content");
            if (content == null || content.isEmpty()) {
                call.reject("Missing settings content");
                return;
            }
            String fileName = call.getString("fileName", DEFAULT_SETTINGS_NAME);
            if (fileName == null || fileName.trim().isEmpty()) {
                fileName = DEFAULT_SETTINGS_NAME;
            }
            // Keep basename only — no path traversal into cache.
            fileName = new File(fileName).getName();
            if (!fileName.toLowerCase().endsWith(".json")) {
                fileName = fileName + ".json";
            }

            File out = new File(ensureShareDir(), fileName);
            try (FileOutputStream fos = new FileOutputStream(out)) {
                fos.write(content.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            }

            openShareChooser(
                    out,
                    "application/json",
                    "Arrs Hub Status settings",
                    "Import this file in Arrs Hub Status → Settings → Import config.",
                    "Share settings file");
            Log.i(TAG, "Sharing settings (" + out.length() + " bytes)");

            JSObject result = new JSObject();
            result.put("bytes", out.length());
            result.put("fileName", fileName);
            call.resolve(result);
        } catch (Exception err) {
            Log.e(TAG, "Share settings failed", err);
            call.reject("Could not share settings: " + err.getMessage(), err);
        }
    }
}
