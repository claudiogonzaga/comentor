#!/usr/bin/env bash
# Instala o AAR oficial do sherpa-onnx (transcrição no celular) em
# modules/aspis-media/android/libs. Não há artefato oficial no Maven Central.
#
#   ./scripts/fetch-sherpa-onnx.sh                 # baixa do GitHub Releases
#   ./scripts/fetch-sherpa-onnx.sh ~/Downloads/sherpa-onnx-1.13.8.aar   # usa um arquivo já baixado
set -euo pipefail

VERSION=1.13.8
# SHA-256 do asset oficial (digest publicado no release do GitHub).
SHA256="${SHERPA_ONNX_SHA256:-633c24321e06b1fe79feafa03ea16cbc0f8a286641e2da3559bac91bdb13bd96}"
URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/v${VERSION}/sherpa-onnx-${VERSION}.aar"
DEST_DIR="$(cd "$(dirname "$0")/.." && pwd)/modules/aspis-media/android/libs"
DEST="$DEST_DIR/sherpa-onnx-${VERSION}.aar"

mkdir -p "$DEST_DIR"
if [[ -n "${1:-}" ]]; then
  cp "$1" "$DEST.tmp"
else
  curl -fL --retry 3 -o "$DEST.tmp" "$URL"
fi

GOT=$(shasum -a 256 "$DEST.tmp" | awk '{print $1}')
if [[ -n "$SHA256" && "$GOT" != "$SHA256" ]]; then
  rm -f "$DEST.tmp"
  echo "Erro: SHA-256 não confere ($GOT)." >&2
  exit 1
fi
# confere que é mesmo o AAR do sherpa-onnx (classes Kotlin + libs nativas arm64)
LISTING=$(unzip -l "$DEST.tmp") # (grep -q num pipe + pipefail dá falso negativo)
grep -q "jni/arm64-v8a/libsherpa-onnx-jni.so" <<<"$LISTING" || { rm -f "$DEST.tmp"; echo "Erro: AAR inesperado." >&2; exit 1; }
mv "$DEST.tmp" "$DEST"
echo "✓ sherpa-onnx ${VERSION} instalado em $DEST"
echo "  SHA-256: $GOT"
