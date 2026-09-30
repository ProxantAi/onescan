#!/usr/bin/env bash
set -euo pipefail
ONESCAN_VENDOR_DIR="${1:-vendor/open-rppg}"
ONESCAN_UPSTREAM_COMMIT=4d24237e7b14e17429b49d0334f2282b7d2fd159
if [[ -e "$ONESCAN_VENDOR_DIR" ]]; then
  echo "Destination already exists: $ONESCAN_VENDOR_DIR" >&2
  exit 1
fi
mkdir -p "$ONESCAN_VENDOR_DIR"
git -C "$ONESCAN_VENDOR_DIR" init
git -C "$ONESCAN_VENDOR_DIR" remote add origin https://github.com/KegangWangCCNU/open-rppg.git
git -C "$ONESCAN_VENDOR_DIR" fetch --depth 1 origin "$ONESCAN_UPSTREAM_COMMIT"
git -C "$ONESCAN_VENDOR_DIR" checkout --detach FETCH_HEAD
echo "Set OPEN_RPPG_PATH=$(cd "$ONESCAN_VENDOR_DIR" && pwd)"
