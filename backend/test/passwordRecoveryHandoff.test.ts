import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import {
  hasPasswordRecoveryIntent,
  parsePasswordRecoveryUrl,
  processPasswordRecovery,
  processPasswordRecoveryOnce,
  type PasswordRecoveryInput,
} from '../../src/lib/passwordRecovery';

const session = { user: { id: 'unit-user' } } as unknown as Session;

function input(overrides: Partial<PasswordRecoveryInput> = {}): PasswordRecoveryInput {
  return {
    accessToken: null,
    authType: null,
    code: null,
    hasAuthError: false,
    refreshToken: null,
    tokenHash: null,
    ...overrides,
  };
}

function client(options: {
  emitRecoveryEvent?: boolean;
  sessionResult?: Session | null;
} = {}) {
  const calls = {
    exchange: 0,
    setSession: 0,
    unsubscribe: 0,
    verify: 0,
  };
  let authStateCallback: ((event: string, nextSession: Session | null) => void) | null = null;

  const resultSession = options.sessionResult === undefined ? session : options.sessionResult;
  const fakeClient = {
    auth: {
      onAuthStateChange(callback: (event: string, nextSession: Session | null) => void) {
        authStateCallback = callback;
        return {
          data: {
            subscription: {
              unsubscribe() {
                calls.unsubscribe += 1;
              },
            },
          },
        };
      },
      async exchangeCodeForSession() {
        calls.exchange += 1;
        if (options.emitRecoveryEvent) authStateCallback?.('PASSWORD_RECOVERY', session);
        return { data: { session: resultSession, user: resultSession?.user ?? null }, error: null };
      },
      async setSession() {
        calls.setSession += 1;
        return { data: { session: resultSession, user: resultSession?.user ?? null }, error: null };
      },
      async verifyOtp() {
        calls.verify += 1;
        return { data: { session: resultSession, user: resultSession?.user ?? null }, error: null };
      },
    },
  } as unknown as SupabaseClient;

  return { calls, fakeClient };
}

const manualInput = input();
assert.equal(hasPasswordRecoveryIntent(manualInput), false);
assert.equal((await processPasswordRecovery(client().fakeClient, manualInput)).status, 'manual');

const failedInput = input({ hasAuthError: true });
assert.equal((await processPasswordRecovery(client().fakeClient, failedInput)).status, 'invalid');

const pkce = client();
const pkceResult = await processPasswordRecovery(pkce.fakeClient, input({ code: randomUUID() }));
assert.equal(pkceResult.status, 'valid');
assert.equal(pkce.calls.exchange, 1);
assert.equal(pkce.calls.verify, 0);
assert.equal(pkce.calls.setSession, 0);
assert.equal(pkce.calls.unsubscribe, 1);

const tokenHash = client();
const tokenHashResult = await processPasswordRecovery(tokenHash.fakeClient, input({
  authType: 'recovery',
  tokenHash: randomUUID(),
}));
assert.equal(tokenHashResult.status, 'valid');
assert.equal(tokenHash.calls.exchange, 0);
assert.equal(tokenHash.calls.verify, 1);
assert.equal(tokenHash.calls.setSession, 0);
assert.equal(tokenHash.calls.unsubscribe, 1);

const implicit = client();
const implicitResult = await processPasswordRecovery(implicit.fakeClient, input({
  accessToken: randomUUID(),
  authType: 'recovery',
  refreshToken: randomUUID(),
}));
assert.equal(implicitResult.status, 'valid');
assert.equal(implicit.calls.exchange, 0);
assert.equal(implicit.calls.verify, 0);
assert.equal(implicit.calls.setSession, 1);
assert.equal(implicit.calls.unsubscribe, 1);

const recoveryEvent = client({ emitRecoveryEvent: true, sessionResult: null });
const recoveryEventResult = await processPasswordRecovery(
  recoveryEvent.fakeClient,
  input({ code: randomUUID() }),
);
assert.equal(recoveryEventResult.status, 'valid');
assert.equal(recoveryEvent.calls.exchange, 1);

const singleFlight = client();
const singleFlightInput = input({ code: randomUUID() });
const firstHandoff = processPasswordRecoveryOnce(singleFlight.fakeClient, singleFlightInput);
const secondHandoff = processPasswordRecoveryOnce(singleFlight.fakeClient, singleFlightInput);
assert.equal(firstHandoff, secondHandoff);
assert.equal((await firstHandoff).status, 'valid');
assert.equal(singleFlight.calls.exchange, 1);

const authErrorUrl = new URL('https://unit.test/auth/update-password?error_code=expired');
const parsedError = parsePasswordRecoveryUrl(authErrorUrl);
assert.equal(parsedError.hasAuthError, true);
assert.equal(hasPasswordRecoveryIntent(parsedError), true);

console.log('passwordRecoveryHandoff unit tests passed');
