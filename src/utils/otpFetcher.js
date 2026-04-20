const logger = require("./logger");

function extractOtpFromSubject(a = "") {
  const b = [
    /your\s+chatgpt\s+code\s+is\s*(\d{6})/i,
    /chatgpt\s+code\s+is\s*(\d{6})/i,
    /\b(\d{6})\b/,
  ];
  for (const c of b) {
    const d = String(a)["match"](c);
    if (d && d[0x1]) {
      return d[0x1];
    }
  }
  return null;
}

function extractOtpFromBody(a = "") {
  const b = [
    /verification code[\s\S]{0,200}?(\d{6})/i,
    /your\s+chatgpt\s+code\s+is\s*(\d{6})/i,
    />\s*(\d{6})\s*</,
  ];
  for (const c of b) {
    const d = String(a)["match"](c);
    if (d && d[0x1]) {
      return d[0x1];
    }
  }
  return null;
}

/**
 * Stripped down version of otpFetcher. 
 * Since project is now manual-only, we mainly care about these utilities
 * if the user ever wants to revert or use external mail polling.
 */
async function fetchOtpWithRetry(email, config, retries = 30, delay = 5000) {
  logger.warn("Automated OTP fetching is disabled. Use manual mode.");
  return null;
}

module.exports = {
  extractOtpFromSubject,
  extractOtpFromBody,
  fetchOtpWithRetry
};
