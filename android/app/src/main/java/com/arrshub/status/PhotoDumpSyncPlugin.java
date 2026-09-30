package com.arrshub.status;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.content.ContextCompat;
import androidx.work.WorkInfo;
import androidx.work.WorkManager;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Photo Dump background sync.
 *
 * <ul>
 *   <li>start/update/stop: legacy foreground-service notification for the JS upload loop.
 *   <li>enqueue/status/cancel/retry/clear/setOptions/getOptions: native WorkManager queue
 *       ({@link PhotoDumpUploadWorker}). Events: uploadItem, uploadProgress, uploadBytes,
 *       uploadComplete.
 * </ul>
 */
@CapacitorPlugin(
        name = "PhotoDumpSync",
        permissions = {
            @Permission(
                    alias = "notifications",
                    strings = {Manifest.permission.POST_NOTIFICATIONS})
        })
public class PhotoDumpSyncPlugin extends Plugin {
    private static WeakReference<PhotoDumpSyncPlugin> instance = new WeakReference<>(null);

    private PluginCall pendingStartCall;

    @Override
    public void load() {
        instance = new WeakReference<>(this);
    }

    /** Forward worker events to JS when the app (bridge) is alive; no-op otherwise. */
    static void emit(String event, JSObject data) {
        PhotoDumpSyncPlugin p = instance.get();
        if (p == null || p.getBridge() == null) return;
        try {
            p.notifyListeners(event, data);
        } catch (Throwable ignored) {
            // bridge torn down mid-emit
        }
    }

    private boolean needsNotificationPermission() {
        return Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(
                                getContext(), Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED;
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (needsNotificationPermission()) {
            pendingStartCall = call;
            requestPermissionForAlias("notifications", call, "notificationsCallback");
            return;
        }
        startService(call, PhotoDumpSyncService.ACTION_START);
    }

    @PermissionCallback
    private void notificationsCallback(PluginCall call) {
        PluginCall pending = pendingStartCall != null ? pendingStartCall : call;
        pendingStartCall = null;
        // Proceed even if denied — service may still run without a visible notif on some OEMs.
        startService(pending, PhotoDumpSyncService.ACTION_START);
    }

    @PluginMethod
    public void update(PluginCall call) {
        startService(call, PhotoDumpSyncService.ACTION_UPDATE);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try {
            Intent intent = new Intent(getContext(), PhotoDumpSyncService.class);
            intent.setAction(PhotoDumpSyncService.ACTION_STOP);
            getContext().startService(intent);
        } catch (Throwable ignored) {
            // ignore
        }
        JSObject out = new JSObject();
        out.put("ok", true);
        call.resolve(out);
    }

    private void startService(PluginCall call, String action) {
        try {
            Intent intent = new Intent(getContext(), PhotoDumpSyncService.class);
            intent.setAction(action);
            String title = call.getString("title", "Photo Dump");
            String text = call.getString("text", "Uploading…");
            Integer current = call.getInt("current", 0);
            Integer total = call.getInt("total", 0);
            intent.putExtra(PhotoDumpSyncService.EXTRA_TITLE, title);
            intent.putExtra(PhotoDumpSyncService.EXTRA_TEXT, text);
            intent.putExtra(
                    PhotoDumpSyncService.EXTRA_CURRENT, current != null ? current : 0);
            intent.putExtra(PhotoDumpSyncService.EXTRA_TOTAL, total != null ? total : 0);
            ContextCompat.startForegroundService(getContext(), intent);
            JSObject out = new JSObject();
            out.put("ok", true);
            call.resolve(out);
        } catch (Exception err) {
            call.reject("Could not start sync service: " + err.getMessage(), err);
        } catch (Throwable err) {
            call.reject("Could not start sync service: " + err.getMessage());
        }
    }

    // ---- native WorkManager queue ----

    /**
     * { url, headers, folder, items: [{ id?, uri, name?, size?, mimeType?, folder? }],
     *   wifiOnly?, chargingOnly? } → { added: string[], queued }
     */
    @PluginMethod
    public void enqueue(PluginCall call) {
        if (needsNotificationPermission()) {
            requestPermissionForAlias("notifications", call, "enqueueAfterPermission");
            return;
        }
        doEnqueue(call);
    }

    @PermissionCallback
    private void enqueueAfterPermission(PluginCall call) {
        // Upload proceeds without a visible notification if denied.
        doEnqueue(call);
    }

    private void doEnqueue(PluginCall call) {
        Context ctx = getContext();
        String url = call.getString("url", "");
        if (url == null || url.trim().isEmpty()) {
            call.reject("Missing url");
            return;
        }
        JSArray raw = call.getArray("items");
        if (raw == null || raw.length() == 0) {
            call.reject("Missing items");
            return;
        }
        String folder = call.getString("folder", "");
        applyOptionFlags(call);
        PhotoDumpQueueStore.setConfig(ctx, url, call.getObject("headers", new JSObject()), folder);

        List<JSONObject> items = new ArrayList<>();
        for (int i = 0; i < raw.length(); i++) {
            JSONObject it = raw.optJSONObject(i);
            if (it == null) continue;
            String uri = it.optString("uri", "");
            try {
                PhotoDumpUploader.requireAllowedMediaUri(uri);
            } catch (SecurityException err) {
                continue;
            }
            try {
                if (!it.has("folder")) it.put("folder", folder == null ? "" : folder);
            } catch (Exception ignored) {
                // ignore
            }
            items.add(it);
        }
        List<String> added = PhotoDumpQueueStore.enqueue(ctx, items);
        if (!added.isEmpty()) PhotoDumpUploadWorker.scheduleUpload(ctx);

        JSObject out = new JSObject();
        out.put("added", new JSArray(added));
        out.put("queued", added.size());
        call.resolve(out);
    }

    /** → { running, total, pending, active, done, failed, items: [...] } */
    @PluginMethod
    public void status(PluginCall call) {
        final Context ctx = getContext();
        new Thread(
                        () -> {
                            JSObject out =
                                    PhotoDumpUploadWorker.countsEvent(
                                            PhotoDumpQueueStore.counts(ctx));
                            out.put("running", isUploadRunning(ctx));
                            out.put("items", PhotoDumpQueueStore.snapshotItems(ctx));
                            call.resolve(out);
                        },
                        "PhotoDump-status")
                .start();
    }

    private static boolean isUploadRunning(Context ctx) {
        try {
            List<WorkInfo> infos =
                    WorkManager.getInstance(ctx.getApplicationContext())
                            .getWorkInfosForUniqueWork(PhotoDumpUploadWorker.UNIQUE_UPLOAD)
                            .get();
            for (WorkInfo info : infos) {
                WorkInfo.State s = info.getState();
                if (s == WorkInfo.State.RUNNING
                        || s == WorkInfo.State.ENQUEUED
                        || s == WorkInfo.State.BLOCKED) {
                    return true;
                }
            }
        } catch (Exception ignored) {
            // treat as idle
        }
        return false;
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        Context ctx = getContext();
        int n = PhotoDumpQueueStore.cancelActive(ctx);
        PhotoDumpUploadWorker.cancelUpload(ctx);
        JSObject ev = PhotoDumpUploadWorker.countsEvent(PhotoDumpQueueStore.counts(ctx));
        emit("uploadComplete", ev);
        JSObject out = new JSObject();
        out.put("cancelled", n);
        call.resolve(out);
    }

    /** { ids?: string[] } — error/cancelled → pending, then schedule. */
    @PluginMethod
    public void retry(PluginCall call) {
        Context ctx = getContext();
        int n = PhotoDumpQueueStore.retry(ctx, idsFrom(call));
        if (n > 0) PhotoDumpUploadWorker.scheduleUpload(ctx);
        JSObject out = new JSObject();
        out.put("retried", n);
        call.resolve(out);
    }

    /** { ids?: string[] } — drop rows (all finished rows when ids omitted). */
    @PluginMethod
    public void clear(PluginCall call) {
        int n = PhotoDumpQueueStore.remove(getContext(), idsFrom(call));
        JSObject out = new JSObject();
        out.put("removed", n);
        call.resolve(out);
    }

    /**
     * { wifiOnly?, chargingOnly?, autoBackup?, autoFolder?, url?, headers? } — persists and
     * (re)schedules the auto-backup periodic worker.
     */
    @PluginMethod
    public void setOptions(PluginCall call) {
        Context ctx = getContext();
        SharedPreferences p = PhotoDumpQueueStore.prefs(ctx);
        boolean wifiBefore = p.getBoolean(PhotoDumpQueueStore.PREF_WIFI_ONLY, false);
        boolean chargingBefore = p.getBoolean(PhotoDumpQueueStore.PREF_CHARGING_ONLY, false);
        applyOptionFlags(call);
        String url = call.getString("url");
        if (url != null && !url.trim().isEmpty()) {
            PhotoDumpQueueStore.setConfig(ctx, url, call.getObject("headers"), null);
        }
        boolean constraintsChanged =
                wifiBefore != p.getBoolean(PhotoDumpQueueStore.PREF_WIFI_ONLY, false)
                        || chargingBefore
                                != p.getBoolean(PhotoDumpQueueStore.PREF_CHARGING_ONLY, false);
        if (constraintsChanged) {
            PhotoDumpQueueStore.Counts c = PhotoDumpQueueStore.counts(ctx);
            if (c.pending + c.active > 0) PhotoDumpUploadWorker.rescheduleUpload(ctx);
        }
        PhotoDumpUploadWorker.syncAutoBackupSchedule(ctx);
        getOptions(call);
    }

    @PluginMethod
    public void getOptions(PluginCall call) {
        SharedPreferences p = PhotoDumpQueueStore.prefs(getContext());
        JSObject out = new JSObject();
        out.put("wifiOnly", p.getBoolean(PhotoDumpQueueStore.PREF_WIFI_ONLY, false));
        out.put("chargingOnly", p.getBoolean(PhotoDumpQueueStore.PREF_CHARGING_ONLY, false));
        out.put("autoBackup", p.getBoolean(PhotoDumpQueueStore.PREF_AUTO_BACKUP, false));
        out.put("autoFolder", p.getString(PhotoDumpQueueStore.PREF_AUTO_FOLDER, ""));
        out.put("configured", PhotoDumpQueueStore.hasConfig(getContext()));
        call.resolve(out);
    }

    private void applyOptionFlags(PluginCall call) {
        SharedPreferences p = PhotoDumpQueueStore.prefs(getContext());
        SharedPreferences.Editor e = p.edit();
        Boolean wifi = call.getBoolean("wifiOnly");
        Boolean charging = call.getBoolean("chargingOnly");
        Boolean auto = call.getBoolean("autoBackup");
        String autoFolder = call.getString("autoFolder");
        if (wifi != null) e.putBoolean(PhotoDumpQueueStore.PREF_WIFI_ONLY, wifi);
        if (charging != null) e.putBoolean(PhotoDumpQueueStore.PREF_CHARGING_ONLY, charging);
        if (autoFolder != null) e.putString(PhotoDumpQueueStore.PREF_AUTO_FOLDER, autoFolder);
        if (auto != null) {
            boolean was = p.getBoolean(PhotoDumpQueueStore.PREF_AUTO_BACKUP, false);
            e.putBoolean(PhotoDumpQueueStore.PREF_AUTO_BACKUP, auto);
            if (auto && !was) {
                // Only media added from now on — never back-fill the whole gallery.
                e.putLong(
                        PhotoDumpQueueStore.PREF_AUTO_WATERMARK,
                        System.currentTimeMillis() / 1000L);
            }
        }
        e.apply();
    }

    private static List<String> idsFrom(PluginCall call) {
        JSArray raw = call.getArray("ids");
        if (raw == null) return null;
        List<String> ids = new ArrayList<>();
        JSONArray arr = raw;
        for (int i = 0; i < arr.length(); i++) {
            String s = arr.optString(i, "");
            if (!s.isEmpty()) ids.add(s);
        }
        return ids;
    }
}
