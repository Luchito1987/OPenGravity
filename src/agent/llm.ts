import OpenAI from 'openai';
import { config } from '../config/env.js';
import { agentTools } from './tools.js';

const groqClient = new OpenAI({
  apiKey: config.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

const openRouterClient = new OpenAI({
  apiKey: config.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
});

const openAITools: OpenAI.ChatCompletionTool[] = Object.values(agentTools).map((t) => ({
  type: 'function',
  function: {
    name: t.name,
    description: t.description,
    parameters: t.parameters as unknown as Record<string, unknown>,
  },
}));

export async function askLLM(messages: OpenAI.ChatCompletionMessageParam[]) {
  try {
    const hasImage = messages.some(m => 
      Array.isArray(m.content) && m.content.some((c: any) => c.type === 'image_url')
    );
    
    const model = hasImage ? config.GROQ_VISION_MODEL : config.GROQ_MODEL;

    const response = await groqClient.chat.completions.create({
      model: model,
      messages: messages,
      tools: openAITools.length > 0 ? openAITools : undefined,
      tool_choice: openAITools.length > 0 ? 'auto' : undefined,
    });
    return response.choices[0].message;
  } catch (error: any) {
    console.warn(`[LLM] Groq error: ${error?.status} - ${error?.message || error}`);
    if (error?.status === 429 || error?.code === 'rate_limit_exceeded' || error?.status === 413) {
      console.warn('[Fallback] Falling back to OpenRouter...');
      if (!config.OPENROUTER_API_KEY || config.OPENROUTER_API_KEY === 'SUTITUYE POR EL TUYO') {
        throw new Error('Groq limit/size exceeded and OPENROUTER_API_KEY is not configured.');
      }
      const fallbackModels = [
        'meta-llama/llama-3.3-70b-instruct:free',
        'google/gemini-2.0-flash-lite-preview-02-05:free',
        'google/gemini-2.0-pro-exp-02-05:free',
        'deepseek/deepseek-r1:free',
        'mistralai/mistral-7b-instruct:free',
        'qwen/qwen-2.5-72b-instruct:free',
        'nvidia/nemotron-4-340b-instruct:free',
        'google/gemini-2.0-flash-exp:free'
      ];
      
      let lastError: any;
      for (const fModel of [...new Set(fallbackModels)]) {
         try {
           console.warn(`[Fallback] Trying OpenRouter model: ${fModel}`);
           const response = await openRouterClient.chat.completions.create({
             model: fModel,
             messages: messages,
             tools: openAITools.length > 0 ? openAITools : undefined,
             tool_choice: openAITools.length > 0 ? 'auto' : undefined,
           });
           return response.choices[0].message;
         } catch (e: any) {
           console.warn(`[Fallback] Model ${fModel} failed: ${e.message}`);
           lastError = e;
         }
      }
      throw new Error(`All OpenRouter fallback models exhausted. Last error: ${lastError?.message || 'Unknown'}`);
    }
    throw error;
  }
}

export async function analyzeImage(base64Image: string, mimeType: string): Promise<string> {
  try {
    const response = await openRouterClient.chat.completions.create({
      model: 'meta-llama/llama-3.2-11b-vision-instruct:free',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe in detail what you see in this image from a functional and technical perspective. If it is a diagram, flowchart, or table, extract all relevant information precisely.' },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } }
          ]
        }
      ]
    });
    return response.choices[0].message?.content || '[No description generated]';
  } catch (e: any) {
    console.warn(`[Vision LLM Error] ${e.message}`);
    return `[Error analyzing image: ${e.message}]`;
  }
}
