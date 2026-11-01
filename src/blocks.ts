import type { Block, BlockResponse } from "@emdash-cms/blocks";

import type { CheckStatus, StoredCheck } from "./qqq.js";

// Block Kit views for the admin page and the dashboard widget. Everything shown comes from the qqq.ee answer;
// no score is computed here, because the checker keeps crawler access, mentions and citations apart on purpose.

export const TOOL_URL = "https://qqq.ee/en/ai-visibility-checker/";

const LABELS: Record<string, string> = {
	reachable: "Homepage reachable",
	https: "HTTPS",
	robots_txt: "robots.txt",
	ai_crawlers: "AI crawlers allowed",
	googlebot: "Googlebot allowed",
	sitemap: "XML sitemap",
	title: "Title",
	meta_description: "Meta description",
	h1: "One H1",
	canonical: "Canonical",
	noindex: "Indexable (no noindex)",
	lang: "lang attribute",
	organization_schema: "Organization/Person structured data",
	html_content: "Content in HTML (not JS-only)",
	og_image: "og:image",
	key_pages: "Key pages",
	ai_crawler_access: "Server answers AI crawlers (informational)",
	llms_txt: "llms.txt (informational)",
};

const STATUS_TEXT: Record<CheckStatus, string> = { ok: "OK", missing: "Missing", unknown: "Unknown" };

export const label = (id: string) => LABELS[id] ?? id;

const external = (text: string, url: string, appearance: "primary" | "secondary" | "inline" = "secondary") => ({
	type: "link" as const,
	label: text,
	target: { kind: "external" as const, url },
	appearance,
});

const checkButton = (text: string) => ({ type: "button" as const, action_id: "run_check", label: text, style: "primary" as const });

function fullCheckUrl(stored: StoredCheck | null, domain: string | null): string {
	const fromServer = stored?.result.links.fullCheck;
	if (fromServer?.startsWith("https://qqq.ee/")) return fromServer;
	return domain ? `${TOOL_URL}?url=${encodeURIComponent(domain)}` : TOOL_URL;
}

/** The view when there is no public domain to check (local dev or an unset preview host). */
export function noDomainView(): BlockResponse {
	return {
		blocks: [
			{ type: "header", text: "AI visibility" },
			{
				type: "empty",
				title: "No public domain yet",
				description: "This site runs on a local or private address. Set the public domain in the plugin settings to check it.",
				actions: [{ type: "link", label: "Plugin settings", target: { kind: "plugin-settings" } }],
			},
		],
	};
}

export function dashboardView(
	stored: StoredCheck | null,
	domain: string,
	opts: { widget?: boolean; notice?: { title: string; description: string } } = {},
): BlockResponse {
	const blocks: Block[] = [];
	if (!opts.widget) blocks.push({ type: "header", text: `AI visibility of ${domain}` });
	if (opts.notice) blocks.push({ type: "banner", variant: "alert", ...opts.notice });

	if (!stored) {
		blocks.push({
			type: "empty",
			title: "Not checked yet",
			description: "Check whether ChatGPT, Gemini, Claude and Perplexity crawlers may read this site and whether it is ready for AI search.",
			actions: [checkButton("Check now")],
		});
		blocks.push({ type: "context", text: "Free technical check by QQQ (qqq.ee). Only the domain name is sent." });
		return { blocks };
	}

	const r = stored.result;
	const blocked = r.blockedAiCrawlers ?? [];
	const crawlers = r.readiness?.checks.find((c) => c.id === "ai_crawlers")?.status ?? "unknown";
	const report = r.latestReport;

	blocks.push({
		type: "stats",
		items: [
			{
				label: "Technical checks passed",
				value: r.readiness ? `${r.readiness.passed} / ${r.readiness.total}` : "–",
			},
			{
				label: "AI crawlers",
				value: crawlers === "ok" ? "Allowed" : crawlers === "missing" ? `${blocked.length || "Some"} blocked` : "Unknown",
				trend: crawlers === "ok" ? "up" : crawlers === "missing" ? "down" : "neutral",
				description: blocked.length ? blocked.join(", ") : undefined,
			},
			report && report.total
				? {
						label: "Named in AI answers",
						value: `${report.mentioned ?? 0} / ${report.total}`,
						description: `Full check ${String(report.checkedAt).slice(0, 10)}, own site cited ${report.cited ?? 0}×`,
					}
				: { label: "Named in AI answers", value: "Not measured", description: "Run the full check on qqq.ee" },
		],
	});

	if (r.topFixes?.length) {
		blocks.push({ type: "section", text: `**Fix first:**\n${r.topFixes.map((f) => `- ${f}`).join("\n")}` });
	}

	if (!opts.widget && r.readiness) {
		blocks.push({
			type: "table",
			page_action_id: "checks_page",
			columns: [
				{ key: "check", label: "Check" },
				{ key: "status", label: "Status", format: "badge" },
			],
			rows: r.readiness.checks.map((c) => ({ check: label(c.id), status: STATUS_TEXT[c.status] ?? c.status })),
		});
	}

	const elements = [
		checkButton("Check again"),
		external("Full AI answer check on qqq.ee", fullCheckUrl(stored, domain), "primary"),
		...(r.links.report?.startsWith("https://qqq.ee/") ? [external("Latest public report", r.links.report)] : []),
	];
	if (opts.widget) elements.splice(2);
	blocks.push({ type: "actions", elements });
	blocks.push({
		type: "context",
		text: `Checked ${stored.at.slice(0, 16).replace("T", " ")} UTC. Free technical check by QQQ (qqq.ee); AI answers are measured on qqq.ee only.`,
	});
	return { blocks };
}
