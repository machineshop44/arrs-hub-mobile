package com.arrshub.status;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Persistent Photo Dump upload queue (JSON file in app storage) + sync options
 * (SharedPreferences). All access is synchronized on the class.
 *
 * <p>Item statuses: pending, hashing, uploading, done, error, cancelled.
 */
public final class PhotoDumpQueueStore {
    private static final String TAG = "PhotoDumpQueue";
    private static final String FILE = "photo_dump_queue.json";
    public static final String PREFS = "photo_dump_sync";

    public static final String PREF_WIFI_ONLY = "wifiOnly";
    public static final String PREF_CHARGING_ONLY = "chargingOnly";
    public static final String PREF_AUTO_BACKUP = "autoBackup";
    public static final String PREF_AUTO_FOLDER = "autoFolder";
    public static final String PREF_AUTO_WATERMARK = "autoWatermarkSec";

    public static final int MAX_ATTEMPTS = 4;

    private static JSONObject cache;

    private PhotoDumpQueueStore() {}

    public static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static File file(Context ctx) {
        return new File(ctx.getApplicationContext().getFilesDir(), FILE);
    }

    private static JSONObject state(Context ctx) {
        if (cache != null) return cache;
        JSONObject loaded = null;
        File f = file(ctx);
        if (f.exists()) {
            try (FileInputStream in = new FileInputStream(f)) {
                byte[] bytes = new byte[(int) f.length()];
                int off = 0;
                while (off < bytes.length) {
                    int n = in.read(bytes, off, bytes.length - off);
                    if (n < 0) break;
                    off += n;
                }
                loaded = new JSONObject(new String(bytes, 0, off, StandardCharsets.UTF_8));
            } catch (Exception err) {
                Log.w(TAG, "Queue file unreadable — starting fresh", err);
            }
        }
        if (loaded == null) loaded = new JSONObject();
        try {
            if (!loaded.has("items")) loaded.put("items", new JSONArray());
            if (!loaded.has("config")) loaded.put("config", new JSONObject());
        } catch (JSONException ignored) {
            // cannot happen
        }
        cache = loaded;
        return cache;
    }

    private static void save(Context ctx) {
        if (cache == null) return;
        File f = file(ctx);
        File tmp = new File(f.getParentFile(), FILE + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(cache.toString().getBytes(StandardCharsets.UTF_8));
            out.getFD().sync();
        } catch (IOException err) {
            Log.e(TAG, "Could not write queue file", err);
            return;
        }
        if (!tmp.renameTo(f)) {
            //noinspection ResultOfMethodCallIgnored
            f.delete();
            if (!tmp.renameTo(f)) Log.e(TAG, "Could not replace queue file");
        }
    }

    private static JSONArray items(Context ctx) {
        return state(ctx).optJSONArray("items");
    }

    private static boolean isActive(String status) {
        return "pending".equals(status) || "hashing".equals(status) || "uploading".equals(status);
    }

    // ---- config ----

    /** Upload endpoint + base headers (API key, hub token) from the last JS enqueue / setOptions. */
    public static synchronized void setConfig(Context ctx, String url, JSONObject headers, String folder) {
        try {
            JSONObject cfg = state(ctx).optJSONObject("config");
            if (cfg == null) cfg = new JSONObject();
            if (url != null && !url.trim().isEmpty()) cfg.put("url", url.trim());
            if (headers != null) cfg.put("headers", headers);
            if (folder != null) cfg.put("folder", folder);
            state(ctx).put("config", cfg);
            save(ctx);
        } catch (JSONException err) {
            Log.w(TAG, "setConfig failed", err);
        }
    }

    public static synchronized JSONObject getConfig(Context ctx) {
        JSONObject cfg = state(ctx).optJSONObject("config");
        try {
            return cfg == null ? new JSONObject() : new JSONObject(cfg.toString());
        } catch (JSONException e) {
            return new JSONObject();
        }
    }

    public static boolean hasConfig(Context ctx) {
        return !getConfig(ctx).optString("url", "").isEmpty();
    }

    // ---- items ----

    /**
     * Append items (each needs uri; id/name/size/mimeType/folder/source optional). URIs that are
     * already queued and not finished are skipped. Returns the ids that were added.
     */
    public static synchronized List<String> enqueue(Context ctx, List<JSONObject> incoming) {
        List<String> added = new ArrayList<>();
        JSONArray arr = items(ctx);
        Set<String> activeUris = new HashSet<>();
        for (int i = 0; i < arr.length(); i++) {
            JSONObject it = arr.optJSONObject(i);
            if (it != null && isActive(it.optString("status"))) {
                activeUris.add(it.optString("uri"));
            }
        }
        long now = System.currentTimeMillis();
        for (JSONObject raw : incoming) {
            String uri = raw.optString("uri", "").trim();
            if (uri.isEmpty() || activeUris.contains(uri)) continue;
            // Re-enqueue of a finished/failed uri replaces the old row.
            removeWhere(arr, uri, null);
            try {
                JSONObject it = new JSONObject();
                String id = raw.optString("id", "");
                if (id.isEmpty()) id = "n-" + now + "-" + added.size();
                it.put("id", id);
                it.put("uri", uri);
                it.put("name", raw.optString("name", "media"));
                it.put("size", raw.optLong("size", 0));
                it.put("mimeType", raw.optString("mimeType", "application/octet-stream"));
                it.put("folder", raw.optString("folder", ""));
                it.put("source", raw.optString("source", "manual"));
                it.put("status", "pending");
                it.put("attempts", 0);
                it.put("addedAt", now);
                it.put("updatedAt", now);
                arr.put(it);
                activeUris.add(uri);
                added.add(id);
            } catch (JSONException err) {
                Log.w(TAG, "enqueue item failed", err);
            }
        }
        if (!added.isEmpty()) save(ctx);
        return added;
    }

    private static void removeWhere(JSONArray arr, String uri, Set<String> ids) {
        for (int i = arr.length() - 1; i >= 0; i--) {
            JSONObject it = arr.optJSONObject(i);
            if (it == null) continue;
            boolean match =
                    (uri != null && uri.equals(it.optString("uri")))
                            || (ids != null && ids.contains(it.optString("id")));
            if (match) arr.remove(i);
        }
    }

    /** Next pending item (copy) whose id is not in {@code exclude}, or null. */
    public static synchronized JSONObject nextPending(Context ctx, Set<String> exclude) {
        JSONArray arr = items(ctx);
        for (int i = 0; i < arr.length(); i++) {
            JSONObject it = arr.optJSONObject(i);
            if (it != null
                    && "pending".equals(it.optString("status"))
                    && (exclude == null || !exclude.contains(it.optString("id")))) {
                try {
                    return new JSONObject(it.toString());
                } catch (JSONException e) {
                    return null;
                }
            }
        }
        return null;
    }

    public static synchronized JSONObject get(Context ctx, String id) {
        JSONArray arr = items(ctx);
        for (int i = 0; i < arr.length(); i++) {
            JSONObject it = arr.optJSONObject(i);
            if (it != null && id.equals(it.optString("id"))) {
                try {
                    return new JSONObject(it.toString());
                } catch (JSONException e) {
                    return null;
                }
            }
        }
        return null;
    }

    /** Merge fields into item {@code id}. Returns the updated copy, or null if gone. */
    public static synchronized JSONObject update(Context ctx, String id, JSONObject patch) {
        JSONArray arr = items(ctx);
        for (int i = 0; i < arr.length(); i++) {
            JSONObject it = arr.optJSONObject(i);
            if (it == null || !id.equals(it.optString("id"))) continue;
            try {
                Iterator<String> keys = patch.keys();
                while (keys.hasNext()) {
                    String k = keys.next();
                    it.put(k, patch.get(k));
                }
                it.put("updatedAt", System.currentTimeMillis());
                save(ctx);
                return new JSONObject(it.toString());
            } catch (JSONException err) {
                Log.w(TAG, "update failed", err);
                return null;
            }
        }
        return null;
    }

    /** Worker (re)start: anything mid-flight from a killed run goes back to pending. */
    public static synchronized void resetInterrupted(Context ctx) {
        JSONArray arr = items(ctx);
        boolean changed = false;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject it = arr.optJSONObject(i);
            if (it == null) continue;
            String s = it.optString("status");
            if ("hashing".equals(s) || "uploading".equals(s)) {
                try {
                    it.put("status", "pending");
                    changed = true;
                } catch (JSONException ignored) {
                    // ignore
                }
            }
        }
        if (changed) save(ctx);
    }

    /** Mark every unfinished item cancelled. Returns how many were cancelled. */
    public static synchronized int cancelActive(Context ctx) {
        JSONArray arr = items(ctx);
        int n = 0;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject it = arr.optJSONObject(i);
            if (it == null || !isActive(it.optString("status"))) continue;
            try {
                it.put("status", "cancelled");
                it.put("message", "Cancelled — phone copy kept.");
                it.put("updatedAt", System.currentTimeMillis());
                n++;
            } catch (JSONException ignored) {
                // ignore
            }
        }
        if (n > 0) save(ctx);
        return n;
    }

    /** error/cancelled → pending (all when ids is null). Returns count reset. */
    public static synchronized int retry(Context ctx, Collection<String> ids) {
        JSONArray arr = items(ctx);
        int n = 0;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject it = arr.optJSONObject(i);
            if (it == null) continue;
            String s = it.optString("status");
            if (!"error".equals(s) && !"cancelled".equals(s)) continue;
            if (ids != null && !ids.contains(it.optString("id"))) continue;
            try {
                it.put("status", "pending");
                it.put("attempts", 0);
                it.remove("message");
                it.put("updatedAt", System.currentTimeMillis());
                n++;
            } catch (JSONException ignored) {
                // ignore
            }
        }
        if (n > 0) save(ctx);
        return n;
    }

    /** Remove items by id (never removes in-flight items). ids null = all finished items. */
    public static synchronized int remove(Context ctx, Collection<String> ids) {
        JSONArray arr = items(ctx);
        int n = 0;
        for (int i = arr.length() - 1; i >= 0; i--) {
            JSONObject it = arr.optJSONObject(i);
            if (it == null) continue;
            String s = it.optString("status");
            if ("hashing".equals(s) || "uploading".equals(s)) continue;
            if (ids == null ? isActive(s) : !ids.contains(it.optString("id"))) continue;
            arr.remove(i);
            n++;
        }
        if (n > 0) save(ctx);
        return n;
    }

    /** Drop finished auto-backup rows (nothing for JS to do with them). */
    public static synchronized void pruneAutoDone(Context ctx) {
        JSONArray arr = items(ctx);
        boolean changed = false;
        for (int i = arr.length() - 1; i >= 0; i--) {
            JSONObject it = arr.optJSONObject(i);
            if (it != null
                    && "auto".equals(it.optString("source"))
                    && "done".equals(it.optString("status"))) {
                arr.remove(i);
                changed = true;
            }
        }
        if (changed) save(ctx);
    }

    public static final class Counts {
        public int total, pending, active, done, failed;
    }

    public static synchronized Counts counts(Context ctx) {
        Counts c = new Counts();
        JSONArray arr = items(ctx);
        for (int i = 0; i < arr.length(); i++) {
            JSONObject it = arr.optJSONObject(i);
            if (it == null) continue;
            c.total++;
            switch (it.optString("status")) {
                case "pending":
                    c.pending++;
                    break;
                case "hashing":
                case "uploading":
                    c.active++;
                    break;
                case "done":
                    c.done++;
                    break;
                default:
                    c.failed++;
            }
        }
        return c;
    }

    /** Copy of all items (safe to hand to JS). */
    public static synchronized JSONArray snapshotItems(Context ctx) {
        try {
            return new JSONArray(items(ctx).toString());
        } catch (JSONException e) {
            return new JSONArray();
        }
    }
}
