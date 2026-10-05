#!/usr/bin/env bash
set -e

echo "======================================"
echo " VeloraGames Backend Deploy"
echo "======================================"

command -v npx >/dev/null 2>&1 || {
  echo "ERROR: Node/npm tidak ditemukan."
  exit 1
}

echo "[1/4] Mencari D1 database 'velora'..."

D1_JSON="$(npx wrangler d1 list --json)"

D1_ID="$(
  printf '%s' "$D1_JSON" |
  node <<'NODE'
let input = "";

process.stdin.on("data", chunk => {
  input += chunk;
});

process.stdin.on("end", () => {
  try {
    const data = JSON.parse(input);
    const list = Array.isArray(data)
      ? data
      : (data.result || data.results || []);

    const db = list.find(x =>
      x.name === "velora" ||
      x.database_name === "velora"
    );

    if (!db || !db.uuid) {
      process.exit(1);
    }

    process.stdout.write(db.uuid);
  } catch {
    process.exit(1);
  }
});
NODE
)" || {
  echo ""
  echo "ERROR: D1 database 'velora' tidak ditemukan."
  exit 1
}

echo "D1 ID:"
echo "$D1_ID"

cat > worker/.wrangler.deploy.toml <<EOF
name = "backendbuildapk"
main = "index.js"
compatibility_date = "2026-09-30"

[[d1_databases]]
binding = "DB"
database_name = "velora"
database_id = "$D1_ID"
EOF

echo "[2/4] Deploy Worker..."

cd worker

npx wrangler deploy --config .wrangler.deploy.toml

echo ""
echo "======================================"
echo " DEPLOY BERHASIL"
echo "======================================"
