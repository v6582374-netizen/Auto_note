#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

VERSION="${1:-}"
if [[ -z "${VERSION}" ]]; then
  VERSION="$(node -e "const fs=require('fs');const m=JSON.parse(fs.readFileSync('public/manifest.json','utf8'));process.stdout.write(m.version);")"
fi

OUT_DIR="releases"
OUT_ZIP="${OUT_DIR}/musemark-store-v${VERSION}.zip"

echo "[1/6] Type check"
npm run check

echo "[2/6] Strict unused check"
npx tsc --noEmit --noUnusedLocals --noUnusedParameters

echo "[3/6] Build"
npm run build

echo "[4/6] Content script module-safety check"
if rg -n --max-count 1 "^[[:space:]]*import[[:space:]]" dist/content.js >/dev/null; then
  echo "ERROR: dist/content.js contains top-level import. MV3 content_scripts must not be module scripts."
  exit 1
fi

echo "[5/6] Secret-like pattern scan (dist only; sourcemaps excluded)"
if rg -n --no-heading \
  --glob "!**/*.map" \
  --glob "!**/*.png" \
  --glob "!**/*.jpg" \
  --glob "!**/*.jpeg" \
  --glob "!**/*.ico" \
  --glob "!**/*.webp" \
  --glob "!**/*.svg" \
  -e "sk-[A-Za-z0-9]{20,}" \
  -e "AIza[0-9A-Za-z_-]{35}" \
  -e "AKIA[0-9A-Z]{16}" \
  -e "-----BEGIN (RSA|EC|OPENSSH|PRIVATE) KEY-----" \
  dist >/dev/null; then
  echo "ERROR: potential secret-like content found in dist. Please review matches below:"
  rg -n --no-heading \
    --glob "!**/*.map" \
    --glob "!**/*.png" \
    --glob "!**/*.jpg" \
    --glob "!**/*.jpeg" \
    --glob "!**/*.ico" \
    --glob "!**/*.webp" \
    --glob "!**/*.svg" \
    -e "sk-[A-Za-z0-9]{20,}" \
    -e "AIza[0-9A-Za-z_-]{35}" \
    -e "AKIA[0-9A-Z]{16}" \
    -e "-----BEGIN (RSA|EC|OPENSSH|PRIVATE) KEY-----" \
    dist
  exit 1
fi

echo "[6/6] Pack dist only (exclude *.map)"
mkdir -p "${OUT_DIR}"
rm -f "${OUT_ZIP}"
(
  cd dist
  zip -qr "../${OUT_ZIP}" . -x "*.map"
)

echo "Package created: ${OUT_ZIP}"
echo "Package file list:"
zipinfo -1 "${OUT_ZIP}"
