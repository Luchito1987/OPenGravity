export type ToolDef = {
  name: string;
  description: string;
  parameters: object;
  execute: (args: any) => Promise<string> | string;
};

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const agentTools: Record<string, ToolDef> = {
  get_current_time: {
    name: 'get_current_time',
    description: 'Returns the current server local time, date, and timezone offset. Very important for Calendar events scheduling.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    execute: () => {
      const now = new Date();
      return JSON.stringify({
        iso: now.toISOString(),
        localStr: now.toString(),
        timezoneOffset: now.getTimezoneOffset()
      });
    },
  },
  google_ecosystem: {
    name: 'google_ecosystem',
    description: 'Executes commands using the gog CLI to interact with Google Workspace (Calendar, Gmail, Drive, Docs, Sheets). Only use exactly as described in SKILL.md. Prefer --json flag for parseable output.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The gog CLI command to execute, excluding the "gog" prefix. E.g. "calendar events primary --from 2024-01-01T00:00:00Z --to 2024-01-02T00:00:00Z --json"',
        },
      },
      required: ['command'],
    },
    execute: async (args: any) => {
      try {
        const { stdout, stderr } = await execAsync(`/home/luciano/.local/bin/gog ${args.command}`);
        if (stderr && stderr.trim() !== '') {
           return `Warning/Error output: ${stderr}\nStandard output: ${stdout}`;
        }
        return stdout;
      } catch (error: any) {
        return `Execution failed: ${error.message}\nOutput: ${error.stdout}\nError Output: ${error.stderr}`;
      }
    },
  },
  search_skills: {
    name: 'search_skills',
    description: 'Searches for AI skills in the prompts.chat marketplace. Use this when the user asks to find, look up, or search for a skill.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query (e.g. "automation", "review", etc.).'
        }
      },
      required: ['query']
    },
    execute: async (args: any) => {
      try {
        const fetchFn = (typeof fetch !== 'undefined') ? fetch : (await import('node-fetch')).default;
        const res = await fetchFn('https://raw.githubusercontent.com/f/prompts.chat/main/plugins/claude/prompts.chat/skills/index.json');
        if (!res.ok) return 'Error fetching skills index.';
        const data = await res.json() as any;
        const query = args.query.toLowerCase();
        const results = data.skills.filter((s: any) => s.name.toLowerCase().includes(query) || s.description.toLowerCase().includes(query));
        return JSON.stringify(results.slice(0, 10));
      } catch (e: any) {
        return `Error searching skills: ${e.message}`;
      }
    }
  },
  install_skill: {
    name: 'install_skill',
    description: 'Installs a skill by its exact name from the prompts.chat marketplace. Use this when the user asks to install a skill.',
    parameters: {
      type: 'object',
      properties: {
        skill_name: {
          type: 'string',
          description: 'The exact name of the skill to install (e.g. "skill-lookup").'
        }
      },
      required: ['skill_name']
    },
    execute: async (args: any) => {
      try {
        const fetchFn = (typeof fetch !== 'undefined') ? fetch : (await import('node-fetch')).default;
        const url = `https://raw.githubusercontent.com/f/prompts.chat/main/plugins/claude/prompts.chat/skills/${args.skill_name}/SKILL.md`;
        const res = await fetchFn(url);
        if (!res.ok) return `Error: Skill ${args.skill_name} not found or failed to fetch.`;
        const content = await res.text();
        const fs = await import('fs');
        if (!fs.existsSync('./skills')) {
          fs.mkdirSync('./skills', { recursive: true });
        }
        fs.writeFileSync(`./skills/${args.skill_name}.md`, content, 'utf-8');
        return `Successfully installed skill: ${args.skill_name}.`;
      } catch (e: any) {
        return `Error installing skill: ${e.message}`;
      }
    }
  },
  web_search: {
    name: 'web_search',
    description: 'Searches the internet for real-time information (news, current events, cryptocurrency prices, weather) using DuckDuckGo. Returns a list of search results with URLs and snippets.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query (e.g. "bitcoin price today", "weather in tokyo").'
        }
      },
      required: ['query']
    },
    execute: async (args: any) => {
      try {
        const fetchFn = (typeof fetch !== 'undefined') ? fetch : (await import('node-fetch')).default;
        const cheerio = await import('cheerio');
        
        const params = new URLSearchParams();
        params.append('q', args.query);
        params.append('kl', '');

        const response = await fetchFn('https://html.duckduckgo.com/html/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'
          },
          body: params.toString()
        });

        const html = await response.text();
        const $ = cheerio.load(html);
        
        const results: any[] = [];
        $('.result').each((i: any, el: any) => {
          const title = $(el).find('.result__title .result__a').text().trim();
          const snippet = $(el).find('.result__snippet').text().trim();
          const url = $(el).find('.result__url').attr('href')?.trim();
          if (title && url) {
            results.push({ title, snippet, url });
          }
        });

        return JSON.stringify(results.slice(0, 5));
      } catch (e: any) {
        return `Error executing web search: ${e.message}`;
      }
    }
  },
  fetch_webpage: {
    name: 'fetch_webpage',
    description: 'Reads the text content of a specific URL. Useful for opening web links found via web_search to read the full article.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The absolute URL of the webpage to read (e.g. "https://en.wikipedia.org/wiki/Bitcoin").'
        }
      },
      required: ['url']
    },
    execute: async (args: any) => {
      try {
         const fetchFn = (typeof fetch !== 'undefined') ? fetch : (await import('node-fetch')).default;
         const cheerio = await import('cheerio');
         
         const res = await fetchFn(args.url, {
           headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/114.0.0.0 Safari/537.36' }
         });
         const html = await res.text();
         const $ = cheerio.load(html);
         
         $('script, style, nav, footer, iframe, img').remove();
         const text = $('body').text().replace(/\\s+/g, ' ').trim();
         
         return text.slice(0, 5000) + (text.length > 5000 ? '... [Truncated]' : '');
      } catch (e: any) {
        return `Error fetching webpage: ${e.message}`;
      }
    }
  },
  generate_google_doc: {
    name: 'generate_google_doc',
    description: 'Creates a new Google Doc from text/markdown content. Use this to generate the final Functional Analysis or any other requested document.',
    parameters: {
       type: 'object',
       properties: {
         title: { type: 'string', description: 'The title of the Google Doc to create.' },
         content: { type: 'string', description: 'The full markdown or text content of the document.' }
       },
       required: ['title', 'content']
    },
    execute: async (args: any) => {
      try {
        const { google } = await import('googleapis');
        const { config } = await import('../config/env.js');
        
          const authOptions: any = {
            scopes: [
              'https://www.googleapis.com/auth/drive.file',
              'https://www.googleapis.com/auth/documents'
            ],
          };

          if (config.GOOGLE_SERVICE_ACCOUNT_JSON) {
            authOptions.credentials = JSON.parse(config.GOOGLE_SERVICE_ACCOUNT_JSON);
          } else {
            authOptions.keyFile = config.GOOGLE_APPLICATION_CREDENTIALS;
          }

          const auth = new google.auth.GoogleAuth(authOptions);

          const drive = google.drive({ version: 'v3', auth });
        
        // Create the file in Google Drive, converting from HTML to Google Doc
        const response: any = await drive.files.create({
          requestBody: {
            name: args.title,
            mimeType: 'application/vnd.google-apps.document',
          },
          media: {
            mimeType: 'text/html',
            body: args.content,
          },
          fields: 'id, webViewLink',
        });

        const fileId = response.data.id;
        const webViewLink = response.data.webViewLink;

        if (!fileId) {
          return `Error: Google Doc creation failed. No file ID returned.`;
        }
        
        return `Google Doc created successfully!\nLink: ${webViewLink || `https://docs.google.com/document/d/${fileId}/edit`}`;
      } catch (e: any) {
        return `Error generating Google Doc with native API: ${e.message}`;
      }
    }
  }
};
