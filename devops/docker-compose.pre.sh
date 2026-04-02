#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
set -a
source "${SCRIPT_DIR}/.env"
set +a

echo "========================================"
echo "  PulsarTeam — Pre-deployment"
echo "========================================"

# 0. Auto-detect RUN_AS_USER UID/GID from the host
if [ -n "$RUN_AS_USER" ]; then
  detected_uid=$(id -u "$RUN_AS_USER" 2>/dev/null || echo "")
  detected_gid=$(id -g "$RUN_AS_USER" 2>/dev/null || echo "")
  if [ -n "$detected_uid" ] && [ -n "$detected_gid" ]; then
    export RUN_AS_UID="$detected_uid"
    export RUN_AS_GID="$detected_gid"
    # Persist into .env so docker stack deploy picks them up
    sed -i "s/^RUN_AS_UID=.*/RUN_AS_UID=${detected_uid}/" "${SCRIPT_DIR}/.env"
    sed -i "s/^RUN_AS_GID=.*/RUN_AS_GID=${detected_gid}/" "${SCRIPT_DIR}/.env"
    echo "👤 RUN_AS_USER=${RUN_AS_USER} → UID=${detected_uid} GID=${detected_gid}"
  else
    echo "⚠️  User '${RUN_AS_USER}' not found on host — keeping existing UID/GID from .env"
  fi
fi

# 1. Ensure api source exists on host
echo ""
SERVER_DIR="${HOST_CODE_PATH}/PulsarTeam/api"
if [ -d "${SERVER_DIR}/src" ]; then
  echo "✅ API source found at ${SERVER_DIR}/src"
else
  echo "⚠️  API source not found at ${SERVER_DIR}/src"
  echo "   Make sure the repo is cloned at ${HOST_CODE_PATH}/PulsarTeam"
fi

echo ""
echo "✅ Pre-deployment complete"
echo "========================================"
