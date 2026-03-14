// Cloud Firestore Enabled
import { Bot } from 'grammy';
import { config } from './config/env.js';
import { processUserMessage } from './agent/loop.js';
import { memory } from './agent/memory.js';
import { transcribeAudio, textToSpeech } from './agent/voice.js';
import { InputFile } from 'grammy';
import axios from 'axios';

if (!config.TELEGRAM_BOT_TOKEN || config.TELEGRAM_BOT_TOKEN === 'SUTITUYE POR EL TUYO') {
  console.error('[ERROR] TELEGRAM_BOT_TOKEN is missing or default. Please check your .env file.');
  process.exit(1);
}

const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

bot.use(async (ctx, next) => {
  const userId = ctx.from?.id.toString();
  if (!userId || !config.TELEGRAM_ALLOWED_USER_IDS.includes(userId)) {
    console.warn(`[AUTH] Rejected access from user ID: ${userId}`);
    return;
  }
  await next();
});

bot.command('start', async (ctx) => {
  const userId = ctx.from!.id.toString();
  await memory.clearMemory(userId);
  await ctx.reply('Hello! I am OpenGravity. My memory has been reset and I am ready to help you.');
});

bot.command('clear', async (ctx) => {
  const userId = ctx.from!.id.toString();
  await memory.clearMemory(userId);
  await ctx.reply('Memory cleared. What would you like to do next?');
});

bot.on('message:text', async (ctx) => {
  const userId = ctx.from.id.toString();
  const text = ctx.message.text;
  await handleUserMessage(ctx, userId, text, false);
});

bot.on('message:photo', async (ctx) => {
  const userId = ctx.from.id.toString();
  const caption = ctx.message.caption ? ` con el mensaje: ${ctx.message.caption}` : "[He enviado una foto/captura de pantalla]";
  
  await ctx.api.sendChatAction(ctx.chat.id, 'typing');
  
  try {
    const file = await ctx.getFile();
    const fileUrl = `https://api.telegram.org/file/bot${config.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data);
    const base64 = buffer.toString('base64');
    const mimeType = file.file_path?.endsWith('png') ? 'image/png' : 'image/jpeg';
    const dataUrl = `data:${mimeType};base64,${base64}`;
    
    await handleUserMessage(ctx, userId, caption, false, dataUrl);
  } catch (error: any) {
    console.error(`[PHOTO ERROR]`, error);
    await handleUserMessage(ctx, userId, caption, false);
  }
});

import { parseDocument } from './agent/document_parser.js';
import { analyzeImage } from './agent/llm.js';

// ... (in the middle of the file) We need to do it at the exact location. I'll just replace the specific listener and assume import can go above it for simplicity, or I can replace a bigger chunk.
// Character limits are now handled dynamically by the loop synthesizer.

bot.on('message:document', async (ctx) => {
  const userId = ctx.from.id.toString();
  const caption = ctx.message.caption || '';
  
  await ctx.api.sendChatAction(ctx.chat.id, 'typing');
  
  try {
    const file = await ctx.getFile();
    const fileUrl = `https://api.telegram.org/file/bot${config.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    const mimeType = ctx.message.document.mime_type || '';
    const fileName = ctx.message.document.file_name || '';
    
    await ctx.reply(`[Analizando documento completo e imágenes: ${fileName}...]`);
    const docParts = await parseDocument(fileUrl, mimeType, fileName);
    
    // Filter parts
    const textParts = docParts.filter(p => p.type === 'text');
    const imageParts = docParts.filter(p => p.type === 'image');

    if (imageParts.length > 0) {
        await ctx.reply(`[Detectadas ${imageParts.length} imágenes. Procesando visión...]`);
    }

    // Process Images in Parallel (Vision to Text)
    const imageDescriptions = await Promise.all(
        imageParts.map(async (part, idx) => {
            try {
                return await analyzeImage(part.content, part.mimeType || 'image/png');
            } catch (e) {
                return `[Error en imagen ${idx}]`;
            }
        })
    );

    let synthesizedDoc = textParts.map(p => p.content).join('\n');
    if (imageDescriptions.length > 0) {
        synthesizedDoc += '\n\n### ANEXO: DESCRIPCIÓN DE ELEMENTOS VISUALES DETECTADOS\n';
        imageDescriptions.forEach((desc, idx) => {
            synthesizedDoc += `\n[ELEMENTO VISUAL ${idx + 1}]: ${desc}\n`;
        });
    }

    // Now handled multi-part processing if too long
    const finalPrompt = `CAPTION DEL USUARIO: ${caption}\n\n[CONTENIDO INTEGRAL DEL DOCUMENTO]\n${synthesizedDoc}`;
    
    await handleUserMessage(ctx, userId, finalPrompt, false);
  } catch (error: any) {
    if (error.message && error.message.includes('file is too big')) {
        await ctx.reply('❌ Error: El documento es demasiado grande. Telegram sólo permite a los bots descargar archivos de hasta 20MB.');
    } else {
        console.error(`[DOCUMENT ERROR]`, error);
        await ctx.reply(`❌ Error procesando documento: No pude extraer el texto. Verifica que sea un PDF, DOCX, XLSX válido o que no esté dañado.`);
    }
  }
});

bot.on('message:voice', async (ctx) => {
  const userId = ctx.from.id.toString();
  const voice = ctx.message.voice;

  await ctx.api.sendChatAction(ctx.chat.id, 'record_voice');

  try {
    const file = await ctx.getFile();
    const fileUrl = `https://api.telegram.org/file/bot${config.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    
    const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data);
    
    // Transcribe
    const transcription = await transcribeAudio(buffer, 'voice.ogg');
    console.log(`[Voice] Transcribed: ${transcription}`);
    
    await handleUserMessage(ctx, userId, transcription, true);
  } catch (error: any) {
    console.error(`[VOICE ERROR FULL DUMP]`, error);
    await ctx.reply('Sorry, I couldn\'t process your voice message.');
  }
});

async function handleUserMessage(ctx: any, userId: string, text: string, isVoice: boolean, imageUrl?: string) {
  try {
    await ctx.api.sendChatAction(ctx.chat.id, isVoice ? 'record_voice' : 'typing');
    const response = await processUserMessage(userId, text, imageUrl);

    let displayText = response;
    let audioText = response;
    let audioLang = 'es';

    // Parse audio block if it exists
    const audioMatch = response.match(/===AUDIO:([a-zA-Z]{2})===([\s\S]*)$/);
    if (audioMatch) {
      audioLang = audioMatch[1].toLowerCase();
      audioText = audioMatch[2].trim();
      // Remove the block from display text
      displayText = response.replace(audioMatch[0], '').trim();
    }

    if (isVoice) {
      // Send text response first
      await ctx.reply(displayText);
      
      try {
        const audioBuffer = await textToSpeech(audioText, audioLang);
        await ctx.replyWithVoice(new InputFile(audioBuffer, 'response.mp3'));
      } catch (ttsError: any) {
        console.error(`[TTS ERROR] ${ttsError.message}`);
      }
    } else {
      if (displayText.length > 4000) {
        for (let i = 0; i < displayText.length; i += 4000) {
          await ctx.reply(displayText.substring(i, i + 4000));
        }
      } else {
        await ctx.reply(displayText);
      }
    }
  } catch (error: any) {
    console.error(`[AGENT ERROR FULL DUMP]`, error);
    await ctx.reply('Sorry, I encountered an error while processing your request.');
  }
}

import http from 'http';
import { webhookCallback } from 'grammy';

bot.catch((err) => {
  console.error('[BOT ERROR]', err);
});

// Start bot
if (config.WEBHOOK_URL) {
  const handler = webhookCallback(bot, 'http');
  const server = http.createServer((req, res) => {
    // Health check for non-POST or empty updates
    if (req.method !== 'POST' || req.headers['content-length'] === '0') {
      res.writeHead(200);
      res.end('Bot is running! (Listening for webhooks)');
      return;
    }
    handler(req, res);
  });
  const port = config.PORT || 3000;
  server.listen(port, async () => {
    console.log(`[Bot] Running via Webhook on port ${port}`);
    try {
      await bot.api.setWebhook(config.WEBHOOK_URL);
      console.log(`[Bot] Webhook set to: ${config.WEBHOOK_URL}`);
    } catch (e) {
      console.error(`[Bot] Failed to set webhook:`, e);
    }
  });
} else {
  console.log('[Bot] Starting OpenGravity telegram bot via Long Polling...');
  bot.start({
    onStart: (me) => {
      console.log(`[Bot] @${me.username} is online!`);
    },
  });
}
