const { google } = require('googleapis');
const dotenv = require('dotenv');
const cron = require('node-cron');
const axios = require('axios');

dotenv.config();

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

function createOAuthClient() {
  const oAuth2Client = new google.auth.OAuth2(
    process.env.CLIENT_ID,
    process.env.CLIENT_SECRET,
    process.env.REDIRECT_URI
  );

  oAuth2Client.setCredentials({
    access_token: process.env.ACCESS_TOKEN,
    refresh_token: process.env.REFRESH_TOKEN,
    scope: process.env.SCOPE,
    token_type: process.env.TOKEN_TYPE,
  });

  return oAuth2Client;
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

// 🔁 Schedule: daily at 9 AM
cron.schedule('0 9 * * *', () => {
  console.log('🕘 Cron Triggered - Checking emails...');
  const auth = createOAuthClient();
  checkEmails(auth);
});

// ⏱️ Initial trigger
const auth = createOAuthClient();
checkEmails(auth);
