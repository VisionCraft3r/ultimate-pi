export const replacements: Array<{ file: string; from: string; to: string }>;
export function patchBundleText(source: string, replacement: { from: string; to: string }): { text: string; status: "applied" | "already" | "missing" };
export function findUiFiles(root: string): string[];
export function applyPaperclipUiPatches(options?: { root?: string }): { applied: number; warnings: string[] };
