const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

async function testProxy() {
    // New proxy from user's curl
    const proxyUrl = 'http://heboys21_custom_zone_GLOBAL_sid_65992597_time_10:KrisnaR1@us.swiftproxy.net:7878';
    const agent = new HttpsProxyAgent(proxyUrl);

    console.log('--- Testing New Proxy ---');
    console.log('Proxy URL:', proxyUrl);

    try {
        console.log('\n1. Testing connectivity to ipinfo.io...');
        const resIp = await axios.get('https://ipinfo.io/json', { 
            httpsAgent: agent, 
            proxy: false,
            timeout: 15000 
        });
        console.log('Status:', resIp.status);
        console.log('IP Data:', JSON.stringify(resIp.data, null, 2));
    } catch (err) {
        console.error('Error at ipinfo.io:', err.response ? `${err.response.status} ${JSON.stringify(err.response.data)}` : err.message);
    }

    try {
        console.log('\n2. Testing connectivity to api.stripe.com...');
        const resStripe = await axios.get('https://api.stripe.com/v1/payment_methods', { 
            httpsAgent: agent, 
            proxy: false,
            timeout: 15000 
        });
        console.log('Status:', resStripe.status);
    } catch (err) {
        if (err.response) {
            console.log('Status (Expected 401):', err.response.status);
        } else {
            console.error('Error at stripe:', err.message);
        }
    }
}

testProxy();
