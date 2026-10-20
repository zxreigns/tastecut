#!/bin/bash
# Deploys site/ + worker/_worker.js to a Cloudflare Pages project (direct upload API, no wrangler).
# env: CF_API_TOKEN (Pages:Edit + Workers AI), CF_ACCOUNT (account id), optional ENV_JSON (path to {NAME: value}, e.g. QLOO_API_KEY)
set -e
cd "$(dirname "$0")/.."
: "${PROJECT:=tastecut}"
: "${ENV_JSON:=scripts/env.json}"
[ -f "$ENV_JSON" ] && export ENV_JSON || unset ENV_JSON
python3 scripts/deploy.py "$PROJECT" site worker/_worker.js
