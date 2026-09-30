package com.arrshub.status;

import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Log;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InterruptedIOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.Map;

/**
 * Streaming hash + upload of content:// media to Arrs Hub. Shared by
 * {@link PhotoDumpMediaPlugin} (JS-driven uploads) and {@link PhotoDumpUploadWorker}.
 */
public final class PhotoDumpUploader {
    private static final String TAG = "PhotoDumpUploader";
    private static final int BUF = 64 * 1024;

    private PhotoDumpUploader() {}

    public interface Cancellation {
        boolean isCancelled();
    }

    public interface ByteProgress {
        void onBytes(long sent, long total);
    }

    public static final class Meta {
        public final String name;
        public final String mimeType;
        public final long size;

        Meta(String name, String mimeType, long size) {
            this.name = name;
            this.mimeType = mimeType;
            this.size = size;
        }
    }

    public static final class HashResult {
        public final String sha256;
        public final long size;

        HashResult(String sha256, long size) {
            this.sha256 = sha256;
            this.size = size;
        }
    }

    public static final class UploadResult {
        public final int status;
        public final String body;
        public final long sent;

        UploadResult(int status, String body, long sent) {
            this.status = status;
            this.body = body;
            this.sent = sent;
        }
    }

    public static final class CancelledException extends IOException {
        public CancelledException() {
            super("Cancelled");
        }
    }

    /** Only content:// media / document / share providers — block file/http and sensitive authorities. */
    public static boolean isAllowedMediaUri(Uri uri) {
        if (uri == null) return false;
        String scheme = uri.getScheme();
        if (scheme == null || !"content".equalsIgnoreCase(scheme)) return false;
        String auth = uri.getAuthority();
        if (auth == null || auth.isEmpty()) return false;
        String a = auth.toLowerCase(Locale.US);
        if (a.contains("sms")
                || a.contains("telephony")
                || a.contains("contacts")
                || a.contains("call_log")
                || a.contains("calendar")
                || a.contains("com.android.settings")) {
            return false;
        }
        return "media".equals(a)
                || a.startsWith("media/")
                || a.contains("providers.media")
                || a.contains("providers.downloads")
                || a.contains("externalstorage.documents")
                || a.contains("apps.photos")
                || a.contains("photos.contentprovider")
                || a.contains("gallery")
                || a.endsWith(".fileprovider")
                || a.contains(".fileprovider");
    }

    public static Uri requireAllowedMediaUri(String uriStr) throws SecurityException {
        if (uriStr == null || uriStr.trim().isEmpty()) {
            throw new SecurityException("Missing uri");
        }
        Uri uri = Uri.parse(uriStr.trim());
        if (!isAllowedMediaUri(uri)) {
            throw new SecurityException("URI not allowed for photo dump: " + uri);
        }
        return uri;
    }

    public static Meta describe(ContentResolver resolver, Uri uri) {
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
        return new Meta(name, mime, size);
    }

    /** Stream SHA-256 + exact size without loading the whole file into memory. */
    public static HashResult hash(ContentResolver resolver, Uri uri, Cancellation cancel)
            throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        long size = 0;
        try (InputStream in = resolver.openInputStream(uri)) {
            if (in == null) throw new IOException("Could not open uri");
            byte[] buf = new byte[BUF];
            int n;
            while ((n = in.read(buf)) > 0) {
                if (cancel != null && cancel.isCancelled()) throw new CancelledException();
                digest.update(buf, 0, n);
                size += n;
            }
        }
        if (size <= 0) throw new IOException("Empty media uri");
        return new HashResult(bytesToHex(digest.digest()), size);
    }

    /**
     * POST raw octets from {@code uri} to {@code url}. Returns HTTP status + body; does not
     * interpret the Hub response. Throws on I/O failure, size mismatch, or cancellation.
     */
    public static UploadResult upload(
            ContentResolver resolver,
            Uri uri,
            String url,
            Map<String, String> headers,
            int timeoutMs,
            long expectedSize,
            Cancellation cancel,
            ByteProgress progress)
            throws IOException {
        if (expectedSize <= 0) {
            expectedSize = describe(resolver, uri).size;
        }
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(Math.min(60_000, timeoutMs));
            conn.setReadTimeout(timeoutMs);
            conn.setDoOutput(true);
            conn.setDoInput(true);
            conn.setUseCaches(false);
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/octet-stream");
            if (headers != null) {
                for (Map.Entry<String, String> e : headers.entrySet()) {
                    String key = e.getKey();
                    if (key == null || key.isEmpty() || e.getValue() == null) continue;
                    if ("content-type".equalsIgnoreCase(key)
                            || "content-length".equalsIgnoreCase(key)) {
                        continue;
                    }
                    conn.setRequestProperty(key, e.getValue());
                }
            }
            if (expectedSize > 0) {
                conn.setFixedLengthStreamingMode(expectedSize);
            } else {
                conn.setChunkedStreamingMode(BUF);
            }

            long sent = 0;
            long lastReport = 0;
            try (InputStream in = resolver.openInputStream(uri);
                    OutputStream out = conn.getOutputStream()) {
                if (in == null) throw new IOException("Could not open uri for upload");
                byte[] buf = new byte[BUF];
                int n;
                while ((n = in.read(buf)) > 0) {
                    if (cancel != null && cancel.isCancelled()) throw new CancelledException();
                    out.write(buf, 0, n);
                    sent += n;
                    if (progress != null && sent - lastReport >= 512 * 1024) {
                        lastReport = sent;
                        progress.onBytes(sent, expectedSize);
                    }
                }
                out.flush();
            }

            if (expectedSize > 0 && sent != expectedSize) {
                throw new IOException(
                        "Upload size mismatch: expected " + expectedSize + ", sent " + sent);
            }

            int status = conn.getResponseCode();
            InputStream respStream = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
            String body = "";
            if (respStream != null) {
                try (InputStream rs = respStream;
                        ByteArrayOutputStream bos = new ByteArrayOutputStream()) {
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = rs.read(buf)) > 0) {
                        bos.write(buf, 0, n);
                    }
                    body = bos.toString(StandardCharsets.UTF_8.name());
                }
            }

            if (status < 200 || status >= 300) {
                Log.e(
                        TAG,
                        "upload HTTP "
                                + status
                                + " for "
                                + uri
                                + " body="
                                + (body.length() > 300 ? body.substring(0, 300) : body));
            } else {
                Log.i(TAG, "upload ok HTTP " + status + " sent=" + sent + " " + uri);
            }
            return new UploadResult(status, body, sent);
        } catch (InterruptedIOException err) {
            if (cancel != null && cancel.isCancelled()) throw new CancelledException();
            throw err;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    public static String bytesToHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(String.format(Locale.US, "%02x", b));
        }
        return sb.toString();
    }
}
