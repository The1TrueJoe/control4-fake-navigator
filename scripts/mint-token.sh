#!/usr/bin/env bash
# Mint a Control4 broker JWT (C4_TOKEN) for the fake-navigator backend.
#
# The broker gates POST /api/v1/localjwt on a client cert; nginx forwards the
# verify result as X-SSL-CERT-* headers. On the controller we POST to
# 127.0.0.1:3000 with those headers set to a Composer identity, so this mints a
# token over root SSH (no cert wrangling on the client).
#
# Env:
#   C4_SSH_HOST  controller IP           (default 10.0.0.107)
#   C4_SSH_USER  ssh user                (default root)
#   C4_SSH_PASS  ssh password            (or use C4_SSH_KEY)
#   C4_SSH_KEY   ssh private key path     (alternative to password)
#
# Usage:
#   C4_SSH_PASS='...' ./scripts/mint-token.sh          # print token
#   C4_SSH_PASS='...' ./scripts/mint-token.sh --env    # write ../.env
set -euo pipefail
HOST="${C4_SSH_HOST:-10.0.0.107}"
USER="${C4_SSH_USER:-root}"
DN='CN=Composer_tech@control4.com_dev,O=Control4'
JS='var h=require("http");var r=h.request({host:"127.0.0.1",port:3000,path:"/api/v1/localjwt",method:"POST",headers:{"Content-Type":"application/json","Content-Length":2,"X-SSL-CERT-VERIFY":"SUCCESS","X-SSL-CERT-CLIENT_S_DN":"'"$DN"'"}},s=>{let d="";s.on("data",c=>d+=c);s.on("end",()=>{try{process.stdout.write(JSON.parse(d).token)}catch(e){process.exit(1)}})});r.write("{}");r.end();'
OPTS=(-o HostKeyAlgorithms=+ssh-rsa -o KexAlgorithms=+diffie-hellman-group1-sha1
      -o PubkeyAcceptedAlgorithms=+ssh-rsa -o StrictHostKeyChecking=no
      -o UserKnownHostsFile=/dev/null -o ConnectTimeout=8)
if [ -n "${C4_SSH_KEY:-}" ]; then
  TOKEN=$(ssh "${OPTS[@]}" -i "$C4_SSH_KEY" "$USER@$HOST" "node -e '$JS'")
elif [ -n "${C4_SSH_PASS:-}" ]; then
  command -v sshpass >/dev/null || { echo "need sshpass (brew install sshpass) or set C4_SSH_KEY" >&2; exit 1; }
  TOKEN=$(sshpass -p "$C4_SSH_PASS" ssh "${OPTS[@]}" "$USER@$HOST" "node -e '$JS'")
else
  echo "set C4_SSH_PASS or C4_SSH_KEY" >&2; exit 1
fi
[ ${#TOKEN} -gt 100 ] || { echo "mint failed (got ${#TOKEN} chars)" >&2; exit 1; }
if [ "${1:-}" = "--env" ]; then
  printf 'C4_HOST=https://%s\nC4_TOKEN=%s\n' "$HOST" "$TOKEN" > "$(dirname "$0")/../.env"
  echo "wrote $(cd "$(dirname "$0")/.." && pwd)/.env" >&2
else
  printf '%s\n' "$TOKEN"
fi
