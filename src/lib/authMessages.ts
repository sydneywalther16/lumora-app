export const MIN_PASSWORD_LENGTH = 8;
export const FORGOT_PASSWORD_RATE_LIMIT_MESSAGE = 'Too many email requests were sent. Please wait a while before trying again.';
export const FORGOT_PASSWORD_COOLDOWN_MESSAGE = 'A reset email was requested recently. Wait a minute before requesting another.';
export const FORGOT_PASSWORD_UNAUTHORIZED_EMAIL_MESSAGE = 'Email delivery is not available for this address yet.';
export const FORGOT_PASSWORD_INVALID_EMAIL_MESSAGE = 'Enter a valid email address.';
export const FORGOT_PASSWORD_NETWORK_MESSAGE = 'Lumora could not reach the email service. Check your connection and try again.';
export const FORGOT_PASSWORD_GENERIC_MESSAGE = 'We could not send a reset link right now. Please try again later.';

export type AuthAction = 'sign_in' | 'sign_up' | 'forgot_password' | 'update_password' | 'magic_link';

function normalizedMessage(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

export function friendlyForgotPasswordError(rawMessage: string | null | undefined): string {
  const message = normalizedMessage(rawMessage);

  if (!message) return FORGOT_PASSWORD_GENERIC_MESSAGE;

  if (
    message.includes('over_email_send_rate_limit')
    || message.includes('429')
    || message.includes('rate limit')
    || message.includes('too many requests')
    || message.includes('email rate limit exceeded')
  ) {
    return FORGOT_PASSWORD_RATE_LIMIT_MESSAGE;
  }

  if (
    message.includes('requested recently')
    || message.includes('too recently')
    || message.includes('wait a minute')
    || message.includes('request this after')
    || message.includes('cooldown')
    || message.includes('try again after')
  ) {
    return FORGOT_PASSWORD_COOLDOWN_MESSAGE;
  }

  if (
    message.includes('email address not authorized')
    || message.includes('email not authorized')
    || message.includes('not allowed for this email')
    || message.includes('email delivery is disabled')
    || message.includes('email provider is not configured')
  ) {
    return FORGOT_PASSWORD_UNAUTHORIZED_EMAIL_MESSAGE;
  }

  if (
    message.includes('invalid email')
    || message.includes('email must be a valid')
    || message.includes('unable to validate email address')
  ) {
    return FORGOT_PASSWORD_INVALID_EMAIL_MESSAGE;
  }

  if (
    message.includes('failed to fetch')
    || message.includes('network request failed')
    || message.includes('network error')
    || message.includes('fetch failed')
    || message.includes('connection')
  ) {
    return FORGOT_PASSWORD_NETWORK_MESSAGE;
  }

  return FORGOT_PASSWORD_GENERIC_MESSAGE;
}

export function friendlyAuthError(action: AuthAction, rawMessage: string | null | undefined): string {
  const message = normalizedMessage(rawMessage);

  if (!message) {
    if (action === 'forgot_password') return FORGOT_PASSWORD_GENERIC_MESSAGE;
    if (action === 'update_password') return 'We could not update your password right now. Please try again.';
    if (action === 'sign_up') return 'We could not create your account right now. Please try again.';
    if (action === 'magic_link') return 'We could not send your email link right now. Please try again.';
    return 'Email or password is incorrect.';
  }

  if (message.includes('invalid login credentials')) return 'Email or password is incorrect.';
  if (message.includes('email not confirmed')) return 'Check your email and confirm your account before signing in.';
  if (message.includes('user already registered')) return 'This email already has an account. Try Password or Email link.';
  if (message.includes('password should be at least')) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (message.includes('same password')) return 'Choose a new password different from your current password.';
  if (message.includes('rate limit') || message.includes('too many requests')) {
    return action === 'forgot_password'
      ? FORGOT_PASSWORD_RATE_LIMIT_MESSAGE
      : 'Too many attempts right now. Please wait a moment and try again.';
  }

  if (action === 'forgot_password') return friendlyForgotPasswordError(rawMessage);

  if (action === 'update_password') return 'We could not update your password right now. Please try again.';
  if (action === 'sign_up') return 'We could not create your account right now. Please try again.';
  if (action === 'magic_link') return 'We could not send your email link right now. Please try again.';
  return 'Email or password is incorrect.';
}

export function validatePasswordInput(password: string): string | null {
  if (!password) return 'Enter a password.';
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

export function validatePasswordConfirmation(password: string, confirmPassword: string): string | null {
  const passwordError = validatePasswordInput(password);
  if (passwordError) return passwordError;
  if (!confirmPassword) return 'Confirm your password.';
  if (password !== confirmPassword) return 'Passwords do not match.';
  return null;
}
