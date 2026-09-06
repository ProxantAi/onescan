#!/usr/bin/env bash
# Deploy static OneScan SPA to onescan.proxant.ai (release + symlink)
set -euo pipefail

AWS_PROFILE="${PROXANT_AWS_PROFILE:-activamente}"
export AWS_PROFILE
AWS_REGION="${AWS_REGION:-mx-central-1}"
export AWS_REGION
INSTANCE_ID="${INSTANCE_ID:-i-0c2cfeedc16207945}"
S3_BUCKET="${S3_BUCKET:-activamente-cloudtrail-logs-192145725135}"
S3_PREFIX="deploy/proxant-onescan/$(date +%Y%m%d-%H%M%S)"
RELEASE_ID="$(date +%Y%m%d-%H%M%S)"

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

log() { echo "[proxant-onescan] $*"; }

log "Packaging static site..."
STAGE="/tmp/onescan-dist-$$"
rm -rf "$STAGE"
mkdir -p "$STAGE/dist"
rsync -a \
  --exclude='.git' --exclude='.github' --exclude='node_modules' \
  --exclude='dist' --exclude='releases' --exclude='current' \
  --exclude='.deploy' --exclude='package.json' --exclude='package-lock.json' \
  --exclude='serve.json' --exclude='README.md' \
  "$ROOT_DIR/" "$STAGE/dist/"

TARBALL="/tmp/onescan-src.tar.gz"
tar -czf "$TARBALL" -C "$STAGE" dist
rm -rf "$STAGE"

S3_URI="s3://$S3_BUCKET/$S3_PREFIX"
log "Uploading to $S3_URI"
aws s3 cp "$TARBALL" "$S3_URI/dist.tar.gz" --region us-east-1
rm -f "$TARBALL"

DIST_URL=$(aws s3 presign "$S3_URI/dist.tar.gz" --expires-in 7200 --region us-east-1)

REMOTE=$(cat <<EOF
set -euo pipefail
RELEASE_DIR="/var/www/onescan/releases/$RELEASE_ID"
mkdir -p "\$RELEASE_DIR"
curl -fsSL '$DIST_URL' -o /tmp/onescan-dist.tar.gz
tar -xzf /tmp/onescan-dist.tar.gz -C "\$RELEASE_DIR"
rm -f /tmp/onescan-dist.tar.gz
# Keep licensed SDK if present at site root
if [ -d /var/www/onescan/shenai-sdk ]; then
  rsync -a /var/www/onescan/shenai-sdk/ "\$RELEASE_DIR/dist/shenai-sdk/"
fi
ln -sfn "\$RELEASE_DIR/dist" /var/www/onescan/current
# Keep a few releases
ls -1dt /var/www/onescan/releases/* | tail -n +6 | xargs -r rm -rf
curl -sfI https://onescan.proxant.ai/ | head -8
ls -la /var/www/onescan/current/assets/js/auth.js
EOF
)

# JSON-escape remote script for SSM
PAYLOAD=$(python3 -c 'import json,sys; print(json.dumps({"commands":[sys.stdin.read()]}))' <<<"$REMOTE")

log "Running remote deploy via SSM..."
CMD_ID=$(aws ssm send-command \
  --region "$AWS_REGION" \
  --instance-ids "$INSTANCE_ID" \
  --document-name "AWS-RunShellScript" \
  --parameters "$PAYLOAD" \
  --timeout-seconds 600 \
  --query 'Command.CommandId' \
  --output text)

for _ in $(seq 1 40); do
  STATUS=$(aws ssm get-command-invocation \
    --region "$AWS_REGION" \
    --command-id "$CMD_ID" \
    --instance-id "$INSTANCE_ID" \
    --query 'Status' \
    --output text 2>/dev/null || echo Pending)
  case "$STATUS" in
    Success)
      aws ssm get-command-invocation \
        --region "$AWS_REGION" \
        --command-id "$CMD_ID" \
        --instance-id "$INSTANCE_ID" \
        --query 'StandardOutputContent' \
        --output text
      log "Done: https://onescan.proxant.ai/"
      exit 0
      ;;
    Failed|Cancelled|TimedOut)
      aws ssm get-command-invocation \
        --region "$AWS_REGION" \
        --command-id "$CMD_ID" \
        --instance-id "$INSTANCE_ID" \
        --output json
      exit 1
      ;;
  esac
  sleep 5
done
log "Timed out"
exit 1
