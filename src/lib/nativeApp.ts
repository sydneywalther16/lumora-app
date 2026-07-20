import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { ImpactStyle, Haptics } from '@capacitor/haptics';
import { Keyboard, KeyboardResize } from '@capacitor/keyboard';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import {
  AUTH_CALLBACK_PATH,
  AUTH_RESET_CONFIRM_PATH,
  AUTH_UPDATE_PASSWORD_PATH,
  NATIVE_APP_SCHEME,
} from './bootstrapSession';

const nativeAuthPaths = new Set([
  AUTH_CALLBACK_PATH,
  AUTH_RESET_CONFIRM_PATH,
  AUTH_UPDATE_PASSWORD_PATH,
]);

let initialized = false;

function localPathForNativeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== `${NATIVE_APP_SCHEME}:`) return null;

    const path = `/${url.hostname}${url.pathname}`.replace(/\/{2,}/g, '/');
    if (!nativeAuthPaths.has(path)) return null;

    return `${path}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function initializeNativeApp() {
  if (initialized || !Capacitor.isNativePlatform()) return;
  initialized = true;
  document.documentElement.classList.add('is-native');

  void StatusBar.setStyle({ style: Style.Dark });
  void Keyboard.setResizeMode({ mode: KeyboardResize.Native });

  void CapacitorApp.addListener('appUrlOpen', ({ url }) => {
    const localPath = localPathForNativeUrl(url);
    if (!localPath) return;

    void Haptics.impact({ style: ImpactStyle.Light });
    window.location.replace(localPath);
  });

  window.setTimeout(() => {
    void SplashScreen.hide();
  }, 250);
}
