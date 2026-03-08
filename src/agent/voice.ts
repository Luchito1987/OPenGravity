import axios from 'axios';
import FormData from 'form-data';
import { config } from '../config/env.js';
import * as googleTTS from 'google-tts-api';

export async function transcribeAudio(fileBuffer: Buffer, fileName: string): Promise<string> {
  const form = new FormData();
  form.append('file', fileBuffer, fileName);
  form.append('model', config.GROQ_TRANSCRIPTION_MODEL);

  const response = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', form, {
    headers: {
      ...form.getHeaders(),
      'Authorization': `Bearer ${config.GROQ_API_KEY}`,
    },
  });

  return response.data.text;
}

export async function textToSpeech(text: string, lang: string = 'es'): Promise<Buffer> {
  try {
    // google-tts-api has a 200 character limit per request, 
    // but getAudioUrl can handle chunking or we just take the first part of short messages
    // To keep it simple and free for Telegram bot usage without complex ElevenLabs keys:
    
    // 1. Chunk text if necessary
    const lines = text.match(/.{1,200}(?:[ \n\r\t.,!?'"-]+|$)/g) || [text];
    
    // 2. Fetch Base64 audio for all chunks
    const base64Audios = await Promise.all(
       lines.map(line => googleTTS.getAudioBase64(line, {
           lang: lang,
           slow: false,
           host: 'https://translate.google.com'
       }))
    );

    // 3. Concatenate all base64 string buffers together 
    const buffers = base64Audios.map(b64 => Buffer.from(b64, 'base64'));
    return Buffer.concat(buffers);

  } catch (err: any) {
    console.error(`[Google TTS ERROR] ${err.message}`);
    throw err;
  }
}
