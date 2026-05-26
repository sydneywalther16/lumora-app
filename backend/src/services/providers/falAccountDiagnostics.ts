import { env } from '../../lib/env';

const FAL_ACCOUNT_BILLING_URL = 'https://api.fal.ai/v1/account/billing?expand=credits';
const FAL_MODEL_PRICING_URL = 'https://api.fal.ai/v1/models/pricing';
const DEFAULT_PRICING_ENDPOINT_ID = 'fal-ai/flux/dev';

export type FalKeySource = 'FAL_ADMIN_KEY' | 'FAL_KEY' | 'KLING_API_KEY';

export type FalAccountErrorCategory =
  | 'fal_key_missing'
  | 'fal_auth_failed'
  | 'fal_key_scope_not_permitted'
  | 'fal_billing_required'
  | 'fal_account_locked'
  | 'fal_api_unavailable'
  | 'fal_ok';

export type FalInferenceKeyValidationStatus = 'not_configured' | 'ok' | 'failed' | 'unknown';
export type FalBillingCheckStatus =
  | 'not_checked'
  | 'ok'
  | 'scope_not_permitted'
  | 'billing_required'
  | 'account_locked'
  | 'auth_failed'
  | 'unavailable';

export type FalAccountStatus = {
  ok: boolean;
  falKeyPresent: boolean;
  falKeySource: 'FAL_KEY' | 'KLING_API_KEY' | null;
  falAdminKeyPresent: boolean;
  billingKeySource: FalKeySource | null;
  authOk: boolean;
  inferenceKeyScopeOk: boolean | null;
  inferenceKeyValidationStatus: FalInferenceKeyValidationStatus;
  inferenceKeyValidationModel: string | null;
  inferenceKeyValidationErrorSummary: string | null;
  billingCheckAvailable: boolean;
  billingCheckStatus: FalBillingCheckStatus;
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

type FalStatusClassification = {
  errorCategory: FalAccountErrorCategory;
  locked: boolean;
  billingRequired: boolean;
  authOk: boolean;
  errorSummary: string | null;
};

type FalInferenceKeyValidation = {
  status: FalInferenceKeyValidationStatus;
  scopeOk: boolean | null;
  model: string | null;
  errorCategory: FalAccountErrorCategory | null;
  errorSummary: string | null;
};

export function getConfiguredFalKey() {
  if (env.FAL_KEY) return { key: env.FAL_KEY, source: 'FAL_KEY' as const };
  if (env.KLING_API_KEY) return { key: env.KLING_API_KEY, source: 'KLING_API_KEY' as const };
  return { key: null, source: null };
}

export function getConfiguredFalBillingKey() {
  if (env.FAL_ADMIN_KEY) return { key: env.FAL_ADMIN_KEY, source: 'FAL_ADMIN_KEY' as const };
  const inferenceKey = getConfiguredFalKey();
  return inferenceKey.key
    ? { key: inferenceKey.key, source: inferenceKey.source }
    : { key: null, source: null };
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
    .replace(/(?:Key|Bearer)\s+[A-Za-z0-9._:-]{12,}/gi, '[redacted-auth]')
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

function parseFalPayload(contentType: string, response: Response) {
  return contentType.includes('application/json')
    ? response.json().catch(() => null)
    : response.text().catch(() => null);
}

function pricingValidationModel() {
  return env.KLING_REFERENCE_MODEL || env.KLING_ELEMENTS_MODEL || env.KLING_MODEL || DEFAULT_PRICING_ENDPOINT_ID;
}

function pricingUrl(model: string) {
  const url = new URL(FAL_MODEL_PRICING_URL);
  url.searchParams.set('endpoint_id', model);
  return url.toString();
}

export function classifyFalAccountStatus(input: {
  statusCode?: number | null;
  payload?: unknown;
  balanceAmount?: number | null;
}): FalStatusClassification {
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
  const scopeNotPermitted = lower.includes('not permitted to perform this action') ||
    lower.includes('not allowed to perform this action') ||
    lower.includes('does not have permission') ||
    lower.includes('insufficient permissions') ||
    lower.includes('missing required scope');
  const authFailed = lower.includes('invalid key') ||
    lower.includes('invalid api key') ||
    lower.includes('malformed api key') ||
    lower.includes('revoked key') ||
    lower.includes('unauthorized');

  if (input.statusCode === 401 || authFailed) {
    return {
      errorCategory: 'fal_auth_failed',
      locked: false,
      billingRequired: false,
      authOk: false,
      errorSummary: text || 'fal authentication failed',
    };
  }
  if (locked) {
    return {
      errorCategory: 'fal_account_locked',
      locked: true,
      billingRequired: true,
      authOk: true,
      errorSummary: text || 'fal account is locked',
    };
  }
  if (billingRequired || input.statusCode === 402) {
    return {
      errorCategory: 'fal_billing_required',
      locked: false,
      billingRequired: true,
      authOk: true,
      errorSummary: text || 'fal billing requires attention',
    };
  }
  if (scopeNotPermitted) {
    return {
      errorCategory: 'fal_key_scope_not_permitted',
      locked: false,
      billingRequired: false,
      authOk: true,
      errorSummary: text || 'fal key scope is not permitted for this endpoint',
    };
  }
  if (input.statusCode === 403) {
    return {
      errorCategory: 'fal_key_scope_not_permitted',
      locked: false,
      billingRequired: false,
      authOk: true,
      errorSummary: text || 'fal key scope is not permitted for this endpoint',
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
      errorCategory: 'fal_api_unavailable',
      locked: false,
      billingRequired: false,
      authOk: false,
      errorSummary: text || 'fal account API is temporarily unavailable',
    };
  }
  return {
    errorCategory: 'fal_ok',
    locked: false,
    billingRequired: false,
    authOk: true,
    errorSummary: null,
  };
}

function billingStatus(category: FalAccountErrorCategory): FalBillingCheckStatus {
  if (category === 'fal_ok') return 'ok';
  if (category === 'fal_key_scope_not_permitted') return 'scope_not_permitted';
  if (category === 'fal_billing_required') return 'billing_required';
  if (category === 'fal_account_locked') return 'account_locked';
  if (category === 'fal_auth_failed') return 'auth_failed';
  if (category === 'fal_api_unavailable') return 'unavailable';
  return 'not_checked';
}

function recommendedNextAction(input: {
  category: FalAccountErrorCategory;
  billingKeySource: FalKeySource | null;
  inferenceKeyValidation: FalInferenceKeyValidation;
}) {
  if (input.category === 'fal_key_missing') {
    return 'Set FAL_KEY or KLING_API_KEY in Render environment variables, then redeploy.';
  }
  if (input.category === 'fal_auth_failed') {
    return input.inferenceKeyValidation.status === 'failed'
      ? 'Rotate the fal inference key in the fal dashboard, set it in Render env, and redeploy. Do not paste the key into scripts or chat.'
      : 'The fal billing/admin key failed authentication. Check FAL_ADMIN_KEY or use the fal dashboard to confirm balance.';
  }
  if (input.category === 'fal_key_scope_not_permitted') {
    return input.billingKeySource === 'FAL_ADMIN_KEY'
      ? 'FAL_ADMIN_KEY cannot read fal billing. Check its scope, or use the fal dashboard to confirm balance.'
      : 'The configured fal inference key is valid for model APIs but cannot read billing. Use the fal dashboard to confirm balance, or set optional FAL_ADMIN_KEY for billing diagnostics.';
  }
  if (input.category === 'fal_billing_required' || input.category === 'fal_account_locked') {
    return 'Add fal credits or unlock billing in the fal dashboard, then rerun this account diagnostic.';
  }
  if (input.category === 'fal_api_unavailable') {
    return 'Fal account or pricing API is unavailable. Try this diagnostic again later.';
  }
  return 'Fal inference key and billing look ready. Run the Kling likeness canary only if you intend to spend a provider attempt.';
}

async function validateFalInferenceKey(): Promise<FalInferenceKeyValidation> {
  const configured = getConfiguredFalKey();
  const model = pricingValidationModel();
  if (!configured.key) {
    return {
      status: 'not_configured',
      scopeOk: null,
      model,
      errorCategory: 'fal_key_missing',
      errorSummary: null,
    };
  }

  try {
    const response = await fetch(pricingUrl(model), {
      method: 'GET',
      headers: {
        Authorization: falAuthorizationHeader(configured.key),
      },
    });
    const payload = await parseFalPayload(response.headers.get('content-type') ?? '', response);
    const classification = classifyFalAccountStatus({
      statusCode: response.status,
      payload,
    });

    if (response.ok && classification.errorCategory === 'fal_ok') {
      return {
        status: 'ok',
        scopeOk: true,
        model,
        errorCategory: null,
        errorSummary: null,
      };
    }

    if (classification.errorCategory === 'fal_auth_failed') {
      return {
        status: 'failed',
        scopeOk: false,
        model,
        errorCategory: 'fal_auth_failed',
        errorSummary: classification.errorSummary,
      };
    }

    return {
      status: 'unknown',
      scopeOk: null,
      model,
      errorCategory: classification.errorCategory,
      errorSummary: classification.errorSummary,
    };
  } catch (error) {
    return {
      status: 'unknown',
      scopeOk: null,
      model,
      errorCategory: 'fal_api_unavailable',
      errorSummary: redactFalText(error),
    };
  }
}

export async function getFalAccountStatus(): Promise<FalAccountStatus> {
  const inferenceKey = getConfiguredFalKey();
  const billingKey = getConfiguredFalBillingKey();
  const inferenceValidation = await validateFalInferenceKey();

  if (!inferenceKey.key && !billingKey.key) {
    return {
      ok: false,
      falKeyPresent: false,
      falKeySource: null,
      falAdminKeyPresent: false,
      billingKeySource: null,
      authOk: false,
      inferenceKeyScopeOk: null,
      inferenceKeyValidationStatus: inferenceValidation.status,
      inferenceKeyValidationModel: inferenceValidation.model,
      inferenceKeyValidationErrorSummary: inferenceValidation.errorSummary,
      billingCheckAvailable: false,
      billingCheckStatus: 'not_checked',
      workspaceRedacted: null,
      userRedacted: null,
      balancePresent: false,
      balanceAmount: null,
      balanceCurrency: null,
      locked: false,
      billingRequired: false,
      errorCategory: 'fal_key_missing',
      errorSummary: null,
      recommendedNextAction: recommendedNextAction({
        category: 'fal_key_missing',
        billingKeySource: null,
        inferenceKeyValidation: inferenceValidation,
      }),
    };
  }

  let accountClassification: FalStatusClassification = {
    errorCategory: 'fal_key_missing',
    locked: false,
    billingRequired: false,
    authOk: false,
    errorSummary: null,
  };
  let workspaceRedacted: string | null = null;
  let userRedacted: string | null = null;
  let balancePresent = false;
  let balanceAmount: number | null = null;
  let balanceCurrency: string | null = null;

  if (billingKey.key) {
    try {
      const response = await fetch(FAL_ACCOUNT_BILLING_URL, {
        method: 'GET',
        headers: {
          Authorization: falAuthorizationHeader(billingKey.key),
        },
      });
      const payload = await parseFalPayload(response.headers.get('content-type') ?? '', response);
      const credits = creditsFromPayload(payload);
      accountClassification = classifyFalAccountStatus({
        statusCode: response.status,
        payload,
        balanceAmount: credits.balanceAmount,
      });
      const record = recordValue(payload);
      workspaceRedacted = redactIdentifier(record.username ?? record.workspace ?? record.account);
      userRedacted = redactIdentifier(record.user ?? record.user_id ?? record.userId);
      balancePresent = credits.balancePresent;
      balanceAmount = credits.balanceAmount;
      balanceCurrency = credits.balanceCurrency;
    } catch (error) {
      accountClassification = {
        errorCategory: 'fal_api_unavailable',
        locked: false,
        billingRequired: false,
        authOk: false,
        errorSummary: redactFalText(error),
      };
    }
  }

  const billingCheckStatus = billingKey.key
    ? billingStatus(accountClassification.errorCategory)
    : 'not_checked';
  const billingCheckAvailable = billingCheckStatus === 'ok' ||
    billingCheckStatus === 'billing_required' ||
    billingCheckStatus === 'account_locked';
  const errorCategory: FalAccountErrorCategory = !inferenceKey.key
    ? 'fal_key_missing'
    : inferenceValidation.status === 'failed'
      ? 'fal_auth_failed'
    : accountClassification.errorCategory === 'fal_ok'
      ? 'fal_ok'
    : accountClassification.errorCategory === 'fal_key_scope_not_permitted'
      ? 'fal_key_scope_not_permitted'
    : accountClassification.errorCategory === 'fal_billing_required' ||
      accountClassification.errorCategory === 'fal_account_locked'
      ? accountClassification.errorCategory
    : accountClassification.errorCategory === 'fal_auth_failed' && billingKey.source === 'FAL_ADMIN_KEY' &&
      inferenceValidation.scopeOk === true
      ? 'fal_key_scope_not_permitted'
    : accountClassification.errorCategory === 'fal_auth_failed'
      ? 'fal_auth_failed'
    : accountClassification.errorCategory === 'fal_api_unavailable' && inferenceValidation.scopeOk === true
      ? 'fal_api_unavailable'
    : inferenceValidation.errorCategory ?? accountClassification.errorCategory;
  const authOk = inferenceValidation.scopeOk === true ||
    accountClassification.authOk ||
    errorCategory === 'fal_key_scope_not_permitted';
  const ok = errorCategory === 'fal_ok' ||
    (errorCategory === 'fal_key_scope_not_permitted' && inferenceValidation.scopeOk === true);

  return {
    ok,
    falKeyPresent: Boolean(inferenceKey.key),
    falKeySource: inferenceKey.source,
    falAdminKeyPresent: Boolean(env.FAL_ADMIN_KEY),
    billingKeySource: billingKey.source,
    authOk,
    inferenceKeyScopeOk: inferenceValidation.scopeOk,
    inferenceKeyValidationStatus: inferenceValidation.status,
    inferenceKeyValidationModel: inferenceValidation.model,
    inferenceKeyValidationErrorSummary: inferenceValidation.errorSummary,
    billingCheckAvailable,
    billingCheckStatus,
    workspaceRedacted,
    userRedacted,
    balancePresent,
    balanceAmount,
    balanceCurrency,
    locked: accountClassification.locked,
    billingRequired: accountClassification.billingRequired,
    errorCategory,
    errorSummary: errorCategory === 'fal_key_scope_not_permitted' && inferenceValidation.scopeOk === true
      ? accountClassification.errorSummary
      : inferenceValidation.status === 'failed'
        ? inferenceValidation.errorSummary
        : accountClassification.errorSummary ?? inferenceValidation.errorSummary,
    recommendedNextAction: recommendedNextAction({
      category: errorCategory,
      billingKeySource: billingKey.source,
      inferenceKeyValidation: inferenceValidation,
    }),
  };
}

export function isFalBillingRequired(status: Pick<FalAccountStatus, 'errorCategory' | 'billingRequired' | 'locked'>) {
  return status.billingRequired ||
    status.locked ||
    status.errorCategory === 'fal_billing_required' ||
    status.errorCategory === 'fal_account_locked';
}

export function isFalAccountBlockingKling(status: Pick<
  FalAccountStatus,
  'errorCategory' | 'billingRequired' | 'locked' | 'falKeyPresent' | 'inferenceKeyScopeOk'
>) {
  if (!status.falKeyPresent) return true;
  if (isFalBillingRequired(status)) return true;
  if (status.errorCategory === 'fal_auth_failed' && status.inferenceKeyScopeOk !== true) return true;
  return false;
}
