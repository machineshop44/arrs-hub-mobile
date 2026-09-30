package com.arrshub.status;

import android.Manifest;
import android.app.Activity;
import android.app.PendingIntent;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.util.Log;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import android.graphics.Bitmap;
import android.media.MediaMetadataRetriever;
import android.util.Size;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;

/**
 * Gallery pick, MediaStore month query, and ContentResolver delete for Photo Dump.
 */
@CapacitorPlugin(
        name = "PhotoDumpMedia",
        permissions = {
            @Permission(
                    alias = "images",
                    strings = {Manifest.permission.READ_MEDIA_IMAGES}),
            @Permission(
                    alias = "videos",
                    strings = {Manifest.permission.READ_MEDIA_VIDEO}),
            @Permission(
                    alias = "storage",
                    strings = {Manifest.permission.READ_EXTERNAL_STORAGE})
        })
public class PhotoDumpMediaPlugin extends Plugin {
    private static final String TAG = "PhotoDumpMedia";

    private ActivityResultLauncher<IntentSenderRequest> deleteSenderLauncher;
    private String pendingDeleteCallId;
    private int pendingDeleteCount;
    private JSArray pendingSharedItems = new JSArray();
    private String lastShareFingerprint = "";

    private static Uri requireAllowedMediaUri(String uriStr) throws SecurityException {
        return PhotoDumpUploader.requireAllowedMediaUri(uriStr);
    }

    /** Drop sticky ACTION_SEND extras so a cold start does not re-ingest. */
    private void clearStickyShareIntent() {
        try {
            Activity act = getActivity();
            if (act == null) return;
            Intent clean = new Intent(act, act.getClass());
            clean.setAction(Intent.ACTION_MAIN);
            clean.addCategory(Intent.CATEGORY_LAUNCHER);
            act.setIntent(clean);
        } catch (Throwable err) {
            Log.w(TAG, "clearStickyShareIntent failed", err);
        }
    }

    @Override
    public void load() {
        deleteSenderLauncher =
                getActivity()
                        .getActivityResultRegistry()
                        .register(
                                "PhotoDumpMedia-delete-" + System.identityHashCode(this),
                                new ActivityResultContracts.StartIntentSenderForResult(),
                                result -> {
                                    PluginCall call =
                                            getBridge().getSavedCall(pendingDeleteCallId);
                                    int count = pendingDeleteCount;
                                    pendingDeleteCallId = null;
                                    pendingDeleteCount = 0;
                                    if (call == null) {
                                        return;
                                    }
                                    getBridge().releaseCall(call);
                                    JSObject out = new JSObject();
                                    boolean ok = result.getResultCode() == Activity.RESULT_OK;
                                    out.put("deleted", ok);
                                    out.put("deletedCount", ok ? count : 0);
                                    out.put(
                                            "message",
                                            ok
                                                    ? "Deleted"
                                                    : "Delete cancelled or not permitted by system");
                                    call.resolve(out);
                                });
        Activity activity = getActivity();
        if (activity != null) {
            ingestShareIntent(activity.getIntent());
        }
    }

    /**
     * Called from {@link MainActivity} for cold start and {@code onNewIntent} shares
     * (Google Photos / Gallery → Share → Arrs Hub Photo Dump).
     */
    public void ingestShareIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (!Intent.ACTION_SEND.equals(action)
                && !Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            return;
        }

        ContentResolver resolver = getContext().getContentResolver();
        List<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> list = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (list != null) {
                for (Uri uri : list) {
                    if (uri != null) uris.add(uri);
                }
            }
        } else {
            Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (uri != null) uris.add(uri);
            // Some senders only put the URI in data.
            if (uris.isEmpty() && intent.getData() != null) {
                uris.add(intent.getData());
            }
        }
        if (uris.isEmpty()) return;

        StringBuilder fp = new StringBuilder(action == null ? "" : action);
        for (Uri uri : uris) {
            fp.append('|').append(uri);
        }
        String fingerprint = fp.toString();
        // Skip if we already ingested (or consumed) this exact share — even when
        // pending is empty, so sticky ACTION_SEND re-delivery does not re-queue.
        if (fingerprint.equals(lastShareFingerprint)) {
            return;
        }
        lastShareFingerprint = fingerprint;

        JSArray fresh = new JSArray();
        int flags = intent.getFlags();
        for (Uri uri : uris) {
            if (uri == null) continue;
            String type = resolver.getType(uri);
            if (type == null) type = intent.getType();
            if (type != null
                    && !(type.startsWith("image/") || type.startsWith("video/"))) {
                // Allow unknown types through — describeUri still works for many providers.
                if (!type.equals("*/*") && !type.startsWith("application/octet-stream")) {
                    Log.i(TAG, "Skipping shared non-media type " + type + " for " + uri);
                    continue;
                }
            }
            takeShareUriPermission(resolver, uri, flags);
            JSObject item = describeUri(resolver, uri);
            if (item != null) {
                fresh.put(item);
                pendingSharedItems.put(item);
            }
        }
        if (fresh.length() == 0) return;

        JSObject event = new JSObject();
        event.put("items", fresh);
        event.put("count", fresh.length());
        notifyListeners("shareReceived", event);
        Log.i(TAG, "Ingested " + fresh.length() + " shared media item(s)");
        clearStickyShareIntent();
    }

    private void takeShareUriPermission(ContentResolver resolver, Uri uri, int intentFlags) {
        int takeFlags =
                intentFlags
                        & (Intent.FLAG_GRANT_READ_URI_PERMISSION
                                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        if (takeFlags == 0) {
            takeFlags = Intent.FLAG_GRANT_READ_URI_PERMISSION;
        }
        // Persist only when the sender offered it (rare for Photos share).
        if ((intentFlags & Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION) != 0) {
            try {
                resolver.takePersistableUriPermission(uri, takeFlags);
                return;
            } catch (SecurityException | IllegalArgumentException err) {
                Log.w(TAG, "Persistable share URI grant failed for " + uri, err);
            }
        }
        // Temporary grant from the share Intent is enough while this process holds the URI.
    }

    /** Return and clear media received via Android Share sheet. */
    @PluginMethod
    public void consumeSharedMedia(PluginCall call) {
        JSArray outItems = pendingSharedItems;
        pendingSharedItems = new JSArray();
        // Keep lastShareFingerprint so the same sticky Intent is not re-ingested.
        clearStickyShareIntent();
        JSObject out = new JSObject();
        out.put("items", outItems);
        out.put("count", outItems.length());
        call.resolve(out);
    }

    @PluginMethod
    public void pickMedia(PluginCall call) {
        boolean multiple = Boolean.TRUE.equals(call.getBoolean("multiple", true));
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[] {"image/*", "video/*"});
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multiple);
        // Write grant is required so we can delete after Hub verifies the upload.
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        intent.addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "pickMediaResult");
    }

    @ActivityCallback
    private void pickMediaResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        if (result.getResultCode() != Activity.RESULT_OK) {
            JSObject out = new JSObject();
            out.put("items", new JSArray());
            call.resolve(out);
            return;
        }

        Intent data = result.getData();
        JSArray items = new JSArray();
        if (data == null) {
            JSObject out = new JSObject();
            out.put("items", items);
            call.resolve(out);
            return;
        }

        ContentResolver resolver = getContext().getContentResolver();
        if (data.getClipData() != null) {
            int count = data.getClipData().getItemCount();
            for (int i = 0; i < count; i++) {
                Uri uri = data.getClipData().getItemAt(i).getUri();
                if (uri != null) {
                    takePersistableRead(resolver, uri, data.getFlags());
                    JSObject item = describeUri(resolver, uri);
                    if (item != null) {
                        items.put(item);
                    }
                }
            }
        } else if (data.getData() != null) {
            Uri uri = data.getData();
            takePersistableRead(resolver, uri, data.getFlags());
            JSObject item = describeUri(resolver, uri);
            if (item != null) {
                items.put(item);
            }
        }

        JSObject out = new JSObject();
        out.put("items", items);
        call.resolve(out);
    }

    @PluginMethod
    public void queryMonth(PluginCall call) {
        Integer year = call.getInt("year");
        Integer month = call.getInt("month"); // 1–12
        if (year == null || month == null || month < 1 || month > 12) {
            call.reject("year and month (1-12) are required");
            return;
        }
        if (!hasMediaReadPermission()) {
            requestMediaReadPermissions(call);
            return;
        }
        resolveMonthQuery(call, year, month);
    }

    @PermissionCallback
    private void mediaPermsCallback(PluginCall call) {
        if (!hasMediaReadPermission()) {
            call.reject(
                    "Gallery permission denied. Allow Photos/Videos access to add a whole month.");
            return;
        }
        Integer year = call.getInt("year");
        Integer month = call.getInt("month");
        if (year == null || month == null || month < 1 || month > 12) {
            call.reject("year and month (1-12) are required");
            return;
        }
        resolveMonthQuery(call, year, month);
    }

    private void requestMediaReadPermissions(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33) {
            requestPermissionForAliases(
                    new String[] {"images", "videos"}, call, "mediaPermsCallback");
        } else {
            requestPermissionForAlias("storage", call, "mediaPermsCallback");
        }
    }

    private boolean hasMediaReadPermission() {
        if (Build.VERSION.SDK_INT >= 33) {
            return ContextCompat.checkSelfPermission(
                                    getContext(), Manifest.permission.READ_MEDIA_IMAGES)
                            == PackageManager.PERMISSION_GRANTED
                    || ContextCompat.checkSelfPermission(
                                    getContext(), Manifest.permission.READ_MEDIA_VIDEO)
                            == PackageManager.PERMISSION_GRANTED;
        }
        return ContextCompat.checkSelfPermission(
                        getContext(), Manifest.permission.READ_EXTERNAL_STORAGE)
                == PackageManager.PERMISSION_GRANTED;
    }

    private void resolveMonthQuery(PluginCall call, int year, int month) {
        try {
            Calendar cal = Calendar.getInstance(TimeZone.getDefault());
            cal.clear();
            cal.set(Calendar.YEAR, year);
            cal.set(Calendar.MONTH, month - 1);
            cal.set(Calendar.DAY_OF_MONTH, 1);
            long startMs = cal.getTimeInMillis();
            cal.add(Calendar.MONTH, 1);
            long endMs = cal.getTimeInMillis();
            long startSec = startMs / 1000L;
            long endSec = endMs / 1000L;

            JSArray items = new JSArray();
            Set<String> seen = new HashSet<>();
            ContentResolver resolver = getContext().getContentResolver();

            if (Build.VERSION.SDK_INT < 33
                    || ContextCompat.checkSelfPermission(
                                    getContext(), Manifest.permission.READ_MEDIA_IMAGES)
                            == PackageManager.PERMISSION_GRANTED) {
                queryMediaStoreCollection(
                        resolver,
                        MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                        startMs,
                        endMs,
                        startSec,
                        endSec,
                        items,
                        seen);
            }
            if (Build.VERSION.SDK_INT < 33
                    || ContextCompat.checkSelfPermission(
                                    getContext(), Manifest.permission.READ_MEDIA_VIDEO)
                            == PackageManager.PERMISSION_GRANTED) {
                queryMediaStoreCollection(
                        resolver,
                        MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                        startMs,
                        endMs,
                        startSec,
                        endSec,
                        items,
                        seen);
            }

            JSObject out = new JSObject();
            out.put("items", items);
            out.put("year", year);
            out.put("month", month);
            out.put("count", items.length());
            call.resolve(out);
        } catch (SecurityException err) {
            Log.e(TAG, "queryMonth denied", err);
            call.reject("Permission denied querying MediaStore: " + err.getMessage(), err);
        } catch (Exception err) {
            Log.e(TAG, "queryMonth failed", err);
            call.reject("Could not query month: " + err.getMessage(), err);
        }
    }

    @PluginMethod
    public void listAlbums(PluginCall call) {
        if (!hasMediaReadPermission()) {
            requestPermissionForAliasesOrStorage(call, "albumsPermsCallback");
            return;
        }
        resolveListAlbums(call);
    }

    @PermissionCallback
    private void albumsPermsCallback(PluginCall call) {
        if (!hasMediaReadPermission()) {
            call.reject(
                    "Gallery permission denied. Allow Photos/Videos access to browse albums.");
            return;
        }
        resolveListAlbums(call);
    }

    @PluginMethod
    public void queryAlbum(PluginCall call) {
        String bucketId = call.getString("bucketId");
        if (bucketId == null || bucketId.trim().isEmpty()) {
            call.reject("bucketId is required");
            return;
        }
        if (!hasMediaReadPermission()) {
            requestPermissionForAliasesOrStorage(call, "albumPermsCallback");
            return;
        }
        resolveAlbumQuery(call, bucketId.trim());
    }

    @PermissionCallback
    private void albumPermsCallback(PluginCall call) {
        if (!hasMediaReadPermission()) {
            call.reject(
                    "Gallery permission denied. Allow Photos/Videos access to open albums.");
            return;
        }
        String bucketId = call.getString("bucketId");
        if (bucketId == null || bucketId.trim().isEmpty()) {
            call.reject("bucketId is required");
            return;
        }
        resolveAlbumQuery(call, bucketId.trim());
    }

    private void requestPermissionForAliasesOrStorage(PluginCall call, String callback) {
        if (Build.VERSION.SDK_INT >= 33) {
            requestPermissionForAliases(new String[] {"images", "videos"}, call, callback);
        } else {
            requestPermissionForAlias("storage", call, callback);
        }
    }

    private void resolveListAlbums(PluginCall call) {
        try {
            java.util.LinkedHashMap<String, JSObject> albums = new java.util.LinkedHashMap<>();
            ContentResolver resolver = getContext().getContentResolver();
            if (Build.VERSION.SDK_INT < 33
                    || ContextCompat.checkSelfPermission(
                                    getContext(), Manifest.permission.READ_MEDIA_IMAGES)
                            == PackageManager.PERMISSION_GRANTED) {
                accumulateAlbums(resolver, MediaStore.Images.Media.EXTERNAL_CONTENT_URI, albums);
            }
            if (Build.VERSION.SDK_INT < 33
                    || ContextCompat.checkSelfPermission(
                                    getContext(), Manifest.permission.READ_MEDIA_VIDEO)
                            == PackageManager.PERMISSION_GRANTED) {
                accumulateAlbums(resolver, MediaStore.Video.Media.EXTERNAL_CONTENT_URI, albums);
            }

            JSArray outList = new JSArray();
            java.util.List<JSObject> values = new ArrayList<>(albums.values());
            values.sort(
                    (a, b) ->
                            Integer.compare(
                                    b.optInt("count", 0), a.optInt("count", 0)));
            for (JSObject album : values) {
                outList.put(album);
            }

            JSObject out = new JSObject();
            out.put("albums", outList);
            out.put("count", outList.length());
            call.resolve(out);
        } catch (SecurityException err) {
            Log.e(TAG, "listAlbums denied", err);
            call.reject("Permission denied listing albums: " + err.getMessage(), err);
        } catch (Exception err) {
            Log.e(TAG, "listAlbums failed", err);
            call.reject("Could not list albums: " + err.getMessage(), err);
        }
    }

    private void accumulateAlbums(
            ContentResolver resolver, Uri collection, java.util.Map<String, JSObject> albums) {
        String[] projection =
                new String[] {
                    MediaStore.MediaColumns.BUCKET_ID,
                    MediaStore.MediaColumns.BUCKET_DISPLAY_NAME,
                    MediaStore.MediaColumns._ID
                };
        String sort = MediaStore.MediaColumns.DATE_MODIFIED + " DESC";
        try (Cursor cursor = resolver.query(collection, projection, null, null, sort)) {
            if (cursor == null) return;
            int bucketIdx = cursor.getColumnIndex(MediaStore.MediaColumns.BUCKET_ID);
            int nameIdx = cursor.getColumnIndex(MediaStore.MediaColumns.BUCKET_DISPLAY_NAME);
            int idIdx = cursor.getColumnIndex(MediaStore.MediaColumns._ID);
            if (bucketIdx < 0 || idIdx < 0) return;
            while (cursor.moveToNext()) {
                if (cursor.isNull(bucketIdx)) continue;
                String bucketId = cursor.getString(bucketIdx);
                if (bucketId == null || bucketId.isEmpty()) continue;
                JSObject existing = albums.get(bucketId);
                if (existing != null) {
                    existing.put("count", existing.optInt("count", 0) + 1);
                    continue;
                }
                String name =
                        nameIdx >= 0 && !cursor.isNull(nameIdx)
                                ? cursor.getString(nameIdx)
                                : null;
                if (name == null || name.trim().isEmpty()) name = "Album";
                long id = cursor.getLong(idIdx);
                Uri cover = ContentUris.withAppendedId(collection, id);
                JSObject album = new JSObject();
                album.put("id", bucketId);
                album.put("name", name.trim());
                album.put("count", 1);
                album.put("coverUri", cover.toString());
                albums.put(bucketId, album);
            }
        }
    }

    private void resolveAlbumQuery(PluginCall call, String bucketId) {
        try {
            JSArray items = new JSArray();
            Set<String> seen = new HashSet<>();
            ContentResolver resolver = getContext().getContentResolver();
            if (Build.VERSION.SDK_INT < 33
                    || ContextCompat.checkSelfPermission(
                                    getContext(), Manifest.permission.READ_MEDIA_IMAGES)
                            == PackageManager.PERMISSION_GRANTED) {
                queryAlbumCollection(
                        resolver,
                        MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                        bucketId,
                        items,
                        seen);
            }
            if (Build.VERSION.SDK_INT < 33
                    || ContextCompat.checkSelfPermission(
                                    getContext(), Manifest.permission.READ_MEDIA_VIDEO)
                            == PackageManager.PERMISSION_GRANTED) {
                queryAlbumCollection(
                        resolver,
                        MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                        bucketId,
                        items,
                        seen);
            }
            JSObject out = new JSObject();
            out.put("items", items);
            out.put("bucketId", bucketId);
            out.put("count", items.length());
            call.resolve(out);
        } catch (SecurityException err) {
            Log.e(TAG, "queryAlbum denied", err);
            call.reject("Permission denied querying album: " + err.getMessage(), err);
        } catch (Exception err) {
            Log.e(TAG, "queryAlbum failed", err);
            call.reject("Could not query album: " + err.getMessage(), err);
        }
    }

    private void queryAlbumCollection(
            ContentResolver resolver,
            Uri collection,
            String bucketId,
            JSArray items,
            Set<String> seen) {
        String[] projection =
                new String[] {
                    MediaStore.MediaColumns._ID,
                    MediaStore.MediaColumns.DISPLAY_NAME,
                    MediaStore.MediaColumns.MIME_TYPE,
                    MediaStore.MediaColumns.SIZE
                };
        String selection = MediaStore.MediaColumns.BUCKET_ID + " = ?";
        String[] args = new String[] {bucketId};
        String sort = MediaStore.MediaColumns.DATE_TAKEN + " DESC";
        try (Cursor cursor = resolver.query(collection, projection, selection, args, sort)) {
            if (cursor == null) return;
            int idIdx = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns._ID);
            int nameIdx = cursor.getColumnIndex(MediaStore.MediaColumns.DISPLAY_NAME);
            int mimeIdx = cursor.getColumnIndex(MediaStore.MediaColumns.MIME_TYPE);
            int sizeIdx = cursor.getColumnIndex(MediaStore.MediaColumns.SIZE);
            while (cursor.moveToNext()) {
                long id = cursor.getLong(idIdx);
                Uri uri = ContentUris.withAppendedId(collection, id);
                String uriStr = uri.toString();
                if (!seen.add(uriStr)) continue;
                String name =
                        nameIdx >= 0 && !cursor.isNull(nameIdx)
                                ? cursor.getString(nameIdx)
                                : null;
                if (name == null || name.trim().isEmpty()) {
                    name = String.format(Locale.US, "media-%d", id);
                }
                String mime =
                        mimeIdx >= 0 && !cursor.isNull(mimeIdx)
                                ? cursor.getString(mimeIdx)
                                : null;
                if (mime == null || mime.isEmpty()) {
                    mime =
                            collection.equals(MediaStore.Video.Media.EXTERNAL_CONTENT_URI)
                                    ? "video/*"
                                    : "image/*";
                }
                long size = sizeIdx >= 0 && !cursor.isNull(sizeIdx) ? cursor.getLong(sizeIdx) : 0;
                JSObject item = new JSObject();
                item.put("uri", uriStr);
                item.put("name", name.trim());
                item.put("mimeType", mime);
                item.put("size", size);
                items.put(item);
            }
        }
    }

    private void queryMediaStoreCollection(
            ContentResolver resolver,
            Uri collection,
            long startMs,
            long endMs,
            long startSec,
            long endSec,
            JSArray items,
            Set<String> seen) {
        String[] projection =
                new String[] {
                    MediaStore.MediaColumns._ID,
                    MediaStore.MediaColumns.DISPLAY_NAME,
                    MediaStore.MediaColumns.MIME_TYPE,
                    MediaStore.MediaColumns.SIZE,
                    MediaStore.MediaColumns.DATE_TAKEN,
                    MediaStore.MediaColumns.DATE_MODIFIED
                };
        // Prefer DATE_TAKEN (ms); fall back to DATE_MODIFIED (sec) when taken is unset.
        String selection =
                "(("
                        + MediaStore.MediaColumns.DATE_TAKEN
                        + " >= ? AND "
                        + MediaStore.MediaColumns.DATE_TAKEN
                        + " < ?) OR (("
                        + MediaStore.MediaColumns.DATE_TAKEN
                        + " IS NULL OR "
                        + MediaStore.MediaColumns.DATE_TAKEN
                        + " = 0) AND "
                        + MediaStore.MediaColumns.DATE_MODIFIED
                        + " >= ? AND "
                        + MediaStore.MediaColumns.DATE_MODIFIED
                        + " < ?))";
        String[] args =
                new String[] {
                    String.valueOf(startMs),
                    String.valueOf(endMs),
                    String.valueOf(startSec),
                    String.valueOf(endSec)
                };
        String sort = MediaStore.MediaColumns.DATE_TAKEN + " ASC";

        try (Cursor cursor = resolver.query(collection, projection, selection, args, sort)) {
            if (cursor == null) {
                return;
            }
            int idIdx = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns._ID);
            int nameIdx = cursor.getColumnIndex(MediaStore.MediaColumns.DISPLAY_NAME);
            int mimeIdx = cursor.getColumnIndex(MediaStore.MediaColumns.MIME_TYPE);
            int sizeIdx = cursor.getColumnIndex(MediaStore.MediaColumns.SIZE);
            while (cursor.moveToNext()) {
                long id = cursor.getLong(idIdx);
                Uri uri = ContentUris.withAppendedId(collection, id);
                String uriStr = uri.toString();
                if (!seen.add(uriStr)) {
                    continue;
                }
                String name =
                        nameIdx >= 0 && !cursor.isNull(nameIdx)
                                ? cursor.getString(nameIdx)
                                : null;
                if (name == null || name.trim().isEmpty()) {
                    name = String.format(Locale.US, "media-%d", id);
                }
                String mime =
                        mimeIdx >= 0 && !cursor.isNull(mimeIdx)
                                ? cursor.getString(mimeIdx)
                                : null;
                if (mime == null || mime.isEmpty()) {
                    mime =
                            collection.equals(MediaStore.Video.Media.EXTERNAL_CONTENT_URI)
                                    ? "video/*"
                                    : "image/*";
                }
                long size = sizeIdx >= 0 && !cursor.isNull(sizeIdx) ? cursor.getLong(sizeIdx) : 0;

                JSObject item = new JSObject();
                item.put("uri", uriStr);
                item.put("name", name.trim());
                item.put("mimeType", mime);
                item.put("size", size);
                items.put(item);
            }
        }
    }

    private void takePersistableRead(ContentResolver resolver, Uri uri, int resultFlags) {
        try {
            int takeFlags =
                    resultFlags
                            & (Intent.FLAG_GRANT_READ_URI_PERMISSION
                                    | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            if (takeFlags == 0) {
                takeFlags =
                        Intent.FLAG_GRANT_READ_URI_PERMISSION
                                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
            }
            resolver.takePersistableUriPermission(uri, takeFlags);
        } catch (SecurityException | IllegalArgumentException err) {
            // Fall back to read-only persist when write is not offered by the provider.
            try {
                resolver.takePersistableUriPermission(
                        uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } catch (SecurityException | IllegalArgumentException err2) {
                Log.w(TAG, "Persistable URI permission not available for " + uri, err2);
            }
        }
    }

    private JSObject describeUri(ContentResolver resolver, Uri uri) {
        PhotoDumpUploader.Meta meta = PhotoDumpUploader.describe(resolver, uri);
        JSObject item = new JSObject();
        item.put("uri", uri.toString());
        item.put("name", meta.name);
        item.put("mimeType", meta.mimeType);
        item.put("size", meta.size);
        return item;
    }

    /**
     * Small JPEG thumbnail / video top-frame for gallery grid.
     * WebView cannot preview many content:// video URIs via convertFileSrc.
     */
    @PluginMethod
    public void thumbnailBase64(PluginCall call) {
        String uriStr = call.getString("uri");
        final Uri uri;
        try {
            uri = requireAllowedMediaUri(uriStr);
        } catch (SecurityException err) {
            call.reject(err.getMessage(), err);
            return;
        }
        final int maxSize = Math.max(64, Math.min(512, call.getInt("maxSize", 256)));
        new Thread(
                        () -> {
                            Bitmap bmp = null;
                            try {
                                ContentResolver resolver = getContext().getContentResolver();
                                String mime = resolver.getType(uri);
                                boolean video =
                                        mime != null && mime.toLowerCase(Locale.US).startsWith("video/");

                                if (Build.VERSION.SDK_INT >= 29) {
                                    try {
                                        bmp =
                                                resolver.loadThumbnail(
                                                        uri, new Size(maxSize, maxSize), null);
                                    } catch (Exception err) {
                                        Log.w(TAG, "loadThumbnail failed, trying frame grab", err);
                                    }
                                }

                                // Videos / odd formats: grab a frame near the start.
                                if (bmp == null) {
                                    bmp = grabVideoFrame(uri, maxSize);
                                }

                                if (bmp == null) {
                                    call.reject(
                                            video
                                                    ? "Could not load video top frame"
                                                    : "Could not load thumbnail");
                                    return;
                                }

                                Bitmap scaled = scaleBitmapMax(bmp, maxSize);
                                if (scaled != bmp) {
                                    bmp.recycle();
                                    bmp = scaled;
                                }

                                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                                bmp.compress(Bitmap.CompressFormat.JPEG, 78, bos);
                                bmp.recycle();
                                bmp = null;
                                byte[] bytes = bos.toByteArray();
                                JSObject out = new JSObject();
                                out.put(
                                        "base64",
                                        Base64.encodeToString(bytes, Base64.NO_WRAP));
                                out.put("mimeType", "image/jpeg");
                                out.put("size", bytes.length);
                                call.resolve(out);
                            } catch (SecurityException err) {
                                Log.e(TAG, "thumbnailBase64 denied", err);
                                call.reject(
                                        "Permission denied reading thumbnail: "
                                                + err.getMessage(),
                                        err);
                            } catch (Exception err) {
                                Log.w(TAG, "thumbnailBase64 failed for " + uri, err);
                                call.reject(
                                        "Could not load thumbnail: " + err.getMessage(), err);
                            } finally {
                                if (bmp != null) {
                                    bmp.recycle();
                                }
                            }
                        },
                        "PhotoDump-thumb")
                .start();
    }

    /** First available video frame (top shot), scaled to max edge. */
    private Bitmap grabVideoFrame(Uri uri, int maxSize) {
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        try {
            retriever.setDataSource(getContext(), uri);
            Bitmap frame =
                    retriever.getFrameAtTime(
                            0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC);
            if (frame == null) {
                frame =
                        retriever.getFrameAtTime(
                                1_000_000, MediaMetadataRetriever.OPTION_CLOSEST_SYNC);
            }
            return frame;
        } catch (Exception err) {
            Log.w(TAG, "grabVideoFrame failed for " + uri, err);
            return null;
        } finally {
            try {
                retriever.release();
            } catch (Exception ignore) {
                // ignore
            }
        }
    }

    private static Bitmap scaleBitmapMax(Bitmap src, int maxSize) {
        int w = src.getWidth();
        int h = src.getHeight();
        if (w <= 0 || h <= 0 || (w <= maxSize && h <= maxSize)) {
            return src;
        }
        float scale = Math.min((float) maxSize / w, (float) maxSize / h);
        int nw = Math.max(1, Math.round(w * scale));
        int nh = Math.max(1, Math.round(h * scale));
        return Bitmap.createScaledBitmap(src, nw, nh, true);
    }

    /**
     * Stream SHA-256 + exact size without loading the whole file into memory.
     * Prefer this over {@link #readUriBase64} for Photo Dump — base64 OOMs the WebView.
     */
    @PluginMethod
    public void hashUri(PluginCall call) {
        final Uri uri;
        try {
            uri = requireAllowedMediaUri(call.getString("uri"));
        } catch (SecurityException err) {
            call.reject(err.getMessage(), err);
            return;
        }
        new Thread(
                        () -> {
                            ContentResolver resolver = getContext().getContentResolver();
                            try {
                                PhotoDumpUploader.HashResult hashed =
                                        PhotoDumpUploader.hash(resolver, uri, null);
                                PhotoDumpUploader.Meta meta =
                                        PhotoDumpUploader.describe(resolver, uri);
                                JSObject out = new JSObject();
                                out.put("sha256", hashed.sha256);
                                out.put("size", hashed.size);
                                out.put("name", meta.name);
                                out.put("mimeType", meta.mimeType);
                                call.resolve(out);
                            } catch (SecurityException err) {
                                Log.e(TAG, "hashUri denied", err);
                                call.reject(
                                        "Permission denied hashing uri: " + err.getMessage(), err);
                            } catch (Exception err) {
                                Log.e(TAG, "hashUri failed", err);
                                call.reject("Could not hash uri: " + err.getMessage(), err);
                            }
                        },
                        "PhotoDump-hashUri")
                .start();
    }

    /**
     * Stream ContentResolver bytes straight to Hub (no base64 / WebView heap).
     * Options: uri, url, headers (object), timeoutMs?
     */
    @PluginMethod
    public void uploadUri(PluginCall call) {
        String urlStr = call.getString("url");
        final Uri uri;
        try {
            uri = requireAllowedMediaUri(call.getString("uri"));
        } catch (SecurityException err) {
            call.reject(err.getMessage(), err);
            return;
        }
        if (urlStr == null || urlStr.trim().isEmpty()) {
            call.reject("Missing url");
            return;
        }
        final String url = urlStr.trim();
        final JSObject headersObj = call.getObject("headers", new JSObject());
        final Map<String, String> headers = new HashMap<>();
        if (headersObj != null) {
            Iterator<String> keys = headersObj.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                Object val = headersObj.opt(key);
                if (key != null && val != null) headers.put(key, String.valueOf(val));
            }
        }
        final int timeoutMs = Math.max(30_000, call.getInt("timeoutMs", 120_000));
        final Long expectedSizeOpt = call.getLong("expectedSize");

        new Thread(
                        () -> {
                            try {
                                ContentResolver resolver = getContext().getContentResolver();
                                long expectedSize =
                                        expectedSizeOpt != null && expectedSizeOpt > 0
                                                ? expectedSizeOpt
                                                : 0L;
                                PhotoDumpUploader.UploadResult res =
                                        PhotoDumpUploader.upload(
                                                resolver,
                                                uri,
                                                url,
                                                headers,
                                                timeoutMs,
                                                expectedSize,
                                                null,
                                                null);
                                JSObject out = new JSObject();
                                out.put("status", res.status);
                                out.put("data", res.body);
                                out.put("sent", res.sent);
                                call.resolve(out);
                            } catch (SecurityException err) {
                                Log.e(TAG, "uploadUri denied", err);
                                call.reject(
                                        "Permission denied uploading uri: " + err.getMessage(),
                                        err);
                            } catch (Exception err) {
                                Log.e(TAG, "uploadUri failed", err);
                                call.reject("Upload failed: " + err.getMessage(), err);
                            }
                        },
                        "PhotoDump-uploadUri")
                .start();
    }

    /** Legacy full-file base64 read — avoid for large videos (OOM). Prefer hashUri + uploadUri. */
    @PluginMethod
    public void readUriBase64(PluginCall call) {
        final Uri uri;
        try {
            uri = requireAllowedMediaUri(call.getString("uri"));
        } catch (SecurityException err) {
            call.reject(err.getMessage(), err);
            return;
        }
        ContentResolver resolver = getContext().getContentResolver();
        try (InputStream in = resolver.openInputStream(uri)) {
            if (in == null) {
                call.reject("Could not open uri");
                return;
            }
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) {
                bos.write(buf, 0, n);
            }
            byte[] bytes = bos.toByteArray();
            String base64 = Base64.encodeToString(bytes, Base64.NO_WRAP);

            JSObject meta = describeUri(resolver, uri);
            JSObject out = new JSObject();
            out.put("base64", base64);
            out.put("name", meta != null ? meta.getString("name") : "media");
            out.put(
                    "mimeType",
                    meta != null ? meta.getString("mimeType") : "application/octet-stream");
            out.put("size", bytes.length);
            call.resolve(out);
        } catch (SecurityException err) {
            Log.e(TAG, "readUriBase64 denied", err);
            call.reject("Permission denied reading uri: " + err.getMessage(), err);
        } catch (Exception err) {
            Log.e(TAG, "readUriBase64 failed", err);
            call.reject("Could not read uri: " + err.getMessage(), err);
        }
    }

    @PluginMethod
    public void deleteUri(PluginCall call) {
        final Uri uri;
        try {
            uri = requireAllowedMediaUri(call.getString("uri"));
        } catch (SecurityException err) {
            call.reject(err.getMessage(), err);
            return;
        }
        List<Uri> uris = new ArrayList<>();
        uris.add(uri);
        deleteUrisInternal(call, uris);
    }

    /** Batch delete (one system confirmation on Android 11+ MediaStore). */
    @PluginMethod
    public void deleteUris(PluginCall call) {
        JSArray raw = call.getArray("uris");
        if (raw == null || raw.length() == 0) {
            call.reject("Missing uris");
            return;
        }
        List<Uri> uris = new ArrayList<>();
        try {
            for (int i = 0; i < raw.length(); i++) {
                String s = raw.getString(i);
                if (s == null || s.trim().isEmpty()) continue;
                try {
                    uris.add(requireAllowedMediaUri(s));
                } catch (SecurityException err) {
                    Log.w(TAG, "Skipping disallowed delete uri: " + s);
                }
            }
        } catch (Exception err) {
            call.reject("Invalid uris: " + err.getMessage(), err);
            return;
        }
        if (uris.isEmpty()) {
            call.reject("Missing uris");
            return;
        }
        deleteUrisInternal(call, uris);
    }

    private void deleteUrisInternal(PluginCall call, List<Uri> uris) {
        ContentResolver resolver = getContext().getContentResolver();
        List<Uri> remaining = new ArrayList<>();
        int deletedCount = 0;
        String lastMessage = null;

        for (Uri uri : uris) {
            boolean deleted = tryDirectDelete(resolver, uri);
            if (deleted) {
                deletedCount += 1;
            } else {
                remaining.add(uri);
            }
        }

        if (remaining.isEmpty()) {
            JSObject out = new JSObject();
            out.put("deleted", true);
            out.put("deletedCount", deletedCount);
            out.put("message", "Deleted");
            call.resolve(out);
            return;
        }

        // Android 11+: MediaStore items we don't "own" need a user-confirmed delete request.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && deleteSenderLauncher != null) {
            List<Uri> mediaUris = new ArrayList<>();
            for (Uri uri : remaining) {
                if (isMediaStoreUri(uri) || DocumentsContract.isDocumentUri(getContext(), uri)) {
                    mediaUris.add(uri);
                }
            }
            if (!mediaUris.isEmpty()) {
                try {
                    PendingIntent pi = MediaStore.createDeleteRequest(resolver, mediaUris);
                    pendingDeleteCallId = call.getCallbackId();
                    pendingDeleteCount = deletedCount + mediaUris.size();
                    getBridge().saveCall(call);
                    IntentSenderRequest request =
                            new IntentSenderRequest.Builder(pi.getIntentSender()).build();
                    deleteSenderLauncher.launch(request);
                    return;
                } catch (Exception err) {
                    lastMessage = "createDeleteRequest failed: " + err.getMessage();
                    Log.w(TAG, lastMessage, err);
                }
            }
        }

        JSObject out = new JSObject();
        boolean all = remaining.isEmpty();
        out.put("deleted", all);
        out.put("deletedCount", deletedCount);
        out.put(
                "message",
                all
                        ? "Deleted"
                        : (lastMessage != null
                                ? lastMessage
                                : ("Could not delete "
                                        + remaining.size()
                                        + " item(s) — remove from gallery manually")));
        call.resolve(out);
    }

    private boolean tryDirectDelete(ContentResolver resolver, Uri uri) {
        if (DocumentsContract.isDocumentUri(getContext(), uri)) {
            try {
                if (DocumentsContract.deleteDocument(resolver, uri)) {
                    return true;
                }
            } catch (Exception err) {
                Log.w(TAG, "DocumentsContract delete failed for " + uri, err);
            }
        }
        try {
            int rows = resolver.delete(uri, null, null);
            return rows > 0;
        } catch (SecurityException err) {
            Log.w(TAG, "ContentResolver delete denied for " + uri, err);
            return false;
        } catch (Exception err) {
            Log.w(TAG, "ContentResolver delete failed for " + uri, err);
            return false;
        }
    }

    private static boolean isMediaStoreUri(Uri uri) {
        String auth = uri.getAuthority();
        return auth != null
                && (auth.equals(MediaStore.AUTHORITY)
                        || auth.startsWith("com.android.providers.media"));
    }
}
