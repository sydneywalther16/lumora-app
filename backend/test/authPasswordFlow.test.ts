import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FORGOT_PASSWORD_COOLDOWN_MESSAGE,
  FORGOT_PASSWORD_GENERIC_MESSAGE,
  FORGOT_PASSWORD_INVALID_EMAIL_MESSAGE,
  FORGOT_PASSWORD_NETWORK_MESSAGE,
  FORGOT_PASSWORD_RATE_LIMIT_MESSAGE,
  FORGOT_PASSWORD_UNAUTHORIZED_EMAIL_MESSAGE,
  MIN_PASSWORD_LENGTH,
  friendlyAuthError,
  friendlyForgotPasswordError,
  validatePasswordConfirmation,
  validatePasswordInput,
} from '../../src/lib/authMessages';

assert.equal(MIN_PASSWORD_LENGTH >= 8, true);
assert.equal(validatePasswordInput(''), 'Enter a password.');
assert.equal(validatePasswordInput('1234567'), `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
assert.equal(validatePasswordConfirmation('password123', 'password321'), 'Passwords do not match.');
assert.equal(validatePasswordConfirmation('password123', 'password123'), null);

assert.equal(
  friendlyAuthError('sign_in', 'Invalid login credentials'),
  'Email or password is incorrect.',
);
assert.equal(
  friendlyAuthError('sign_up', 'User already registered'),
  'This email already has an account. Try Password or Email link.',
);
assert.equal(
  friendlyAuthError('forgot_password', ''),
  FORGOT_PASSWORD_GENERIC_MESSAGE,
);
assert.equal(
  friendlyForgotPasswordError('over_email_send_rate_limit'),
  FORGOT_PASSWORD_RATE_LIMIT_MESSAGE,
);
assert.equal(
  friendlyForgotPasswordError('429 too many requests'),
  FORGOT_PASSWORD_RATE_LIMIT_MESSAGE,
);
assert.equal(
  friendlyForgotPasswordError('A reset email was requested recently. Try again after 60 seconds.'),
  FORGOT_PASSWORD_COOLDOWN_MESSAGE,
);
assert.equal(
  friendlyForgotPasswordError('Email address not authorized for default provider'),
  FORGOT_PASSWORD_UNAUTHORIZED_EMAIL_MESSAGE,
);
assert.equal(
  friendlyForgotPasswordError('Invalid email address'),
  FORGOT_PASSWORD_INVALID_EMAIL_MESSAGE,
);
assert.equal(
  friendlyForgotPasswordError('TypeError: Failed to fetch'),
  FORGOT_PASSWORD_NETWORK_MESSAGE,
);
assert.equal(
  friendlyForgotPasswordError('smtp relay rejected RCPT TO due to policy'),
  FORGOT_PASSWORD_GENERIC_MESSAGE,
);

const appSource = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
const authCardSource = readFileSync(join(process.cwd(), 'src/components/auth/AuthCard.tsx'), 'utf8');
const callbackSource = readFileSync(join(process.cwd(), 'src/pages/AuthCallbackPage.tsx'), 'utf8');
const bootstrapSource = readFileSync(join(process.cwd(), 'src/lib/bootstrapSession.ts'), 'utf8');
const apiOriginSource = readFileSync(join(process.cwd(), 'src/lib/apiOrigin.ts'), 'utf8');
const resetConfirmSource = readFileSync(join(process.cwd(), 'src/pages/AuthResetConfirmPage.tsx'), 'utf8');
const updatePasswordSource = readFileSync(join(process.cwd(), 'src/pages/AuthUpdatePasswordPage.tsx'), 'utf8');
const recoveryTokenSource = readFileSync(join(process.cwd(), 'src/lib/passwordRecoveryTokenHash.ts'), 'utf8');

assert.match(authCardSource, /Email link/);
assert.match(authCardSource, /Password/);
assert.match(authCardSource, /Create account/);
assert.match(authCardSource, /Forgot password\?/);
assert.match(authCardSource, /signInWithOtp/);
assert.match(authCardSource, /signInWithPassword/);
assert.match(authCardSource, /signUp/);
assert.match(authCardSource, /resetPasswordForEmail/);
assert.match(authCardSource, /redirectTo: getPasswordResetConfirmUrl\(\)/);
assert.match(authCardSource, /friendlyForgotPasswordError/);
assert.match(authCardSource, /FORGOT_PASSWORD_CLIENT_COOLDOWN_MS/);
assert.match(authCardSource, /forgotPasswordCooldownActive/);
assert.match(authCardSource, /if \(busy\) return;/);
assert.match(authCardSource, /validatePasswordConfirmation/);
assert.match(authCardSource, /Your private account details stay protected\./);
assert.doesNotMatch(authCardSource, /provider keys|render credentials/i);
assert.match(authCardSource, /Account services are temporarily unavailable\./);
assert.match(authCardSource, />\s*Try again\s*</);
assert.doesNotMatch(authCardSource, /VITE_SUPABASE|ANON_KEY|Connect Supabase|unlock real login|environment variable/i);
assert.match(authCardSource, /Check your email for a password reset link\./);
assert.doesNotMatch(authCardSource, /Password reset email sent\. Open the link to set a new password\./);

assert.match(appSource, /path="\/auth\/callback"/);
assert.match(appSource, /path="\/auth\/reset-confirm"/);
assert.match(appSource, /path="\/auth\/update-password"/);
assert.match(callbackSource, /exchangeCodeForSession/);
assert.match(callbackSource, /setSession/);

assert.match(apiOriginSource, /PRODUCTION_APP_ORIGIN = 'https:\/\/lumora-app-topaz\.vercel\.app'/);
assert.match(bootstrapSource, /export \{ PRODUCTION_APP_ORIGIN \} from '\.\/apiOrigin'/);
assert.match(bootstrapSource, /return PRODUCTION_APP_ORIGIN;/);
assert.doesNotMatch(bootstrapSource, /VERCEL_URL/);
assert.match(bootstrapSource, /window\.location\.pathname === AUTH_CALLBACK_PATH/);
assert.doesNotMatch(bootstrapSource, /window\.location\.pathname === AUTH_CALLBACK_PATH \|\|/);
assert.match(bootstrapSource, /AUTH_RESET_CONFIRM_PATH = '\/auth\/reset-confirm'/);
assert.match(bootstrapSource, /getPasswordResetConfirmUrl/);
assert.match(bootstrapSource, /window\.location\.pathname === AUTH_RESET_CONFIRM_PATH/);

assert.match(resetConfirmSource, /Reset your Lumora password/);
assert.match(resetConfirmSource, /Continue to verify this one-time reset request\./);
assert.match(resetConfirmSource, /Continue to reset password/);
assert.match(resetConfirmSource, /This reset page must be opened from the newest email link\./);
assert.match(resetConfirmSource, /This reset link expired or could not be verified\. Request a new one\./);
assert.match(resetConfirmSource, /Verifying reset request…/);
assert.match(resetConfirmSource, /verificationAttemptedRef/);
assert.match(resetConfirmSource, /passwordRecoveryVerified: true/);
assert.doesNotMatch(resetConfirmSource, /console\.(?:log|warn|error)/);

assert.match(updatePasswordSource, /Checking reset session\.\.\./);
assert.match(updatePasswordSource, /Open the password reset link from your email to continue\./);
assert.match(updatePasswordSource, /passwordRecoveryVerified/);
assert.match(updatePasswordSource, /auth\.getSession\(\)/);
assert.match(updatePasswordSource, /validatePasswordConfirmation/);
assert.match(updatePasswordSource, /<span>New password<\/span>/);
assert.match(updatePasswordSource, /<span>Confirm password<\/span>/);
assert.match(updatePasswordSource, />Update password</);
assert.doesNotMatch(updatePasswordSource, /exchangeCodeForSession|verifyOtp|setSession|token_hash|access_token/);

assert.match(recoveryTokenSource, /client\.auth\.verifyOtp\(/);
assert.match(recoveryTokenSource, /token_hash: tokenToVerify/);
assert.match(recoveryTokenSource, /type: 'recovery'/);
assert.match(recoveryTokenSource, /if \(verificationPromise\) return verificationPromise;/);
assert.doesNotMatch(recoveryTokenSource, /exchangeCodeForSession|setSession|localStorage|sessionStorage/);
assert.doesNotMatch(recoveryTokenSource, /console\.(?:log|warn|error)/);

const authMessagesSource = readFileSync(join(process.cwd(), 'src/lib/authMessages.ts'), 'utf8');
assert.match(authMessagesSource, /FORGOT_PASSWORD_RATE_LIMIT_MESSAGE/);
assert.match(authMessagesSource, /FORGOT_PASSWORD_COOLDOWN_MESSAGE/);
assert.match(authMessagesSource, /FORGOT_PASSWORD_UNAUTHORIZED_EMAIL_MESSAGE/);
assert.match(authMessagesSource, /FORGOT_PASSWORD_INVALID_EMAIL_MESSAGE/);
assert.match(authMessagesSource, /FORGOT_PASSWORD_NETWORK_MESSAGE/);
assert.match(authMessagesSource, /FORGOT_PASSWORD_GENERIC_MESSAGE/);
assert.match(authMessagesSource, /function friendlyForgotPasswordError/);

console.log('authPasswordFlow unit tests passed');
