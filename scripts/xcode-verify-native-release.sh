#!/bin/sh

set -eu

if [ "${CONFIGURATION:-}" != "Release" ]; then
  exit 0
fi

REPO_ROOT="$(cd "${SRCROOT}/../.." && pwd)"
NODE_BIN="$(command -v node || true)"

if [ -z "${NODE_BIN}" ]; then
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node; do
    if [ -x "${candidate}" ]; then
      NODE_BIN="${candidate}"
      break
    fi
  done
fi

if [ -z "${NODE_BIN}" ]; then
  echo "error: Node.js is required to verify native release assets."
  exit 1
fi

SOURCE_COMMIT="$(/usr/bin/git -C "${REPO_ROOT}" rev-parse HEAD)"

"${NODE_BIN}" "${REPO_ROOT}/scripts/verify-native-release.mjs" \
  --repo-root "${REPO_ROOT}" \
  --public-dir "${SRCROOT}/App/public" \
  --expected-commit "${SOURCE_COMMIT}" \
  --expected-build-number "${CURRENT_PROJECT_VERSION}" \
  --expected-marketing-version "${MARKETING_VERSION}"
