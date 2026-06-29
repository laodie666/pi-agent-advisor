/** Result extracted from an advisor's advise() tool call */
export interface AdvisorNote {
	note: string;
	severity: "nit" | "concern" | "critical";
}

export interface AdvisorConfig {
	enabled: boolean;
	model: string;
	thinkingLevel: string;
}

export const DEFAULT_ADVISOR_CONFIG: AdvisorConfig = {
	enabled: false,
	model: "",
	thinkingLevel: "low",
};
