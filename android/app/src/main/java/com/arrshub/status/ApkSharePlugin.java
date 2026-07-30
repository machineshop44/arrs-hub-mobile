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
 * Copies the currently installed APK into cache and opens the system share sheet
 * (Nearby Share / Quick Share, Bluetooth, Files, email, etc.).
 */
@CapacitorPlugin(name = "ApkShare")
public class ApkSharePlugin extends Plugin {
    private static final String TAG = "ApkShare";
    private static final String SHARE_NAME = "ArrsHubStatus-update.apk";

    @PluginMethod
    public void shareInstalledApk(PluginCall call) {
        try {
            File src = new File(getContext().getApplicationInfo().sourceDir);
            if (!src.exists()) {
                call.reject("Installed APK not found");
                return;
            }

            File outDir = new File(getContext().getCacheDir(), "share");
            if (!outDir.exists() && !outDir.mkdirs()) {
                call.reject("Could not create share cache");
                return;
            }

            File out = new File(outDir, SHARE_NAME);
            try (FileInputStream in = new FileInputStream(src);
                    FileOutputStream fos = new FileOutputStream(out)) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) {
                    fos.write(buf, 0, n);
                }
            }

            String authority = getContext().getPackageName() + ".fileprovider";
            android.net.Uri uri = FileProvider.getUriForFile(getContext(), authority, out);

            Intent send = new Intent(Intent.ACTION_SEND);
            // octet-stream is more often accepted by Quick Share than package-archive,
            // while keeping the .apk filename so the receiver can install it directly.
            send.setType("application/octet-stream");
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.putExtra(Intent.EXTRA_SUBJECT, "Arrs Hub Status update");
            send.putExtra(
                    Intent.EXTRA_TEXT,
                    "Open ArrsHubStatus-update.apk and tap Install. "
                            + "Allow installs from this app/source if Android asks.");
            send.setClipData(ClipData.newUri(getContext().getContentResolver(), "Arrs Hub Status update", uri));
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            Intent chooser = Intent.createChooser(send, "Share Arrs Hub Status APK");
            chooser.setClipData(send.getClipData());
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            getContext().startActivity(chooser);
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
}
