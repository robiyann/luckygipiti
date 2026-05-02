require('dotenv').config();
const ChatGPTAutopay = require('./src/autopay.js');

async function testLogin(email, password) {
    console.log(`\n[Login Test] Attempting to login with: ${email}`);
    
    const autopay = new ChatGPTAutopay({
        email: email,
        password: password,
        threadId: "LOGIN_TEST",
        proxyUrl: process.env.GENERAL_PROXY_URL
    });

    try {
        // Kita coba login. Jika gagal karena belum terdaftar, biasanya return 401 atau throw error khusus.
        const result = await autopay.loginToChatGPT();
        console.log("\n=== LOGIN RESULT ===");
        console.log("Success:", result);
    } catch (e) {
        console.log("\n=== LOGIN FAILED (RAW) ===");
        console.log(e.message);
        
        if (e.message.includes("401") || e.message.toLowerCase().includes("unauthorized") || e.message.toLowerCase().includes("wrong email or password")) {
            console.log("\n👉 ANALISIS: Akun ini mungkin sudah terdaftar tapi password salah, ATAU email ini belum menyelesaikan tahap pendaftaran (OTP) sehingga belum ada password-nya.");
        } else if (e.message.toLowerCase().includes("user does not exist")) {
            console.log("\n👉 ANALISIS: OpenAI mengonfirmasi email ini benar-benar BELUM memiliki akun.");
        }
    }
}

// Gunakan email yang tadi kita test regist
const targetEmail = "hubang@hubanshj.my.id";
const targetPassword = "TemporaryPassword123!"; // Password yang kita kirim saat test regist tadi

testLogin(targetEmail, targetPassword).catch(console.error);
