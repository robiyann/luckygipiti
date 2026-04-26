const axios = require('axios');

async function test() {
    try {
        // Fetch all tokens from DB
        const Database = require('better-sqlite3');
        const db = new Database('C:/Users/Administrator/Documents/bot/cf-mail server/db/mail.db');
        const rows = db.prepare('SELECT address, token FROM api_tokens ORDER BY created_at DESC LIMIT 5').all();
        
        for (let row of rows) {
            console.log(`Checking token ${row.token} for ${row.address}`);
            
            try {
                // query /token/:token
                const res = await axios.get(`http://127.0.0.1:3721/api/mailboxes/token/${row.token}`);
                console.log(`   /token/:token found ${res.data.count} emails`);
                
                // query /token/:token/otp
                const otpRes = await axios.get(`http://127.0.0.1:3721/api/mailboxes/token/${row.token}/otp?service=openai`);
                console.log(`   /token/:token/otp SUCCESS:`, otpRes.data);
            } catch (err) {
                if (err.response && err.response.status === 404) {
                    console.log(`   /token/:token/otp FAILED: 404 ${err.response.data.error || ''}`);
                } else {
                    console.log(`   Error:`, err.message);
                }
            }
        }
    } catch (err) {
        console.error(err);
    }
}
test();
