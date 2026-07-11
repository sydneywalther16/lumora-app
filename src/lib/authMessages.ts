export const MIN_PASSWORD_LENGTH = 8;

export type AuthAction = 'sign_in' | 'sign_up' | 'forgot_password' | 'update_password' | 'magic_link';

function normalizedMessage(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

export function friendlyAuthError(action: AuthAction, rawMessage: string | null | undefined): string {
  const message = normalizedMessage(rawMessage);

  if (!message) {
    if (action === 'forgot_password') return 'We could not send a reset link right now. Please try again.';
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
  if (message.includes('rate limit') || message.includes('too many requests')) return 'Too many attempts right now. Please wait a moment and try again.';

  if (action === 'forgot_password') return 'We could not send a reset link right now. Please try again.';
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
