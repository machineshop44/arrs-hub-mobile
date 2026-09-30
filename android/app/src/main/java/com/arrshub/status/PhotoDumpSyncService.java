package com.arrshub.status;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;
import androidx.core.app.NotificationCompat;

/**
 * Foreground service that keeps Photo Dump uploads alive when the screen is off
 * or the app is backgrounded (notification + elevated process priority).
 */
public class PhotoDumpSyncService extends Service {
    private static final String TAG = "PhotoDumpSync";
    public static final String CHANNEL_ID = "photo_dump_sync";
    public static final int NOTIFICATION_ID = 4401;

    public static final String ACTION_START = "com.arrshub.status.PHOTO_DUMP_SYNC_START";
    public static final String ACTION_UPDATE = "com.arrshub.status.PHOTO_DUMP_SYNC_UPDATE";
    public static final String ACTION_STOP = "com.arrshub.status.PHOTO_DUMP_SYNC_STOP";

    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_TEXT = "text";
    public static final String EXTRA_CURRENT = "current";
    public static final String EXTRA_TOTAL = "total";

    @Override
    public void onCreate() {
        super.onCreate();
        ensureChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            stopSelf();
            return START_NOT_STICKY;
        }
        String action = intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            return START_NOT_STICKY;
        }

        String title = intent.getStringExtra(EXTRA_TITLE);
        if (title == null || title.isEmpty()) title = "Photo Dump";
        String text = intent.getStringExtra(EXTRA_TEXT);
        if (text == null) text = "Uploading…";
        int current = intent.getIntExtra(EXTRA_CURRENT, 0);
        int total = intent.getIntExtra(EXTRA_TOTAL, 0);

        Notification notification = buildNotification(title, text, current, total);
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(
                        NOTIFICATION_ID,
                        notification,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (Throwable err) {
            Log.e(TAG, "startForeground failed", err);
            try {
                startForeground(NOTIFICATION_ID, notification);
            } catch (Throwable ignored) {
                stopSelf();
                return START_NOT_STICKY;
            }
        }

        if (ACTION_UPDATE.equals(action)) {
            NotificationManager nm =
                    (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(NOTIFICATION_ID, notification);
        }

        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void ensureChannel() {
        ensureChannel(this);
    }

    /** Shared with {@link PhotoDumpUploadWorker}'s foreground notification. */
    public static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm =
                (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        NotificationChannel existing = nm.getNotificationChannel(CHANNEL_ID);
        if (existing != null) return;
        NotificationChannel channel =
                new NotificationChannel(
                        CHANNEL_ID, "Photo Dump sync", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Keeps photo/video uploads running in the background");
        channel.setShowBadge(false);
        nm.createNotificationChannel(channel);
    }

    private Notification buildNotification(String title, String text, int current, int total) {
        Intent launch = new Intent(this, MainActivity.class);
        launch.setAction(Intent.ACTION_MAIN);
        launch.addCategory(Intent.CATEGORY_LAUNCHER);
        launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi =
                PendingIntent.getActivity(
                        this,
                        0,
                        launch,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder builder =
                new NotificationCompat.Builder(this, CHANNEL_ID)
                        .setContentTitle(title)
                        .setContentText(text)
                        .setSmallIcon(android.R.drawable.stat_sys_upload)
                        .setContentIntent(pi)
                        .setOngoing(true)
                        .setOnlyAlertOnce(true)
                        .setCategory(NotificationCompat.CATEGORY_PROGRESS)
                        .setPriority(NotificationCompat.PRIORITY_LOW);

        if (total > 0) {
            builder.setProgress(total, Math.min(current, total), false);
            builder.setSubText(current + "/" + total);
        } else {
            builder.setProgress(0, 0, true);
        }
        return builder.build();
    }
}
