#!/usr/bin/env bash
# Update Tasks Desktop flatpak from the latest GitHub release
set -euo pipefail

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

gh release download --repo msdosfx/tasks-desktop --pattern '*.flatpak' --dir "$TMP"
sudo flatpak install --reinstall -y "$TMP"/*.flatpak

echo "Done. Installed version:"
flatpak info com.arlis.tasksdesktop | grep -i version || true
