const fs = require('fs');
const readline = require('readline');
const { google } = require('googleapis');
const open = (...args) => import('open').then(module => module.default(...args));
const dotenv = require('dotenv');
const cron = require('node-cron');
const axios = require('axios');

dotenv.config();

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
const TOKEN_JSON = 'token.json';
const TOKEN_BASE64 = 'token.base64';
const CREDENTIALS_TXT = 'credentials.txt';
const CREDENTIALS_JSON = 'credentials.json';

// Decode credentials.txt → credentials.json if needed
if (!fs.existsSync(CREDENTIALS_JSON) && fs.existsSync(CREDENTIALS_TXT)) {
  const base64 = fs.readFileSync(CREDENTIALS_TXT, 'utf8');
  const json = Buffer.from(base64, 'base64').toString('utf8');
  fs.writeFileSync(CREDENTIALS_JSON, json);
  console.log('🛠️ Decoded credentials.txt → credentials.json');
}

// Decode token.base64 → token.json if needed
if (!fs.existsSync(TOKEN_JSON) && fs.existsSync(TOKEN_BASE64)) {
  const base64 = fs.readFileSync(TOKEN_BASE64, 'utf8');
  const json = Buffer.from(base64, 'base64').toString('utf8');
  fs.writeFileSync(TOKEN_JSON, json);
  console.log('🛠️ Decoded token.base64 → token.json');
}

function authorize(callback) {
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_JSON));
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  if (fs.existsSync(TOKEN_JSON)) {
    oAuth2Client.setCredentials(JSON.parse(fs.readFileSync(TOKEN_JSON)));
    callback(oAuth2Client);
  } else {
    getNewToken(oAuth2Client, callback);
  }
}

function getNewToken(oAuth2Client, callback) {
  const authUrl = oAuth2Client.generateAuthUrl({ access_type: 'offline', scope: SCOPES });
  console.log('🔐 Authorize this app by visiting this URL:', authUrl);
  open(authUrl);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('Enter the code from the page: ', (code) => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
      if (err) return console.error('❌ Error retrieving token', err);
      oAuth2Client.setCredentials(token);
      fs.writeFileSync(TOKEN_JSON, JSON.stringify(token));
      console.log('✅ Token stored to', TOKEN_JSON);

      // Optional: auto encode to token.base64 (for pushing to GitHub safely)
      const encoded = Buffer.from(JSON.stringify(token)).toString('base64');
      fs.writeFileSync(TOKEN_BASE64, encoded);
      console.log('📦 Encoded token.json → token.base64');

      callback(oAuth2Client);
    });
  });
}

function checkEmails(auth) {
  const gmail = google.gmail({ version: 'v1', auth });
  gmail.users.messages.list(
    { userId: 'me', q: 'is:unread', maxResults: 10 },
    async (err, res) => {
      if (err) return console.error('📬 API error:', err);
      const messages = res.data.messages || [];

      for (const msg of messages) {
        const msgData = await gmail.users.messages.get({ userId: 'me', id: msg.id });
        const snippet = msgData.data.snippet.toLowerCase();
        const subjectHeader = msgData.data.payload.headers.find((h) => h.name === 'Subject');
        const subject = subjectHeader ? subjectHeader.value.toLowerCase() : '';

        const keywords = process.env.KEYWORDS.split(',').map(k => k.trim().toLowerCase());
        const matched = keywords.some(kw => snippet.includes(kw) || subject.includes(kw));

        if (matched) {
          await sendTelegramNotification(subject, msg.id);
        }
      }
    }
  );
}

async function sendTelegramNotification(subject, messageId) {
  const gmailLink = `https://mail.google.com/mail/u/0/#inbox/${messageId}`;
  const msg = `📧 *New Email Matched Keyword!*\n*Subject:* ${subject}\n🔗 [Open Email](${gmailLink})`;

  await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    chat_id: process.env.TELEGRAM_CHAT_ID,
    text: msg,
    parse_mode: 'Markdown',
  });

  console.log('✅ Telegram alert with link sent');
}

// 🔁 Daily at 9AM — change timing if needed
cron.schedule('0 9 * * *', () => {
  console.log('🕘 Cron Triggered - Checking emails...');
  authorize(checkEmails);
});

// ⏱️ Initial run for testing
authorize(checkEmails);
