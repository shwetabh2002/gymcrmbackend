#!/usr/bin/env bash
# Smoke-test GetTransactionsLog. Load from .env in backendgym:
#   set -a && source ../.env 2>/dev/null; set +a
#   export ESSL_SERIAL_NUMBER ESSL_API_USERNAME ESSL_API_PASSWORD
#   FROM=2026-04-01 TO=2026-04-30 bash scripts/essl-curl-smoke.sh
set -euo pipefail

: "${ESSL_WEB_API_URL:=http://127.0.0.1:85/iclock/WebAPIService.asmx}"
: "${BOTH_MODE:=0}"

URL="$ESSL_WEB_API_URL"
[[ "$URL" == *"?"* ]] || URL="${URL}?op=GetTransactionsLog"

: "${ESSL_API_USERNAME:=essl}"
: "${ESSL_API_PASSWORD:=essl}"
: "${ESSL_SERIAL_NUMBER:?Set ESSL_SERIAL_NUMBER}"
: "${FROM:=2026-04-01}"
: "${TO:=2026-04-30}"
: "${STR_DATA_LIST:=4}"

if [[ "$BOTH_MODE" == "1" ]]; then
  BODY=$(cat <<X
<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetTransactionsLog xmlns="http://tempuri.org/">
      <FromDate>${FROM} 00:00:00</FromDate>
      <ToDate>${TO} 23:59:59</ToDate>
      <FromDateTime>${FROM} 00:00</FromDateTime>
      <ToDateTime>${TO} 23:59</ToDateTime>
      <SerialNumber>${ESSL_SERIAL_NUMBER}</SerialNumber>
      <UserName>${ESSL_API_USERNAME}</UserName>
      <UserPassword>${ESSL_API_PASSWORD}</UserPassword>
      <strDataList>${STR_DATA_LIST}</strDataList>
    </GetTransactionsLog>
  </soap:Body>
</soap:Envelope>
X
)
else
  BODY=$(cat <<X
<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetTransactionsLog xmlns="http://tempuri.org/">
      <FromDate>${FROM} 00:00:00</FromDate>
      <ToDate>${TO} 23:59:59</ToDate>
      <SerialNumber>${ESSL_SERIAL_NUMBER}</SerialNumber>
      <UserName>${ESSL_API_USERNAME}</UserName>
      <UserPassword>${ESSL_API_PASSWORD}</UserPassword>
      <strDataList>${STR_DATA_LIST}</strDataList>
    </GetTransactionsLog>
  </soap:Body>
</soap:Envelope>
X
)
fi

echo "# POST $URL (BOTH_MODE=$BOTH_MODE)" >&2
curl -sS -D- --max-time 60 -X POST "$URL" \
  -H "Content-Type: text/xml; charset=utf-8" \
  -H "SOAPAction: http://tempuri.org/GetTransactionsLog" \
  --data-binary "$BODY" | tr -d '\r'
