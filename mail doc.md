# 🚀 ZYVENOX T-MAIL: Complete Client Documentation

Welcome to **ZYVENOX T-MAIL**! This is a modern, fast, and fully automated temporary email service designed for secure bot automation and client-only access.

---

## 🌟 1. Web Dashboard (Access Portal)

The Web Dashboard is now a private access portal. Public creation is disabled; only users with a valid **Access Token** can view inboxes.

**How to use:**
1. Open the ZYVENOX T-MAIL website.
2. **Access Inbox**: Paste your unique **Access Token** (e.g., `axiomflow_a1b2c3d4`) into the "Access Inbox" field.
3. **Auto-Load**: The system instantly detects the token and loads your emails.
4. **Live Sync**: The inbox automatically refreshes every 5 seconds.
5. **History**: Your latest 5 active tokens are remembered in the "Recent Inboxes" sidebar.

---

## 🤖 2. API Reference (For Developers & Bots)

### A. Authentication
- **Accessing Emails**: No API Key required if you have the **Access Token**.
- **Creating Mailboxes**: Requires an `X-API-Key` header (provided by the administrator).

**Base URL:** `https://mail.zyvenox.my.id`

### B. Generate a Mailbox (Requires API Key)
Generates an email address and a unique Access Token.

**Endpoint:** `POST /api/mailboxes/generate`
**Headers:** `X-API-Key: your_secret_key`

**Example Response:**
```json
{
  "address": "smartdragon7124@axiomflow.my.id",
  "token": "axiomflow_7b2f1a9d"
}
```

### C. Get Emails via Token
Fetches all emails for the mailbox bound to a token.

**Endpoint:** `GET /api/mailboxes/token/:token`

### D. Read a Specific Email via Token
**Endpoint:** `GET /api/mailboxes/token/:token/:id`

### E. Admin: Domain Management (Requires API Key)
You can now manage hundreds of domains via the API without restarting the server.

- **Add/Activate Domain**: `POST /api/domains`
- **Delete Domain**: `DELETE /api/domains/:domain`

**Example (Add Domain):**
```bash
curl -X POST http://your-server/api/domains \
  -H "X-API-Key: your_secret_key" \
  -d '{"domain": "new-domain.com"}'
```

---

## 🔑 3. The OTP Extractor API (Token Based)

If you are automating account creation, use the token-based OTP extractor.

**Endpoint:** `GET /api/mailboxes/token/:token/otp`

### Query Parameters
- `service` *(optional)*: Filter emails by sender (e.g. `openai`, `gopay`).

### Example Usage
```bash
# General 6-digit code extraction
curl "https://mail.zyvenox.my.id/api/mailboxes/token/axiomflow_7b2f1a9d/otp"
```

---

## 💻 4. Code Examples (NodeJS)

### Polling for OTP with Token
```javascript
const axios = require('axios');

async function waitForOTP(accessToken, retries = 10, delay = 5000) {
    const url = `https://mail.zyvenox.my.id/api/mailboxes/token/${accessToken}/otp?service=openai`;
    
    for (let i = 0; i < retries; i++) {
        try {
            const response = await axios.get(url);
            console.log("✅ OTP Found:", response.data.otp);
            return response.data.otp;
        } catch (error) {
            console.log(`⏳ Waiting for OTP... (Attempt ${i + 1}/${retries})`);
            await new Promise(res => setTimeout(res, delay));
        }
    }
    throw new Error("❌ OTP Timeout!");
}

waitForOTP('axiomflow_7b2f1a9d');
```

---

## 🔒 Security Model
- **Token Isolation**: Emails are no longer accessible by address alone via the primary API. Access requires a unique, hard-to-guess token.
- **Short Lifespan**: All emails and tokens are automatically deleted from the server after 24 hours.
o data is retained long-term.
