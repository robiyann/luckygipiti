# LuckMail Email System API Reference

> LuckMail is an email verification code receiving and email purchasing platform. It provides two core business modes: Mode A (email code receiving, pay-per-success) and Mode B (email purchasing, one-time purchase with Token-based querying).

---

## General

- **Base URL:** `https://mails.luckyous.com`
- **Protocol:** HTTPS
- **Data Format:** JSON (UTF-8)
- **Authentication:** JWT Bearer Token (User/Supplier Web UI) or API Key + HMAC-SHA256 (OpenAPI)
- **Pagination:** `?page=1&page_size=20&sort=created_at&order=desc`

### Unified Response Format
```json
{
  "code": 0,
  "message": "success",
  "data": {},
  "timestamp": 1710000000
}
```

### Paginated Response
```json
{
  "code": 0,
  "data": {
    "list": [],
    "total": 100,
    "page": 1,
    "page_size": 20
  }
}
```

### Error Codes
| Code | Keterangan |
|------|------------|
| `0` | Success |
| `1001` | Parameter validation failed |
| `1002` | Not logged in / Token expired |
| `1003` | Permission denied |
| `2001` | Insufficient balance |
| `2002` | Project not found / offline |
| `2003` | No available email |
| `2004` | Order not found |
| `2005` | Order expired |
| `3001` | Payment creation failed |
| `3002` | Insufficient withdrawal amount |
| `5000` | Internal server error |

### Email Types
- `ms_graph` — Microsoft Graph API (outlook.com / hotmail.com)
- `ms_imap` — Microsoft IMAP (outlook.com / hotmail.com)
- `google_variant` — Google variant emails (gmail.com / googlemail.com, auto-generated dot variants)
- `self_built` — Self-built email domains

### Microsoft Email Short/Long-term Classification
- `is_short_term=0` — Long-term email (default). Used as fallback when short-term stock is depleted. Only long-term emails allocated for purchases.
- `is_short_term=1` — Short-term email. Prioritized for code receiving orders. Never allocated for email purchases.

---

# User OpenAPI (Third-party Integration)

**Base path:** `/api/v1/openapi`
**Authentication:** API Key + HMAC-SHA256 signature

```
Headers:
  X-API-Key: {api_key}
  X-Timestamp: {unix_timestamp}
  X-Signature: HMAC-SHA256(api_secret, method + path + timestamp + body)
```

> Rate limit: **6000 req/min (100 QPS)** per API Key untuk endpoint high-frequency.

## Account
- `GET /api/v1/openapi/user/info` — Get user info
- `GET /api/v1/openapi/balance` — Query balance

## Reference Data
- `GET /api/v1/openapi/email-types` — Get supported email types
- `GET /api/v1/openapi/projects` — List available projects

## Mode A: Code Receiving (Pay-per-success)
- `POST /api/v1/openapi/order/create` — Create code receiving order `[rate-limited]`
  ```json
  {
    "project_code": "twitter",
    "email_type": "ms_graph",
    "domain": "outlook.com",
    "specified_email": "user@outlook.com"
  }
  ```
  Response:
  ```json
  {
    "order_no": "ORD2026042078914ad2",
    "email_address": "user@outlook.com",
    "project": "twitter",
    "price": 0.05,
    "timeout_seconds": 300,
    "expired_at": 1710005000
  }
  ```
  > Tidak dicharge saat create. Charge hanya saat kode berhasil diterima.

- `GET /api/v1/openapi/order/:order_no/code` — Poll verification code `[rate-limited]`
  ```
  Polling tiap 3 detik.
  ```
  Response:
  ```json
  {
    "order_no": "ORD2026042078914ad2",
    "status": "success",
    "verification_code": "123456",
    "mail_from": "security@openai.com",
    "mail_subject": "Your ChatGPT code is 123456"
  }
  ```
  Status values:
  - `pending` — Menunggu kode
  - `success` — Kode diterima (dicharge)
  - `timeout` — Expired (tidak dicharge)
  - `cancelled` — Dibatalkan (tidak dicharge)

- `POST /api/v1/openapi/order/:order_no/cancel` — Cancel order (tidak dicharge)
- `GET /api/v1/openapi/orders` — List historical orders

## Mode B: Email Purchase (One-time purchase)
- `POST /api/v1/openapi/email/purchase` — Purchase emails (batch) `[rate-limited]`
  ```json
  {
    "project_code": "twitter",
    "email_type": "ms_graph",
    "domain": "outlook.com",
    "quantity": 5
  }
  ```
  Response:
  ```json
  {
    "purchases": [
      {"email_address": "user@outlook.com", "token": "tok_xxx", "project": "twitter", "price": 0.10}
    ],
    "total_cost": 0.50,
    "balance_after": 9.50
  }
  ```
  > Dicharge langsung: `buy_price × quantity`

- `GET /api/v1/openapi/email/purchases` — List purchased emails

## Purchased Email Operations
- `PUT /api/v1/openapi/email/purchases/:id/disabled` — Enable/disable purchased email
- `POST /api/v1/openapi/email/purchases/batch-disabled` — Batch enable/disable `[rate-limited]`
- `PUT /api/v1/openapi/email/purchases/:id/tag` — Set tag `[rate-limited]`
- `POST /api/v1/openapi/email/purchases/batch-tag` — Batch set tags `[rate-limited]`
- `POST /api/v1/openapi/email/purchases/api-get` — Get purchases by tag `[rate-limited]`

## Email Tag Management
- `POST /api/v1/openapi/email/tags` — Create tag
- `GET /api/v1/openapi/email/tags` — List tags
- `PUT /api/v1/openapi/email/tags/:id` — Update tag
- `DELETE /api/v1/openapi/email/tags/:id` — Delete tag

## Token-based Email Operations `[rate-limited]`
- `GET /api/v1/openapi/email/token/:token/code` — Get latest verification code by purchase token
- `GET /api/v1/openapi/email/token/:token/alive` — Check if email is alive (can fetch mail list)
- `GET /api/v1/openapi/email/token/:token/mails` — Get mail list by purchase token
- `GET /api/v1/openapi/email/token/:token/mails/:message_id` — Get mail detail by purchase token

## User Private Email Management
- `GET /api/v1/openapi/emails` — List user's private emails
- `POST /api/v1/openapi/emails/import` — Import private emails
- `GET /api/v1/openapi/emails/export` — Export private emails

## Appeals
- `POST /api/v1/openapi/appeal/create` — Submit appeal

---

# User API (Web UI, JWT Auth)

**Base path:** `/api/v1`
**Authentication:** `Authorization: Bearer <token>`

## Public Endpoints (No Auth)

### System Settings
- `GET /api/v1/system/settings` — Get public system configuration

### User Registration & Login
- `POST /api/v1/user/register` — Register new user
  ```json
  {"username": "str", "email": "str", "password": "str", "invite_code": "str (optional)"}
  ```
  - Username: 4-32 chars, alphanumeric + underscore
  - Password: 8-32 chars, must contain uppercase + lowercase + digits
- `POST /api/v1/user/login` — User login
  ```json
  {"username": "str", "password": "str"}
  ```
  Response: `{"token": "jwt...", "expires_at": unix_ts, "user": {"id", "username", "email", "balance"}}`
- `POST /api/v1/user/send-register-code` — Send registration email verification code
- `POST /api/v1/user/send-reset-code` — Send password reset email verification code
- `POST /api/v1/user/reset-password` — Reset password with verification code
- `POST /api/v1/feedback` — Submit feedback (public)

### Invite Code
- `GET /api/v1/invite/:code` — Validate an invite code

### LinuxDo OAuth
- `GET /api/v1/oauth/linuxdo/authorize` — Get LinuxDo OAuth authorize URL
- `POST /api/v1/oauth/linuxdo/callback` — LinuxDo OAuth callback

### Token-based Email Query (No Auth, No API Key)
> Untuk purchased emails (Mode B). Rate limited: 10 requests/min/token.

- `GET /api/v1/email/query/:token` — Query email inbox by purchase token (real-time fetch)
  ```json
  {"email_address": "", "project": "", "warranty_until": "", "mails": [{"message_id", "from", "subject", "verification_code", "received_at", "matched": true}]}
  ```
  > `matched=true` = email cocok dengan keyword rules project; `verification_code` diekstrak jika matched.

- `GET /api/v1/email/query/:token/detail/:message_id` — Get single email detail
  ```json
  {"message_id", "from", "to", "subject", "body", "html_body", "received_at", "verification_code", "matched"}
  ```

## Authenticated User Endpoints (JWT Required)

### Auth & Profile
- `POST /api/v1/user/logout` — Logout
- `GET /api/v1/user/profile` — Get user profile
- `PUT /api/v1/user/profile` — Update user profile
- `PUT /api/v1/user/password` — Change password

### API Key Management
- `GET /api/v1/user/api-key` — Get current API key
- `POST /api/v1/user/api-key/regenerate` — Regenerate API key

### Projects
- `GET /api/v1/projects` — List available projects (with pricing per email type)
- `GET /api/v1/projects/:code` — Get project details by project code
- `GET /api/v1/projects/:code/domain-stocks` — Get available email domain stock for a project
- `POST /api/v1/project/apply` — Apply for a new project
- `GET /api/v1/project/applies` — List my project applications

### Mode A: Code Receiving Orders
- `POST /api/v1/order/create` — Create code receiving order
- `GET /api/v1/order/:order_no/code` — Poll for verification code (poll every 3s)
- `POST /api/v1/order/:order_no/cancel` — Cancel order (not charged)
- `GET /api/v1/orders` — List my orders (filterable by status/project/email_type/date)
- `GET /api/v1/order/:order_no` — Get order detail

### Mode B: Email Purchase
- `POST /api/v1/email/purchase` — Purchase emails (batch)
- `GET /api/v1/email/purchases` — List my purchased emails
- `GET /api/v1/email/purchases/projects` — Get projects I have purchased emails for
- `GET /api/v1/email/purchases/export` — Export purchased emails

### Purchased Email Management
- `DELETE /api/v1/email/purchases/:id` — Delete a purchase record
- `POST /api/v1/email/purchases/batch-delete` — Batch delete purchase records
- `PUT /api/v1/email/purchases/:id/disabled` — Enable/disable a purchased email
- `POST /api/v1/email/purchases/batch-disabled` — Batch enable/disable purchased emails
- `PUT /api/v1/email/purchases/:id/tag` — Set tag on a purchased email
- `POST /api/v1/email/purchases/batch-tag` — Batch set tags on purchased emails
- `POST /api/v1/email/purchases/api-get` — Get purchases by tag (for API automation)

### Email Tag Management
- `POST /api/v1/email/tags` — Create email tag
- `GET /api/v1/email/tags` — List email tags
- `PUT /api/v1/email/tags/:id` — Update email tag
- `DELETE /api/v1/email/tags/:id` — Delete email tag

### Appeals
- `POST /api/v1/appeal/create` — Create appeal
  ```json
  {
    "appeal_type": 1,
    "order_id": 456,
    "reason": "already_used",
    "description": "str",
    "evidence_urls": ["url1"]
  }
  ```
  - `appeal_type`: 1=code order appeal, 2=email purchase appeal
  - `reason`: `email_unavailable` / `no_receive` / `wrong_code` / `already_used` / `other`
- `GET /api/v1/appeals` — List my appeals
- `GET /api/v1/appeal/:appeal_no` — Get appeal detail
- `POST /api/v1/appeal/:appeal_no/cancel` — Cancel appeal
- `POST /api/v1/appeal/:appeal_no/escalate` — Escalate to admin arbitration

### Recharge (Top-up Balance)
- `POST /api/v1/recharge/create` — Create recharge order
- `POST /api/v1/recharge/redeem` — Redeem recharge card
- `GET /api/v1/recharge/records` — List recharge records
- `GET /api/v1/recharge/:order_no/pay-info` — Get payment info for a recharge order
- `POST /api/v1/recharge/:order_no/cancel` — Cancel recharge order
- `DELETE /api/v1/recharge/:order_no` — Delete recharge order

### User Private Emails (My Emails)
- `GET /api/v1/user/emails` — List user's private emails
- `GET /api/v1/user/emails/export` — Export user's private emails
- `POST /api/v1/user/emails/import` — Import user's private emails
- `DELETE /api/v1/user/emails/:id` — Delete a private email
- `POST /api/v1/user/emails/batch-delete` — Batch delete private emails
- `GET /api/v1/user/emails/:id/variants` — List Google dot-variants of an email
- `GET /api/v1/user/emails/:id/mails` — List received mails for a private email
- `GET /api/v1/user/emails/:id/mails/:message_id` — Get mail detail for a private email
- `GET /api/v1/user/api-email/status` — Get API email feature toggle status
- `PUT /api/v1/user/api-email/toggle` — Toggle API email feature on/off
- `GET /api/v1/user/emails/:id/projects` — Get projects an email has successfully received codes for

### User Self-built Email Domains
- `GET /api/v1/user/self-built/config` — Get self-built email configuration
- `POST /api/v1/user/self-built/domains/import` — Import self-built domains
- `GET /api/v1/user/self-built/domains` — List self-built domains
- `DELETE /api/v1/user/self-built/domains/:id` — Delete a self-built domain
- `POST /api/v1/user/self-built/domains/:id/addresses` — Create email addresses under a domain
- `GET /api/v1/user/self-built/domains/:id/addresses` — List addresses under a domain
- `PUT /api/v1/user/self-built/addresses/:id/status` — Toggle self-built address status

### Transactions & Dashboard
- `GET /api/v1/transactions` — List balance transaction history (recharge/code/purchase/refund/adjustment)
- `GET /api/v1/user/dashboard/summary` — User dashboard summary
- `GET /api/v1/user/dashboard/trend` — User dashboard trend data

### Sign-in (Daily Rewards)
- `GET /api/v1/user/sign-in/calendar` — Get sign-in calendar
- `POST /api/v1/user/sign-in` — Claim daily sign-in reward

### Announcements
- `GET /api/v1/announcements` — Get system announcements

### Invite System
- `GET /api/v1/user/invite/info` — Get invite info (invite code, stats)
- `GET /api/v1/user/invite/commissions` — List referral commissions

### Resources & Rankings
- `GET /api/v1/resources` — List downloadable resources
- `GET /api/v1/resources/:id/download` — Download a resource
- `GET /api/v1/rankings` — Get leaderboard rankings

---

# Supplier API (Web UI, JWT Auth)

**Base path:** `/api/v1`
**Authentication:** JWT Bearer Token via `Authorization: Bearer <token>`
> Suppliers harus diapprove oleh admin sebelum bisa login.

## Public Endpoints (No Auth)
- `POST /api/v1/supplier/register` — Register as supplier (pending admin approval)
  > Rate limited: 5 per IP per hour, banned 24h on exceed
- `POST /api/v1/supplier/login` — Supplier login
- `POST /api/v1/supplier/send-register-code` — Send registration email verification code
- `POST /api/v1/supplier/send-reset-code` — Send password reset code
- `POST /api/v1/supplier/reset-password` — Reset password

## Authenticated Supplier Endpoints (JWT Required)

### Auth & Profile
- `POST /api/v1/supplier/logout` — Logout
- `GET /api/v1/supplier/profile` — Get supplier profile
- `PUT /api/v1/supplier/profile` — Update profile
- `PUT /api/v1/supplier/password` — Change password

### API Key Management
- `GET /api/v1/supplier/api-key` — Get API key
- `POST /api/v1/supplier/api-key/regenerate` — Regenerate API key

### Email Management
- `GET /api/v1/supplier/emails` — List my emails
  - Query: `?page=1&page_size=20&type=ms_graph&is_short_term=1&status=1&keyword=outlook.com`
  - status: 1=normal, 2=abnormal, 3=cooling, 4=disabled, 5=deleted, 6=pending_check
- `GET /api/v1/supplier/emails/export` — Export emails (streaming txt)
  - Format: `address----password` atau `address----password----client_id----refresh_token`
- `POST /api/v1/supplier/emails/import` — Batch import emails
  ```json
  {
    "type": "microsoft",
    "is_short_term": 1,
    "emails": [{"address": "", "client_id": "", "refresh_token": ""}]
  }
  ```
  - type: `microsoft` / `ms_graph` / `ms_imap` / `google_variant` / `self_built`
  - Gmail imports auto-generate all dot-variants + googlemail.com suffix variants
- `PUT /api/v1/supplier/emails/:id` — Update email info
- `DELETE /api/v1/supplier/emails/:id` — Delete email
- `PUT /api/v1/supplier/emails/:id/status` — Enable/disable email
- `POST /api/v1/supplier/emails/batch-status` — Batch update email status
- `POST /api/v1/supplier/emails/batch-delete` — Batch delete emails
- `GET /api/v1/supplier/emails/:id/variants` — List Google dot-variants

### Self-built Email Domain Management
- `GET /api/v1/supplier/self-built/config` — Get self-built email config
- `POST /api/v1/supplier/self-built/domains/import` — Import self-built domains
- `POST /api/v1/supplier/self-built/domains/:id/verify` — Verify domain ownership
- `GET /api/v1/supplier/self-built/domains/:id/verify-info` — Get domain verification info (DNS records)
- `DELETE /api/v1/supplier/self-built/domains/:id` — Delete domain
- `POST /api/v1/supplier/self-built/domains/:id/addresses` — Create addresses under domain
- `GET /api/v1/supplier/self-built/domains/:id/addresses` — List addresses under domain
- `DELETE /api/v1/supplier/self-built/addresses/:id` — Delete address
- `PUT /api/v1/supplier/self-built/addresses/:id/status` — Toggle address status

### Dashboard & Analytics
- `GET /api/v1/supplier/dashboard/summary` — Dashboard summary
  - Includes: total_emails, active_emails, total_assigned, total_success, success_rate, total_commission, available_balance, today stats, email_category breakdown
- `GET /api/v1/supplier/dashboard/trend` — Trend data (7/30 days)

### Commissions
- `GET /api/v1/supplier/commissions` — List commission records
  - Commission = `supplier_price × commission_rate` (separate rates for code and purchase)

### Appeal Handling
- `GET /api/v1/supplier/appeals` — List appeals received
- `GET /api/v1/supplier/appeal/:appeal_no` — Get appeal detail
- `GET /api/v1/supplier/appeal/:appeal_no/mails` — Get related mail records for an appeal
- `GET /api/v1/supplier/appeal/:appeal_no/mail-detail` — Get appeal mail detail
- `POST /api/v1/supplier/appeal/:appeal_no/reply` — Reply to an appeal
  ```json
  {"result": 1, "reply": "str"}
  ```
  - result: 1=refund, 2=replace email, 3=reject
  - Harus reply dalam 48h atau auto-escalated ke admin
- `POST /api/v1/supplier/appeals/batch-reply` — Batch reply
  ```json
  {"appeal_nos": ["APL001", "APL002"], "result": 3, "reply": "str"}
  ```

### Payment & Withdrawal
- `GET /api/v1/supplier/payment-setting` — Get payment info
- `PUT /api/v1/supplier/payment-setting` — Set payment info (Alipay/Bank/USDT-TRC20)
- `POST /api/v1/supplier/withdrawal/create` — Create withdrawal request
- `POST /api/v1/supplier/transfer-to-user` — Transfer balance to user account
- `GET /api/v1/supplier/withdrawals` — List withdrawal records

---

# Supplier OpenAPI (Third-party Integration)

**Base path:** `/api/v1/openapi/supplier`
**Authentication:** Same as User OpenAPI (API Key + HMAC-SHA256)

```
Headers:
  X-API-Key: {api_key}
  X-Timestamp: {unix_timestamp}
  X-Signature: HMAC-SHA256(api_secret, method + path + timestamp + body)
```

## Account
- `GET /api/v1/openapi/supplier/profile` — Get supplier profile (username/balance/commission rate)
- `GET /api/v1/openapi/supplier/api-key` — Get API key
- `POST /api/v1/openapi/supplier/api-key/regenerate` — Regenerate API key

## Dashboard
- `GET /api/v1/openapi/supplier/dashboard/summary` — Dashboard summary

## Email Management
- `GET /api/v1/openapi/supplier/emails` — List emails (paginated, filterable)
  - Query: `?page=1&page_size=20&type=ms_graph&is_short_term=1&status=1&keyword=outlook.com`
- `POST /api/v1/openapi/supplier/emails/import` — Batch import emails
  ```json
  {
    "type": "microsoft",
    "is_short_term": 1,
    "emails": [{"address": "", "client_id": "", "refresh_token": "", "token_expires_at": 1710000000}]
  }
  ```
- `GET /api/v1/openapi/supplier/emails/export` — Export emails (streaming txt)

## Appeal Management
- `GET /api/v1/openapi/supplier/appeals` — List appeals (filterable by status)
- `GET /api/v1/openapi/supplier/appeal/:appeal_no` — Get appeal detail
- `POST /api/v1/openapi/supplier/appeal/:appeal_no/reply` — Reply to appeal
  ```json
  {"result": 1, "reply": "str"}
  ```
- `POST /api/v1/openapi/supplier/appeals/batch-reply` — Batch reply

---

# Business Logic Notes

## Email Allocation Rules (Code Receiving)
- Same email bisa dialokasikan ke project berbeda secara bersamaan
- Setelah email sukses untuk sebuah project, **TIDAK** akan dialokasikan ke project yang sama lagi
- Same email tidak bisa melayani multiple concurrent orders untuk project yang sama
- `specified_email` override SEMUA aturan alokasi (highest priority)
- Allocation menggunakan Redis distributed lock untuk concurrency control
- Supplier priority + weight menentukan urutan alokasi

## Pricing Model
| Field | Keterangan |
|-------|------------|
| `code_price` | User membayar untuk code receiving |
| `code_supplier_price` | Supplier menerima untuk code receiving |
| `buy_price` | User membayar untuk email purchase |
| `buy_supplier_price` | Supplier menerima untuk email purchase |

> Supplier commission = `supplier_price × commission_rate`

## Appeal Flow
1. User membuat appeal (code order atau purchase)
2. Supplier punya **48 jam** untuk respond (refund/replace/reject)
3. Jika supplier tidak respond dalam 48h → auto-escalated ke admin
4. User bisa manually escalate jika tidak puas dengan respons supplier
5. Admin arbitrates dengan keputusan final (refund/replace/reject)

## Google Variant Email Generation
- Import Gmail parent email → sistem auto-generate semua dot-variants
- Variants include: semua dot permutations dari username + googlemail.com suffix variants
- Total variants per parent: `2^(n-1) × 2` (di mana n = username length)
- Hanya dot (.) variants yang didukung, **tidak** plus (+) variants
- Semua variants berbagi koneksi IMAP dari parent email

---

## Contoh Penggunaan (cURL)

### Cek kode verifikasi dari order
```bash
curl -s -X GET "https://mails.luckyous.com/api/v1/openapi/order/ORD2026042078914ad2/code" \
  -H "X-API-Key: ak_8d96ef30a1e01a5d095d25a2683a57fc" \
  | python3 -c "import sys, json; print(json.loads(sys.stdin.read())['data']['verification_code'])"
```

### Buat order baru
```bash
curl -s -X POST "https://mails.luckyous.com/api/v1/openapi/order/create" \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"project_code": "chatgpt", "email_type": "ms_graph"}'
```

### Cek balance
```bash
curl -s -X GET "https://mails.luckyous.com/api/v1/openapi/balance" \
  -H "X-API-Key: YOUR_API_KEY"
```
