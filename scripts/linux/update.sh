#!/usr/bin/env bash
# Updates the game to the newest commit of its branch, re-applies the Linux setup and restarts the service.
# Run it as the user who owns /opt/faultward. Your .env and the data in /var/lib/faultward are not touched.
set -euo pipefail
cd "$(dirname "$0")/../.."
branch=$(git rev-parse --abbrev-ref HEAD)
echo "Updating FAULTWARD ($branch) from $(git rev-parse --short HEAD)"
git fetch --depth 1 origin "$branch"
git reset --hard "origin/$branch"          # also restores the Windows binary setup.sh replaces
./scripts/linux/setup.sh
sudo systemctl restart faultward
echo "Now at $(git rev-parse --short HEAD): $(git log -1 --format=%s)"
