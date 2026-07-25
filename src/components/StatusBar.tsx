import { Capacitor } from '@capacitor/core';
import { shouldShowNativeRouteHeader, shouldShowSimulatedDeviceStatus } from '../lib/nativeUi';

type Props = { title: string };

export default function StatusBar({ title }: Props) {
  const isNativePlatform = Capacitor.isNativePlatform();
  if (!shouldShowNativeRouteHeader(isNativePlatform, title)) return null;

  return (
    <header className={`status-bar${isNativePlatform ? ' native-route-header' : ''}`}>
      <div>
        {!isNativePlatform ? <div className="eyebrow">AI Cast Studio</div> : null}
        <h1>{title}</h1>
      </div>
      {shouldShowSimulatedDeviceStatus(isNativePlatform) ? (
        <div className="status-icons" aria-label="Simulated web preview status">
          <span>5G</span>
          <span>89%</span>
        </div>
      ) : null}
    </header>
  );
}
