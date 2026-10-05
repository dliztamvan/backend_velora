#!/usr/bin/env bash
set -euo pipefail

command -v npx >/dev/null 2>&1 || { echo 'ERROR: Node/npm tidak ditemukan.'; exit 1; }

TMP="worker/.wrangler.deploy.toml"
trap 'rm -f "$TMP"' EXIT

echo "Mencari D1 database bernama velora..."
D1_JSON="$(npx wrangler d1 list --json)"
D1_ID="$(printf '%s' "$D1_JSON" | node -e '
let s="";
process.stdin.on("data",d=>s+=d).on("end",()=>{
  try {
    const a=JSON.parse(s);
    const rows=Array.isArray(a)?a:(a.result||a.results||[]);
    const x=rows.find(x=>x.name==="velora"||x.database_name==="velora");
    if(!x || !(x.uuid||x.id)) process.exit(2);
    process.stdout.write(x.uuid||x.id);
  } catch(e) { process.exit(2); }
});
')" || {
  echo 'ERROR: D1 database "velora" tidak ditemukan.'
  echo 'Pastikan database tersebut sudah dibuat dan akun Wrangler sudah login.'
  exit 1
}

echo "D1 ID ditemukan: $D1_ID"

cat > "$TMP" <<TOML
name = "velora-backend"
main = "index.js"
compatibility_date = "2026-09-30"

[[d1_databases]]
binding = "DB"
database_name = "velora"
database_id = "$D1_ID"
TOML

echo "Deploy Worker..."
cd worker
npx wrangler deploy --config .wrangler.deploy.toml
