import type { DirectorCanaryAuthorizationState, DirectorCanaryStatusResponse } from './api';

export type DirectorCanaryRunState = 'checking' | DirectorCanaryAuthorizationState;

export function synchronizedDirectorCanaryRunState(
  _currentState: DirectorCanaryRunState,
  status: DirectorCanaryStatusResponse,
): DirectorCanaryRunState {
  return status.state === 'ready' && status.expiresInSeconds <= 0 ? 'expired' : status.state;
}

export function remainingDirectorCanarySeconds(expiresAt: number, now = Date.now()) {
  return Math.max(0, Math.ceil((expiresAt - now) / 1_000));
}

export function formatDirectorCanaryCountdown(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  return `${minutes}:${String(safeSeconds % 60).padStart(2, '0')}`;
}

export function canStartDirectorCanary(
  state: DirectorCanaryRunState,
  remainingSeconds: number,
) {
  return state === 'ready' && remainingSeconds > 0;
}
