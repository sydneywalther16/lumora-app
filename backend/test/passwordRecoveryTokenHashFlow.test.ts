import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import {
  createPasswordRecoveryVerifier,
  hasPasswordRecoveryToken,
  parsePasswordRecoveryToken,
  passwordResetConfirmSafePath,
  type PasswordRecoveryTokenInput,
} from '../../src/lib/passwordRecoveryTokenHash';

const session = { user: { id: 'unit-user' } } as unknown as Session;

function fakeClient(options: { valid?: boolean } = {}) {
  const calls = { verify: 0 };
  const valid = options.valid ?? true;
  const client = {
    auth: {
      async verifyOtp() {
        calls.verify += 1;
        return valid
          ? { data: { session, user: session.user }, error: null }
          : { data: { session: null, user: null }, error: new Error('rejected') };
      },
    },
  } as unknown as SupabaseClient;

  return { calls, client };
}

function recoveryInput(): { input: PasswordRecoveryTokenInput; url: URL } {
  const url = new URL('https://unit.test/auth/reset-confirm');
  url.searchParams.set('token_hash', randomUUID());
  url.searchParams.set('type', 'recovery');
  return { input: parsePasswordRecoveryToken(url), url };
}

const validRequest = recoveryInput();
assert.equal(validRequest.input.hasRecoveryType, true);
assert.equal(Boolean(validRequest.input.tokenHash), true);
assert.equal(hasPasswordRecoveryToken(validRequest.input), true);

const validClient = fakeClient();
const verifier = createPasswordRecoveryVerifier(validClient.client, validRequest.input);
const firstVerification = verifier.verify();
const duplicateVerification = verifier.verify();
assert.equal(firstVerification, duplicateVerification);
assert.equal(await firstVerification, 'valid');
assert.equal(validClient.calls.verify, 1);

const invalidClient = fakeClient({ valid: false });
const invalidVerifier = createPasswordRecoveryVerifier(invalidClient.client, recoveryInput().input);
assert.equal(await invalidVerifier.verify(), 'invalid');
assert.equal(invalidClient.calls.verify, 1);

const manualClient = fakeClient();
const manualVerifier = createPasswordRecoveryVerifier(manualClient.client, {
  hasRecoveryType: false,
  tokenHash: null,
});
assert.equal(await manualVerifier.verify(), 'invalid');
assert.equal(manualClient.calls.verify, 0);

validRequest.url.searchParams.set('keep', '1');
validRequest.url.hash = new URLSearchParams({
  tab: 'details',
  token_hash: randomUUID(),
  type: 'recovery',
}).toString();
const safePath = passwordResetConfirmSafePath(validRequest.url);
assert.equal(safePath, '/auth/reset-confirm?keep=1#tab=details');
assert.equal(safePath.includes('token_hash'), false);
assert.equal(safePath.includes('recovery'), false);

const confirmPageSource = readFileSync(join(process.cwd(), 'src/pages/AuthResetConfirmPage.tsx'), 'utf8');
const helperSource = readFileSync(join(process.cwd(), 'src/lib/passwordRecoveryTokenHash.ts'), 'utf8');

assert.doesNotMatch(confirmPageSource, /useEffect/);
assert.match(confirmPageSource, /status !== 'ready'/);
assert.match(confirmPageSource, /verificationAttemptedRef\.current = true;/);
assert.match(confirmPageSource, /setStatus\('verifying'\)/);
assert.match(confirmPageSource, /await verifierRef\.current\.verify\(\)/);
assert.match(confirmPageSource, /cleanPasswordResetConfirmUrl\(\)/);
assert.match(confirmPageSource, /navigate\(AUTH_UPDATE_PASSWORD_PATH, \{\s*replace: true,/s);
assert.match(confirmPageSource, /This reset link expired or could not be verified\. Request a new one\./);
assert.match(confirmPageSource, /This reset page must be opened from the newest email link\./);
assert.doesNotMatch(confirmPageSource, /localStorage|sessionStorage|console\.(?:log|warn|error)/);
assert.doesNotMatch(helperSource, /localStorage|sessionStorage|console\.(?:log|warn|error)/);

const failedStateIndex = confirmPageSource.indexOf("setStatus('invalid')");
const failedCleanupIndex = confirmPageSource.lastIndexOf('cleanPasswordResetConfirmUrl();');
assert.ok(failedStateIndex >= 0 && failedStateIndex < failedCleanupIndex);

console.log('passwordRecoveryTokenHashFlow unit tests passed');
