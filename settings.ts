import * as fs from "node:fs";
import * as path from "node:path";
import type { AdvisorConfig } from "./types.ts";
import { DEFAULT_ADVISOR_CONFIG } from "./types.ts";

const SETTINGS_KEY = "advisor";

/**
 * Read advisor settings from the effective settings file(s).
 * Global: ~/.pi/agent/settings.json
 * Project: <cwd>/.pi/settings.json (overrides global)
 */
export function readAdvisorConfig(agentDir: string, cwd: string): AdvisorConfig {
	const config: AdvisorConfig = { ...DEFAULT_ADVISOR_CONFIG };

	// Global
	const globalPath = path.join(agentDir, "settings.json");
	const globalVal = readSettingsKey(globalPath);
	if (globalVal && typeof globalVal === "object") applyToConfig(config, globalVal);

	// Project overrides
	const projectDir = findProjectPiDir(cwd);
	if (projectDir) {
		const projectPath = path.join(projectDir, "settings.json");
		const projectVal = readSettingsKey(projectPath);
		if (projectVal && typeof projectVal === "object") applyToConfig(config, projectVal);
	}

	return config;
}

/**
 * Write advisor settings to the project-level settings.json.
 */
export function writeAdvisorConfig(_agentDir: string, cwd: string, patch: Partial<AdvisorConfig>): void {
	const projectDir = findProjectPiDir(cwd);
	if (!projectDir) return;

	const settingsPath = path.join(projectDir, "settings.json");
	let settings: Record<string, unknown> = {};
	try {
		settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
	} catch {
		// File doesn't exist or is invalid — start fresh
	}

	const current = settings[SETTINGS_KEY] ?? {};
	settings[SETTINGS_KEY] = { ...current as object, ...patch };

	fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
	fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
}

// ── Helpers ──

function readSettingsKey(filePath: string): unknown {
	try {
		const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
		return raw[SETTINGS_KEY];
	} catch {
		return undefined;
	}
}

function applyToConfig(config: AdvisorConfig, val: unknown): void {
	const obj = val as Record<string, unknown>;
	if (typeof obj.enabled === "boolean") config.enabled = obj.enabled;
	if (typeof obj.model === "string") config.model = obj.model;
	if (typeof obj.thinkingLevel === "string") config.thinkingLevel = obj.thinkingLevel;
}
}

function findProjectPiDir(cwd: string): string | null {
	const candidate = path.join(cwd, ".pi");
	try {
		if (fs.statSync(candidate).isDirectory()) return candidate;
	} catch {
		// not found
	}
	return null;
}
