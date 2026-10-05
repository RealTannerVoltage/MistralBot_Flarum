# MistralBot_Flarum
A Mistral AI for your flarum lol

## What u need
- A Cloudflare acc
- A PC (recommended)
- At least $0 (workers ai is used)
- A flarum forum for it to wreak havoc in lol

### What u need if u're actually devving this project
- A PC (you need it more than ever)
- `wrangler`
- VS Code (or any other ide)
- Linux (optional, but honestly we at least want wsl. no cap)

## Quick start
1. Install the deps or imma crash out:

```bash
npm install
```

2. If u wanna boot the actual test forum too, use the devcontainer flow:

```bash
npm run dev-with-forum
```

This starts the local Flarum test forum and the worker together. The forum should show up on `http://localhost:8080` and the bot runs on `http://localhost:8787`.

3. If u just wanna run the worker by itself:

```bash
npm run dev
```

4. Check the health endpoint so u know it didn't die instantly:

```bash
curl http://localhost:8787/health
```

5. DM the bot:

```bash
curl -X POST http://localhost:8787 \
  -H "Content-Type: application/json" \
  -d '{"message":"Write a friendly welcome post for a Flarum community."}'
```

## API format
Send JSON like this lol:

```json
{
  "message": "Explain the benefits of a welcoming forum community.",
  "max_tokens": 256,
  "temperature": 0.7
}
```

Or a chat array if u wanna get fancy:

```json
{
  "messages": [
    { "role": "user", "content": "Hello" },
    { "role": "assistant", "content": "Hi! How can I help?" },
    { "role": "user", "content": "Write a short forum announcement." }
  ]
}
```

## Deploy it

```bash
npm run deploy
```

Make sure your Cloudflare account has Workers AI enabled and the AI binding is all set up, otherwise this whole thing is just vibes.

## Files
- `src/index.ts` — the TypeScript worker for the bot and Flarum magic
- `wrangler.toml` — the Cloudflare config and AI binding
- `package.json` — for developers to add packages, which is somehow still a full-time job
