export function shouldShowInstallAction(isNativePlatform: boolean): boolean {
  return !isNativePlatform;
}

export function shouldShowSimulatedDeviceStatus(isNativePlatform: boolean): boolean {
  return !isNativePlatform;
}

export function shouldShowNativeRouteHeader(isNativePlatform: boolean, title: string): boolean {
  return !isNativePlatform || title !== 'Lumora';
}
