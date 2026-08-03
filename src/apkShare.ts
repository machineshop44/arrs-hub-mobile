import { Capacitor, registerPlugin } from "@capacitor/core";
import { App } from "@capacitor/app";
import { APP_VERSION } from "./version";

export type ApkSharePlugin = {
  shareInstalledApk(): Promise<{ bytes: number; fileName: string }>;
};

const ApkShare = registerPlugin<ApkSharePlugin>("ApkShare");

export type AppVersionInfo = {
  version: string;
  build: string;
};

export async function getAppVersionInfo(): Promise<AppVersionInfo | null> {
  if (Capacitor.isNativePlatform()) {
    try {
      const info = await App.getInfo();
      return { version: info.version, build: info.build };
    } catch {
      return { version: APP_VERSION, build: "web" };
    }
  }
  return { version: APP_VERSION, build: "web" };
}

export async function shareInstalledApk(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error("Share APK is only available in the Android app.");
  }
  await ApkShare.shareInstalledApk();
}
