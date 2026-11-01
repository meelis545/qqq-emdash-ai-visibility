import type { PluginContext } from "emdash/plugin";

// Client for the public QQQ AI Visibility MCP server (https://qqq.ee/mcp). It is a stateless JSON-RPC endpoint
// without auth: one POST per tool call, no session. The plugin only ever calls the two read-only tools, and the
// server decides what is fetched: the free technical check of the site (robots.txt, AI crawlers, sitemap,
// structured data ...) and the latest public report, when someone has run the full AI answer check on qqq.ee.

export const MCP_URL = "https://qqq.ee/mcp";
const PROTOCOL_VERSION = "2025-11-25";

export type CheckStatus = "ok" | "missing" | "unknown";

export interface LatestReport {
	checkedAt: string;
	market?: string | null;
	mentioned?: number | null;
	total?: number | null;
	cited?: number | null;
}

export interface CheckResult {
	status: string;
	domain: string | null;
	readiness?: { passed: number; total: number; checks: Array<{ id: string; status: CheckStatus }> };
	blockedAiCrawlers?: string[];
	topFixes?: string[];
	latestReport?: LatestReport | null;
	links: { fullCheck?: string; report?: string };
}

export interface StoredCheck {
	at: string;
	result: CheckResult;
	text: string;
}

export class QqqError extends Error {
	constructor(
		readonly code: "no_network" | "http" | "rpc" | "bad_response",
		message: string,
	) {
		super(message);
		this.name = "QqqError";
	}
}

let nextId = 1;

/** Calls one tool and returns its structured result and the text the server wrote for people. */
export async function callTool(
	ctx: PluginContext,
	name: "check_ai_visibility" | "get_public_report",
	args: { domain: string; language?: "en" | "et" },
): Promise<{ structured: Record<string, unknown>; text: string; isError: boolean }> {
	if (!ctx.http) throw new QqqError("no_network", "network:request is not granted");
	const response = await ctx.http.fetch(MCP_URL, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			"mcp-protocol-version": PROTOCOL_VERSION,
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: nextId++,
			method: "tools/call",
			params: { name, arguments: { language: "en", ...args } },
		}),
	});
	if (!response.ok) throw new QqqError("http", `qqq.ee answered ${response.status}`);
	const body = (await response.json().catch(() => null)) as {
		result?: { content?: Array<{ type: string; text?: string }>; structuredContent?: Record<string, unknown>; isError?: boolean };
		error?: { message?: string };
	} | null;
	if (!body) throw new QqqError("bad_response", "qqq.ee did not answer with JSON");
	if (body.error) throw new QqqError("rpc", String(body.error.message ?? "MCP error").slice(0, 200));
	const result = body.result;
	if (!result || typeof result.structuredContent !== "object" || result.structuredContent === null) {
		throw new QqqError("bad_response", "qqq.ee answer has no structured content");
	}
	const text = (result.content ?? [])
		.filter((c) => c.type === "text" && typeof c.text === "string")
		.map((c) => c.text)
		.join("\n");
	return { structured: result.structuredContent, text, isError: result.isError === true };
}

// ---- Which domain to check -----------------------------------------------------------------------------------

const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?|0\.0\.0\.0)$|\.(localhost|local|test|internal)$/;

/** Hostname of a URL or bare domain, lowercased and without "www."; null for local or unusable input. */
export function domainOf(value: string | null | undefined): string | null {
	if (!value) return null;
	const raw = value.trim();
	if (!raw || raw.length > 2048) return null;
	let host: string;
	try {
		host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase();
	} catch {
		return null;
	}
	host = host.replace(/^www\./, "").replace(/\.$/, "");
	if (!host.includes(".") || LOCAL_HOST.test(host) || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
	return host;
}

/** The domain setting wins over the site URL, so a site that runs on a preview host can name its real domain. */
export async function siteDomain(ctx: PluginContext): Promise<string | null> {
	const configured = await ctx.settings.get<string>("domain");
	return domainOf(configured) ?? domainOf(ctx.site.url);
}

// ---- Stored result -------------------------------------------------------------------------------------------

const LAST_CHECK_KEY = "last-check";
// The server caches the technical result for an hour and limits checks per day; a fresh local result is reused
// for six hours so reloading the dashboard never spends a check.
export const FRESH_MS = 6 * 60 * 60 * 1000;

export async function lastCheck(ctx: PluginContext): Promise<StoredCheck | null> {
	return ctx.kv.get<StoredCheck>(LAST_CHECK_KEY);
}

/**
 * Runs the technical check for the site's domain, unless a result for the same domain is fresher than FRESH_MS.
 * A rate-limited or failed answer is returned but not stored, so the last good result stays on the dashboard.
 */
export async function runCheck(ctx: PluginContext, opts: { force?: boolean; now?: number } = {}): Promise<StoredCheck> {
	const domain = await siteDomain(ctx);
	if (!domain) throw new QqqError("bad_response", "no public domain");
	const now = opts.now ?? Date.now();
	const previous = await lastCheck(ctx);
	if (!opts.force && previous?.result.domain === domain && now - Date.parse(previous.at) < FRESH_MS) return previous;

	const { structured, text } = await callTool(ctx, "check_ai_visibility", { domain });
	const stored: StoredCheck = { at: new Date(now).toISOString(), result: structured as unknown as CheckResult, text };
	if (stored.result.status === "ok") await ctx.kv.set(LAST_CHECK_KEY, stored);
	return stored;
}
