#!/bin/sh
# Auto-update of the local NetShift subscription.
#
# The XPNet feed carries fields that current sing-box rejects (`fp`, `fm`,
# `security`, `authority`, ...) and XHTTP nodes without x_padding_bytes.
# Without sanitising, sing-box cannot decode the config and NetShift drops
# most nodes. This script downloads a fresh feed, normalises every outbound,
# validates the result with `sing-box check` and only then atomically
# replaces /www/mysub.json.
#
# Run: cron every 30 minutes, BEFORE netshift subscription_update.

SRC_URL="https://xpnet-reserve.space/sub/aYpMegsL6CsH1GJf"
TMP_RAW="/tmp/ymsub-raw.json"
TMP_OUT="/tmp/ymsub-fixed.json"
TARGET="/www/mysub.json"
LOG="/tmp/ymsub.log"

log() { echo "$(date '+%F %T') $*" >> "$LOG"; }

# 1. Download the feed in sing-box format
if ! uclient-fetch -q -T 40 -O "$TMP_RAW" --user-agent="sing-box/1.14.3" "$SRC_URL" 2>/dev/null; then
    log "download failed, keeping old subscription"
    exit 0
fi

if [ ! -s "$TMP_RAW" ]; then
    log "empty response, keeping old subscription"
    exit 0
fi

if ! jq -e '.outbounds | length > 0' "$TMP_RAW" >/dev/null 2>&1; then
    log "not a valid sing-box JSON, keeping old"
    rm -f "$TMP_RAW"
    exit 0
fi

COUNT=$(jq '.outbounds | length' "$TMP_RAW" 2>/dev/null)

# 2. Normalise every outbound
jq '
  def cleantr: del(.authority, .max_early_data, .early_data_header_name);

  .outbounds |= map(
    if (.type == "selector" or .type == "urltest" or .type == "direct" or .type == "block")
    then .
    else
      del(.fp, .fm, .security, .obfs_password, .default, .interrupt_exist_connections,
          .interval, .tolerance, .url)
      | (if .transport then (.transport |= cleantr) else . end)
      | (if .transport and .transport.type == "xhttp" and (.transport.x_padding_bytes | not)
         then .transport.x_padding_bytes = "100-1000" else . end)
    end
  )
  | {log: {level: "info"}, dns: (.dns // {}), route: (.route // {}), outbounds: .outbounds}
' "$TMP_RAW" > "$TMP_OUT" 2>/dev/null

if [ ! -s "$TMP_OUT" ] || ! jq -e '.outbounds | length > 0' "$TMP_OUT" >/dev/null 2>&1; then
    log "jq transform failed, keeping old"
    rm -f "$TMP_RAW" "$TMP_OUT"
    exit 0
fi

# 3. sing-box must accept the result
if ! /usr/bin/sing-box check -c "$TMP_OUT" >/dev/null 2>&1; then
    ERR=$(/usr/bin/sing-box check -c "$TMP_OUT" 2>&1 | head -1 | tr -d '\033')
    log "sing-box check failed: $ERR"
    rm -f "$TMP_RAW" "$TMP_OUT"
    exit 0
fi

# 4. Atomic replace
cp "$TMP_OUT" "$TARGET.new"
mv "$TARGET.new" "$TARGET"
chmod 644 "$TARGET"

XHTTP=$(jq '[.outbounds[] | select(.transport.type=="xhttp")] | length' "$TARGET" 2>/dev/null)

log "OK: $COUNT outbounds ($XHTTP xhttp), size $(wc -c < "$TARGET")"

rm -f "$TMP_RAW" "$TMP_OUT"
exit 0
