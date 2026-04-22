# ZYVENOX GPT — Complete Bot Flow Analysis

> **Nama Project**: GPT Station (ZYVENOX GPT Creator)  
> **Versi**: 3.0.0 (Multi-User + LuckMail + GoPay Pool Edition)  
> **Entry Point**: `src/index.js` (via `start.bat` atau `node src/index.js`)

---

## 📁 Struktur File

```
newgptbot/
├── .env                          # Konfigurasi (token, admin, proxy, OTP server)
├── start.bat                     # Launcher Windows + auto-restart
├── bot-runner.js                 # Runner untuk compiled bytecode (.jsc)
├── users.json                    # Database profil user (JSON flat file)
├── accounts.json                 # Database akun ChatGPT yang sudah dibuat
├── orders.json                   # Riwayat pembelian email LuckMail (token, email, status)
├── otp_cache.json                # Cache OTP terakhir per email (anti replay OTP lama)
├── data.txt                      # Log akun berhasil (email:password) — legacy
├── email.json                    # Pool email untuk bulk — legacy
├── package.json                  # Dependencies & scripts
│
└── src/
    ├── index.js                  # 🎯 Main orchestrator (handleAccountTask, GoPay pool)
    ├── telegramHandler.js        # 🤖 Telegram UI, interaksi user, batch mode
    ├── workerPool.js             # ⚡ Thread pool (max MAX_THREADS concurrent, FIFO)
    ├── db.js                     # 💾 JSON database (users/accounts/orders/otp_cache)
    ├── signup.js                 # 📝 ChatGPT signup engine
    ├── autopay.js                # 💳 Autopay engine
    │
    └── utils/
        ├── apiSignup.js          # 🔐 Low-level signup via CycleTLS
        ├── httpClient.js         # 🌐 Axios client + proxy + cookie jar
        ├── emailGenerator.js     # 🎲 Random name & birthday generator
        ├── luckMailApi.js        # 📨 LuckMail API (beli email, ambil OTP, refund)
        ├── gopayOtpFetcher.js    # 📲 GoPay pool (claim/release slot, trigger webhook, poll OTP)
        ├── otpFetcher.js         # 📨 OTP ekstractor manual (legacy, tidak dipakai di auto mode)
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
│   Telegram    │─────►│  Worker Pool    │─────►│ handleAccountTask│
│   Handler     │      │  (FIFO, THREADS)│      │  (index.js)      │
└──────┬───────┘      └────────┬────────┘      └────────┬─────────┘
       │                       │                        │
       │ User Input            │ Queue/Dequeue          │
       │                       │                        ▼
       │              ┌────────┴────────┐     ┌─────────────────────────┐
       │              │  Mode Router    │     │  1. LuckMail Purchase   │
       │              │                 │     │     (jika auto mode)    │
       │              │ signup          │     │  2. Claim GoPay Slot    │
       │              │ autopay         │────►│     (jika autopay mode) │
       │              │ login_autopay   │     │  3. signup.js ATAU      │
       │              │ auto_signup     │     │     autopay.js          │
       │              │ auto_autopay    │     │  4. Release GoPay Slot  │
       │              │ auto_loginpay   │     └────────┬────────────────┘
       │              │ retry_autopay   │              │
       │              └─────────────────┘              ▼
       │                                      ┌─────────────────┐
       │                                      │  Result Handler │
       │◄─────────── Status Update ───────────┤  (JSON report,  │
       │                                      │   batch/single) │
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
       ├─ resetAllGopaySlots(OTP_SERVER_URL)   ← Reset semua slot GoPay ke "available"
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
  ├─ Notify user: "Akses Disetujui! — Lengkapi Password, No GoPay & PIN di Edit Data Saya"
  └─ Tampilkan main menu keyboard

Admin klik Reject
  ├─ db.rejectUser(userId)
  └─ Notify user: "Akses Ditolak"
```

### 2.2 Main Menu

```
┌─────────────────────────────────────────────┐
│      🤖 Auto Daftar (LuckMail)              │
│  ✨ Daftar Akun Baru  │   🔑 Login Akun     │
│  ⚙️ Edit Data Saya    │   📊 Status Server  │
│              ❓ Bantuan                      │
└─────────────────────────────────────────────┘
```

**Menu Items:**
| Menu | Aksi |
|------|------|
| `🤖 Auto Daftar (LuckMail)` | Pilih sub-mode otomatis (LuckMail); tidak perlu input email |
| `✨ Daftar Akun Baru` | Tunggu user kirim email → deteksi email → pilih mode manual |
| `🔑 Login Akun` | Minta email lama → langsung enqueue `login_autopay` |
| `⚙️ Edit Data Saya` | Inline menu: ganti Password / No. GoPay / PIN GoPay |
| `📊 Status Server` | Dashboard server: active slots, mode, runtime |
| `❓ Bantuan` | Pesan bantuan singkat |

### 2.3 Auto Daftar (LuckMail) - Mode Baru

```
User klik 🤖 Auto Daftar (LuckMail)
  ├─ Cek: user sudah punya proses aktif? → tolak
  └─ Tampilkan inline button:
       ├─ [📝 Auto Signup Only]        → mode: auto_signup
       ├─ [💳 Auto Signup + Autopay]   → mode: auto_autopay  ← BATCH SUPPORT
       └─ [🔑 Auto Login + Autopay]   → mode: auto_loginpay
```

**Khusus mode `auto_autopay` (Batch Mode):**
```
Bot tanya: "Berapa jumlah akun yang ingin dibuat?"
  ├─ Validasi: angka, 1 s/d MAX_THREADS*2 (default maks 10)
  ├─ Set state.isBatchMode = true
  ├─ state.batchTarget = jumlah
  ├─ Enqueue semua task sekaligus (email kosong, mode: auto_autopay)
  └─ workerPool proses secara CONCURRENT (FIFO, max MAX_THREADS)
```

### 2.4 Email Detection & Mode Selection (Manual)

```
User kirim email valid (misal: test@gmail.com)
  ├─ Cek: user sudah punya proses aktif? → tolak
  └─ Tampilkan inline button:
       ├─ [📝 Signup Only]        → mode: signup
       ├─ [💳 Signup + Autopay]   → mode: autopay
       └─ [🔑 Login + Autopay]   → mode: login_autopay
```

### 2.5 Data Validation (per mode)

```
Mode signup / auto_signup     → Wajib: password
Mode autopay / auto_autopay   → Wajib: password
Mode login_autopay            → Wajib: password (GoPay diambil dari pool)
Mode auto_loginpay            → Wajib: password + email lama (input manual)
Mode retry_autopay            → Otomatis ambil accessToken dari accounts.json
```

> **Catatan**: No. GoPay dan PIN GoPay tidak lagi dipakai langsung dari profil user untuk autopay. Sekarang selalu diambil dari **GoPay Pool Server**.

### 2.6 Settings Edit Flow

```
⚙️ Edit Data Saya
  ├─ 🔑 Ganti Password
  │     └─ Validasi: min 12 char, huruf besar + kecil + angka
  ├─ 📱 Ganti No. GoPay
  │     └─ Input bebas (format nomor) — disimpan tapi tidak dipakai di autopay
  └─ 🔢 Ganti PIN GoPay
        └─ Input 6 digit angka — disimpan tapi tidak dipakai di autopay
```

---

## ⚡ 3. Worker Pool (`workerPool.js`)

```
MAX_SLOTS = env.MAX_THREADS || 5

enqueueTask(task)
  ├─ Assign taskId unik
  ├─ Push ke globalQueue[]
  ├─ tryStart()
  │     ├─ Cek: activeSlots.size < MAX_SLOTS?
  │     ├─ Ambil task pertama di queue (FIFO, FULL CONCURRENCY — 1 user bisa multi-slot)
  │     ├─ Pindahkan dari queue ke activeSlots (key: taskId)
  │     ├─ Jalankan processTaskCallback(task) secara async
  │     ├─ Setelah selesai → handleTaskResult(userId, result)
  │     └─ releaseSlot(taskId) → tryStart() lagi
  └─ Return posisi antrian

Fitur:
  - Full concurrency: 1 user bisa punya banyak task aktif bersamaan (sesuai MAX_THREADS)
  - Cancel: cancelUserQueue() + cancelUserActiveToken()
  - Status: getActiveStatus() → list semua slot aktif
  - isUserBusy(): cek apakah user punya task di queue ATAU aktif
```

---

## 📲 4. GoPay Pool System (`gopayOtpFetcher.js` + OTP Server)

```
OTP_SERVER_URL = http://146.190.85.126:3000

Saat bot start:
  └─ GET /gopay/reset-all → reset semua slot ke "available"

Saat task autopay dimulai:
  ├─ claimGopaySlot(serverUrl)
  │     ├─ GET /gopay/claim
  │     ├─ Jika 503 → semua slot busy → return null
  │     └─ Return: { id, phone, pin, webhook_action }
  │
  ├─ Jika claimGopaySlot() == null → entry WAIT LOOP (max 10 menit, cek tiap 2 detik)
  │     └─ Tampilkan status: "⌛ Menunggu Slot GoPay..."
  │
  ├─ Jika tetap null setelah 10 menit → Task GAGAL + release CycleTLS
  │
  └─ Setelah dapat slot:
        ├─ finalGopayPhone = activeSlot.phone
        ├─ finalGopayPin = activeSlot.pin
        ├─ finalServerNum = activeSlot.id
        └─ finalWebhook = activeSlot.webhook_action

Polling OTP GoPay (di dalam autopay.js):
  └─ fetchGopayOtp(phone, serverUrl, serverNum)
        ├─ GET /otp?server={id}&phone={phone} tiap 3 detik
        ├─ Parse digit 4-6 dari response.data.text
        ├─ Max 20 attempts (60 detik)
        └─ Timeout → throw Error

Trigger MacroDroid (di dalam autopay.js, setelah unlink):
  └─ triggerMacrodroidWebhook(serverUrl, 'reset-link')
        └─ GET /trigger-hp?action=reset-link

Release slot setelah task selesai (sukses/gagal):
  └─ releaseGopaySlot(serverUrl, slotId)
        └─ GET /gopay/release?id={slotId}
```

---

## 📨 5. LuckMail API (`luckMailApi.js`)

```
BASE_URL = https://mails.luckyous.com/api/v1/openapi
ALLOWED_DOMAINS = [outlook.de, outlook.cl, outlook.ph]

purchaseEmail()
  ├─ Pilih domain random dari ALLOWED_DOMAINS
  ├─ POST /email/purchase
  │     Body: { project_code: "openai", email_type: "ms_imap", domain, quantity: 1 }
  ├─ Parse: token, email_address, id (purchaseId)
  ├─ db.saveOrder(token, email, 'purchased')   ← Simpan ke orders.json
  └─ Return: { token, email, purchaseId }

fetchVerificationCode(token, email)
  ├─ Cek db.getOtpCache(email) → lastOtp (anti-replay)
  ├─ Polling GET /email/token/{token}/code tiap 2 detik (max 10x = 20 detik)
  ├─ Extract 6-digit dari verification_code
  ├─ Abaikan jika kode == lastOtp (kode lama)
  ├─ db.saveOtpCache(email, extractedOtp)     ← Update cache
  └─ Return: OTP string ATAU null (timeout)

cancelEmail(purchaseId)
  ├─ POST /appeal/create
  │     Body: { appeal_type: 2, purchase_id, reason: "no_code" }
  └─ Dipanggil jika: signup gagal ATAU OTP timeout (untuk refund)

getBalance()
  └─ GET /balance → return saldo akun LuckMail
```

---

## 📝 6. Signup Flow (`signup.js` → `apiSignup.js`)

### 6.1 High-Level Signup

```
handleAccountTask (mode: signup / autopay / auto_signup / auto_autopay)
  ├─ Jika auto mode → purchaseEmail() dulu (LuckMail)
  ├─ Claim GoPay slot (jika autopay mode)
  ├─ generateRandomName() + generateRandomBirthday()
  ├─ new ChatGPTSignup({email, password, name, birthdate, otpFn, ...})
  └─ signup.runSignup()
       └─ Delegate ke apiSignup.runSignupViaAPI()

otpFn (callback OTP, berbeda per mode):
  ├─ Manual mode   → askTelegramUser() → user input kode dari inbox
  └─ Auto mode     → luckMailApi.fetchVerificationCode(token, email)
```

### 6.2 Detailed API Signup (`apiSignup.js`)

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
  │     └─ generateSentinelTokens("username_password_create") → {sentinelToken, soToken}
  │
  ├─ 6. REGISTER
  │     └─ POST auth.openai.com/api/accounts/user/register
  │          Body: {password, username(email)}
  │          Headers: OpenAI-Sentinel-Token + cookies
  │
  ├─ 7. OTP
  │     ├─ GET /api/accounts/email-otp/send → trigger email
  │     ├─ otpFn() → ambil OTP (manual atau LuckMail polling)
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
        ├─ success: true → {email, password, accessToken, cookies}
        └─ db.saveAccount(email, {userId, password, accountType: 'Free', accessToken})
```

### 6.3 Retry Logic

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

## 💳 7. Autopay Flow (`autopay.js`)

### 7.1 High-Level Autopay

```
handleAccountTask (mode: autopay / auto_autopay / login_autopay / auto_loginpay / retry_autopay)
  │
  ├─ [autopay / auto_autopay]
  │     → Signup dulu → dapat accessToken
  │     → ChatGPTAutopay({ skipLogin: true, accessToken })
  │
  ├─ [login_autopay / auto_loginpay]
  │     → Tidak signup
  │     → ChatGPTAutopay({ skipLogin: false }) → login dulu di dalam autopay.js
  │
  ├─ [retry_autopay]
  │     → Ambil accessToken dari accounts.json (db.getAccount())
  │     → ChatGPTAutopay({ skipLogin: true, accessToken: cached })
  │
  └─ new ChatGPTAutopay({
         email, password, name,
         gopayPhone: activeSlot.phone,   ← DARI POOL, bukan dari profil user
         gopayPin: activeSlot.pin,       ← DARI POOL, bukan dari profil user
         serverNumber: activeSlot.id,
         webhookAction: activeSlot.webhook_action,
         threadId, sharedCycleTLS: localCycleTLS,
         accessToken, skipLogin, otpFn
     }).runAutopay()
```

### 7.2 Login Flow (jika tidak skip)

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
  │     └─ Auto (auto_loginpay): luckMailApi.fetchVerificationCode(token, email)
  │     POST /api/accounts/email-otp/validate → {code}
  │
  ├─ 7. followRedirects(continue_url) → OAuth callback
  ├─ 8. GET /api/auth/session → accessToken (retry 3x)
  └─ Return: {accessToken}
```

### 7.3 Payment Flow (Stripe + Midtrans + GoPay)

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
  │     │          Body: {type: "gopay", phone: gopayPhone}   ← dari Pool
  │     │          → gopayReference (UUID)
  │     │
  │     ├─ gopayAuthorize()
  │     │     ├─ POST gopayapi.com/v1/linking/validate-reference
  │     │     └─ POST gopayapi.com/v1/linking/user-consent
  │     │          → OTP dikirim ke WhatsApp slot GoPay
  │     │
  │     └─ handleGoPayOtpAndPin()
  │           ├─ fetchGopayOtp(phone, OTP_SERVER, serverNum) → poll /otp endpoint
  │           │     └─ OTP otomatis dari MacroDroid/Android (tidak perlu manual!)
  │           ├─ POST gopayapi.com/v1/linking/validate-otp → challengeId
  │           ├─ POST customer.gopayapi.com/api/v1/users/pin/tokens/nb
  │           │     Body: {pin: gopayPin, challenge_id} → JWT token  ← PIN dari Pool
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
  ├─ PHASE 5: VERIFY
  │     ├─ checkTransactionStatus() → poll max 12x (tiap 5 detik)
  │     │     └─ GET midtrans.com/snap/v1/transactions/{snapId}/status
  │     │          Tunggu: "settlement" atau "capture" atau status_code=200
  │     │
  │     ├─ verifyCheckout()
  │     │     ├─ GET chatgpt.com/checkout/verify?stripe_session_id=...
  │     │     └─ GET chatgpt.com/checkout/verify?...&refresh_account=true
  │     │
  │     └─ checkSubscriptionStatus()
  │           └─ GET /backend-api/payments/checkout/openai_llc/{sessionId}
  │                → payment_status: "paid", status: "complete"
  │
  └─ CLEANUP (di index.js, setelah runAutopay() return):
        ├─ Unlink GoPay (sudah dihandle di dalam autopay.js sebelum return)
        ├─ triggerMacrodroidWebhook('reset-link') → reset WhatsApp GoPay di Android
        └─ releaseGopaySlot(serverUrl, activeSlot.id)  ← NON-BLOCKING (fire & forget)
```

---

## 📊 8. Result Handler & Batch Reporting (`telegramHandler.js`)

```
Setelah task selesai (workerPool):
  └─ handleTaskResult(userId, result)
        │
        ├─ [isBatchMode = true]
        │     ├─ state.batchResults.push(result)
        │     ├─ state.batchCompleted++
        │     └─ checkAndSendBatchReport(chatId)
        │           ├─ Jika batchCompleted >= batchTarget:
        │           │     ├─ Kirim ringkasan: "BATCH COMPLETED — ✅ X (Plus) / ❌ Y"
        │           │     ├─ Buat file JSON (hanya akun Plus)
        │           │     ├─ bot.sendDocument(chatId, filePath)
        │           │     └─ Hapus file setelah 30 detik
        │           └─ Reset batch state
        │
        └─ [isBatchMode = false]
              └─ sendAccountJsonFile(chatId, [result])
                    ├─ Hanya akun Plus yang masuk ke JSON
                    └─ Kirim langsung setelah 2 detik
```

---

## 🛡️ 9. Sentinel Token System (`sentinelToken.js`)

```
generateSentinelTokens(proxy, userAgent, flow, sentinelId, cycleTLS)
  │
  ├─ 1. Build Browser Fingerprint Array (25 elemen)
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
  │          Iterate hingga hash prefix <= difficulty → "gAAAAAB" prefix
  │
  ├─ 5. Solve Turnstile Challenge (sentinelVM.js)
  │     ├─ XOR decrypt turnstile.dx menggunakan requirementsProof sebagai key
  │     ├─ Parse instruksi JSON
  │     ├─ Buat mock window/navigator/document
  │     └─ Jalankan custom bytecode VM (30+ opcodes, max 500k iter / 2 detik)
  │          → base64-encoded result
  │
  └─ 6. Assemble Token
        sentinelToken = JSON.stringify({p: proof, t: turnstile, c: token, id, flow})
        soToken = JSON.stringify({so: null, c: token, id, flow})
```

---

## 🌐 10. HTTP Client & Proxy (`httpClient.js`)

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

LuckMail API juga menggunakan GENERAL_PROXY_URL (via https-proxy-agent)
```

---

## 💾 11. Database (`db.js`)

### File-file Database

| File | Isi |
|------|-----|
| `users.json` | Profil user Telegram (status, password, gopayPhone, gopayPin) |
| `accounts.json` | Akun ChatGPT hasil proses (email, password, accessToken, accountType) |
| `orders.json` | Riwayat pembelian email LuckMail (token/orderId, email, status) |
| `otp_cache.json` | OTP terakhir per email (untuk deteksi OTP lama / anti-replay) |

### Skema users.json

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

### Skema accounts.json

```json
{
  "user@outlook.de": {
    "email": "user@outlook.de",
    "userId": "6276972957",
    "password": "MySecureP4ss!",
    "accountType": "Plus",
    "accessToken": "eyJ...",
    "refreshToken": "...",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

**Status Lifecycle accounts**: `Free` → `Plus` (setelah autopay sukses)

**Functions DB**:
- Users: `getUser()`, `saveUser()`, `hasUser()`, `getPendingUsers()`, `approveUser()`, `rejectUser()`
- Accounts: `saveAccount()`, `getAccount()`
- OTP Cache: `saveOtpCache()`, `getOtpCache()`
- Orders: `saveOrder()`, `getOrderByEmail()`

---

## 📊 12. Dashboard & Status Updates

```
Setiap aksi penting → updateStatusFor(chatId, text, accountInfo, isQueued)
  ├─ Message queue per user (coalesce rapid updates — kirim yang paling baru saja)
  ├─ Edit existing message ATAU kirim baru
  ├─ Header: NAME, EMAIL, MODE
  ├─ Body: status terkini (registering, payment, error, dll)
  ├─ Footer: engine status + timestamp
  │     ├─ ACTIVE • PROCESSING 🚀
  │     ├─ QUEUED • WAITING ⏳
  │     ├─ FINISHED • COMPLETED ✅
  │     └─ STANDBY • IDLE 💤
  └─ Inline button: [🛑 Batalkan Sesi Ini] ATAU [💳 Retry Pay] ATAU [📋 Menu Utama]
```

---

## 🔧 13. Konfigurasi (`.env`)

| Key | Deskripsi |
|-----|-----------|
| `TELEGRAM_BOT_TOKEN` | Token bot Telegram |
| `ADMIN_ID` | Comma-separated admin Telegram user IDs |
| `MAX_THREADS` | Maksimum concurrent task (default: 5) |
| `DEBUG` | Enable debug logging (true/false) |
| `KOREA_PROXY_URL` | Proxy untuk checkout (Korea / DataImpulse) |
| `GENERAL_PROXY_URL` | Proxy untuk signup/login (Singapore / DataImpulse) |
| `OTP_SERVER_URL` | URL OTP Server VPS (`http://146.190.85.126:3000`) |

---

## ⚠️ Error Handling

| Error | Sumber | Aksi |
|-------|--------|------|
| `CF_CHALLENGE` | Cloudflare block | Retry dengan proxy baru |
| `unsupported_country` | OpenAI region block | Ganti proxy negara lain |
| `email conflict (409)` | Email sudah terdaftar | Retry |
| `Sentinel token not available` | Token generation fail | Retry |
| `OTP tidak diterima (LuckMail)` | Timeout 20 detik | `cancelEmail(purchaseId)` → refund |
| `GoPay Pool timeout` | Semua slot busy 10 menit | Gagal, task dihentikan |
| `checkout_amount_mismatch` | Akun sudah pernah trial | Gagal (no retry) |
| `GoPay sudah terhubung` | GoPay linked ke Midtrans lain | Autopay.js trigger unlink + webhook reset |
| `provider_decline` | GoPay menolak pembayaran | Tunggu / ganti nomor pool |
| `Akun not eligible` | Trial tidak tersedia | Gagal (no retry) |
| `LuckMail API error` | API LuckMail down | Retry 3x dengan delay 5 detik |
| `Order/token tidak ditemukan` | auto_loginpay tanpa riwayat order | Gagal, minta input ulang |

---

## 🔑 Dependencies Utama

| Package | Fungsi |
|---------|--------|
| `node-telegram-bot-api` | Telegram Bot API |
| `cycletls` | HTTP client dengan JA3/H2 TLS fingerprint |
| `puppeteer` + `stealth` | Headless browser (CF solver, sentinel) |
| `axios` + `tough-cookie` | HTTP client standar + cookie jar (LuckMail, GoPay pool) |
| `https-proxy-agent` | Proxy support |
| `uuid` | Generate deviceId, sessionId, dll |
| `dotenv` | Load .env config |
| `chalk` | Colorized console output |
| `async_hooks` | AsyncLocalStorage untuk tracking chatId per concurrent task |

---

## 🗺️ Mode Summary

| Mode | Trigger | Email Sumber | GoPay | OTP |
|------|---------|-------------|-------|-----|
| `signup` | Manual email | User input | Tidak perlu | Manual Telegram |
| `autopay` | Manual email | User input | Pool server | Manual Telegram |
| `login_autopay` | 🔑 Login Akun | User input | Pool server | Manual Telegram |
| `auto_signup` | 🤖 Auto Daftar | LuckMail API | Tidak perlu | Auto LuckMail |
| `auto_autopay` | 🤖 Auto Daftar (Batch) | LuckMail API | Pool server | Auto LuckMail |
| `auto_loginpay` | 🤖 Auto Daftar | User input (email lama) | Pool server | Auto LuckMail |
| `retry_autopay` | Tombol Retry Pay | accounts.json (cached) | Pool server | Auto/Manual |
