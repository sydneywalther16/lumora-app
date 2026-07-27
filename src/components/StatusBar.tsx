import { Capacitor } from '@capacitor/core';
import { shouldShowNativeRouteHeader } from '../lib/nativeUi';

type Props = { title: string };

export default function StatusBar({ title }: Props) {
  const isNativePlatform = Capacitor.isNativePlatform();
  if (!shouldShowNativeRouteHeader(isNativePlatform, title)) return null;

  return (
    <header className={`status-bar${isNativePlatform ? ' native-route-header' : ''}`}>
      <div>
        <h1>{title}</h1>
      </div>
    </header>
  );
}
