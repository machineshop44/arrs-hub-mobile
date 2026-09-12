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
import java.util.ArrayList;
import java.util.Calendar;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
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
        String name = "media";
        long size = 0;
        String mime = resolver.getType(uri);
        if (mime == null || mime.isEmpty()) {
            mime = "application/octet-stream";
        }

        try (Cursor cursor =
                resolver.query(
                        uri,
                        new String[] {OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE},
                        null,
                        null,
                        null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int nameIdx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                int sizeIdx = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (nameIdx >= 0 && !cursor.isNull(nameIdx)) {
                    String n = cursor.getString(nameIdx);
                    if (n != null && !n.trim().isEmpty()) {
                        name = n.trim();
                    }
                }
                if (sizeIdx >= 0 && !cursor.isNull(sizeIdx)) {
                    size = cursor.getLong(sizeIdx);
                }
            }
        } catch (Exception err) {
            Log.w(TAG, "Could not query columns for " + uri, err);
        }

        if (size <= 0) {
            try (InputStream in = resolver.openInputStream(uri)) {
                if (in != null) {
                    byte[] buf = new byte[8192];
                    long total = 0;
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        total += n;
                    }
                    size = total;
                }
            } catch (Exception err) {
                Log.w(TAG, "Could not measure size for " + uri, err);
            }
        }

        JSObject item = new JSObject();
        item.put("uri", uri.toString());
        item.put("name", name);
        item.put("mimeType", mime);
        item.put("size", size);
        return item;
    }

    @PluginMethod
    public void readUriBase64(PluginCall call) {
        String uriStr = call.getString("uri");
        if (uriStr == null || uriStr.trim().isEmpty()) {
            call.reject("Missing uri");
            return;
        }
        Uri uri = Uri.parse(uriStr.trim());
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
        String uriStr = call.getString("uri");
        if (uriStr == null || uriStr.trim().isEmpty()) {
            call.reject("Missing uri");
            return;
        }
        List<Uri> uris = new ArrayList<>();
        uris.add(Uri.parse(uriStr.trim()));
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
                if (s != null && !s.trim().isEmpty()) {
                    uris.add(Uri.parse(s.trim()));
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
