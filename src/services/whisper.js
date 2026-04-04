const OpenAI = require('openai');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Transcribe a voice message from a URL (Twilio media URL).
 * Downloads the file temporarily, sends to Whisper API, returns text.
 */
async function transcribeVoiceMessage(mediaUrl, authHeader = null) {
  // Download the audio file from Twilio (requires auth)
  const headers = authHeader ? { Authorization: authHeader } : {};

  // Use basic auth for Twilio media URLs
  const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioAuthToken  = process.env.TWILIO_AUTH_TOKEN;
  const auth = Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString('base64');

  const response = await axios.get(mediaUrl, {
    responseType: 'arraybuffer',
    headers: { Authorization: `Basic ${auth}` }
  });

  // Save to a temp file (Whisper needs a file, not a buffer)
  const tmpFile = path.join(os.tmpdir(), `kharcha_voice_${Date.now()}.ogg`);
  fs.writeFileSync(tmpFile, Buffer.from(response.data));

  try {
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpFile),
      model: 'whisper-1',
      language: 'hi', // Hint: Hindi — Whisper handles mixed Hindi/English well
      response_format: 'text'
    });

    return transcription.trim();
  } finally {
    // Clean up temp file
    try { fs.unlinkSync(tmpFile); } catch (_) {}
  }
}

module.exports = { transcribeVoiceMessage };
