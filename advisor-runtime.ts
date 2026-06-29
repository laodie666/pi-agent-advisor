import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AdvisorConfig, AdvisorNote } from "./types.ts";

export type AdvisorNotifier = Pick<ExtensionAPI, "sendMessage">;

/**
 * Resolve pi invocation for child process. Handles Windows .cmd files.
 */
function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const cs = process.argv[1];
	if (cs && !cs.startsWith("/$bunfs/root/") && fs.existsSync(cs)) {
		return { command: process.execPath, args: [cs, ...args] };
	}
	const en = path.basename(process.execPath).toLowerCase();
	if (!/^(node|bun)(\.exe)?$/.test(en)) return { command: process.execPath, args };
	return { command: "pi", args };
}

/**
 * AdvisorRuntime manages the lifecycle of the advisor child process.
 * Spawns one child pi per turn. Stateless. Fresh process each time.
 */
export class AdvisorRuntime {
	private _config: AdvisorConfig;
	private agentDir: string;
	private cwd: string;
	private currentProc: ReturnType<typeof spawn> | null = null;


	constructor(config: AdvisorConfig, agentDir: string, cwd: string) {
		this._config = config;
		this.agentDir = agentDir;
		this.cwd = cwd;
	}

	get isEnabled(): boolean {
		return this._config.enabled;
	}
	get config(): Readonly<AdvisorConfig> {
		return this._config;
	}
	get isRunning(): boolean {
		return this.currentProc !== null;
	}

	updateConfig(patch: Partial<AdvisorConfig>): void {
		Object.assign(this._config, patch);
	}

	reset(): void {
		this.killProcess();
		this.currentProc = null;
	}

	killProcess(): void {
		if (this.currentProc) {
			try { this.currentProc.kill("SIGTERM"); } catch {}
			this.currentProc = null;
		}
	}

	/**
	 * Spawn a child pi process to review the given transcript.
	 * Returns true if advice was injected.
	 */
	async runReview(
		transcriptPath: string,
		sysPromptPath: string,
		notify: AdvisorNotifier,
	): Promise<boolean> {
		if (!this._config.enabled) return false;
		if (!this._config.model) return false;

		this.killProcess();

		const childArgs: string[] = [
			"--mode", "json",
			"-p",
			"--no-session",
		];
		if (this._config.model) {
			childArgs.push("--model", this._config.model);
			if (this._config.thinkingLevel) {
				childArgs.push("--thinking", this._config.thinkingLevel);
			}
		}
		childArgs.push(
			"--append-system-prompt", sysPromptPath,
			"--tools", "read,grep,find,advise",
			"-e", ADVISOR_TOOL_PATH,
			"@" + transcriptPath,
			"Review the transcript. Use advise() if you find issues.",
		);

		const invocation = getPiInvocation(childArgs);
		const proc = spawn(invocation.command, invocation.args, {
			cwd: this.cwd,
			stdio: ["ignore", "pipe", "ignore"],
			shell: false,
		});

		this.currentProc = proc;

		// Parse JSON output for advise() tool calls and usage
		let buffer = "";
		const adviseCalls: AdvisorNote[] = [];
		let usageStr = "";

		proc.stdout.on("data", (data: Buffer) => {
			buffer += data.toString();
			const lines = buffer.split("\n");
			buffer = lines.pop() || "";
			for (const line of lines) {
				if (!line.trim()) continue;
				try {
					const event = JSON.parse(line);
					if (event.type === "tool_execution_start" && event.toolName === "advise") {
						const args = event.args || {};
						const note = typeof args.note === "string" ? args.note.trim() : "";
						const severity = args.severity === "concern" || args.severity === "critical" ? args.severity : "nit";
						if (note) adviseCalls.push({ note, severity });
					}
					// Capture usage from last assistant message
					if (event.type === "message_end" && event.message?.role === "assistant" && event.message?.usage) {
						const u = event.message.usage;
						if (u.cost?.total != null) {
							usageStr = `↑${fmt(u.input)} ↓${fmt(u.output)} $${u.cost.total.toFixed(5)}`;
							if (u.cacheRead) usageStr += ` R${fmt(u.cacheRead)}`;
						}
					}
				} catch {}
			}
		});

		const TIMEOUT_MS = 120_000;
		const exitCode = await new Promise<number>((resolve) => {
			const timer = setTimeout(() => {
				try { proc.kill("SIGTERM"); } catch {}
				resolve(1);
			}, TIMEOUT_MS);
			proc.on("close", (code) => {
				clearTimeout(timer);
				resolve(code ?? 1);
			});
			proc.on("error", () => {
				clearTimeout(timer);
				resolve(1);
			});
		});

		this.currentProc = null;

		if (exitCode !== 0 && adviseCalls.length === 0) {
			return false;
		}

		// Take first non-suppressed advise call
		for (const call of adviseCalls) {
			const costLine = usageStr ? `\n\n_${usageStr}_` : "";
			notify.sendMessage({
				customType: "advisor-note",
				content: `**Advisor (${call.severity}):** ${call.note}${costLine}`,
				display: true,
				details: { severity: call.severity, usage: usageStr },
			}, { deliverAs: "followUp", triggerTurn: true });
			return true;
		}

		return false;
	}
}

function fmt(n: number): string {
	if (n < 1000) return String(n);
	if (n < 10000) return (n / 1000).toFixed(1) + "k";
	return Math.round(n / 1000) + "k";
}

const ADVISOR_TOOL_PATH = path.resolve(
	(import.meta as { dirname?: string }).dirname ?? __dirname,
	"advisor-tool.ts",
);
