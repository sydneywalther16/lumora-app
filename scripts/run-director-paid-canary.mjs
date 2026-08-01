const REQUIRED_APPROVAL = 'I AUTHORIZE EXACTLY ONE GUARDED PAID CANARY';
const SENSITIVE_ENVIRONMENT_KEYS = [
  'LUMORA_DIRECTOR_AUTHORIZATION_ID',
  'LUMORA_DIRECTOR_IDEMPOTENCY_KEY',
  'LUMORA_DIRECTOR_USER_ACCESS_TOKEN',
];

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required private input: ${name}.`);
  return value;
}

function mask(value) {
  if (value.length <= 8) return '••••••••';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function clearSensitiveEnvironment() {
  for (const name of SENSITIVE_ENVIRONMENT_KEYS) delete process.env[name];
}

function safeResult(response, body) {
  const diagnostics = body && typeof body === 'object' && body.internalDiagnostics &&
    typeof body.internalDiagnostics === 'object'
    ? body.internalDiagnostics
    : {};
  return {
    httpStatus: response.status,
    status: typeof body?.status === 'string' ? body.status : null,
    message: typeof body?.message === 'string' ? body.message.slice(0, 240) : null,
    draftSaved: body?.draftSaved === true,
    authorizationState: typeof diagnostics.authorizationState === 'string'
      ? diagnostics.authorizationState
      : null,
    failureCategory: typeof diagnostics.failureCategory === 'string'
      ? diagnostics.failureCategory
      : null,
    providerRequestCount: Number(diagnostics.providerRequestCount ?? 0),
    providerRetryCount: Number(diagnostics.providerRetryCount ?? 0),
    providerFallbackCount: Number(diagnostics.providerFallbackCount ?? 0),
    repairRequestCount: Number(diagnostics.repairRequestCount ?? 0),
  };
}

async function main() {
  if (process.env.LUMORA_DIRECTOR_ONE_TIME_APPROVAL !== REQUIRED_APPROVAL) {
    throw new Error('Refusing to run without a fresh explicit one-time paid-canary authorization.');
  }
  const endpoint = process.env.LUMORA_DIRECTOR_ENDPOINT?.trim() ||
    'https://lumora-app-topaz.vercel.app/api/generations';
  const authorizationId = requiredEnvironment('LUMORA_DIRECTOR_AUTHORIZATION_ID');
  const idempotencyKey = requiredEnvironment('LUMORA_DIRECTOR_IDEMPOTENCY_KEY');
  const accessToken = requiredEnvironment('LUMORA_DIRECTOR_USER_ACCESS_TOKEN');
  clearSensitiveEnvironment();

  console.log(JSON.stringify({
    action: 'one_guarded_paid_canary',
    authorizationId: mask(authorizationId),
    idempotencyKey: mask(idempotencyKey),
    retries: 0,
  }));

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
      'x-lumora-director-authorization': authorizationId,
    },
    body: JSON.stringify({
      engine: 'lumora-director-v1-canary',
      prompt: 'She walks through a candlelit mansion and pauses after hearing a sound behind her.',
    }),
  });
  const body = await response.json().catch(() => null);
  console.log(JSON.stringify(safeResult(response, body)));
  if (!response.ok) process.exitCode = 1;
}

try {
  await main();
} finally {
  clearSensitiveEnvironment();
  delete process.env.LUMORA_DIRECTOR_ONE_TIME_APPROVAL;
}
