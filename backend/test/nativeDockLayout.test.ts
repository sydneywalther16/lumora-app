import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const css = readFileSync(join(repoRoot, 'src/styles/global.css'), 'utf8');
const appShell = readFileSync(join(repoRoot, 'src/components/AppShell.tsx'), 'utf8');
const bottomNav = readFileSync(join(repoRoot, 'src/components/BottomNav.tsx'), 'utf8');
const nativeApp = readFileSync(join(repoRoot, 'src/lib/nativeApp.ts'), 'utf8');
const dockRule = css.match(/\.bottom-nav\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

assert.match(css, /--bottom-nav-controls-height:\s*60px/);
assert.match(css, /--bottom-nav-shell-height:\s*calc\(var\(--bottom-nav-controls-height\) \+ env\(safe-area-inset-bottom,\s*0px\)\)/);
assert.match(dockRule, /position:\s*fixed/);
assert.match(dockRule, /left:\s*0/);
assert.match(dockRule, /right:\s*0/);
assert.match(dockRule, /bottom:\s*0/);
assert.match(dockRule, /width:\s*100%/);
assert.match(dockRule, /grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/);
assert.match(dockRule, /border-radius:\s*22px 22px 0 0/);
assert.match(dockRule, /background:\s*rgba\(12,\s*10,\s*24,\s*0\.98\)/);
assert.match(dockRule, /env\(safe-area-inset-bottom,\s*0px\)/);
assert.doesNotMatch(dockRule, /position:\s*absolute/);
assert.doesNotMatch(dockRule, /translateX/);

assert.match(css, /\.screen-scroll[\s\S]*padding:[\s\S]*var\(--bottom-nav-space\)/);
assert.match(css, /\.is-native \.screen-scroll[\s\S]*padding-bottom:\s*calc\(var\(--bottom-nav-space\) \+ 24px\)/);
assert.match(css, /\.is-native\.keyboard-open \.bottom-nav\s*\{[\s\S]*display:\s*none/);
assert.match(nativeApp, /keyboardWillShow[\s\S]*classList\.add\('keyboard-open'\)/);
assert.match(nativeApp, /keyboardWillHide[\s\S]*classList\.remove\('keyboard-open'\)/);
assert.match(appShell, /<main className="screen-scroll">[\s\S]*<Outlet \/>[\s\S]*<BottomNav \/>/);
assert.deepEqual(
  Array.from(bottomNav.matchAll(/\['([^']+)',\s*'[^']+'\]/g), (match) => match[1]),
  ['Home', 'Discover', 'Create', 'Drafts', 'Profile'],
);

console.info('Native fixed-dock and safe-area layout tests passed.');
