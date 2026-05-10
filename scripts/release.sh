#!/usr/bin/env bash
# Cria uma release no GitHub anexando o APK como asset.
# Uso: ./scripts/release.sh <versao> <caminho-do-apk> [<notas>]
#   ./scripts/release.sh 1.2.0 ./builds/comentor-1.2.0.apk "Bug fixes"

set -euo pipefail

VERSION="${1:-}"
APK_PATH="${2:-}"
NOTES="${3:-Veja o histórico de commits para detalhes.}"

if [[ -z "$VERSION" || -z "$APK_PATH" ]]; then
  echo "Uso: $0 <versao> <caminho-do-apk> [<notas>]"
  echo "Exemplo: $0 1.2.0 ./builds/comentor-1.2.0.apk 'Adiciona modo voz'"
  exit 1
fi

if [[ ! -f "$APK_PATH" ]]; then
  echo "Erro: APK não encontrado em $APK_PATH"
  exit 1
fi

TAG="v${VERSION#v}"

# Confere se a versão no app.json bate
APP_JSON_VERSION=$(grep '"version"' app.json | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/')
if [[ "$APP_JSON_VERSION" != "${VERSION#v}" ]]; then
  echo "Aviso: app.json tem versão '$APP_JSON_VERSION', mas você está releasando '${VERSION#v}'."
  read -p "Continuar mesmo assim? [y/N] " -n 1 -r
  echo
  [[ $REPLY =~ ^[Yy]$ ]] || exit 1
fi

# Cria/empurra a tag
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Tag $TAG já existe."
else
  git tag -a "$TAG" -m "Release $TAG"
  git -c http.sslCAInfo=/etc/ssl/cert.pem push origin "$TAG"
fi

# Cria release com APK
gh release create "$TAG" \
  --title "CoMentor $TAG" \
  --notes "$NOTES" \
  "$APK_PATH#comentor-${VERSION#v}.apk"

echo
echo "✓ Release $TAG publicada com APK anexado."
echo "  Usuários verão o banner de atualização no app dentro de 6 horas (cache)."
echo "  Para forçar imediato: Configurações → Verificar atualização."
