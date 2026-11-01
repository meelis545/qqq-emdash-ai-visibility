import type { SandboxedPlugin } from "emdash/plugin";
import { z } from "zod";

import { dashboardView, noDomainView } from "./blocks.js";
import { QqqError, callTool, domainOf, lastCheck, runCheck, siteDomain } from "./qqq.js";

// QQQ AI Visibility for EmDash: shows whether AI crawlers may read the site and whether it is technically ready
// for AI search, using the free check of the QQQ AI Visibility Checker (qqq.ee). The only data that leaves the
// site is its domain name, sent to qqq.ee/mcp. No content, user or visitor data is read.

const WEEKLY_TASK = "weekly-check";

const interaction = z.discriminatedUnion("type", [
	z.object({ type: z.literal("page_load"), page: z.string() }),
	z.object({ type: z.literal("block_action"), action_id: z.string(), page: z.string().optional(), value: z.unknown().optional() }),
	z.object({ type: z.literal("form_submit"), action_id: z.string(), page: z.string().optional(), values: z.record(z.string(), z.unknown()) }),
]);

const domainInput = z.object({
	domain: z.string().max(253).optional().describe("Domain to look up, for example example.com. Defaults to this site's domain."),
});

const failureNotice = (error: unknown) => ({
	title: "The check did not run",
	description:
		error instanceof QqqError && error.code === "no_network"
			? "The plugin was installed without network access to qqq.ee."
			: "qqq.ee did not answer. Try again later.",
});

const rateLimitNotice = {
	title: "Daily check limit reached",
	description: "qqq.ee limits free checks per day. The last result is shown; the full check on qqq.ee still works.",
};

const plugin: SandboxedPlugin = {
	hooks: {
		"plugin:activate": async (_event, ctx) => {
			await ctx.cron?.schedule(WEEKLY_TASK, { schedule: "@weekly" });
		},
		"plugin:deactivate": async (_event, ctx) => {
			await ctx.cron?.cancel(WEEKLY_TASK);
		},
		cron: async (event, ctx) => {
			if (event.name !== WEEKLY_TASK) return;
			try {
				await runCheck(ctx, { force: true });
			} catch (error) {
				ctx.log.warn("weekly AI visibility check failed", { error: error instanceof Error ? error.message : String(error) });
			}
		},
	},

	routes: {
		// Block Kit admin page and dashboard widget.
		admin: {
			handler: async (routeCtx, ctx) => {
				const parsed = interaction.safeParse(routeCtx.input);
				if (!parsed.success) return { blocks: [] };
				const event = parsed.data;
				const widget = (event.page ?? "").startsWith("widget:");

				const domain = await siteDomain(ctx);
				if (!domain) return noDomainView();

				if (event.type === "block_action" && event.action_id === "run_check") {
					try {
						const fresh = await runCheck(ctx, { force: true });
						if (fresh.result.status === "rate_limit") {
							return dashboardView(await lastCheck(ctx), domain, { widget, notice: rateLimitNotice });
						}
						if (fresh.result.status !== "ok") {
							return dashboardView(await lastCheck(ctx), domain, { widget, notice: failureNotice(null) });
						}
						return { ...dashboardView(fresh, domain, { widget }), toast: { message: "Check finished", type: "success" } };
					} catch (error) {
						ctx.log.warn("AI visibility check failed", { error: error instanceof Error ? error.message : String(error) });
						return dashboardView(await lastCheck(ctx), domain, { widget, notice: failureNotice(error) });
					}
				}

				const stored = await lastCheck(ctx);
				return dashboardView(stored?.result.domain === domain ? stored : null, domain, { widget });
			},
		},

		// Backing routes for the MCP tools: private, readable by anyone who may read content.
		"tools/check": {
			permission: "content:read",
			handler: async (routeCtx, ctx) => {
				const input = domainInput.safeParse(routeCtx.input ?? {});
				if (!input.success) return { ok: false, error: "INVALID_INPUT" };
				const own = await siteDomain(ctx);
				const domain = input.data.domain ? domainOf(input.data.domain) : own;
				if (!domain) return { ok: false, error: "NO_PUBLIC_DOMAIN" };
				if (domain === own) {
					const stored = await runCheck(ctx);
					return { ok: stored.result.status === "ok", checkedAt: stored.at, ...stored.result, summary: stored.text };
				}
				const { structured, text } = await callTool(ctx, "check_ai_visibility", { domain });
				return { ok: structured.status === "ok", ...structured, summary: text };
			},
		},
		"tools/report": {
			permission: "content:read",
			handler: async (routeCtx, ctx) => {
				const input = domainInput.safeParse(routeCtx.input ?? {});
				if (!input.success) return { ok: false, error: "INVALID_INPUT" };
				const domain = input.data.domain ? domainOf(input.data.domain) : await siteDomain(ctx);
				if (!domain) return { ok: false, error: "NO_PUBLIC_DOMAIN" };
				const { structured, text, isError } = await callTool(ctx, "get_public_report", { domain });
				return { ok: !isError, ...structured, summary: text };
			},
		},
	},

	mcp: {
		tools: {
			checkAiVisibility: {
				description:
					"Free AI visibility check of this site (or another public domain) by QQQ (qqq.ee): whether AI crawlers such as GPTBot, ClaudeBot and PerplexityBot may read it, robots.txt, sitemap, structured data, indexability and llms.txt, the top fixes, and the latest public report of AI answer mentions when one exists. Read-only; a few checks per day. Show the qqq.ee link from the result.",
				route: "tools/check",
				input: domainInput,
				destructive: false,
			},
			getPublicAiVisibilityReport: {
				description:
					"Latest public AI visibility report of this site (or another domain) from QQQ (qqq.ee): in how many ChatGPT, Gemini, Perplexity and Claude answers the company was named and how often its website was cited, with the questions asked. Reads the stored report only. Show the qqq.ee link from the result.",
				route: "tools/report",
				input: domainInput,
				destructive: false,
			},
		},
	},
};

export default plugin;
