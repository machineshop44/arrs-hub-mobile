# Release is minified (debug is not). Capacitor discovers plugins and @PluginMethod
# handlers by reflection, and the WebView bridge calls into them by name, so keep
# every plugin package whole.

-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod,SourceFile,LineNumberTable

# Capacitor core + plugins
-keep class com.getcapacitor.** { *; }
-keep class com.capacitorjs.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod public *;
    @com.getcapacitor.annotation.PermissionCallback *;
    @com.getcapacitor.annotation.ActivityCallback *;
}
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# App (plugins, workers, widget provider)
-keep class com.arrshub.status.** { *; }

# libVLC (JNI looks up Java classes/fields by name)
-keep class org.videolan.** { *; }
-dontwarn org.videolan.**

# @capgo/inappbrowser
-keep class ee.forgr.** { *; }
-dontwarn ee.forgr.**

# capacitor-udp-socket
-keep class com.svend.plugins.udp.socket.** { *; }

# Cordova plugin bridge (capacitor-cordova-android-plugins)
-keep class org.apache.cordova.** { *; }
-dontwarn org.apache.cordova.**

# WorkManager instantiates workers reflectively
-keep class androidx.work.** { *; }
-keep class * extends androidx.work.ListenableWorker {
    public <init>(android.content.Context, androidx.work.WorkerParameters);
}
-dontwarn androidx.work.**
