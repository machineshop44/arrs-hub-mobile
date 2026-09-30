package com.arrshub.status;

import android.app.Notification;
import android.app.PendingIntent;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.net.Uri;
import android.os.Build;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.ForegroundInfo;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import com.getcapacitor.JSObject;
import java.io.IOException;
import java.io.UnsupportedEncodingException;
import java.net.URLEncoder;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

/**
 * Sequentially uploads everything pending in {@link PhotoDumpQueueStore}. Runs as a
 * foreground (dataSync) worker so uploads survive the app being closed.
 */
public class PhotoDumpUploadWorker extends Worker {
    private static final String TAG = "PhotoDumpWorker";
    public static final String UNIQUE_UPLOAD = "photo_dump_upload";
    public static final String UNIQUE_AUTO_BACKUP = "photo_dump_auto_backup";
    private static final int NOTIFICATION_ID = 4402;
    private static final long MAX_FILE_BYTES = 2L * 1024 * 1024 * 1024;
    private static final long PROGRESS_THROTTLE_MS = 750;

    private int processedThisRun = 0;
    private long lastProgressEmit = 0;
    private final Set<String> skipThisRun = new HashSet<>();

    public PhotoDumpUploadWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    // ---- scheduling ----

    public static Constraints constraints(Context ctx) {
        SharedPreferences p = PhotoDumpQueueStore.prefs(ctx);
        return new Constraints.Builder()
                .setRequiredNetworkType(
                        p.getBoolean(PhotoDumpQueueStore.PREF_WIFI_ONLY, false)
                                ? NetworkType.UNMETERED
                                : NetworkType.CONNECTED)
                .setRequiresCharging(p.getBoolean(PhotoDumpQueueStore.PREF_CHARGING_ONLY, false))
                .build();
    }

    /** Queue a worker run after any in-flight run (which picks up new items anyway). */
    public static void scheduleUpload(Context ctx) {
        enqueueUpload(ctx, ExistingWorkPolicy.APPEND_OR_REPLACE);
    }

    /** Restart with fresh constraints (Wi-Fi / charging toggled); in-flight item goes back to pending. */
    public static void rescheduleUpload(Context ctx) {
        enqueueUpload(ctx, ExistingWorkPolicy.REPLACE);
    }

    private static void enqueueUpload(Context ctx, ExistingWorkPolicy policy) {
        OneTimeWorkRequest req =
                new OneTimeWorkRequest.Builder(PhotoDumpUploadWorker.class)
                        .setConstraints(constraints(ctx))
                        .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                        .addTag(UNIQUE_UPLOAD)
                        .build();
        WorkManager.getInstance(ctx.getApplicationContext())
                .enqueueUniqueWork(UNIQUE_UPLOAD, policy, req);
    }

    public static void cancelUpload(Context ctx) {
        WorkManager.getInstance(ctx.getApplicationContext()).cancelUniqueWork(UNIQUE_UPLOAD);
    }

    public static void syncAutoBackupSchedule(Context ctx) {
        WorkManager wm = WorkManager.getInstance(ctx.getApplicationContext());
        if (!PhotoDumpQueueStore.prefs(ctx).getBoolean(PhotoDumpQueueStore.PREF_AUTO_BACKUP, false)) {
            wm.cancelUniqueWork(UNIQUE_AUTO_BACKUP);
            return;
        }
        PeriodicWorkRequest req =
                new PeriodicWorkRequest.Builder(
                                PhotoDumpAutoBackupWorker.class, 15, TimeUnit.MINUTES)
                        .setConstraints(constraints(ctx))
                        .addTag(UNIQUE_AUTO_BACKUP)
                        .build();
        wm.enqueueUniquePeriodicWork(UNIQUE_AUTO_BACKUP, ExistingPeriodicWorkPolicy.UPDATE, req);
    }

    // ---- work ----

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        PhotoDumpQueueStore.resetInterrupted(ctx);
        if (PhotoDumpQueueStore.nextPending(ctx, null) == null) {
            emitComplete(ctx);
            return Result.success();
        }
        PhotoDumpSyncService.ensureChannel(ctx);
        promoteToForeground(ctx, "Starting…", 0, 0);

        boolean retryLater = false;
        while (!isStopped()) {
            JSONObject item = PhotoDumpQueueStore.nextPending(ctx, skipThisRun);
            if (item == null) break;
            if (!processItem(ctx, item)) retryLater = true;
            processedThisRun++;
        }

        if (isStopped()) {
            // Constraints lost / cancelled — resetInterrupted handles leftovers next run.
            return Result.retry();
        }
        emitComplete(ctx);
        if (retryLater && getRunAttemptCount() < 6) {
            // Transient failures were left pending; WorkManager backoff re-runs us.
            return Result.retry();
        }
        return Result.success();
    }

    /** Returns false when the item hit a transient failure and was left pending for retry. */
    private boolean processItem(Context ctx, JSONObject item) {
        String id = item.optString("id");
        ContentResolver resolver = ctx.getContentResolver();
        JSONObject cfg = PhotoDumpQueueStore.getConfig(ctx);
        String url = cfg.optString("url", "");
        if (url.isEmpty()) {
            fail(ctx, id, "No upload URL — open Photo Dump and upload once to save Hub settings.");
            return true;
        }
        final Uri uri;
        try {
            uri = PhotoDumpUploader.requireAllowedMediaUri(item.optString("uri"));
        } catch (SecurityException err) {
            fail(ctx, id, err.getMessage());
            return true;
        }
        String name = item.optString("name", "media");
        int attempts = item.optInt("attempts", 0);
        PhotoDumpUploader.Cancellation cancel = this::isStopped;

        try {
            setItem(ctx, id, "hashing", null);
            notifyProgress(ctx, "Hashing " + name);
            PhotoDumpUploader.HashResult hashed = PhotoDumpUploader.hash(resolver, uri, cancel);
            if (hashed.size > MAX_FILE_BYTES) {
                fail(ctx, id, "File exceeds upload cap (2 GB).");
                return true;
            }

            Map<String, String> headers = new HashMap<>();
            JSONObject base = cfg.optJSONObject("headers");
            if (base != null) {
                Iterator<String> keys = base.keys();
                while (keys.hasNext()) {
                    String k = keys.next();
                    headers.put(k, base.optString(k));
                }
            }
            headers.put("Accept", "application/json");
            headers.put("X-File-Name", encodeUriComponent(name));
            headers.put(
                    "X-Relative-Folder",
                    encodeUriComponent(item.optString("folder", "").replace('\\', '/')));
            headers.put("X-Content-SHA256", hashed.sha256);
            headers.put("X-Expected-Size", String.valueOf(hashed.size));
            int timeoutMs =
                    (int)
                            Math.min(
                                    30L * 60 * 1000,
                                    Math.max(120_000L, ((hashed.size + 49_999) / 50_000) * 1000));

            JSObject patch = new JSObject();
            patch.put("status", "uploading");
            patch.put("sha256", hashed.sha256);
            patch.put("size", hashed.size);
            patch.put("bytesSent", 0);
            PhotoDumpQueueStore.update(ctx, id, patch);
            notifyProgress(ctx, "Uploading " + name);

            PhotoDumpUploader.UploadResult res =
                    PhotoDumpUploader.upload(
                            resolver,
                            uri,
                            url,
                            headers,
                            timeoutMs,
                            hashed.size,
                            cancel,
                            (sent, total) -> emitBytes(ctx, id, sent, total));

            int status = res.status;
            if (status == 0 || status == 408 || status == 429 || status >= 500) {
                return transientFail(
                        ctx, id, attempts, "Hub returned HTTP " + status + ". Retrying later.");
            }
            JSONObject json = parseJson(res.body);
            if (status < 200 || status >= 300) {
                String detail = json.optString("error", "");
                fail(
                        ctx,
                        id,
                        (detail.isEmpty() ? "Upload failed" : detail)
                                + " (HTTP "
                                + status
                                + "). Phone copy kept.");
                return true;
            }
            boolean duplicate = json.optBoolean("duplicate", false);
            String remoteSha = json.optString("sha256", "").toLowerCase();
            long remoteSize = json.optLong("size", hashed.size);
            boolean ok =
                    json.optBoolean("ok", false)
                            && json.optBoolean("verified", false)
                            && remoteSha.equals(hashed.sha256)
                            && (duplicate || remoteSize == hashed.size);
            if (!ok) {
                fail(
                        ctx,
                        id,
                        duplicate
                                ? "Hub duplicate response failed verification (hash mismatch). Phone copy kept."
                                : "Hub did not verify upload (size/hash mismatch). Phone copy kept.");
                return true;
            }
            JSObject done = new JSObject();
            done.put("status", "done");
            done.put("duplicate", duplicate);
            done.put("remotePath", json.optString("path", ""));
            done.put("fileName", json.optString("fileName", name));
            done.put("remoteSize", remoteSize);
            done.put("message", JSONObject.NULL);
            emitItem(ctx, PhotoDumpQueueStore.update(ctx, id, done));
            return true;
        } catch (PhotoDumpUploader.CancelledException err) {
            JSONObject cur = PhotoDumpQueueStore.get(ctx, id);
            if (cur != null && !"cancelled".equals(cur.optString("status"))) {
                setItem(ctx, id, "pending", null);
            }
            return true;
        } catch (SecurityException err) {
            fail(ctx, id, "Permission denied reading media: " + err.getMessage());
            return true;
        } catch (IOException err) {
            return transientFail(ctx, id, attempts, "Network error: " + err.getMessage());
        } catch (Exception err) {
            Log.e(TAG, "upload failed for " + uri, err);
            fail(ctx, id, "Upload failed: " + err.getMessage());
            return true;
        }
    }

    private boolean transientFail(Context ctx, String id, int attempts, String msg) {
        int next = attempts + 1;
        if (next >= PhotoDumpQueueStore.MAX_ATTEMPTS) {
            fail(ctx, id, msg.replace(" Retrying later.", "") + " Gave up after " + next + " tries. Phone copy kept.");
            return true;
        }
        JSObject patch = new JSObject();
        patch.put("status", "pending");
        patch.put("retrying", true);
        patch.put("attempts", next);
        patch.put("message", msg);
        emitItem(ctx, PhotoDumpQueueStore.update(ctx, id, patch));
        skipThisRun.add(id);
        return false;
    }

    private void fail(Context ctx, String id, String msg) {
        JSObject patch = new JSObject();
        patch.put("status", "error");
        patch.put("retrying", false);
        patch.put("message", msg);
        emitItem(ctx, PhotoDumpQueueStore.update(ctx, id, patch));
    }

    private void setItem(Context ctx, String id, String status, String msg) {
        JSObject patch = new JSObject();
        patch.put("status", status);
        if (msg != null) patch.put("message", msg);
        emitItem(ctx, PhotoDumpQueueStore.update(ctx, id, patch));
    }

    private static JSONObject parseJson(String body) {
        try {
            return body == null || body.trim().isEmpty() ? new JSONObject() : new JSONObject(body);
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    /** Matches JS encodeURIComponent closely enough for Hub's decodeURIComponent. */
    static String encodeUriComponent(String s) {
        try {
            return URLEncoder.encode(s == null ? "" : s, "UTF-8")
                    .replace("+", "%20")
                    .replace("%21", "!")
                    .replace("%27", "'")
                    .replace("%28", "(")
                    .replace("%29", ")")
                    .replace("%7E", "~");
        } catch (UnsupportedEncodingException e) {
            return s;
        }
    }

    // ---- progress / events ----

    private void notifyProgress(Context ctx, String label) {
        PhotoDumpQueueStore.Counts c = PhotoDumpQueueStore.counts(ctx);
        int remaining = c.pending + c.active;
        int total = processedThisRun + remaining;
        promoteToForeground(ctx, label, processedThisRun, total);
        JSObject ev = countsEvent(c);
        ev.put("label", label);
        ev.put("current", processedThisRun);
        ev.put("runTotal", total);
        PhotoDumpSyncPlugin.emit("uploadProgress", ev);
    }

    private void emitItem(Context ctx, JSONObject item) {
        if (item == null) return;
        JSObject ev = countsEvent(PhotoDumpQueueStore.counts(ctx));
        ev.put("item", item);
        PhotoDumpSyncPlugin.emit("uploadItem", ev);
    }

    private void emitBytes(Context ctx, String id, long sent, long total) {
        long now = System.currentTimeMillis();
        if (now - lastProgressEmit < PROGRESS_THROTTLE_MS) return;
        lastProgressEmit = now;
        JSObject ev = new JSObject();
        ev.put("id", id);
        ev.put("bytesSent", sent);
        ev.put("bytesTotal", total);
        PhotoDumpSyncPlugin.emit("uploadBytes", ev);
    }

    private static void emitComplete(Context ctx) {
        PhotoDumpQueueStore.pruneAutoDone(ctx);
        PhotoDumpSyncPlugin.emit("uploadComplete", countsEvent(PhotoDumpQueueStore.counts(ctx)));
    }

    static JSObject countsEvent(PhotoDumpQueueStore.Counts c) {
        JSObject ev = new JSObject();
        ev.put("total", c.total);
        ev.put("pending", c.pending);
        ev.put("active", c.active);
        ev.put("done", c.done);
        ev.put("failed", c.failed);
        return ev;
    }

    private void promoteToForeground(Context ctx, String text, int current, int total) {
        try {
            setForegroundAsync(foregroundInfo(ctx, text, current, total));
        } catch (Throwable err) {
            // Android 12+ may refuse a background FGS start; the worker still runs.
            Log.w(TAG, "setForeground refused", err);
        }
    }

    private static ForegroundInfo foregroundInfo(Context ctx, String text, int current, int total) {
        Intent launch = new Intent(ctx, MainActivity.class);
        launch.setAction(Intent.ACTION_MAIN);
        launch.addCategory(Intent.CATEGORY_LAUNCHER);
        launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi =
                PendingIntent.getActivity(
                        ctx,
                        0,
                        launch,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b =
                new NotificationCompat.Builder(ctx, PhotoDumpSyncService.CHANNEL_ID)
                        .setContentTitle("Photo Dump")
                        .setContentText(text)
                        .setSmallIcon(android.R.drawable.stat_sys_upload)
                        .setContentIntent(pi)
                        .setOngoing(true)
                        .setOnlyAlertOnce(true)
                        .setCategory(NotificationCompat.CATEGORY_PROGRESS)
                        .setPriority(NotificationCompat.PRIORITY_LOW);
        if (total > 0) {
            b.setProgress(total, Math.min(current, total), false);
            b.setSubText(current + "/" + total);
        } else {
            b.setProgress(0, 0, true);
        }
        Notification n = b.build();
        if (Build.VERSION.SDK_INT >= 29) {
            return new ForegroundInfo(
                    NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        }
        return new ForegroundInfo(NOTIFICATION_ID, n);
    }
}
