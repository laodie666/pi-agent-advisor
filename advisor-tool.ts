import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

/**
 * The `advise` tool loaded by the advisor child pi process.
 * The parent extension watches for advise() calls in the child's JSON output.
 */
export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "advise",
		label: "Advise",
		description: "Submit advisory feedback to the primary agent. At most ONE call per review. Do NOT repeat advice.",
		parameters: Type.Object({
			note: Type.String({ description: "Your advisory note (1-3 sentences)" }),
			severity: Type.Optional(
				StringEnum(["nit", "concern", "critical"] as const, {
					description: "Severity of the advisory. Omit for nits/low-priority notes.",
					default: "nit",
				}),
			),
		}),
		async execute(_toolCallId, params) {
			return {
				content: [{ type: "text" as const, text: "Recorded." }],
				details: { severity: params.severity ?? "nit", note: params.note },
			};
		},
	});
}
