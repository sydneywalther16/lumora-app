import { env } from '../../lib/env';

const FAL_ACCOUNT_BILLING_URL = 'https://api.fal.ai/v1/account/billing?expand=credits';

export type FalAccountErrorCategory =
  | 'fal_key_missing'
  | 'fal_auth_failed'
  | 'fal_billing_required'
  | 'fal_account_locked'
  | 'fal_api_unavailable'
  | 'fal_ok';

export type FalAccountStatus = {
  ok: boolean;
  falKeyPresent: boolean;
  falKeySource: 'FAL_KEY' | 'KLING_API_KEY' | null;
  authOk: boolean;
  workspaceRedacted: string | null;
  userRedacted: string | null;
  balancePresent: boolean;
  balanceAmount: number | null;
  balanceCurrency: string | null;
  locked: boolean;
  billingRequired: boolean;
  errorCategory: FalAccountErrorCategory;
  errorSummary: string | null;
  recommendedNextAction: string;
};

export function getConfiguredFalKey() {
  if (env.FAL_KEY) return { key: env.FAL_KEY, source: 'FAL_KEY' as const };
  if (env.KLING_API_KEY) return { key: env.KLING_API_KEY, source: 'KLING_API_KEY' as const };
  return { key: null, source: null };
}

export function falAuthorizationHeader(key: string) {
  if (/^(Key|Bearer)\s+/i.test(key.trim())) return key.trim();
  return `Key ${key.trim()}`;
}

function safeText(value: unknown) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function redactFalText(value: unknown, maxLength = 320) {
  return safeText(value)
    .replace(/https?:\/\/\S+/gi, '[redacted-url]')
    .replace(/(?:Key|Bearer)\s+[A-Za-z0-9._:-]+/gi, '[redacted-auth]')
    .replace(/[A-Za-z0-9_-]{16,}:[A-Za-z0-9._:-]{16,}/g, '[redacted-key]')
    .slice(0, maxLength);
}

function redactIdentifier(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  if (text.length <= 4) return `${text.slice(0, 1)}...`;
  return `${text.slice(0, 3)}...${text.slice(-2)}`;
}

function numberValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function creditsFromPayload(payload: unknown) {
  const record = recordValue(payload);
  const credits = recordValue(record.credits);
  const balanceAmount = numberValue(
    credits.current_balance ??
    credits.balance ??
    credits.amount ??
    record.current_balance ??
    record.balance,
  );
  const balanceCurrencyValue = credits.currency ?? record.currency;
  const balanceCurrency = typeof balanceCurrencyValue === 'string' ? balanceCurrencyValue : null;
  return {
    balancePresent: balanceAmount !== null,
    balanceAmount,
    balanceCurrency,
  };
}

export function classifyFalAccountStatus(input: {
  statusCode?: number | null;
  payload?: unknown;
  balanceAmount?: number | null;
}) {
  const text = redactFalText(input.payload);
  const lower = text.toLowerCase();
  const locked = lower.includes('user is locked') ||
    lower.includes('account locked') ||
    lower.includes('locked account') ||
    lower.includes('locked. reason');
  const billingRequired = lower.includes('exhausted balance') ||
    lower.includes('top up') ||
    lower.includes('billing required') ||
    lower.includes('payment required') ||
    lower.includes('billing not configured') ||
    lower.includes('enable billing') ||
    lower.includes('insufficient credit') ||
    lower.includes('insufficient balance') ||
    (lower.includes('balance') && lower.includes('exhausted')) ||
    (typeof input.balanceAmount === 'number' && input.balanceAmount <= 0);

  if (input.statusCode === 401) {
    return {
      errorCategory: 'fal_auth_failed' as const,
      locked: false,
      billingRequired: false,
      authOk: false,
      errorSummary: text || 'fal authentication failed',
    };
  }
  if (locked) {
    return {
      errorCategory: 'fal_account_locked' as const,
      locked: true,
      billingRequired: true,
      authOk: true,
      errorSummary: text || 'fal account is locked',
    };
  }
  if (billingRequired || input.statusCode === 402) {
    return {
      errorCategory: 'fal_billing_required' as const,
      locked: false,
      billingRequired: true,
      authOk: true,
      errorSummary: text || 'fal billing requires attention',
    };
  }
  if (input.statusCode === 403) {
    return {
      errorCategory: 'fal_auth_failed' as const,
      locked: false,
      billingRequired: false,
      authOk: false,
      errorSummary: text || 'fal key lacks access to this endpoint',
    };
  }
  if (
    input.statusCode === 429 ||
    input.statusCode === 500 ||
    input.statusCode === 502 ||
    input.statusCode === 503 ||
    input.statusCode === 504
  ) {
    return {
      errorCategory: 'fal_api_unavailable' as const,
      locked: false,
      billingRequired: false,
      authOk: false,
      errorSummary: text || 'fal account API is temporarily unavailable',
    };
  }
  return {
    errorCategory: 'fal_ok' as const,
    locked: false,
    billingRequired: false,
    authOk: true,
    errorSummary: null,
  };
}

function recommendedNextAction(category: FalAccountErrorCategory) {
  if (category === 'fal_key_missing') return 'Set FAL_KEY or KLING_API_KEY in Render environment variables, then redeploy.';
  if (category === 'fal_auth_failed') return 'Rotate the fal key in the fal dashboard, set it in Render env, and redeploy. Do not paste the key into scripts or chat.';
  if (category === 'fal_billing_required' || category === 'fal_account_locked') return 'Add fal credits or unlock billing in the fal dashboard, then rerun this account diagnostic.';
  if (category === 'fal_api_unavailable') return 'Fal account API is unavailable. Try this diagnostic again later.';
  return 'Fal account key and billing look ready. Run the Kling likeness canary only if you intend to spend a provider attempt.';
}

export async function getFalAccountStatus(): Promise<FalAccountStatus> {
  const configured = getConfiguredFalKey();
  if (!configured.key) {
    return {
      ok: false,
      falKeyPresent: false,
      falKeySource: null,
      authOk: false,
      workspaceRedacted: null,
      userRedacted: null,
      balancePresent: false,
      balanceAmount: null,
      balanceCurrency: null,
      locked: false,
      billingRequired: false,
      errorCategory: 'fal_key_missing',
      errorSummary: null,
      recommendedNextAction: recommendedNextAction('fal_key_missing'),
    };
  }

  try {
    const response = await fetch(FAL_ACCOUNT_BILLING_URL, {
      method: 'GET',
      headers: {
        Authorization: falAuthorizationHeader(configured.key),
      },
    });
    const contentType = response.headers.get('content-type') ?? '';
    const payload = contentType.includes('application/json')
      ? await response.json().catch(() => null)
      : await response.text().catch(() => null);
    const credits = creditsFromPayload(payload);
    const classification = classifyFalAccountStatus({
      statusCode: response.status,
      payload,
      balanceAmount: credits.balanceAmount,
    });
    const record = recordValue(payload);
    const ok = response.ok && classification.errorCategory === 'fal_ok';

    return {
      ok,
      falKeyPresent: true,
      falKeySource: configured.source,
      authOk: response.ok ? true : classification.authOk,
      workspaceRedacted: redactIdentifier(record.username ?? record.workspace ?? record.account),
      userRedacted: redactIdentifier(record.user ?? record.user_id ?? record.userId),
      balancePresent: credits.balancePresent,
      balanceAmount: credits.balanceAmount,
      balanceCurrency: credits.balanceCurrency,
      locked: classification.locked,
      billingRequired: classification.billingRequired,
      errorCategory: classification.errorCategory,
      errorSummary: classification.errorSummary,
      recommendedNextAction: recommendedNextAction(classification.errorCategory),
    };
  } catch (error) {
    return {
      ok: false,
      falKeyPresent: true,
      falKeySource: configured.source,
      authOk: false,
      workspaceRedacted: null,
      userRedacted: null,
      balancePresent: false,
      balanceAmount: null,
      balanceCurrency: null,
      locked: false,
      billingRequired: false,
      errorCategory: 'fal_api_unavailable',
      errorSummary: redactFalText(error),
      recommendedNextAction: recommendedNextAction('fal_api_unavailable'),
    };
  }
}

export function isFalBillingRequired(status: Pick<FalAccountStatus, 'errorCategory' | 'billingRequired' | 'locked'>) {
  return status.billingRequired ||
    status.locked ||
    status.errorCategory === 'fal_billing_required' ||
    status.errorCategory === 'fal_account_locked';
}
