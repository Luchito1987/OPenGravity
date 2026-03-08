# OpenGravity - Cloud Ready Bot

This bot is configured to run on Render using the provided `Dockerfile` and `render.yaml`.

## Environment Variables Required

For the bot to function, you must set the following environment variables in your hosting provider's dashboard:

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Your Telegram Bot API Token |
| `TELEGRAM_ALLOWED_USER_IDS` | Comma-separated list of allowed User IDs |
| `GROQ_API_KEY` | Your Groq API Key |
| `OPENROUTER_API_KEY` | Your OpenRouter API Key (for fallback) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | **CRITICAL:** Paste the entire contents of your `service-account.json` file here. |

## Deployment Steps

1. Create a new "Web Service" on Render.
2. Connect your GitHub repository.
3. Render will detect the `render.yaml` and set up the service as a worker.
4. Manually add the environment variables listed above.
