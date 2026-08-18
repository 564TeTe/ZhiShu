#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "================================================================"
echo "  知枢 - AI Coding Agent 编排平台"
echo "================================================================"
echo "将检查环境、构建并启动 PostgreSQL / Spring / Node。"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "[FAIL] Node.js 22+ is required."
  exit 1
fi

npm run zhishu:start
echo "[READY] http://127.0.0.1:3001"
