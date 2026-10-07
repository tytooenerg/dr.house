#!/usr/bin/env bash
# Publica no servidor um commit que já passou no CI. Chamado pelo GitHub Actions
# (.github/workflows/deploy.yml) por SSH, com uma chave que o authorized_keys do servidor
# restringe a ESTE comando (command="..."): quem tiver a chave não ganha um shell, só
# consegue pedir "publique o commit X". O SHA chega em SSH_ORIGINAL_COMMAND.
#
# Também roda à mão: scripts/deploy/deploy-remoto.sh <sha-de-40-caracteres>
set -euo pipefail

SHA="${SSH_ORIGINAL_COMMAND:-${1:-}}"
if [[ ! "$SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "[deploy] uso: informe o SHA completo (40 caracteres) do commit a publicar" >&2
  exit 2
fi

cd "$(dirname "$0")/../.."
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

git fetch --quiet origin "$BRANCH"

# Só publica commit que pertence ao branch que este servidor segue — nunca troca de branch
# nem publica algo que não passou pelo origin.
if ! git merge-base --is-ancestor "$SHA" "origin/$BRANCH" 2>/dev/null; then
  echo "[deploy] o commit $SHA não está em origin/$BRANCH — nada foi alterado" >&2
  exit 1
fi

# --ff-only: se alguém mexeu em arquivo direto no servidor, para aqui em vez de misturar.
if ! git merge --ff-only --quiet "$SHA" 2>/dev/null; then
  echo "[deploy] há alterações locais no servidor que impedem atualizar o código — nada foi alterado." >&2
  echo "[deploy] veja com: cd $(pwd) && git status" >&2
  exit 1
fi
echo "[deploy] código em $(git rev-parse --short HEAD) ($BRANCH); reconstruindo os containers…"

docker compose -f docker-compose.prod.yml up -d --build
echo "[deploy] publicado $(git rev-parse --short HEAD)"
