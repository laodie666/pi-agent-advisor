import * as fs from "node:fs";
import * as path from "node:path";

/**
 * WATCHDOG.md discovery and loading.
 *
 * Discovers WATCHDOG.md files from:
 * 1. ~/.pi/agent/WATCHDOG.md (global)
 * 2. <cwd>/WATCHDOG.md and <cwd>/.pi/WATCHDOG.md, walking up to git root
 */
export function loadWatchdogContent(agentDir: string, cwd: string): string {
	const parts: string[] = [];

	// 1. Global
	const globalWd = path.join(agentDir, "WATCHDOG.md");
	if (exists(globalWd)) {
		parts.push(readWithImports(globalWd));
	}

	// 2. Project — walk up from cwd to git root
	const projectFiles = discoverProjectWatchdogFiles(cwd);
	for (const f of projectFiles) {
		parts.push(readWithImports(f));
	}

	if (parts.length === 0) return "";

	return (
		"\n\nEspecially pay attention to:\n<attention>\n" +
		parts.join("\n\n---\n\n") +
		"\n</attention>"
	);
}

function discoverProjectWatchdogFiles(start: string): string[] {
	const files: string[] = [];
	const gitRoot = findGitRoot(start);
	const home = getHomeDir();
	let dir = start;

	while (true) {
		// Check <dir>/WATCHDOG.md
		const wd = path.join(dir, "WATCHDOG.md");
		if (exists(wd) && !files.includes(wd)) files.unshift(wd);

		// Check <dir>/.pi/WATCHDOG.md
		const piWd = path.join(dir, ".pi", "WATCHDOG.md");
		if (exists(piWd) && !files.includes(piWd)) files.unshift(piWd);

		if (gitRoot && dir === gitRoot) break;
		if (!gitRoot && dir === home) break;
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}

	return files;
}

function readWithImports(filePath: string): string {
	let content: string;
	try {
		content = fs.readFileSync(filePath, "utf-8");
	} catch {
		return "";
	}

	// Expand @imports — simple relative and ~/ patterns
	const baseDir = path.dirname(filePath);
	return content.replace(/^@(\S+)$/gm, (_match, importPath) => {
		let resolved: string;
		if (importPath.startsWith("~/")) {
			resolved = path.join(getHomeDir(), importPath.slice(2));
		} else {
			resolved = path.resolve(baseDir, importPath);
		}
		try {
			return fs.readFileSync(resolved, "utf-8").trim();
		} catch {
			return `@${importPath}`; // leave original if not found
		}
	});
}

function findGitRoot(dir: string): string | null {
	try {
		const result = fs.realpathSync(path.join(dir, ".git"));
		if (fs.statSync(result).isDirectory() || fs.statSync(result).isFile()) {
			return dir;
		}
	} catch {
		// not found
	}
	const parent = path.dirname(dir);
	if (parent === dir) return null;
	return findGitRoot(parent);
}

function getHomeDir(): string {
	return process.env.HOME || process.env.USERPROFILE || "/";
}

function exists(p: string): boolean {
	try {
		fs.statSync(p);
		return true;
	} catch {
		return false;
	}
}
