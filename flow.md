# ZYVENOX GPT — Complete Bot Flow Analysis

> **Nama Project**: GPT Station (ZYVENOX GPT Creator)  
> **Versi**: 2.1.0 (Multi-User Edition)  
> **Entry Point**: `src/index.js` (via `start.bat` atau `node src/index.js`)

---

## 📁 Struktur File

```
newgptbot/
├── .env                          # Konfigurasi (token, admin, proxy)
├── start.bat                     # Launcher Windows + auto-restart
├── bot-runner.js                 # Runner untuk compiled bytecode (.jsc)
├── users.json                    # Database user (JSON flat file)
├── data.txt                      # Log akun berhasil (email:password)
├── email.json                    # Pool email untuk bulk
├── package.json                  # Dependencies & scripts
│
└── src/
    ├── index.js                  # 🎯 Main orchestrator
    ├── telegramHandler.js        # 🤖 Telegram UI & interaksi user
    ├── workerPool.js             # ⚡ Thread pool (max 5 concurrent)
    ├── db.js                     # 💾 JSON database (users.json)
    ├── signup.js                 # 📝 ChatGPT signup engine
    ├── autopay.js                # 💳 Autopay engine (2000+ baris)
    │
    └── utils/
        ├── apiSignup.js          # 🔐 Low-level signup via CycleTLS
        ├── httpClient.js         # 🌐 Axios client + proxy + cookie jar
        ├── emailGenerator.js     # 🎲 Random name & birthday generator
        ├── otpFetcher.js         # 📨 OTP extractor (manual mode only)
        ├── sentinelToken.js      # 🛡️ Sentinel token generator (PoW + Turnstile)
        ├── sentinelVM.js         # 🖥️ Turnstile VM bytecode interpreter
        ├── sentinelBrowser.js    # 🌐 Headless browser sentinel (Puppeteer)
        ├── cfSolver.js           # ☁️ Cloudflare challenge solver (Puppeteer)
        └── logger.js             # 📋 Console logger dengan warna
```

---

## 🔄 Flow Utama (High-Level)

```
┌──────────────┐      ┌─────────────────┐      ┌──────────────────┐
│   Telegram    │─────►│  Worker Pool    │─────►│  Task Processor  │
│   Handler     │      │  (max 5 slot)   │      │  (index.js)      │
└──────┬───────┘      └────────┬────────┘      └────────┬─────────┘
       │                       │                        │
       │ User Input            │ Queue/Dequeue          │
       │                       │                        ▼
       │              ┌────────┴────────┐     ┌─────────────────┐
       │              │  Mode Router    │     │  signup.js ATAU │
       │              │                 │────►│  autopay.js     │
       │              │ signup          │     └────────┬────────┘
       │              │ autopay         │              │
       │              │ login_autopay   │              ▼
       │              └─────────────────┘     ┌─────────────────┐
       │                                      │  OpenAI Auth    │
       │                                      │  Stripe/GoPay   │
       │◄─────────── Status Update ───────────┤  Midtrans       │
       │                                      └─────────────────┘
```

---

## 🚀 1. Startup Flow (`start.bat` → `index.js`)

```
start.bat
  ├─ Cek Node.js & npm
  ├─ Auto-install npm jika belum ada node_modules/
  ├─ Cek file .env
  └─ Jalankan: node src/index.js
       ├─ Tampilkan banner ASCII "ZYVENOX"
       ├─ workerPool.setTaskProcessor(handleAccountTask)
       ├─ telegramHandler.initTelegram()
       └─ Logger: "SYSTEM ONLINE"
```

---

## 🤖 2. Telegram Bot Flow (`telegramHandler.js`)

### 2.1 User Onboarding (Admin Approval)

```
User baru kirim /start
  ├─ Simpan ke users.json (status: "pending")
  ├─ Kirim notifikasi ke semua ADMIN_ID
  │     └─ Inline button: [✅ Approve] [❌ Reject]
  └─ User menunggu → "Akun Pending"

Admin klik Approve
  ├─ db.approveUser(userId)
  ├─ Notify user: "Akses Disetujui!"
  └─ Tampilkan main menu keyboard

Admin klik Reject
  ├─ db.rejectUser(userId)
  └─ Notify user: "Akses Ditolak"
```

### 2.2 Main Menu

```
┌────────────────────────────────────┐
│  ✨ Daftar Akun Baru  │  🔑 Login │
│  ⚙️ Edit Data Saya    │  📊 Status│
│            ❓ Bantuan              │
└────────────────────────────────────┘
```

**Menu Items:**
| Menu | Aksi |
|------|------|
| `✨ Daftar Akun Baru` | Minta user kirim email → deteksi email → pilih mode |
| `🔑 Login Akun` | Minta email lama → langsung enqueue `login_autopay` |
| `⚙️ Edit Data Saya` | Inline menu: ganti Password / No. GoPay / PIN GoPay |
| `📊 Status Server` | Dashboard: active slots, mode, runtime |
| `❓ Bantuan` | Pesan bantuan singkat |

### 2.3 Email Detection & Mode Selection

```
User kirim email valid (misal: test@gmail.com)
  ├─ Cek: user sudah punya proses aktif? → tolak
  └─ Tampilkan inline button:
       ├─ [📝 Signup Only]        → mode: signup
       ├─ [💳 Signup + Autopay]   → mode: autopay
       └─ [🔑 Login + Autopay]   → mode: login_autopay
```

### 2.4 Data Validation

```
Mode signup       → Wajib: password
Mode autopay      → Wajib: password + gopayPhone + gopayPin
Mode login_autopay → Wajib: password + gopayPhone + gopayPin

Jika tidak lengkap → Arahkan ke ⚙️ Edit Data Saya
```

### 2.5 Settings Edit Flow

```
⚙️ Edit Data Saya
  ├─ 🔑 Ganti Password
  │     └─ Validasi: min 12 char, huruf besar + kecil + angka
  ├─ 📱 Ganti No. GoPay
  │     └─ Input bebas (format nomor)
  └─ 🔢 Ganti PIN GoPay
        └─ Input 6 digit angka
```

---

## ⚡ 3. Worker Pool (`workerPool.js`)

```
MAX_SLOTS = env.MAX_THREADS || 5

enqueueTask(task)
  ├─ Push ke globalQueue[]
  ├─ tryStart()
  │     ├─ Cek: activeSlots.size < MAX_SLOTS?
  │     ├─ Cari task pertama di queue yang user-nya TIDAK sedang aktif
  │     ├─ Pindahkan dari queue ke activeSlots
  │     ├─ Jalankan processTaskCallback(task) secara async
  │     └─ Setelah selesai → releaseSlot() → tryStart() lagi
  └─ Return posisi antrian

Fitur:
  - 1 slot per user (tidak boleh double)
  - Cancel: cancelUserQueue() + cancelUserActiveToken()
  - Status: getActiveStatus() → list semua slot aktif
```

---

## 📝 4. Signup Flow (`signup.js` → `apiSignup.js`)

### 4.1 High-Level Signup

```
handleAccountTask (mode: signup atau autopay)
  ├─ initCycleTLS() → HTTP client dengan TLS fingerprint Chrome
  ├─ generateRandomName() + generateRandomBirthday()
  ├─ new ChatGPTSignup({email, password, name, birthdate, ...})
  └─ signup.runSignup()
       └─ Delegate ke apiSignup.runSignupViaAPI()
```

### 4.2 Detailed API Signup (`apiSignup.js`)

```
runSignupViaAPI(proxy, {email, password, name, birthdate, ...})
  │
  ├─ 1. INIT SESSION
  │     ├─ CycleTLS instance + TLSSession (JA3 Chrome 147)
  │     ├─ Set oai-did cookie
  │     └─ GET chatgpt.com/ → cek Cloudflare
  │
  ├─ 2. CSRF
  │     └─ GET /api/auth/csrf → csrfToken
  │
  ├─ 3. SIGNIN
  │     └─ POST /api/auth/signin/openai?prompt=login&login_hint={email}
  │          → Dapat authorize URL
  │
  ├─ 4. AUTHORIZE
  │     └─ followRedirects(authorizeUrl, max 15 hops)
  │          → Landing di /create-account/ atau /email-verification
  │
  ├─ 5. SENTINEL TOKEN
  │     ├─ generateSentinelTokens("username_password_create")
  │     │     ├─ Build browser fingerprint array
  │     │     ├─ Generate requirements proof (gAAAAAC prefix)
  │     │     ├─ POST sentinel.openai.com → dapat challenge
  │     │     ├─ Solve Proof-of-Work (FNV-1a hash)
  │     │     ├─ Solve Turnstile via VM (sentinelVM.js)
  │     │     └─ Return: {sentinelToken, soToken}
  │     └─ Masukkan ke header: OpenAI-Sentinel-Token
  │
  ├─ 6. REGISTER
  │     └─ POST auth.openai.com/api/accounts/user/register
  │          Body: {password, username(email)}
  │          Headers: OpenAI-Sentinel-Token + cookies
  │
  ├─ 7. OTP
  │     ├─ GET /api/accounts/email-otp/send → trigger email
  │     ├─ otpFn() → askTelegramUser() → user input kode 6 digit
  │     └─ POST /api/accounts/email-otp/validate → {code}
  │
  ├─ 8. CREATE ACCOUNT
  │     ├─ Sentinel token baru ("oauth_create_account")
  │     └─ POST /api/accounts/create_account → {name, birthdate}
  │
  ├─ 9. OAUTH CALLBACK
  │     ├─ followRedirects(continue_url)
  │     └─ GET /api/auth/session → accessToken
  │
  └─ 10. RESULT
        ├─ success: true → {email, password, accessToken}
        └─ Simpan ke data.txt
```

### 4.3 Retry Logic

```
Max 3 percobaan (default)
  ├─ Setiap retry:
  │     ├─ Refresh HTTP client (proxy baru)
  │     ├─ UUID baru (deviceId, sessionId)
  │     └─ Delay 1 detik
  ├─ Error retryable: init, csrf, signin, register(409), otp_validate
  └─ Error terminal: unsupported_country, create_account fail
```

---

## 💳 5. Autopay Flow (`autopay.js`)

### 5.1 High-Level Autopay

```
handleAccountTask (mode: autopay atau login_autopay)
  │
  ├─ [mode: autopay] → Signup dulu → dapat accessToken → lanjut autopay
  │                     (skipLogin: true)
  │
  ├─ [mode: login_autopay] → Login dulu → dapat accessToken → lanjut autopay
  │                           (skipLogin: false)
  │
  └─ new ChatGPTAutopay({...}).runAutopay()
```

### 5.2 Login Flow (jika tidak skip)

```
loginToChatGPT()
  ├─ 1. CycleTLS instance + LoginCookieJar
  ├─ 2. GET /api/auth/csrf → csrfToken
  ├─ 3. POST /api/auth/signin/openai → authorize URL
  ├─ 4. followRedirects(authorizeUrl)
  ├─ 5. Sentinel token ("authorize_continue")
  ├─ 6. POST /api/accounts/authorize/continue → {username: email}
  │
  ├─ RUTE A: Password Login
  │     ├─ Sentinel token ("password_verify")
  │     └─ POST /api/accounts/password/verify → {password}
  │
  ├─ RUTE B: Email OTP Challenge
  │     ├─ Manual: askTelegramUser() → user kirim kode (max 3x)
  │     └─ Auto: poll email provider → cari OTP baru
  │     POST /api/accounts/email-otp/validate → {code}
  │
  ├─ 7. followRedirects(continue_url) → OAuth callback
  ├─ 8. GET /api/auth/session → accessToken (retry 3x)
  └─ Return: {accessToken}
```

### 5.3 Payment Flow (Stripe + Midtrans + GoPay)

```
runAutopay() — setelah login/signup berhasil
  │
  ├─ PHASE 1: CHECKOUT
  │     ├─ getPricingCountries() + getPricingConfig() [parallel]
  │     ├─ createCheckoutSession()
  │     │     ├─ Sentinel token ("chatgpt_checkout")
  │     │     └─ POST /backend-api/payments/checkout
  │     │          Body: {plan: "chatgptplusplan", country: "ID", currency: "IDR",
  │     │                 promo: "plus-1-month-free"}
  │     │          → checkout_session_id + publishable_key
  │     │
  │     ├─ [Parallel] initStripeCheckout() + initStripeSession() + createPaymentMethod()
  │     │     ├─ POST stripe.com/v1/payment_pages/{id}/init
  │     │     ├─ POST stripe.com/v1/elements/sessions
  │     │     └─ POST stripe.com/v1/payment_methods
  │     │          type: "gopay", billing_details: {alamat random Indonesia}
  │     │
  │     └─ confirmCheckout()
  │           └─ POST stripe.com/v1/payment_pages/{id}/confirm
  │                → setup_intent / payment_intent + redirect URL
  │
  ├─ PHASE 2: REDIRECT → MIDTRANS
  │     ├─ followStripeRedirect()
  │     │     ├─ Cari redirect URL (pm-redirects.stripe.com → app.midtrans.com)
  │     │     ├─ Jika manual approval → POST /backend-api/payments/checkout/approve
  │     │     └─ Extract: midtransSnapId dari /snap/v4/redirection/{id}
  │     │
  │     └─ getMidtransTransaction()
  │           └─ GET midtrans.com/snap/v1/transactions/{snapId}
  │
  ├─ PHASE 3: GOPAY LINKING
  │     ├─ linkGoPay()
  │     │     └─ POST midtrans.com/snap/v3/accounts/{snapId}/linking
  │     │          Body: {type: "gopay", phone: gopayPhone}
  │     │          → gopayReference (UUID)
  │     │
  │     ├─ gopayAuthorize()
  │     │     ├─ POST gopayapi.com/v1/linking/validate-reference
  │     │     └─ POST gopayapi.com/v1/linking/user-consent
  │     │          → OTP dikirim ke WhatsApp user
  │     │
  │     └─ handleGoPayOtpAndPin()
  │           ├─ askTelegram("Masukkan kode GoPay dari WhatsApp")
  │           ├─ POST gopayapi.com/v1/linking/validate-otp → challengeId
  │           ├─ POST customer.gopayapi.com/api/v1/users/pin/tokens/nb
  │           │     Body: {pin: gopayPin, challenge_id} → JWT token
  │           └─ POST gopayapi.com/v1/linking/validate-pin
  │                 Body: {reference_id, token: JWT}
  │
  ├─ PHASE 4: CHARGE
  │     ├─ chargeGoPay()
  │     │     └─ POST midtrans.com/snap/v2/transactions/{snapId}/charge
  │     │          Body: {payment_type: "gopay", tokenization: true}
  │     │
  │     └─ handleChargePin()
  │           ├─ GET gopayapi.com/v1/payment/validate
  │           ├─ POST gopayapi.com/v1/payment/confirm → challengeId
  │           ├─ POST customer.gopayapi.com/api/v1/users/pin/tokens/nb
  │           │     Body: {pin: gopayPin} → JWT token
  │           └─ POST gopayapi.com/v1/payment/process
  │                 Body: {challenge: {type: "GOPAY_PIN_CHALLENGE", pin_token}}
  │
  └─ PHASE 5: VERIFY
        ├─ checkTransactionStatus() → poll max 12x (tiap 5 detik)
        │     └─ GET midtrans.com/snap/v1/transactions/{snapId}/status
        │          Tunggu: "settlement" atau "capture" atau status_code=200
        │
        ├─ verifyCheckout()
        │     ├─ GET chatgpt.com/checkout/verify?stripe_session_id=...
        │     └─ GET chatgpt.com/checkout/verify?...&refresh_account=true
        │
        └─ checkSubscriptionStatus()
              └─ GET /backend-api/payments/checkout/openai_llc/{sessionId}
                   → payment_status: "paid", status: "complete"
```

---

## 🛡️ 6. Sentinel Token System

### 6.1 Flow Token Generation (`sentinelToken.js`)

```
generateSentinelTokens(proxy, userAgent, flow, sentinelId, cycleTLS)
  │
  ├─ 1. Build Browser Fingerprint Array (25 elemen)
  │     [screen, date, seed, iteration, UA, sdkUrl, null, lang, langs,
  │      elapsed, navProp, docProp, winEvent, perfNow, sentinelId, ...]
  │
  ├─ 2. Generate Requirements Proof
  │     └─ Solve trivial PoW (difficulty "0") → "gAAAAAC" prefix
  │
  ├─ 3. Fetch Challenge
  │     └─ POST chatgpt.com/backend-api/sentinel/req
  │          Body: {p: requirementsProof, id: sentinelId, flow}
  │          → {token, proofofwork: {seed, difficulty}, turnstile: {dx}, so}
  │
  ├─ 4. Solve Real PoW
  │     └─ FNV-1a hash: hash(seed + base64(fingerprint))
  │          Iterate hingga hash prefix <= difficulty
  │          → "gAAAAAB" prefix
  │
  ├─ 5. Solve Turnstile Challenge (sentinelVM.js)
  │     ├─ XOR decrypt turnstile.dx menggunakan requirementsProof sebagai key
  │     ├─ Parse instruksi JSON
  │     ├─ Buat mock window/navigator/document
  │     └─ Jalankan custom bytecode VM (30+ opcodes)
  │          → base64-encoded result
  │
  └─ 6. Assemble Token
        sentinelToken = JSON.stringify({p: proof, t: turnstile, c: token, id, flow})
        soToken = JSON.stringify({so: null, c: token, id, flow})
```

### 6.2 VM Opcodes (`sentinelVM.js`)

```
OP_SET(2), OP_GET_PROP(6), OP_CALL(7), OP_COPY(8),
OP_XOR(1), OP_PUSH(5), OP_SUCCESS(3), OP_ERROR(4),
OP_JSON_PARSE(14), OP_JSON_STR(15), OP_ATOB(18), OP_BTOA(19),
OP_IF_EQ(20), OP_IF_DEF(23), OP_DEFINE_FN(30), OP_AWAIT(34), ...

Max 500,000 iterasi ATAU 2 detik timeout
```

---

## 🌐 7. HTTP Client & Proxy (`httpClient.js`)

```
createClient(proxyUrl)
  ├─ Axios instance + tough-cookie CookieJar
  ├─ Random User-Agent (dari 10 preset: Chrome/Edge/Firefox/Safari)
  ├─ Auto cookie management (request interceptor + response interceptor)
  ├─ followRedirects() → manual redirect following (max 10)
  └─ Proxy: HttpsProxyAgent

Proxy System:
  ├─ GENERAL_PROXY_URL → dipakai untuk signup & login (Singapore)
  ├─ KOREA_PROXY_URL   → dipakai untuk checkout (Korea)
  └─ DataImpulse sticky session: user__session-{8char} di username
```

---

## 💾 8. Database (`db.js` → `users.json`)

```json
{
  "6276972957": {
    "status": "approved",
    "firstName": "Admin",
    "registeredAt": "2024-01-01T00:00:00.000Z",
    "approvedAt": "2024-01-01T00:00:00.000Z",
    "password": "MySecureP4ss!",
    "gopayPhone": "81234567890",
    "gopayPin": "123456"
  }
}
```

**Status Lifecycle**: `pending` → `approved` / `rejected`

**Functions**: `getUser()`, `saveUser()`, `hasUser()`, `approveUser()`, `rejectUser()`

---

## 📊 9. Dashboard & Status Updates

```
Setiap aksi penting → updateStatusFor(chatId, text)
  ├─ Message queue per user (debounced, coalesce rapid updates)
  ├─ Edit existing message ATAU kirim baru
  ├─ Header: email, mode, name
  ├─ Body: status terkini (registering, payment, error, dll)
  ├─ Footer: engine status (ACTIVE/QUEUED/FINISHED/STANDBY) + timestamp
  └─ Inline button: [🛑 Batalkan Sesi]
```

---

## 🔧 10. Konfigurasi (`.env`)

| Key | Deskripsi |
|-----|-----------|
| `TELEGRAM_BOT_TOKEN` | Token bot Telegram |
| `ADMIN_ID` | Comma-separated admin Telegram user IDs |
| `MAX_THREADS` | Maksimum concurrent task (default: 5) |
| `DEBUG` | Enable debug logging (true/false) |
| `KOREA_PROXY_URL` | Proxy untuk checkout (Korea) |
| `GENERAL_PROXY_URL` | Proxy untuk signup/login (Singapore) |

---

## ⚠️ Error Handling

| Error | Sumber | Aksi |
|-------|--------|------|
| `CF_CHALLENGE` | Cloudflare block | Retry dengan proxy baru |
| `unsupported_country` | OpenAI region block | Ganti proxy negara lain |
| `email conflict (409)` | Email sudah terdaftar | Retry |
| `Sentinel token not available` | Token generation fail | Retry |
| `OTP tidak diterima` | Timeout OTP | Gagal (bisa retry manual) |
| `checkout_amount_mismatch` | Akun sudah pernah trial | Gagal (no retry) |
| `GoPay sudah terhubung` | GoPay linked ke Midtrans lain | Putuskan di Gojek dulu |
| `provider_decline` | GoPay menolak pembayaran | Tunggu / ganti nomor |
| `Akun not eligible` | Trial tidak tersedia setelah manual approval | Gagal (no retry) |

---

## 🔑 Dependencies Utama

| Package | Fungsi |
|---------|--------|
| `node-telegram-bot-api` | Telegram Bot API |
| `cycletls` | HTTP client dengan JA3/H2 TLS fingerprint |
| `puppeteer` + `stealth` | Headless browser (CF solver, sentinel) |
| `axios` + `tough-cookie` | HTTP client standar + cookie jar |
| `https-proxy-agent` | Proxy support |
| `uuid` | Generate deviceId, sessionId, dll |
| `dotenv` | Load .env config |
