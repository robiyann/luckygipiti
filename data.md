curl -s -X GET "https://mails.luckyous.com/api/v1/openapi/order/ORD2026042078914ad2/code" \
  -H "X-API-Key: ak_8d96ef30a1e01a5d095d25a2683a57fc" | \
  python3 -c "import sys, json; print(json.loads(sys.stdin.read())['data']['verification_code'])"

  itu contoh untuk cek code verifikasi

  lalu untuk untuk purchase mail   
  curl -X POST "https://mails.luckyous.com/api/v1/openapi/order/create" \
  -H "X-API-Key: ak_8d96ef30a1e01a5d095d25a2683a57fc" \
  -H "Content-Type: application/json" \
  -d '{
  "project_code": "openai",
  "email_type": "ms_imap",
  "domain": "outlook.de",
  "specified_email": "",
  "variant_mode": ""
}'