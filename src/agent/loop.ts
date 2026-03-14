import { askLLM } from './llm.js';
import fs from 'fs';
import { memory, MessageRecord } from './memory.js';
import { agentTools } from './tools.js';
import OpenAI from 'openai';

const MAX_ITERATIONS = 5;

async function summarizeLongText(text: string, userId: string, depth = 0): Promise<string> {
    const CHUNK_SIZE = 20000; // Increased chunk size for fewer calls
    if (text.length <= CHUNK_SIZE || depth > 1) return text; // Limit recursion

    console.log(`[Summary] Text too long (${text.length} chars) at depth ${depth}, chunking...`);
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += CHUNK_SIZE) {
        chunks.push(text.substring(i, i + CHUNK_SIZE));
    }

    const partialSummaries: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
        const prompt = `Extrae los puntos clave y detalles técnicos críticos de esta sección (${i+1}/${chunks.length}). 
        Mantén nombres de campos, reglas de negocio y acrónimos, pero sé MUY conciso.
        
        CONTENIDO:
        ${chunks[i]}`;
        
        try {
            const summaryMsg = await askLLM([{ role: 'user', content: prompt }]);
            partialSummaries.push(summaryMsg.content || '');
        } catch (e) {
            console.error(`[Summary Error] Piece ${i} failed, using raw substring.`, e);
            partialSummaries.push(chunks[i].substring(0, 1000) + '... [Error en resumen]');
        }
    }

    const aggregatedText = partialSummaries.join('\n\n');
    const AGGREGATE_THRESHOLD = 25000;
    if (aggregatedText.length > AGGREGATE_THRESHOLD && depth === 0) {
        console.log(`[Summary] Aggregate still long (${aggregatedText.length}), one final refinement...`);
        return summarizeLongText(aggregatedText, userId, depth + 1);
    }
    return aggregatedText;
}

export async function processUserMessage(userId: string, userPrompt: string, imageUrl?: string): Promise<string> {
  const MAX_INPUT_LENGTH_FOR_SUMMARY = 15000;
  let processedUserPrompt = userPrompt;
  if (userPrompt.length > MAX_INPUT_LENGTH_FOR_SUMMARY) {
    console.log(`[ProcessUserMessage] User input too long (${userPrompt.length} chars), summarizing...`);
    processedUserPrompt = await summarizeLongText(userPrompt, userId);
    console.log(`[ProcessUserMessage] Summarized input length: ${processedUserPrompt.length} chars.`);
  }

  await memory.addMessage(userId, 'user', processedUserPrompt, { imageUrl });

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const history = (await memory.getMessages(userId, 50)) as MessageRecord[];
    
    const openAIMessages: OpenAI.ChatCompletionMessageParam[] = history.map(msg => {
      if (msg.role === 'tool') {
        return {
          role: 'tool',
          content: msg.content,
          tool_call_id: msg.toolCallId!,
          name: msg.name || 'unknown_tool',
        } as OpenAI.ChatCompletionToolMessageParam;
      } else if (msg.role === 'assistant' && msg.toolCalls) {
        return {
          role: 'assistant',
          content: msg.content || null,
          tool_calls: JSON.parse(msg.toolCalls),
        } as OpenAI.ChatCompletionAssistantMessageParam;
      } else if (msg.role === 'system') {
        return {
          role: 'system',
          content: msg.content,
        } as OpenAI.ChatCompletionSystemMessageParam;
      }
      let content: any = msg.content;
      if (msg.imageUrl) {
        content = [
          { type: 'text', text: msg.content },
          { type: 'image_url', image_url: { url: msg.imageUrl } }
        ];
      }

      return {
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: content,
      } as OpenAI.ChatCompletionMessageParam;
    });

    let skillDoc = '';
    const skillsDir = './skills';
    if (fs.existsSync(skillsDir)) {
      const files = fs.readdirSync(skillsDir);
      for (const file of files) {
        if (file.endsWith('.md')) {
          skillDoc += fs.readFileSync(`${skillsDir}/${file}`, 'utf-8') + '\n\n';
        }
      }
    }

    const systemPrompt: OpenAI.ChatCompletionSystemMessageParam = {
      role: 'system',
      content: `Eres OpenGravity, un agente de IA personal avanzado que funciona localmente y usa Telegram como interfaz. Eres un agente que usa "tool calling" (llamadas a funciones) para interactuar con el mundo.

PERSONA EXPERTA Y PENSAMIENTO PROFUNDO:
Cuando el usuario te pida analizar documentos técnicos, código, o redactar un análisis funcional, DEBES asumir el rol de un **Arquitecto de Software Senior y Analista de Sistemas**. 
1. Piensa paso a paso y de manera profunda antes de responder.
2. Estructura siempre tus análisis funcionales con rigor profesional (Resumen Ejecutivo, Contexto, Requerimientos, Casos de Uso, Riesgos, Stack Técnico recomendado).
3. Asegúrate de que el documento sea **comprensible para humanos**; no te limites a listar datos, explica los flujos y la lógica de negocio con claridad narrativa.
4. **ESTRUCTURA BALANCEADA**: Utiliza tablas de Markdown cuando ayuden a organizar información de manera clara (como mapeos de campos, clasificaciones o glosarios). Sin embargo, para flujos de lógica de negocio complejos, prioriza la narrativa y listas que aseguren que el documento sea fácil de leer y entender.
5. No des respuestas superficiales; cuestiona, sugiere mejoras arquitectónicas y propón soluciones de ingeniería de alto nivel.
6. **OBLIGATORIO (FORMATO PREMIUM)**: NUNCA devuelvas el texto completo del análisis en el chat de Telegram. SIEMPRE utiliza la herramienta \`generate_google_doc\`. El argumento \`content\` de esta herramienta DEBE estar escrito en **HTML Profesional** (usando etiquetas como \`<h1>\`, \`<h2>\`, \`<p>\`, \`<ul>\`, y especialmente \`<table>\` con bordes para reglas de negocio). Esto es CRÍTICO para que Google Docs convierta el análisis en un documento con tablas reales, estilos elegantes y un aspecto profesional tipo "Excel/Corporativo".
   - Usa \`<table border="1" style="border-collapse: collapse; width: 100%;">\` para las tablas de datos.
   - Devuélvele al usuario únicamente el enlace al documento generado y un brevísimo resumen introductorio en el chat.

REGLAS DE IDIOMA Y VOZ:
1. El texto principal de tu respuesta SIEMPRE DEBE ESTAR EN ESPAÑOL.
2. Si te hablan en un idioma distinto, añade al final EXACTAMENTE este bloque (si NO es español):
===AUDIO:xx===
[Tu respuesta traducida al idioma original del usuario]

REGLAS ESTRICTAS DE HERRAMIENTAS (TOOL CALLING):
Tienes acceso a varias herramientas (functions). Para usarlas, DEBES emitir una llamada a la función (tool call) en formato JSON estricto.
¡PROHIBIDO! NUNCA digas al usuario "Usa este comando", ni le muestres código bash. TÚ ERES la máquina, TÚ DEBES invocar la herramienta internamente. Si tienes que hacer algo, HAZLO llamando a la herramienta, no diciendo cómo se hace.

¡ATENCIÓN! Cuando pases argumentos a las funciones, usa SOLO STRINGS VÁLIDOS EN JSON. ESTÁ TOTALMENTE PROHIBIDO usar sintaxis de código. Resuelve el string tú mismo antes de enviarlo. El argumento debe ser texto plano.

DOCUMENTACIÓN DE HABILIDADES (SKILLS) INSTALADAS:
${skillDoc}

REGLAS CRÍTICAS PARA CALENDARIO (LLAMANDO A LA HERRAMIENTA google_ecosystem):
1. ZONA HORARIA Y HORA ACTUAL: PRIMERO debes llamar a la herramienta \`get_current_time\` para saber qué día y hora es HOY y cuál es el desfase real. Usa las fechas exactas devueltas por esa herramienta para reemplazar \`--from\` y \`--to\`. Nunca uses "Z".
2. ACCIONES: Si el usuario pide crear, primero busca colisiones. Si te pide borrar, primero busca el ID. Luego, HAZ UNA TOOL CALL (llamada a función) con el comando necesario (ej. "calendar delete primary ID --force").
3. NO INVENTES: No inventes IDs ni nombres. Extrae todo estrictamente del resultado de las herramientas.`,
    };
    
    openAIMessages.unshift(systemPrompt);

    let completionMessage;
    try {
      completionMessage = await askLLM(openAIMessages);
    } catch (e: any) {
      console.error(`[ProcessUserMessage] LLM Failure: ${e.message}`);
      return `❌ Error: No he podido procesar tu mensaje debido a un límite de capacidad en los servidores de IA (Groq/OpenRouter). Por favor, intenta de nuevo en unos momentos o envía un mensaje más corto.\n\nDetalles: ${e.message}`;
    }

    if (completionMessage.tool_calls && completionMessage.tool_calls.length > 0) {
      await memory.addMessage(userId, 'assistant', completionMessage.content || '', {
        toolCalls: completionMessage.tool_calls,
      });

      for (const toolCall of completionMessage.tool_calls) {
        let toolResult = '';
        try {
          const tool = agentTools[toolCall.function.name];
          if (!tool) {
            toolResult = `Error: Tool ${toolCall.function.name} not found.`;
          } else {
            const args = toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {};
            const resolvedResult = await tool.execute(args);
            toolResult = typeof resolvedResult === 'string' ? resolvedResult : JSON.stringify(resolvedResult);
          }
        } catch (e: any) {
          toolResult = `Error executing tool: ${e.message}`;
        }
        
        await memory.addMessage(userId, 'tool', toolResult, {
          toolCallId: toolCall.id,
          name: toolCall.function.name,
        });
      }
    } else {
      const answer = completionMessage.content || '';
      await memory.addMessage(userId, 'assistant', answer);
      return answer;
    }
  }

  return "I reached my maximum thinking steps and had to stop.";
}
