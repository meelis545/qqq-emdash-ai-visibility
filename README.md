# QQQ AI Visibility Checker for EmDash

Can ChatGPT, Gemini, Claude and Perplexity read your site? This plugin shows the answer on your EmDash dashboard. It runs the free technical check of the [QQQ AI Visibility Checker](https://qqq.ee/en/ai-visibility-checker/), which shows whether AI search can reach your pages and what to fix first.

**What it checks**

- **AI crawlers**: whether robots.txt lets GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot, Google-Extended and other AI user agents in, and which ones it blocks.
- **AI search readiness**: HTTPS, XML sitemap, indexability, title, meta description, H1, canonical, lang attribute, Organization structured data, whether the content is in the HTML rather than rendered only by JavaScript, and llms.txt.
- **The top fixes**, most important first.
- **Mentions in AI answers**: if someone has run the full check on qqq.ee, the plugin also shows in how many ChatGPT, Gemini, Perplexity and Claude answers your company was named and how often your own site was cited.

**Where you see it**

- A dashboard widget with the main numbers and a "Check again" button.
- An **AI visibility** admin page that lists every check and its status.
- A weekly background re-check, so the dashboard stays current.
- Two MCP tools for your site's AI agent, `checkAiVisibility` and `getPublicAiVisibilityReport`. An administrator enables them after install.

Technical access and AI answers are different things: a site can be fully readable and still not be named. The plugin reports them separately and gives no combined score. To see what AI assistants actually say about your company, run the free [full AI answer check on qqq.ee](https://qqq.ee/en/ai-visibility-checker/).

**Privacy.** The plugin sends only your domain name, and only to `qqq.ee`. It reads no posts, users, comments or media.

Made by [QQQ](https://qqq.ee/en/), an SEO and [AI search optimization](https://qqq.ee/en/ai-search-optimization/) agency in Estonia. The same checker is also available as an [MCP server](https://qqq.ee/en/mcp-server/) for Claude, Cursor and other AI clients.

## Develop

```sh
pnpm install
pnpm run validate
pnpm run typecheck
pnpm run test
pnpm run build
```

- `src/plugin.ts`: hooks (weekly cron), the Block Kit `admin` route and the MCP tool routes.
- `src/qqq.ts`: the client for `https://qqq.ee/mcp` (JSON-RPC `tools/call`) and the stored last result.
- `src/blocks.ts`: the dashboard widget and admin page views.

`pnpm run test` builds the plugin and runs its tests through Worker Loader, EmDash's production sandbox wrapper and the host bridge. Calls to qqq.ee are mocked, so the tests make no network request.

To try it on a site, run `pnpm run dev` here and `pnpm add file:../qqq-emdash-ai-visibility` in the site. Then `import aiVisibility from "ai-visibility"` and pass it into `emdash({ sandboxed: [aiVisibility] })`.

Bump `version` in `package.json` for every release, and always when `capabilities`, `allowedHosts` or `storage` change, because installed sites consented to the old contract. Publishing steps are in [PUBLISHING.md](PUBLISHING.md).

## License

MIT
