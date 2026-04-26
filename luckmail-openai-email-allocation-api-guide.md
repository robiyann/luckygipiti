# LuckMail OpenAI Email Allocation API Guide

This document describes how to allocate imported private LuckMail emails for OpenAI registration while preventing the same email from being reused.

- LuckMail API documentation: <https://mail.luckyous.com/user/api-doc>
- Target project: `openai`
- Recommended email type: `ms_graph`
- Supported private domains in this workflow:
  - `outlook.jp`
  - `outlook.de`

---

## 1. Core Rule

For imported private emails, do **not** rely on LuckMail's domain-random allocation if each email must only be used once.

Avoid this pattern for one-time-use registration:

```json
{
  "project_code": "openai",
  "email_type": "ms_graph",
  "domain": "outlook.jp"
}
```

The reason is that LuckMail may randomly assign the same email again later.

Instead, your allocation layer should select an unused email first, then create the order with `specified_email`:

```json
{
  "project_code": "openai",
  "email_type": "ms_graph",
  "specified_email": "exact_unused_email@outlook.jp"
}
```

Recommended allocation flow:

```text
fetch private emails
→ exclude reserved / used emails
→ choose one email
→ create OpenAI order with specified_email
→ save order_no locally
→ poll verification code by order_no
→ mark email as used
```

---

## 2. Environment Variable

Store the API key in an environment variable:

```bash
export LUCKMAIL_API_KEY="your_api_key_here"
```

All OpenAPI requests should include this header:

```http
X-API-Key: $LUCKMAIL_API_KEY
```

---

## 3. Check API Key / Account Status

```bash
curl -X GET "https://mail.luckyous.com/api/v1/openapi/user/info" \
  -H "X-API-Key: $LUCKMAIL_API_KEY"
```

Expected success response:

```json
{
  "code": 0,
  "message": "success"
}
```

---

## 4. Check the OpenAI Project

```bash
curl -G "https://mail.luckyous.com/api/v1/openapi/projects" \
  -H "X-API-Key: $LUCKMAIL_API_KEY" \
  --data-urlencode "page=1" \
  --data-urlencode "page_size=500"
```

Find the project whose code is:

```json
{
  "code": "openai",
  "name": "OpenAi",
  "email_types": ["ms_graph", "ms_imap", "self_built", "google_variant"]
}
```

Use these values for OpenAI registration:

```json
{
  "project_code": "openai",
  "email_type": "ms_graph"
}
```

---

## 5. Fetch the Private Email Pool

### 5.1 Fetch `outlook.jp` Emails

```bash
curl -G "https://mail.luckyous.com/api/v1/openapi/emails" \
  -H "X-API-Key: $LUCKMAIL_API_KEY" \
  --data-urlencode "page=1" \
  --data-urlencode "page_size=100" \
  --data-urlencode "keyword=outlook.jp" \
  --data-urlencode "status=1"
```

### 5.2 Fetch `outlook.de` Emails

```bash
curl -G "https://mail.luckyous.com/api/v1/openapi/emails" \
  -H "X-API-Key: $LUCKMAIL_API_KEY" \
  --data-urlencode "page=1" \
  --data-urlencode "page_size=100" \
  --data-urlencode "keyword=outlook.de" \
  --data-urlencode "status=1"
```

Important response fields:

```json
{
  "id": 123,
  "address": "user@outlook.jp",
  "type": "ms_graph",
  "domain": "outlook.jp",
  "status": 1,
  "total_used": 0,
  "success_count": 0,
  "fail_count": 0
}
```

Recommended filters:

```text
status == 1
type == "ms_graph"
address ends with @outlook.jp or @outlook.de
address is not in the local reserved / used list
optional strict mode: total_used == 0
```

---

## 6. Local Reserved / Used State

LuckMail does not provide an OpenAPI endpoint to automatically mark imported private emails as used.

Therefore, the allocation layer must maintain its own local state file.

Recommended file name:

```text
openai_email_state.jsonl
```

Example records:

```jsonl
{"email":"a@outlook.jp","order_no":"ORDxxx","status":"reserved","created_at":"2026-04-26T06:00:00+08:00"}
{"email":"b@outlook.de","order_no":"ORDyyy","status":"used","code":"123456","created_at":"2026-04-26T06:01:00+08:00"}
{"email":"c@outlook.jp","order_no":"ORDzzz","status":"failed","reason":"timeout"}
```

Recommended status definitions:

| Status | Meaning | Should be excluded from future allocation? |
| --- | --- | --- |
| `reserved` | Allocated and registration is in progress | Yes |
| `used` | Registration or code receiving succeeded | Yes |
| `failed` | Registration or code receiving failed | Depends on policy |
| `released` | Manually released back to the usable pool | No |

For strict one-email-one-use behavior, exclude:

```text
reserved
used
failed
```

For retryable failure behavior, exclude only:

```text
reserved
used
```

---

## 7. Allocation Modes

### 7.1 Randomly Choose `outlook.jp` or `outlook.de`

Logic:

```text
fetch outlook.jp pool
fetch outlook.de pool
merge both lists
exclude reserved / used emails
randomly choose one remaining email
create order with specified_email
```

Order body:

```json
{
  "project_code": "openai",
  "email_type": "ms_graph",
  "specified_email": "selected_email@outlook.jp"
}
```

### 7.2 Specify a Domain Suffix

For `outlook.jp` only:

```text
fetch outlook.jp pool
exclude reserved / used emails
randomly choose one remaining email
```

For `outlook.de` only:

```text
fetch outlook.de pool
exclude reserved / used emails
randomly choose one remaining email
```

Then create the order with the selected email:

```json
{
  "project_code": "openai",
  "email_type": "ms_graph",
  "specified_email": "selected_email@outlook.de"
}
```

### 7.3 Specify an Exact Email

First verify that the email exists and is normal:

```bash
curl -G "https://mail.luckyous.com/api/v1/openapi/emails" \
  -H "X-API-Key: $LUCKMAIL_API_KEY" \
  --data-urlencode "page=1" \
  --data-urlencode "page_size=10" \
  --data-urlencode "keyword=exact_email@outlook.jp" \
  --data-urlencode "status=1"
```

Then check the local state file. If the email is not marked as `reserved`, `used`, or otherwise blocked, create the order with that exact email.

---

## 8. Create an OpenAI Verification Order

```bash
curl -X POST "https://mail.luckyous.com/api/v1/openapi/order/create" \
  -H "X-API-Key: $LUCKMAIL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "project_code": "openai",
    "email_type": "ms_graph",
    "specified_email": "exact_unused_email@outlook.jp"
  }'
```

Successful response:

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "order_no": "ORD20260426xxxx",
    "email_address": "exact_unused_email@outlook.jp",
    "project": "OpenAi",
    "price": "0.0009",
    "timeout_seconds": 300,
    "expired_at": "2026-04-26 06:00:00"
  }
}
```

Immediately save a local reservation record:

```json
{
  "email": "exact_unused_email@outlook.jp",
  "order_no": "ORD20260426xxxx",
  "status": "reserved"
}
```

This prevents the same email from being allocated again while registration is still in progress.

---

## 9. Poll the Verification Code

Replace `ORDER_NO` with the `order_no` returned by the create-order API.

```bash
curl -X GET "https://mail.luckyous.com/api/v1/openapi/order/ORDER_NO/code" \
  -H "X-API-Key: $LUCKMAIL_API_KEY"
```

Pending response:

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "status": "pending",
    "verification_code": null
  }
}
```

Success response:

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "status": "success",
    "verification_code": "969301",
    "mail_from": "noreply@tm.openai.com",
    "mail_subject": "Your temporary ChatGPT code"
  }
}
```

Recommended polling interval:

```text
3 to 5 seconds
```

Stop polling when the status becomes one of:

```text
success
timeout
cancelled
```

After successful registration, update the local state to `used`:

```json
{
  "email": "exact_unused_email@outlook.jp",
  "order_no": "ORD20260426xxxx",
  "status": "used",
  "code": "969301"
}
```

---

## 10. Query Order History

If the local record is lost, query order history:

```bash
curl -G "https://mail.luckyous.com/api/v1/openapi/orders" \
  -H "X-API-Key: $LUCKMAIL_API_KEY" \
  --data-urlencode "page=1" \
  --data-urlencode "page_size=20" \
  --data-urlencode "status=2" \
  --data-urlencode "project_id=2"
```

Order status values:

| Status | Meaning |
| --- | --- |
| `1` | Pending |
| `2` | Completed |
| `3` | Timeout |
| `4` | Cancelled |
| `5` | Refunded |

Example order record:

```json
{
  "order_no": "ORD20260426xxxx",
  "email_address": "user@outlook.jp",
  "verification_code": "123456",
  "status": 2
}
```

---

## 11. Important Limitation: No LuckMail Token for Imported Emails

Imported private emails are listed under:

```http
GET /api/v1/openapi/emails
```

They do **not** receive a LuckMail `token` for token-based mail lookup.

Therefore, this token API is not applicable to imported private emails:

```http
GET /api/v1/openapi/email/token/{token}/code
```

The token API is for purchased emails under:

```http
GET /api/v1/openapi/email/purchases
```

For imported private emails, always query the verification result by `order_no`:

```http
GET /api/v1/openapi/order/{order_no}/code
```

---

## 12. Recommended End-to-End Workflow

```text
1. Fetch outlook.jp / outlook.de private email pools.
2. Keep only status=1 and type=ms_graph emails.
3. Exclude locally reserved / used emails.
4. Select one email by one of these modes:
   - random jp/de
   - specified jp
   - specified de
   - specified exact email
5. Create an OpenAI order with specified_email.
6. Save the local state as reserved.
7. Use the selected email for OpenAI registration.
8. Poll the verification code by order_no.
9. After success, update the local state to used.
10. Never allocate the same used email again.
```

---

## 13. Minimal State-Based Allocation Pseudocode

```python
used_statuses = {"reserved", "used"}

private_emails = fetch_luckmail_emails(domains=["outlook.jp", "outlook.de"])
local_state = load_jsonl("openai_email_state.jsonl")
blocked_emails = {
    item["email"]
    for item in local_state
    if item["status"] in used_statuses
}

candidates = [
    email for email in private_emails
    if email["status"] == 1
    and email["type"] == "ms_graph"
    and email["address"] not in blocked_emails
]

selected = random_choice(candidates)

order = create_order(
    project_code="openai",
    email_type="ms_graph",
    specified_email=selected["address"],
)

append_jsonl("openai_email_state.jsonl", {
    "email": selected["address"],
    "order_no": order["order_no"],
    "status": "reserved",
})
```
