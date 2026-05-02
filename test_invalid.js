require('dotenv').config();
const ChatGPTSignup = require('./src/signup.js');

async function checkEmailRegistration(emailToCheck) {
    console.log(`\n[Checker] Checking registration status for: ${emailToCheck}`);
    
    const signup = new ChatGPTSignup({
        email: emailToCheck,
        password: "TemporaryPassword123!",
        name: "Checker User",
        birthdate: "1990-01-01",
        clientId: "pdlLp2NdGLTSUcdH2v2R1A",
        redirectUri: "com.openai.chat://auth0.openai.com/ios/com.openai.chat/callback",
        audience: "https://api.openai.com/v1",
        threadId: "CHECK",
        proxyUrl: process.env.GENERAL_PROXY_URL,
        signupRetries: 1,
        // Kita beri dummy otpFn agar tidak crash saat minta kode
        otpFn: async () => {
            console.log("   (OTP requested, aborting check since we reached this stage)");
            throw new Error("CHECK_REACHED_OTP");
        }
    });

    try {
        const result = await signup.runSignup();
        console.log("\n=== RAW RESPONSE (FINAL) ===");
        console.log(JSON.stringify(result, null, 2));
    } catch (e) {
        // Jika errornya dari dummy otpFn, berarti register tadi SUKSES
        if (e.message === "CHECK_REACHED_OTP") {
            console.log("\n=== REGISTER SUCCESS (RAW) ===");
            console.log("Status: 200/201 OK");
            console.log("Body: {} (OpenAI returns empty object on successful register step)");
        } else {
            console.log("\n=== ERROR RESPONSE (RAW) ===");
            console.log(e.message);
        }
    }
}

const targetEmail = "hubang@hubanshj.my.id";
checkEmailRegistration(targetEmail).catch(console.error);
