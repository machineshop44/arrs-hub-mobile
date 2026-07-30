package com.arrshub.status;

import android.content.ClipData;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.util.Log;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * Exports the installed app as a sideloadable package and opens the system share
 * sheet (Quick Share, Bluetooth, Files, email, Drive, etc.).
 *
 * <p>Android Studio "Run" often installs split APKs (base + ABI/density). Sharing
 * only {@link ApplicationInfo#sourceDir} produces a file other devices reject with
 * "not available to install". This plugin always gathers every split and, when
 * needed, zips them so another phone can install the full package.
 */
@CapacitorPlugin(name = "ApkShare")
public class ApkSharePlugin extends Plugin {
    private static final String TAG = "ApkShare";
    private static final String SHARE_APK_NAME = "ArrsHubStatus-update.apk";
    private static final String SHARE_SPLITS_NAME = "ArrsHubStatus-update.apks";

    @PluginMethod
    public void shareInstalledApk(PluginCall call) {
        try {
            ApplicationInfo info = getContext().getApplicationInfo();
            List<File> parts = collectInstalledApks(info);
            if (parts.isEmpty()) {
                call.reject("Installed APK not found");
                return;
            }

            File outDir = new File(getContext().getCacheDir(), "share");
            if (!outDir.exists() && !outDir.mkdirs()) {
                call.reject("Could not create share cache");
                return;
            }
            // Drop previous exports so receivers never get a stale partial file.
            File[] old = outDir.listFiles();
            if (old != null) {
                for (File f : old) {
                    //noinspection ResultOfMethodCallIgnored
                    f.delete();
                }
            }

            final File out;
            final String mime;
            final String installHint;
            final boolean splitPackage;

            if (parts.size() == 1) {
                out = new File(outDir, SHARE_APK_NAME);
                copyFile(parts.get(0), out);
                // Correct APK MIME so Pixel Files / package installer offer Install.
                mime = "application/vnd.android.package-archive";
                installHint =
                        "Open ArrsHubStatus-update.apk and tap Install. "
                                + "Allow installs from this app/source if Android asks.";
                splitPackage = false;
            } else {
                // Full split set — single .apks zip (base.apk + split_*.apk).
                out = new File(outDir, SHARE_SPLITS_NAME);
                zipApks(parts, out);
                mime = "application/octet-stream";
                installHint =
                        "This build is a split package (ArrsHubStatus-update.apks). "
                                + "On the other phone: open with SAI / \"Install with Options\", "
                                + "or install the universal APK from the GitHub release instead.";
                splitPackage = true;
                Log.w(TAG, "Installed app has " + parts.size() + " APK splits; sharing .apks zip");
            }

            String authority = getContext().getPackageName() + ".fileprovider";
            android.net.Uri uri = FileProvider.getUriForFile(getContext(), authority, out);

            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(mime);
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.putExtra(Intent.EXTRA_SUBJECT, "Arrs Hub Status update");
            send.putExtra(Intent.EXTRA_TEXT, installHint);
            send.setClipData(
                    ClipData.newUri(
                            getContext().getContentResolver(), "Arrs Hub Status update", uri));
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            Intent chooser = Intent.createChooser(send, "Share Arrs Hub Status APK");
            chooser.setClipData(send.getClipData());
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            getContext().startActivity(chooser);
            Log.i(TAG, "Sharing " + out.getName() + " (" + out.length() + " bytes)");

            JSObject result = new JSObject();
            result.put("bytes", out.length());
            result.put("fileName", out.getName());
            result.put("splitPackage", splitPackage);
            result.put("partCount", parts.size());
            call.resolve(result);
        } catch (Exception err) {
            Log.e(TAG, "Share failed", err);
            call.reject("Could not share app: " + err.getMessage(), err);
        }
    }

    private static List<File> collectInstalledApks(ApplicationInfo info) {
        List<File> parts = new ArrayList<>();
        if (info.sourceDir != null) {
            File base = new File(info.sourceDir);
            if (base.exists()) {
                parts.add(base);
            }
        }
        if (info.splitSourceDirs != null) {
            for (String path : info.splitSourceDirs) {
                if (path == null) continue;
                File split = new File(path);
                if (split.exists()) {
                    parts.add(split);
                }
            }
        }
        return parts;
    }

    private static void copyFile(File src, File dest) throws Exception {
        try (FileInputStream in = new FileInputStream(src);
                FileOutputStream fos = new FileOutputStream(dest)) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) {
                fos.write(buf, 0, n);
            }
        }
    }

    /**
     * Packs every installed APK into an .apks zip using stable entry names
     * (base.apk, split_config.xxx.apk) that SAI / Install with Options expect.
     */
    private static void zipApks(List<File> parts, File dest) throws Exception {
        try (ZipOutputStream zos =
                new ZipOutputStream(new BufferedOutputStream(new FileOutputStream(dest)))) {
            byte[] buf = new byte[8192];
            for (int i = 0; i < parts.size(); i++) {
                File part = parts.get(i);
                String entryName = i == 0 ? "base.apk" : "split_" + sanitizeSplitName(part.getName());
                ZipEntry entry = new ZipEntry(entryName);
                zos.putNextEntry(entry);
                try (BufferedInputStream in = new BufferedInputStream(new FileInputStream(part))) {
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        zos.write(buf, 0, n);
                    }
                }
                zos.closeEntry();
            }
        }
    }

    private static String sanitizeSplitName(String name) {
        // Keep filenames like split_config.arm64_v8a.apk readable inside the zip.
        if (name.startsWith("split_")) {
            return name.substring("split_".length());
        }
        return name;
    }
}
