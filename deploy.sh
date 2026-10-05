#!/usr/bin/env bash
set -euo pipefail

# VeloraGames backend deploy helper.
# It finds the D1 database named "velora" automatically, so the D1 id
# does not need to be hard-coded in this repository.

command -v npx >/dev/null 2>&1 || { echo 'ERROR: Node/npm tidak ditemukan.'; exit 1; }

TMP="worker/.wrangler.deploy.toml"
trap 'rm -f "$TMP"' EXIT

D1_JSON="$(npx wrangler d1 list --json)"
D1_ID="$(printf '%s' "$D1_JSON" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s);const x=(Array.isArray(a)?a:(a.result||a.results||[])).find(x=>x.name==="velora"||x.database_name==="velora");if(!x||!x.uuid)process.exit(2);process.stdout.write(x.uuid)}catch(e){process.exit(2)}})'")" || {
  echo 'ERROR: Database D1 "velora" tidak ditemukan.'
  echo 'Buat D1 dengan nama velora terlebih dahulu, lalu beri token akses D1.'
  exit 1
}

cat > "$TMP" <<TOML
name = "velora-backend"
main = "index.js"
compatibility_date = "2026-09-30"

[[d1_databases]]
binding = "DB"
database_name = "velora"
database_id = "$D1_ID"

[vars]
ADMIN_FEE = "3000"
SELLER_PRICE = "15000"
SELLER_DAYS = "15"
TOML

# Deploy from the worker directory so main = "index.js" resolves correctly.
cd worker
npx wrangler deploy --config .wrangler.deploy.toml
