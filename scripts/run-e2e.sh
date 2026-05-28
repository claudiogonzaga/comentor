#!/usr/bin/env bash
# Roda os flows do Maestro contra o emulador, captura logcat em paralelo
# e extrai crashes/erros nativos quando algum flow falha.
#
# Uso:
#   scripts/run-e2e.sh                 # roda todos os flows
#   scripts/run-e2e.sh .maestro/01_smoke_app_abre.yaml   # roda um só
#
# Requisitos: maestro CLI, adb, emulador rodando.

set -uo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

export PATH="$PATH:$HOME/.maestro/bin"

PACKAGE="com.claudiogonzaga.comentor"
TARGET="${1:-.maestro}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="test-results/run-$STAMP"
mkdir -p "$OUT_DIR"

DEVICE="$(adb devices | awk 'NR>1 && $2=="device"{print $1; exit}')"
if [ -z "$DEVICE" ]; then
  echo "ERRO: nenhum dispositivo/emulador conectado (adb devices)." >&2
  exit 1
fi
echo "Device: $DEVICE"
echo "Target: $TARGET"
echo "Output: $OUT_DIR"
echo

# Limpa o buffer do logcat para começar do zero
adb -s "$DEVICE" logcat -c

# Captura logcat em background — pega tudo, filtramos depois
LOGCAT_RAW="$OUT_DIR/logcat-raw.txt"
adb -s "$DEVICE" logcat -v threadtime > "$LOGCAT_RAW" &
LOGCAT_PID=$!
trap 'kill $LOGCAT_PID 2>/dev/null || true' EXIT

# Roda Maestro — formato junit + screenshots no OUT_DIR
MAESTRO_OUT="$OUT_DIR/maestro-output.txt"
set +e
maestro test \
  --format junit \
  --output "$OUT_DIR/report.xml" \
  "$TARGET" 2>&1 | tee "$MAESTRO_OUT"
MAESTRO_EXIT=${PIPESTATUS[0]}
set -e

# Para o logcat
sleep 1
kill $LOGCAT_PID 2>/dev/null || true
wait $LOGCAT_PID 2>/dev/null || true

# Extrai eventos relevantes do logcat
LOGCAT_FILTERED="$OUT_DIR/logcat-errors.txt"
{
  echo "=== FATAL EXCEPTIONS ==="
  grep -A 30 "FATAL EXCEPTION" "$LOGCAT_RAW" || echo "(nenhum)"
  echo
  echo "=== AndroidRuntime errors (app pid) ==="
  grep -E "AndroidRuntime|$PACKAGE" "$LOGCAT_RAW" | grep -E " E |FATAL" | head -100 || echo "(nenhum)"
  echo
  echo "=== ReactNativeJS errors / warnings ==="
  grep "ReactNativeJS" "$LOGCAT_RAW" | grep -iE "error|exception|warn|crash" | head -50 || echo "(nenhum)"
  echo
  echo "=== Process death / ANR ==="
  grep -E "ActivityManager.*died|ANR in|Force finishing activity" "$LOGCAT_RAW" | grep -i comentor | head -20 || echo "(nenhum)"
} > "$LOGCAT_FILTERED"

# Move screenshots se Maestro deixou em ~/.maestro/tests
MAESTRO_TESTS_DIR="$HOME/.maestro/tests"
if [ -d "$MAESTRO_TESTS_DIR" ]; then
  LATEST_TEST="$(ls -td "$MAESTRO_TESTS_DIR"/* 2>/dev/null | head -1)"
  if [ -n "$LATEST_TEST" ]; then
    cp -r "$LATEST_TEST" "$OUT_DIR/maestro-artifacts" 2>/dev/null || true
  fi
fi

echo
echo "================================================================"
echo "Resultado: $([ $MAESTRO_EXIT -eq 0 ] && echo PASSOU || echo FALHOU)"
echo "Artefatos em: $OUT_DIR"
echo "  - maestro-output.txt   stdout do Maestro"
echo "  - report.xml           junit"
echo "  - logcat-raw.txt       logcat completo durante a execução"
echo "  - logcat-errors.txt    apenas erros/crashes filtrados"
echo "  - maestro-artifacts/   screenshots e debug do Maestro"
echo "================================================================"

if [ $MAESTRO_EXIT -ne 0 ]; then
  echo
  echo "=== TRECHOS DE ERRO DO LOGCAT ==="
  head -80 "$LOGCAT_FILTERED"
fi

exit $MAESTRO_EXIT
