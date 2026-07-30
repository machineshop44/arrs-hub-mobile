import { Capacitor, registerPlugin } from "@capacitor/core";
import { App } from "@capacitor/app";

export type ApkSharePlugin = {
  shareInstalledApk(): Promise<{ bytes: number; fileName: string }>;
};

const ApkShare = registerPlugin<ApkSharePlugin>("ApkShare");

export type AppVersionInfo = {
  version: string;
  build: string;
};

export async function getAppVersionInfo(): Promise<AppVersionInfo | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const info = await App.getInfo();
    return { version: info.version, build: info.build };
  } catch {
    return null;
  }
}

export async function shareInstalledApk(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error("Share APK is only available in the Android app.");
  }
  await ApkShare.shareInstalledApk();
}
