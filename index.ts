import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { AdvisorRuntime } from "./advisor-runtime.ts";
import { readAdvisorConfig, writeAdvisorConfig } from "./settings.ts";
import { buildTranscriptDelta } from "./transcript.ts";
import { loadWatchdogContent } from "./watchdog.ts";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AdvisorConfig } from "./types.ts";

export default function (pi: ExtensionAPI) {
	// Skip initialization in child processes (exact --mode <value> match)
	const modeIdx = process.argv.indexOf("--mode");
	const mode = modeIdx >= 0 ? process.argv[modeIdx + 1] : null;
	if (mode === "json" || mode === "rpc") return;
	}

	let runtime: AdvisorRuntime | null = null;
	let agentDir = "";
	let cwd = "";

	pi.on("session_start", async (_event, ctx) => {
		agentDir = getAgentDir();
		cwd = ctx.cwd;
		const config = readAdvisorConfig(agentDir, cwd);
		runtime?.reset();
		runtime = new AdvisorRuntime(config, agentDir, cwd);
		updateStatusWidget(ctx, config, runtime);
	});

	pi.on("turn_start", async (_event, ctx) => {
		if (runtime?.isEnabled) {
			ctx.ui.setStatus("advisor", "advisor: ● " + shortModelName(runtime.config.model));
		}
	});

	pi.on("turn_end", async (_event, ctx) => {
		if (!runtime?.isEnabled) return;
		if (!runtime.config.model) return;
		if (runtime.isRunning) return;

		const transcript = buildTranscriptDelta(ctx.sessionManager);

		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-advisor-"));
		const transcriptPath = path.join(tmpDir, "transcript.md");
		const sysPromptPath = path.join(tmpDir, "system.md");
		const watchdog = loadWatchdogContent(agentDir, cwd);
		const systemPrompt = loadSystemPrompt() + (watchdog ? "\n" + watchdog : "");

		fs.writeFileSync(transcriptPath, transcript, "utf-8");
		fs.writeFileSync(sysPromptPath, systemPrompt, "utf-8");

		const notify = { sendMessage: pi.sendMessage.bind(pi) };

		runtime.runReview(transcriptPath, sysPromptPath, notify).then(() => {
		}).catch((err) => { console.error("[advisor] review error:", err); }).finally(() => {
			try { fs.unlinkSync(transcriptPath); } catch (e) { console.error("[advisor] cleanup error:", e); }
			try { fs.unlinkSync(sysPromptPath); } catch (e) { console.error("[advisor] cleanup error:", e); }
			try { fs.rmdirSync(tmpDir); } catch (e) { console.error("[advisor] cleanup error:", e); }
		});
	});

	pi.on("session_shutdown", async () => {
		runtime?.reset();
		runtime = null;
	});

	pi.registerCommand("advisor", {
		description: "Show advisor status",
		handler: async (_args, ctx) => {
			if (!runtime) { ctx.ui.notify("Advisor not initialized", "warning"); return; }
			ctx.ui.notify(
				"Advisor: " + (runtime.isEnabled ? "enabled" : "disabled") +
				" | Model: " + (runtime.config.model || "(none)"),
				runtime.isEnabled ? "info" : "warning",
			);
		},
	});

	pi.registerCommand("advisor-on", {
		description: "Enable advisor",
		handler: async (_args, ctx) => {
			if (!runtime) { ctx.ui.notify("Advisor not initialized", "warning"); return; }
			runtime.updateConfig({ enabled: true });
			writeAdvisorConfig(agentDir, cwd, { enabled: true });
			ctx.ui.notify("Advisor enabled", "info");
		},
	});

	pi.registerCommand("advisor-off", {
		description: "Disable advisor",
		handler: async (_args, ctx) => {
			if (!runtime) { ctx.ui.notify("Advisor not initialized", "warning"); return; }
			runtime.updateConfig({ enabled: false });
			runtime.killProcess();
			writeAdvisorConfig(agentDir, cwd, { enabled: false });
			ctx.ui.setStatus("advisor", "advisor: disabled");
			ctx.ui.notify("Advisor disabled", "info");
		},
	});

	pi.registerCommand("advisor-status", {
		description: "Show detailed advisor status",
		handler: async (_args, ctx) => {
			if (!runtime) { ctx.ui.notify("Advisor not initialized", "warning"); return; }
			const config = runtime.config;
			const msg = [
				"Enabled: " + runtime.isEnabled,
				"Model: " + (config.model || "(none)"),
				"Thinking: " + config.thinkingLevel,
				"Immune turns: " + config.immuneTurns,
				"Backlog: " + JSON.stringify(config.syncBacklog),
			].join("\n");
			ctx.ui.notify(msg, runtime.isEnabled ? "info" : "warning");
		},
	});
}

function getAgentDir(): string {
	return process.env.PI_CODING_AGENT_DIR ||
		(process.env.HOME || process.env.USERPROFILE || "~") + "/.pi/agent";
}

function updateStatusWidget(
	ctx: { ui: { setStatus: (key: string, val: string) => void } },
	config: AdvisorConfig,
	runtime: AdvisorRuntime,
): void {
	if (!runtime.isEnabled) { ctx.ui.setStatus("advisor", "advisor: disabled"); return; }
	if (!config.model) { ctx.ui.setStatus("advisor", "advisor: no model"); return; }
	ctx.ui.setStatus("advisor", "advisor: ● " + shortModelName(config.model));
}

function shortModelName(model: string): string {
	if (!model) return "";
	const parts = model.split("/");
	return parts.length > 1 ? parts[1] : model;
}

function loadSystemPrompt(): string {
	const p = path.resolve(
		(import.meta as { dirname?: string }).dirname ?? __dirname,
		"system-prompt.md",
	);
	try { return fs.readFileSync(p, "utf-8").trim(); }
	catch { return "You are an advisor. Review the transcript for issues."; }
}
