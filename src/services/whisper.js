const OpenAI = require('openai');
const axios  = require('axios');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Transcribe a voice message from a Twilio media URL.
 * Downloads with Twilio Basic Auth → sends to OpenAI Whisper → returns text.
 *
 * WhatsApp sends voice as audio/ogg (OPUS codec).
 * Whisper supports: mp3, mp4, mpeg, mpga, m4a, wav, webm, ogg
 */
async function transcribeVoiceMessage(mediaUrl) {
  const accountSid  = process.env.TWILIO_ACCOUNT_SID;
  const authToken   = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    throw new Error('Twilio credentials not configured');
  }

  // ── Download audio from Twilio (requires Basic Auth) ──
  let audioBuffer;
  let contentType = 'audio/ogg';

  try {
    const response = await axios.get(mediaUrl, {
      responseType: 'arraybuffer',
      timeout:      20000,           // 20 second timeout
      auth: {
        username: accountSid,
        password: authToken
      }
    });
    audioBuffer  = Buffer.from(response.data);
    contentType  = response.headers['content-type'] || 'audio/ogg';
  } catch (err) {
    console.error('[Whisper] Audio download failed:', err.message);
    throw new Error('Audio download failed');
  }

  // ── Determine file extension from content-type ──
  // Whisper identifies format by file extension
  let ext = '.ogg';
  if (contentType.includes('mp4') || contentType.includes('m4a')) ext = '.m4a';
  else if (contentType.includes('mpeg') || contentType.includes('mp3')) ext = '.mp3';
  else if (contentType.includes('webm')) ext = '.webm';
  else if (contentType.includes('wav'))  ext = '.wav';
  // Default: .ogg works for WhatsApp voice notes (ogg/opus)

  // ── Save to temp file ──
  const tmpFile = path.join(os.tmpdir(), `kharcha_voice_${Date.now()}${ext}`);
  fs.writeFileSync(tmpFile, audioBuffer);

  console.log(`[Whisper] Audio saved: ${tmpFile} (${audioBuffer.length} bytes, ${contentType})`);

  try {
    // ── Transcribe with Whisper ──
    const transcription = await openai.audio.transcriptions.create({
      file:            fs.createReadStream(tmpFile),
      model:           'whisper-1',
      language:        'hi',          // Hindi hint — handles Hinglish well
      response_format: 'text',
      prompt:          'KharchaAI expense tracker. User may say amounts in rupees, Hindi numbers (ek, do, teen, sau, hazaar), or Hinglish.'
    });

    const text = typeof transcription === 'string'
      ? transcription.trim()
      : (transcription.text || '').trim();

    console.log(`[Whisper] Transcribed: "${text}"`);
    return text;

  } catch (err) {
    console.error('[Whisper] OpenAI transcription failed:', err.message);
    throw new Error('Transcription failed');
  } finally {
    // Always clean up temp file
    try { fs.unlinkSync(tmpFile); } catch (_) {}
  }
}

module.exports = { transcribeVoiceMessage };
