package com.arrshub.status;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.widget.RemoteViews;
import android.widget.Toast;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * Home-screen widget: streams / downloads / Ombi pending (pushed from JS via
 * {@link HubWidgetPlugin}) and a native Wake-on-LAN button.
 */
public class HubWidgetProvider extends AppWidgetProvider {
    private static final String TAG = "HubWidget";
    public static final String PREFS = "hub_widget";
    public static final String ACTION_WAKE = "com.arrshub.status.HUB_WIDGET_WAKE";

    static final String KEY_STREAMS = "streams";
    static final String KEY_DOWNLOADS = "downloads";
    static final String KEY_OMBI = "ombiPending";
    static final String KEY_UPDATED = "updatedAt";
    static final String KEY_MAC = "wolMac";
    static final String KEY_BROADCAST = "wolBroadcast";
    static final String KEY_PORT = "wolPort";

    static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static void refreshAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, HubWidgetProvider.class));
        if (ids == null || ids.length == 0) return;
        for (int id : ids) {
            mgr.updateAppWidget(id, buildViews(ctx));
        }
    }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] appWidgetIds) {
        for (int id : appWidgetIds) {
            mgr.updateAppWidget(id, buildViews(ctx));
        }
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        super.onReceive(ctx, intent);
        if (intent == null || !ACTION_WAKE.equals(intent.getAction())) return;
        SharedPreferences p = prefs(ctx);
        final String mac = p.getString(KEY_MAC, "");
        final String broadcast = p.getString(KEY_BROADCAST, "255.255.255.255");
        final int port = p.getInt(KEY_PORT, 9);
        final Context app = ctx.getApplicationContext();
        if (mac == null || mac.isEmpty()) {
            // Views normally route to the app when no MAC is stored; this covers a stale widget.
            Intent launch = launchIntent(app);
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                app.startActivity(launch);
            } catch (Exception err) {
                Log.w(TAG, "Could not open app from widget", err);
            }
            return;
        }
        final PendingResult pending = goAsync();
        new Thread(
                        () -> {
                            String msg;
                            try {
                                int sent = sendMagicPacket(mac, broadcast, port);
                                msg = sent > 0 ? "Wake packet sent to " + mac : "Wake-on-LAN failed";
                            } catch (Exception err) {
                                Log.w(TAG, "WoL send failed", err);
                                msg = "Wake-on-LAN failed: " + err.getMessage();
                            }
                            final String toast = msg;
                            new Handler(Looper.getMainLooper())
                                    .post(
                                            () -> {
                                                Toast.makeText(app, toast, Toast.LENGTH_SHORT).show();
                                                pending.finish();
                                            });
                        },
                        "HubWidget-wol")
                .start();
    }

    /** 6×0xFF + 16×MAC to the configured broadcast and 255.255.255.255. Returns sends that succeeded. */
    static int sendMagicPacket(String mac, String broadcast, int port) throws Exception {
        byte[] macBytes = parseMac(mac);
        if (macBytes == null) throw new IllegalArgumentException("Invalid MAC " + mac);
        byte[] packet = new byte[6 + 16 * 6];
        for (int i = 0; i < 6; i++) packet[i] = (byte) 0xFF;
        for (int i = 0; i < 16; i++) System.arraycopy(macBytes, 0, packet, 6 + i * 6, 6);

        List<String> targets = new ArrayList<>();
        if (broadcast != null && !broadcast.trim().isEmpty()) targets.add(broadcast.trim());
        if (!targets.contains("255.255.255.255")) targets.add("255.255.255.255");

        int ok = 0;
        Exception last = null;
        try (DatagramSocket socket = new DatagramSocket()) {
            socket.setBroadcast(true);
            for (String target : targets) {
                try {
                    InetAddress addr = InetAddress.getByName(target);
                    socket.send(new DatagramPacket(packet, packet.length, addr, port > 0 ? port : 9));
                    ok++;
                } catch (Exception err) {
                    last = err;
                }
            }
        }
        if (ok == 0 && last != null) throw last;
        return ok;
    }

    static byte[] parseMac(String mac) {
        String hex = mac == null ? "" : mac.replaceAll("[^0-9A-Fa-f]", "");
        if (hex.length() != 12) return null;
        byte[] out = new byte[6];
        for (int i = 0; i < 6; i++) {
            out[i] = (byte) Integer.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
        }
        return out;
    }

    private static Intent launchIntent(Context ctx) {
        Intent launch = new Intent(ctx, MainActivity.class);
        launch.setAction(Intent.ACTION_MAIN);
        launch.addCategory(Intent.CATEGORY_LAUNCHER);
        launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return launch;
    }

    private static String fmt(SharedPreferences p, String key) {
        int v = p.getInt(key, -1);
        return v < 0 ? "—" : String.valueOf(v);
    }

    static RemoteViews buildViews(Context ctx) {
        SharedPreferences p = prefs(ctx);
        RemoteViews views = new RemoteViews(ctx.getPackageName(), R.layout.hub_widget);
        views.setTextViewText(R.id.hub_widget_streams, fmt(p, KEY_STREAMS));
        views.setTextViewText(R.id.hub_widget_downloads, fmt(p, KEY_DOWNLOADS));
        views.setTextViewText(R.id.hub_widget_ombi, fmt(p, KEY_OMBI));
        long updated = p.getLong(KEY_UPDATED, 0);
        views.setTextViewText(
                R.id.hub_widget_updated,
                updated > 0
                        ? "Updated " + new SimpleDateFormat("HH:mm", Locale.getDefault()).format(new Date(updated))
                        : "Open app to refresh");

        PendingIntent open =
                PendingIntent.getActivity(
                        ctx,
                        0,
                        launchIntent(ctx),
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.hub_widget_root, open);

        String mac = p.getString(KEY_MAC, "");
        PendingIntent wake;
        if (mac == null || mac.isEmpty()) {
            wake = open;
        } else {
            Intent i = new Intent(ctx, HubWidgetProvider.class);
            i.setAction(ACTION_WAKE);
            wake =
                    PendingIntent.getBroadcast(
                            ctx,
                            1,
                            i,
                            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        }
        views.setOnClickPendingIntent(R.id.hub_widget_wake, wake);
        return views;
    }
}
