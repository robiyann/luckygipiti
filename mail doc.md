# 🚀 ZYVENOX T-MAIL: Complete Client Documentation

Welcome to **ZYVENOX T-MAIL**! This is a modern, fast, and fully automated temporary email service designed for both human users and bot automation.

This document serves as the official guide for clients and developers to interact with the ZYVENOX T-MAIL system.

---

## 🌟 1. Web Dashboard (For Humans)

The Web Dashboard provides a sleek, dark-mode, glassmorphism UI for generating and managing temporary emails.

**How to use:**
1. Open the ZYVENOX T-MAIL website.
2. **Generate Random:** Click the "Generate Random" button to instantly get a human-readable email address (e.g., `fastrabbit42@axiomflow.my.id`).
3. **Create Custom:** Switch to the "Custom Mode" tab, enter your preferred prefix, select a domain, and click "Create Custom".
4. **Live Sync:** The inbox automatically refreshes every 5 seconds.
5. **Persistence:** Your current inbox will be remembered even if you refresh the page.
6. **Recent Inboxes:** Easily switch back to your latest 5 active inboxes using the sidebar.

---

## 🤖 2. API Reference (For Developers & Bots)

For automation, we expose a completely public REST API. **No Authentication or API Keys are required.** 
*Security model: Security by obscurity (Only those who know the exact random email address can read its messages).*

**Base URL:** `https://mail.zyvenox.my.id`

### A. List Available Domains
Returns a list of all active email domains that can be used to generate addresses.

**Endpoint:** `GET /api/domains`

**Example Response:**
```json
{
  "domains": ["axiomflow.my.id"]
}
```

### B. Generate a Random Address
Generates a highly unique, human-readable random email address.

**Endpoint:** `POST /api/mailboxes/generate`

**Request Body:**
```json
{
  "domain": "axiomflow.my.id"
}
```

**Example Response:**
```json
{
  "address": "smartdragon7124@axiomflow.my.id"
}
```

### C. Create a Custom Address
Creates an inbox with a specific prefix.

**Endpoint:** `POST /api/mailboxes/custom`

**Request Body:**
```json
{
  "prefix": "john.doe",
  "domain": "axiomflow.my.id"
}
```

### D. Get All Emails in an Inbox
Fetches all emails received by a specific address.

**Endpoint:** `GET /api/mailboxes/:address`

**Example:** `GET /api/mailboxes/fastrabbit42@axiomflow.my.id`

### E. Read a Specific Email
Fetches the full details (including HTML body) of a specific email.

**Endpoint:** `GET /api/mailboxes/:address/:id`

---

## 🔑 3. The OTP Extractor API (The Automation Superpower)

If you are using ZYVENOX T-MAIL for bot automation (like account creation scripts), you don't need to parse the whole email. Just use our built-in OTP Extractor!

It automatically reads the latest email and extracts 6-digit confirmation codes.

**Endpoint:** `GET /api/mailboxes/:address/otp`

### Query Parameters
- `service` *(optional)*: Filter emails by sender. Supported values right now:
  - `openai`: Extracts codes specifically from OpenAI (`noreply@tm.openai.com`)

### Example Usage

**1. General 6-digit code extraction (Latest email):**
```bash
curl "https://mail.zyvenox.my.id/api/mailboxes/luckyeagle7271@axiomflow.my.id/otp"
```

**2. Specific OpenAI OTP extraction:**
```bash
curl "https://mail.zyvenox.my.id/api/mailboxes/luckyeagle7271@axiomflow.my.id/otp?service=openai"
```

**Successful Response (200 OK):**
```json
{
  "otp": "088647",
  "from": "noreply@tm.openai.com",
  "date": "2026-04-23T10:34:32.175Z"
}
```

**Pending/Not Found Response (404 Not Found):**
```json
{
  "error": "No OTP email found for luckyeagle7271@axiomflow.my.id"
}
```

---

## 💻 4. Code Examples

### NodeJS (Axios) - Polling for OTP
```javascript
const axios = require('axios');

async function waitForOTP(emailAddress, retries = 10, delay = 5000) {
    const url = `https://mail.zyvenox.my.id/api/mailboxes/${emailAddress}/otp?service=openai`;
    
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

waitForOTP('luckyeagle7271@axiomflow.my.id');
```

### Python (Requests) - Polling for OTP
```python
import requests
import time

def wait_for_otp(email_address, retries=10, delay=5):
    url = f"https://mail.zyvenox.my.id/api/mailboxes/{email_address}/otp?service=openai"
    
    for i in range(retries):
        try:
            response = requests.get(url)
            if response.status_code == 200:
                data = response.json()
                print(f"✅ OTP Found: {data['otp']}")
                return data['otp']
        except Exception:
            pass
            
        print(f"⏳ Waiting for OTP... (Attempt {i + 1}/{retries})")
        time.sleep(delay)
        
    raise Exception("❌ OTP Timeout!")

wait_for_otp('luckyeagle7271@axiomflow.my.id')
```

---

## 🔒 Security Practices
- **Isolation by Randomness:** There are over 22,000,000 unique semantic combinations for random emails, making collisions virtually impossible.
- **Short Lifespan:** All emails are automatically hard-deleted from the server after 24 hours. No data is retained long-term.
