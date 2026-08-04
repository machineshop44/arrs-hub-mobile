package com.arrshub.status.tester;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.ImageButton;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;
import java.util.ArrayList;
import org.json.JSONArray;
import org.json.JSONObject;
import org.videolan.libvlc.LibVLC;
import org.videolan.libvlc.Media;
import org.videolan.libvlc.MediaPlayer;
import org.videolan.libvlc.util.VLCVideoLayout;

/**
 * In-process libVLC fullscreen player for hub workout streams (Matroska/AC3).
 * Stays inside this app task — not an Intent to the VLC package.
 */
public class VlcPlayerActivity extends AppCompatActivity {
    public static final String EXTRA_ITEMS_JSON = "itemsJson";
    public static final String EXTRA_START_INDEX = "startIndex";
    public static final String EXTRA_FINISHED = "finished";

    private static final String TAG = "VlcPlayerActivity";
    private static final long UI_TICK_MS = 500L;

    private LibVLC libVLC;
    private MediaPlayer mediaPlayer;
    private VLCVideoLayout videoLayout;
    private TextView titleView;
    private TextView timeView;
    private TextView errorView;
    private ImageButton playPauseBtn;
    private Button nextBtn;

    private final ArrayList<String> urls = new ArrayList<>();
    private final ArrayList<String> titles = new ArrayList<>();
    private int index = 0;
    private boolean finishedPlaylist = false;
    private boolean wasPlayingBeforePause = false;
    private boolean released = false;

    private final Handler uiHandler = new Handler(Looper.getMainLooper());
    private final Runnable timeTick =
            new Runnable() {
                @Override
                public void run() {
                    updateTimeLabel();
                    uiHandler.postDelayed(this, UI_TICK_MS);
                }
            };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setContentView(R.layout.activity_vlc_player);

        videoLayout = findViewById(R.id.vlc_video_layout);
        titleView = findViewById(R.id.vlc_title);
        timeView = findViewById(R.id.vlc_time);
        errorView = findViewById(R.id.vlc_error);
        playPauseBtn = findViewById(R.id.vlc_play_pause);
        nextBtn = findViewById(R.id.vlc_next);
        ImageButton closeBtn = findViewById(R.id.vlc_close);
        Button back10 = findViewById(R.id.vlc_back_10);
        Button fwd10 = findViewById(R.id.vlc_fwd_10);

        if (!parsePlaylist(getIntent())) {
            showError("No playable stream URL.");
            closeBtn.setOnClickListener(v -> finishWithResult(false));
            return;
        }

        try {
            ArrayList<String> options = new ArrayList<>();
            options.add("--aout=opensles");
            options.add("--audio-time-stretch");
            options.add("--network-caching=2000");
            options.add("--http-reconnect");
            libVLC = new LibVLC(this, options);
            mediaPlayer = new MediaPlayer(libVLC);
            mediaPlayer.attachViews(videoLayout, null, false, false);
            mediaPlayer.setEventListener(this::onVlcEvent);
        } catch (Throwable err) {
            Log.e(TAG, "libVLC init failed", err);
            showError("Embedded VLC failed to start: " + err.getMessage());
            closeBtn.setOnClickListener(v -> finishWithResult(false));
            return;
        }

        closeBtn.setOnClickListener(v -> finishWithResult(false));
        playPauseBtn.setOnClickListener(v -> togglePlayPause());
        back10.setOnClickListener(v -> seekByMs(-10_000));
        fwd10.setOnClickListener(v -> seekByMs(10_000));
        nextBtn.setOnClickListener(v -> playNext(true));

        playIndex(index);
        uiHandler.post(timeTick);
    }

    private boolean parsePlaylist(Intent intent) {
        urls.clear();
        titles.clear();
        String json = intent != null ? intent.getStringExtra(EXTRA_ITEMS_JSON) : null;
        index = intent != null ? Math.max(0, intent.getIntExtra(EXTRA_START_INDEX, 0)) : 0;
        if (json == null || json.trim().isEmpty()) {
            return false;
        }
        try {
            JSONArray arr = new JSONArray(json);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject obj = arr.getJSONObject(i);
                String url = obj.optString("url", "").trim();
                if (url.isEmpty()) continue;
                urls.add(url);
                String title = obj.optString("title", "").trim();
                titles.add(title.isEmpty() ? ("Item " + (urls.size())) : title);
            }
        } catch (Exception err) {
            Log.e(TAG, "Bad playlist JSON", err);
            return false;
        }
        if (urls.isEmpty()) return false;
        if (index >= urls.size()) index = 0;
        return true;
    }

    private void playIndex(int i) {
        if (mediaPlayer == null || i < 0 || i >= urls.size()) return;
        index = i;
        errorView.setVisibility(View.GONE);
        String label =
                (index == 0 ? "Warm-up" : "Workout")
                        + " · "
                        + titles.get(index)
                        + "  ("
                        + (index + 1)
                        + "/"
                        + urls.size()
                        + ")";
        titleView.setText(label);
        nextBtn.setVisibility(index < urls.size() - 1 ? View.VISIBLE : View.GONE);

        try {
            mediaPlayer.stop();
            Media media = new Media(libVLC, Uri.parse(urls.get(index)));
            media.setHWDecoderEnabled(true, false);
            media.addOption(":network-caching=2000");
            mediaPlayer.setMedia(media);
            media.release();
            mediaPlayer.play();
            playPauseBtn.setImageResource(android.R.drawable.ic_media_pause);
        } catch (Throwable err) {
            Log.e(TAG, "play failed", err);
            showError("Could not play: " + err.getMessage());
        }
    }

    private void onVlcEvent(MediaPlayer.Event event) {
        switch (event.type) {
            case MediaPlayer.Event.EndReached:
                runOnUiThread(() -> playNext(false));
                break;
            case MediaPlayer.Event.EncounteredError:
                runOnUiThread(
                        () ->
                                showError(
                                        "Decode/network error on this stream. Try Play in VLC (external) from the in-app player."));
                break;
            case MediaPlayer.Event.Playing:
                runOnUiThread(
                        () -> playPauseBtn.setImageResource(android.R.drawable.ic_media_pause));
                break;
            case MediaPlayer.Event.Paused:
            case MediaPlayer.Event.Stopped:
                runOnUiThread(
                        () -> playPauseBtn.setImageResource(android.R.drawable.ic_media_play));
                break;
            default:
                break;
        }
    }

    private void playNext(boolean fromUser) {
        if (index < urls.size() - 1) {
            playIndex(index + 1);
            return;
        }
        if (!fromUser) {
            finishedPlaylist = true;
            finishWithResult(true);
        }
    }

    private void togglePlayPause() {
        if (mediaPlayer == null) return;
        if (mediaPlayer.isPlaying()) {
            mediaPlayer.pause();
        } else {
            mediaPlayer.play();
        }
    }

    private void seekByMs(long deltaMs) {
        if (mediaPlayer == null) return;
        long next = Math.max(0, mediaPlayer.getTime() + deltaMs);
        long length = mediaPlayer.getLength();
        if (length > 0) next = Math.min(next, length);
        mediaPlayer.setTime(next);
        updateTimeLabel();
    }

    private void updateTimeLabel() {
        if (mediaPlayer == null || timeView == null) return;
        long cur = Math.max(0, mediaPlayer.getTime());
        long len = Math.max(0, mediaPlayer.getLength());
        timeView.setText(formatClock(cur) + " / " + formatClock(len));
    }

    private static String formatClock(long ms) {
        long totalSec = Math.max(0, ms / 1000L);
        long m = totalSec / 60L;
        long s = totalSec % 60L;
        return m + ":" + (s < 10 ? "0" : "") + s;
    }

    private void showError(String message) {
        errorView.setText(message);
        errorView.setVisibility(View.VISIBLE);
    }

    private void finishWithResult(boolean finished) {
        finishedPlaylist = finishedPlaylist || finished;
        Intent data = new Intent();
        data.putExtra(EXTRA_FINISHED, finishedPlaylist);
        setResult(RESULT_OK, data);
        VlcPlayerPlugin.notifyClosed(finishedPlaylist);
        finish();
    }

    @Override
    public void onBackPressed() {
        finishWithResult(false);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (mediaPlayer != null && !released) {
            wasPlayingBeforePause = mediaPlayer.isPlaying();
            if (wasPlayingBeforePause) {
                mediaPlayer.pause();
            }
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Stay paused after background; user taps play to continue.
    }

    @Override
    protected void onDestroy() {
        uiHandler.removeCallbacks(timeTick);
        releasePlayer();
        super.onDestroy();
    }

    private void releasePlayer() {
        if (released) return;
        released = true;
        try {
            if (mediaPlayer != null) {
                mediaPlayer.stop();
                mediaPlayer.detachViews();
                mediaPlayer.release();
                mediaPlayer = null;
            }
        } catch (Throwable err) {
            Log.w(TAG, "mediaPlayer release", err);
        }
        try {
            if (libVLC != null) {
                libVLC.release();
                libVLC = null;
            }
        } catch (Throwable err) {
            Log.w(TAG, "libVLC release", err);
        }
    }
}
