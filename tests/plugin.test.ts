import { afterEach, describe, expect, it } from "vitest";

import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";

import { domainOf, MCP_URL } from "../src/qqq.js";

let host: PluginRuntimeTestHost | undefined;

afterEach(async () => {
	await host?.dispose();
	host = undefined;
});

const okResult = {
	status: "ok",
	domain: "example.com",
	readiness: {
		passed: 9,
		total: 12,
		checks: [
			{ id: "reachable", status: "ok" },
			{ id: "ai_crawlers", status: "missing" },
			{ id: "llms_txt", status: "missing" },
		],
	},
	blockedAiCrawlers: ["GPTBot", "ClaudeBot"],
	topFixes: ["Allow GPTBot and ClaudeBot in robots.txt"],
	latestReport: { checkedAt: "2026-10-20T08:00:00.000Z", market: "us", mentioned: 3, total: 12, cited: 1 },
	links: {
		fullCheck: "https://qqq.ee/en/ai-visibility-checker/?url=example.com&utm_source=mcp",
		report: "https://qqq.ee/en/ai-visibility-checker/report/example.com/?utm_source=mcp",
	},
};

const rpc = (structuredContent: unknown, text = "summary") =>
	new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text }], structuredContent, isError: false } }), {
		headers: { "content-type": "application/json" },
	});

const json = (value: unknown) => JSON.stringify(value);
const decode = (bytes: Uint8Array) => JSON.parse(new TextDecoder().decode(bytes));

async function start(url = "https://www.example.com") {
	host = await createPluginRuntimeTestHost({ site: { name: "Example", url } });
	return host;
}

describe("dashboard widget", () => {
	it("shows the empty state without calling qqq.ee", async () => {
		const h = await start();
		const view = await h.admin.loadWidget("ai-visibility");
		expect(json(view)).toContain("Not checked yet");
		expect(h.http.requests()).toHaveLength(0);
	});

	it("runs the check on qqq.ee with the domain only and stores the result", async () => {
		const h = await start();
		await h.http.respond(MCP_URL, rpc(okResult));
		const view = await h.admin.act("widget:ai-visibility", "run_check");

		const [request] = h.http.requests();
		expect(new URL(request.url).host).toBe("qqq.ee");
		expect(request.method).toBe("POST");
		const body = decode(request.body);
		expect(body.method).toBe("tools/call");
		expect(body.params).toEqual({ name: "check_ai_visibility", arguments: { language: "en", domain: "example.com" } });

		const text = json(view);
		expect(text).toContain("9 / 12");
		expect(text).toContain("2 blocked");
		expect(text).toContain("GPTBot, ClaudeBot");
		expect(text).toContain("3 / 12");
		expect(text).toContain("Allow GPTBot and ClaudeBot in robots.txt");
		expect(view.toast?.type).toBe("success");
		expect((await h.inspect.kv.get<{ result: { domain: string } }>("last-check"))?.result.domain).toBe("example.com");
	});

	it("keeps the last good result when qqq.ee answers with the daily limit", async () => {
		const h = await start();
		await h.fixtures.plugin.kv("last-check", { at: "2026-10-30T10:00:00.000Z", result: okResult, text: "old" });
		await h.http.respond(MCP_URL, rpc({ status: "rate_limit", domain: "example.com", links: { fullCheck: okResult.links.fullCheck } }));
		const view = await h.admin.act("widget:ai-visibility", "run_check");

		expect(json(view)).toContain("Daily check limit reached");
		expect(json(view)).toContain("9 / 12");
		expect((await h.inspect.kv.get<{ text: string }>("last-check"))?.text).toBe("old");
	});

	it("shows a notice and no crash when qqq.ee fails", async () => {
		const h = await start();
		await h.http.respond(MCP_URL, new Response("oops", { status: 502 }));
		const view = await h.admin.act("widget:ai-visibility", "run_check");
		expect(json(view)).toContain("The check did not run");
	});
});

describe("admin page", () => {
	it("lists every check with its status", async () => {
		const h = await start();
		await h.fixtures.plugin.kv("last-check", { at: "2026-10-30T10:00:00.000Z", result: okResult, text: "t" });
		const view = await h.admin.loadPage("/overview");
		const text = json(view);
		expect(text).toContain("AI visibility of example.com");
		expect(text).toContain("AI crawlers allowed");
		expect(text).toContain("llms.txt (informational)");
		expect(text).toContain("Latest public report");
		expect(h.http.requests()).toHaveLength(0);
	});

	it("asks for a domain on a local site and uses the setting when given", async () => {
		const h = await start("http://localhost:4321");
		expect(json(await h.admin.loadPage("/overview"))).toContain("No public domain yet");

		await h.fixtures.plugin.setting("domain", "https://www.Example.com/blog");
		expect(json(await h.admin.loadPage("/overview"))).toContain("AI visibility of example.com");
	});

	it("does not show a stored result for another domain", async () => {
		const h = await start("https://other.org");
		await h.fixtures.plugin.kv("last-check", { at: "2026-10-30T10:00:00.000Z", result: okResult, text: "t" });
		expect(json(await h.admin.loadPage("/overview"))).toContain("Not checked yet");
	});
});

describe("weekly check", () => {
	it("schedules on activate and cancels on deactivate", async () => {
		const h = await start();
		await h.actions.plugin.activate();
		expect(json(await h.inspect.scheduledTasks())).toContain("weekly-check");
		await h.actions.plugin.deactivate();
		expect(json(await h.inspect.scheduledTasks())).not.toContain("weekly-check");
	});

	it("re-checks the site when the cron task fires", async () => {
		const h = await start();
		await h.http.respond(MCP_URL, rpc(okResult));
		await h.transport.invokeHook("cron", { name: "weekly-check", scheduledAt: "2026-11-01T00:00:00.000Z" });
		expect(h.http.requests()).toHaveLength(1);
		expect((await h.inspect.kv.get<{ result: { status: string } }>("last-check"))?.result.status).toBe("ok");
	});
});

describe("MCP tool routes", () => {
	it("reuses a fresh stored result for the site's own domain", async () => {
		const h = await start();
		await h.fixtures.plugin.kv("last-check", { at: new Date().toISOString(), result: okResult, text: "cached" });
		const answer = (await h.transport.invokeRoute("tools/check", {})) as Record<string, unknown>;
		expect(answer.ok).toBe(true);
		expect(answer.summary).toBe("cached");
		expect(h.http.requests()).toHaveLength(0);
	});

	it("reads the public report of another domain", async () => {
		const h = await start();
		await h.http.respond(MCP_URL, rpc({ status: "ok", domain: "forus.ee", links: {} }, "report text"));
		const answer = (await h.transport.invokeRoute("tools/report", { domain: "https://forus.ee/" })) as Record<string, unknown>;
		expect(answer.summary).toBe("report text");
		expect(decode(h.http.requests()[0].body).params).toEqual({ name: "get_public_report", arguments: { language: "en", domain: "forus.ee" } });
	});

	it("refuses input that is not a public domain", async () => {
		const h = await start();
		const answer = (await h.transport.invokeRoute("tools/report", { domain: "127.0.0.1" })) as Record<string, unknown>;
		expect(answer).toEqual({ ok: false, error: "NO_PUBLIC_DOMAIN" });
		expect(h.http.requests()).toHaveLength(0);
	});
});

describe("domainOf", () => {
	it("normalises URLs and refuses local hosts", () => {
		expect(domainOf("https://www.Example.com/path?q=1")).toBe("example.com");
		expect(domainOf("example.com")).toBe("example.com");
		expect(domainOf("näide.ee")).toBe("xn--nide-loa.ee");
		expect(domainOf("localhost")).toBeNull();
		expect(domainOf("site.local")).toBeNull();
		expect(domainOf("10.0.0.1")).toBeNull();
		expect(domainOf("")).toBeNull();
	});
});
