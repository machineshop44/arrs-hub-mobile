package com.arrshub.status;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONObject;

/**
 * Periodic (15 min) scan for new camera photos/videos (MediaStore DATE_ADDED > watermark);
 * enqueues them into {@link PhotoDumpQueueStore} using the last saved upload config.
 */
public class PhotoDumpAutoBackupWorker extends Worker {
    private static final String TAG = "PhotoDumpAutoBackup";

    public PhotoDumpAutoBackupWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        SharedPreferences prefs = PhotoDumpQueueStore.prefs(ctx);
        if (!prefs.getBoolean(PhotoDumpQueueStore.PREF_AUTO_BACKUP, false)) return Result.success();
        if (!PhotoDumpQueueStore.hasConfig(ctx)) return Result.success();

        long watermark = prefs.getLong(PhotoDumpQueueStore.PREF_AUTO_WATERMARK, 0);
        if (watermark <= 0) {
            prefs.edit()
                    .putLong(
                            PhotoDumpQueueStore.PREF_AUTO_WATERMARK,
                            System.currentTimeMillis() / 1000L)
                    .apply();
            return Result.success();
        }

        String folder = prefs.getString(PhotoDumpQueueStore.PREF_AUTO_FOLDER, null);
        if (folder == null) folder = PhotoDumpQueueStore.getConfig(ctx).optString("folder", "");

        List<JSONObject> found = new ArrayList<>();
        long maxAdded = watermark;
        try {
            ContentResolver resolver = ctx.getContentResolver();
            if (canRead(ctx, Manifest.permission.READ_MEDIA_IMAGES)) {
                maxAdded =
                        Math.max(
                                maxAdded,
                                scan(resolver, MediaStore.Images.Media.EXTERNAL_CONTENT_URI, watermark, folder, found));
            }
            if (canRead(ctx, Manifest.permission.READ_MEDIA_VIDEO)) {
                maxAdded =
                        Math.max(
                                maxAdded,
                                scan(resolver, MediaStore.Video.Media.EXTERNAL_CONTENT_URI, watermark, folder, found));
            }
        } catch (Exception err) {
            Log.w(TAG, "MediaStore scan failed", err);
            return Result.success();
        }

        prefs.edit().putLong(PhotoDumpQueueStore.PREF_AUTO_WATERMARK, maxAdded).apply();
        if (found.isEmpty()) return Result.success();

        List<String> added = PhotoDumpQueueStore.enqueue(ctx, found);
        Log.i(TAG, "Auto-backup queued " + added.size() + " new camera item(s)");
        if (!added.isEmpty()) PhotoDumpUploadWorker.scheduleUpload(ctx);
        return Result.success();
    }

    private static boolean canRead(Context ctx, String mediaPermission) {
        String perm =
                Build.VERSION.SDK_INT >= 33
                        ? mediaPermission
                        : Manifest.permission.READ_EXTERNAL_STORAGE;
        return ContextCompat.checkSelfPermission(ctx, perm) == PackageManager.PERMISSION_GRANTED;
    }

    @SuppressWarnings("deprecation")
    private static long scan(
            ContentResolver resolver,
            Uri collection,
            long watermarkSec,
            String folder,
            List<JSONObject> out) {
        String pathCol =
                Build.VERSION.SDK_INT >= 29
                        ? MediaStore.MediaColumns.RELATIVE_PATH
                        : MediaStore.MediaColumns.DATA;
        String pathPattern = Build.VERSION.SDK_INT >= 29 ? "DCIM/%" : "%/DCIM/%";
        String[] projection =
                new String[] {
                    MediaStore.MediaColumns._ID,
                    MediaStore.MediaColumns.DISPLAY_NAME,
                    MediaStore.MediaColumns.MIME_TYPE,
                    MediaStore.MediaColumns.SIZE,
                    MediaStore.MediaColumns.DATE_ADDED
                };
        String selection =
                MediaStore.MediaColumns.DATE_ADDED + " > ? AND " + pathCol + " LIKE ?";
        String[] args = new String[] {String.valueOf(watermarkSec), pathPattern};
        String sort = MediaStore.MediaColumns.DATE_ADDED + " ASC";
        long max = watermarkSec;
        boolean video = collection.equals(MediaStore.Video.Media.EXTERNAL_CONTENT_URI);
        try (Cursor c = resolver.query(collection, projection, selection, args, sort)) {
            if (c == null) return max;
            int idIdx = c.getColumnIndexOrThrow(MediaStore.MediaColumns._ID);
            int nameIdx = c.getColumnIndex(MediaStore.MediaColumns.DISPLAY_NAME);
            int mimeIdx = c.getColumnIndex(MediaStore.MediaColumns.MIME_TYPE);
            int sizeIdx = c.getColumnIndex(MediaStore.MediaColumns.SIZE);
            int addedIdx = c.getColumnIndex(MediaStore.MediaColumns.DATE_ADDED);
            while (c.moveToNext()) {
                long id = c.getLong(idIdx);
                long added = addedIdx >= 0 ? c.getLong(addedIdx) : 0;
                if (added > max) max = added;
                String name = nameIdx >= 0 && !c.isNull(nameIdx) ? c.getString(nameIdx) : null;
                String mime = mimeIdx >= 0 && !c.isNull(mimeIdx) ? c.getString(mimeIdx) : null;
                JSONObject item = new JSONObject();
                item.put("uri", ContentUris.withAppendedId(collection, id).toString());
                item.put("name", name == null || name.trim().isEmpty() ? "media-" + id : name.trim());
                item.put("mimeType", mime != null ? mime : (video ? "video/*" : "image/*"));
                item.put("size", sizeIdx >= 0 && !c.isNull(sizeIdx) ? c.getLong(sizeIdx) : 0);
                item.put("folder", folder == null ? "" : folder);
                item.put("source", "auto");
                item.put("id", "auto-" + (video ? "v" : "i") + id);
                out.add(item);
            }
        } catch (Exception err) {
            Log.w(TAG, "scan failed for " + collection, err);
        }
        return max;
    }
}
