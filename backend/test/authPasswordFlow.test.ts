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
const updatePasswordSource = readFileSync(join(process.cwd(), 'src/pages/AuthUpdatePasswordPage.tsx'), 'utf8');

assert.match(authCardSource, /Email link/);
assert.match(authCardSource, /Password/);
assert.match(authCardSource, /Create account/);
assert.match(authCardSource, /Forgot password\?/);
assert.match(authCardSource, /signInWithOtp/);
assert.match(authCardSource, /signInWithPassword/);
assert.match(authCardSource, /signUp/);
assert.match(authCardSource, /resetPasswordForEmail/);
assert.match(authCardSource, /friendlyForgotPasswordError/);
assert.match(authCardSource, /FORGOT_PASSWORD_CLIENT_COOLDOWN_MS/);
assert.match(authCardSource, /forgotPasswordCooldownActive/);
assert.match(authCardSource, /if \(busy\) return;/);
assert.match(authCardSource, /validatePasswordConfirmation/);
assert.match(authCardSource, /We'll never ask for your provider keys or render credentials\./);
assert.match(authCardSource, /Check your email for a password reset link\./);
assert.doesNotMatch(authCardSource, /Password reset email sent\. Open the link to set a new password\./);

assert.match(appSource, /path="\/auth\/callback"/);
assert.match(appSource, /path="\/auth\/update-password"/);
assert.match(callbackSource, /exchangeCodeForSession/);
assert.match(callbackSource, /setSession/);

assert.match(bootstrapSource, /verifyOtp/);
assert.match(bootstrapSource, /token_hash/);
assert.match(bootstrapSource, /type:\s*'recovery'/);

assert.match(updatePasswordSource, /Checking reset link\.\.\./);
assert.match(updatePasswordSource, /PASSWORD_RECOVERY/);
assert.match(updatePasswordSource, /exchangeCodeForSession|refreshSession/);
assert.match(updatePasswordSource, /This reset link expired or could not be verified\. Request a new one\./);
assert.match(updatePasswordSource, /Open the password reset link from your email to continue\./);
assert.match(updatePasswordSource, /validatePasswordConfirmation/);

const authMessagesSource = readFileSync(join(process.cwd(), 'src/lib/authMessages.ts'), 'utf8');
assert.match(authMessagesSource, /FORGOT_PASSWORD_RATE_LIMIT_MESSAGE/);
assert.match(authMessagesSource, /FORGOT_PASSWORD_COOLDOWN_MESSAGE/);
assert.match(authMessagesSource, /FORGOT_PASSWORD_UNAUTHORIZED_EMAIL_MESSAGE/);
assert.match(authMessagesSource, /FORGOT_PASSWORD_INVALID_EMAIL_MESSAGE/);
assert.match(authMessagesSource, /FORGOT_PASSWORD_NETWORK_MESSAGE/);
assert.match(authMessagesSource, /FORGOT_PASSWORD_GENERIC_MESSAGE/);
assert.match(authMessagesSource, /function friendlyForgotPasswordError/);

console.log('authPasswordFlow unit tests passed');
