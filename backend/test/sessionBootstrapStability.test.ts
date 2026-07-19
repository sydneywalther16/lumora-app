import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const bootstrapSource = readFileSync(join(process.cwd(), 'src/lib/bootstrapSession.ts'), 'utf8');
const useSessionSource = readFileSync(join(process.cwd(), 'src/hooks/useSession.ts'), 'utf8');
const updatePasswordSource = readFileSync(join(process.cwd(), 'src/pages/AuthUpdatePasswordPage.tsx'), 'utf8');
const recoverySource = readFileSync(join(process.cwd(), 'src/lib/passwordRecovery.ts'), 'utf8');

assert.match(bootstrapSource, /let bootstrapPromise: Promise<Session \| null> \| null = null;/);
assert.match(bootstrapSource, /if \(bootstrapPromise\) \{\s*return bootstrapPromise;\s*\}/s);
assert.match(bootstrapSource, /bootstrapPromise = \(async \(\) => \{/);
assert.match(bootstrapSource, /\}\)\(\)\.finally\(\(\) => \{\s*bootstrapPromise = null;\s*\}\);/s);

assert.match(bootstrapSource, /const shouldShowRestoring = source === 'initial' && !initialHydrated;/);
assert.match(bootstrapSource, /emitSessionState\(\{\s*\.\.\.currentSnapshot,\s*authReady: false,/s);
assert.match(bootstrapSource, /const shouldProcessRedirectParams = redirectParamsPresent && isGlobalAuthRedirectRoute\(\);/);
assert.match(bootstrapSource, /return window\.location\.pathname === AUTH_CALLBACK_PATH;/);
assert.match(bootstrapSource, /window\.location\.pathname === AUTH_UPDATE_PASSWORD_PATH/);
assert.match(bootstrapSource, /readSession\(supabase, nextSource, shouldProcessRedirectParams\)/);
assert.match(bootstrapSource, /cleanAuthParamsFromCurrentUrl\(\)/);
assert.match(bootstrapSource, /window\.history\.replaceState\(/);
assert.match(bootstrapSource, /if \(shouldProcessRedirectParams\) \{\s*cleanAuthParamsFromCurrentUrl\(\);\s*\}/s);
assert.doesNotMatch(bootstrapSource, /window\.dispatchEvent\(new PopStateEvent\('popstate'\)\)/);

assert.match(bootstrapSource, /client\.auth\.onAuthStateChange\(\(event, session\) => \{/);
const listenerBlock = bootstrapSource.match(/onAuthStateChange\(\(event, session\) => \{[\s\S]*?\}\);/);
assert.ok(listenerBlock, 'onAuthStateChange listener block should exist');
assert.doesNotMatch(listenerBlock[0], /refreshBootstrapSession\(/);
assert.doesNotMatch(listenerBlock[0], /exchangeRedirectSession\(/);

assert.match(useSessionSource, /useCallback\(\(\) => refreshBootstrapSession\('refresh'\), \[\]\)/);
assert.match(useSessionSource, /refreshSession,/);

assert.doesNotMatch(updatePasswordSource, /refreshSession/);
assert.match(updatePasswordSource, /processPasswordRecoveryOnce/);
assert.match(recoverySource, /PASSWORD_RECOVERY/);
assert.match(recoverySource, /let recoveryHandoffPromise: Promise<PasswordRecoveryResult> \| null = null;/);
assert.match(recoverySource, /return recoveryHandoffPromise;/);

console.log('sessionBootstrapStability unit tests passed');
