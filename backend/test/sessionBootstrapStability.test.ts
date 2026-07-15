import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const bootstrapSource = readFileSync(join(process.cwd(), 'src/lib/bootstrapSession.ts'), 'utf8');
const useSessionSource = readFileSync(join(process.cwd(), 'src/hooks/useSession.ts'), 'utf8');
const updatePasswordSource = readFileSync(join(process.cwd(), 'src/pages/AuthUpdatePasswordPage.tsx'), 'utf8');

assert.match(bootstrapSource, /let bootstrapPromise: Promise<Session \| null> \| null = null;/);
assert.match(bootstrapSource, /if \(bootstrapPromise\) \{\s*return bootstrapPromise;\s*\}/s);
assert.match(bootstrapSource, /bootstrapPromise = \(async \(\) => \{/);
assert.match(bootstrapSource, /\}\)\(\)\.finally\(\(\) => \{\s*bootstrapPromise = null;\s*\}\);/s);

assert.match(bootstrapSource, /const shouldShowRestoring = source === 'initial' && !initialHydrated;/);
assert.match(bootstrapSource, /emitSessionState\(\{\s*\.\.\.currentSnapshot,\s*authReady: false,/s);
assert.match(bootstrapSource, /const shouldProcessRedirectParams = redirectParamsPresent && isAuthRedirectRoute\(\);/);
assert.match(bootstrapSource, /readSession\(supabase, nextSource, shouldProcessRedirectParams\)/);
assert.match(bootstrapSource, /cleanAuthParamsFromCurrentUrl\(\)/);
assert.match(bootstrapSource, /window\.history\.replaceState\(/);
assert.doesNotMatch(bootstrapSource, /window\.dispatchEvent\(new PopStateEvent\('popstate'\)\)/);

assert.match(bootstrapSource, /client\.auth\.onAuthStateChange\(\(event, session\) => \{/);
const listenerBlock = bootstrapSource.match(/onAuthStateChange\(\(event, session\) => \{[\s\S]*?\}\);/);
assert.ok(listenerBlock, 'onAuthStateChange listener block should exist');
assert.doesNotMatch(listenerBlock[0], /refreshBootstrapSession\(/);
assert.doesNotMatch(listenerBlock[0], /exchangeRedirectSession\(/);

assert.match(useSessionSource, /useCallback\(\(\) => refreshBootstrapSession\('refresh'\), \[\]\)/);
assert.match(useSessionSource, /refreshSession,/);

assert.match(updatePasswordSource, /refreshSession/);
assert.doesNotMatch(updatePasswordSource, /onAuthStateChange/);

console.log('sessionBootstrapStability unit tests passed');
