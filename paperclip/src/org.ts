import { createHash } from "node:crypto";

export type OrgRole = "ceo" | "general" | "engineer" | "pm" | "researcher" | "qa" | "designer" | "reviewer";

export type OrgSeat = {
  persona: string;
  role: OrgRole;
  manager: string | null;
  capability: string;
};

export const ORG: readonly OrgSeat[] = [
  {
    persona: "orchestrator",
    role: "ceo",
    manager: null,
    capability: "Board tasks land here. jev_triage decides the tier, then this agent delegates with subagent. Paperclip mirrors each pane as a sub-task.",
  },
  {
    persona: "scout",
    role: "general",
    manager: "orchestrator",
    capability: "Tier 2 reconnaissance. Ultimate PI assigns file and line maps here before a worker edits.",
  },
  {
    persona: "planner",
    role: "pm",
    manager: "orchestrator",
    capability: "Tier 3 specs. Ultimate PI assigns the breakdown here. The spec goes back to Ultimate PI, then to Worker.",
  },
  {
    persona: "worker",
    role: "engineer",
    manager: "orchestrator",
    capability: "Tier 1 edits, tier 2 after Scout, and tier 3 after the Planner spec is approved.",
  },
  {
    persona: "researcher",
    role: "researcher",
    manager: "orchestrator",
    capability: "External docs. Ultimate PI assigns research here when the work needs sources outside the repo.",
  },
  {
    persona: "qa_tester",
    role: "qa",
    manager: "orchestrator",
    capability: "Tier 4 live UI checks. Ultimate PI assigns browser QA here.",
  },
  {
    persona: "reviewer",
    role: "reviewer",
    manager: "orchestrator",
    capability: "Read-only review after a worker wave, and tier 5 code or project audits. Ultimate PI assigns the verdict here.",
  },
];

export function assignmentInstructions(input: {
  persona: string;
  model: string;
  thinking: string;
}): string {
  const seat = ORG.find((entry) => entry.persona === input.persona);
  if (!seat) return "";
  if (seat.persona === "orchestrator") {
    return [
      "You are Ultimate PI, the orchestrator for the local Pi install in ~/.pi/agent.",
      "You do not pin a model. You keep every tool and extension, and you run in tmux.",
      "Scout, Worker, Planner, Researcher, QA Tester, and Reviewer report to you.",
      "A Paperclip task assigned to you is incoming work. Call jev_triage, then delegate with subagent(...) for that tier. Paperclip mirrors each subagent as a sub-task automatically:",
      "- tier 0: answer it yourself",
      "- tier 1: Worker, then one Reviewer if source changed",
      "- tier 2: Scout, then Worker, then one Reviewer if source changed",
      "- tier 3: Planner. After the spec is ready, delegate implementation to Worker, then one Reviewer",
      "- tier 4 UI: QA Tester",
      "- tier 5 audit: Reviewer",
      "- external docs: Researcher",
      "Do not do a role's job in this session.",
    ].join("\n");
  }
  const model = input.model ? ` Model ${input.model}.` : "";
  const thinking = input.thinking ? ` Thinking ${input.thinking}.` : "";
  return [
    `You are the ${seat.persona} persona from ~/.pi/agent/agents/${seat.persona}.md.${model}${thinking}`,
    "You report to Ultimate PI. You run in your own tmux session through the ultimate_pi adapter.",
    seat.capability,
    "Do the Paperclip task assigned to you. Hand the result back to Ultimate PI. Do not reassign the task unless Ultimate PI asked you to.",
  ].join("\n");
}

export type SeededSeat = {
  role: string;
  reportsTo: string | null;
  capabilities: string;
  instructionsHash: string;
};

export type OrgSeedState = {
  seats: Record<string, SeededSeat>;
};

export function hashText(text: string): string {
  return createHash("sha256").update(text.trim()).digest("hex");
}

function seededValue(current: string, previous: string | undefined, next: string, force: boolean, hadSeed: boolean): string {
  if (force || !hadSeed || current.trim() === "") return next;
  if (previous !== undefined && current === previous) return next;
  return current;
}

export function planOrgSync(input: {
  role: string;
  reportsTo: string | null;
  capabilities: string | null;
  instructions: string;
  seeded?: SeededSeat | null;
  force?: boolean;
  next: { role: string; reportsTo: string | null; capabilities: string; instructions: string };
}): {
  role: string;
  reportsTo: string | null;
  capabilities: string;
  writeAgent: boolean;
  writeInstructions: boolean;
  instructions: string;
  seeded: SeededSeat;
} {
  const force = input.force === true;
  const hadSeed = Boolean(input.seeded);
  const role = seededValue(input.role, input.seeded?.role, input.next.role, force, hadSeed);
  const reportsTo = force || !hadSeed || input.reportsTo == null || input.reportsTo === input.seeded?.reportsTo
    ? input.next.reportsTo
    : input.reportsTo;
  const capabilities = seededValue(input.capabilities ?? "", input.seeded?.capabilities, input.next.capabilities, force, hadSeed);
  const currentHash = hashText(input.instructions);
  const nextHash = hashText(input.next.instructions);
  const writeInstructions = force || !hadSeed || (input.seeded?.instructionsHash === currentHash && currentHash !== nextHash);
  const instructionsHash = writeInstructions ? nextHash : (input.seeded?.instructionsHash ?? currentHash);
  return {
    role,
    reportsTo,
    capabilities,
    writeAgent: role !== input.role || reportsTo !== input.reportsTo || capabilities !== (input.capabilities ?? ""),
    writeInstructions,
    instructions: input.next.instructions,
    seeded: { role, reportsTo, capabilities, instructionsHash },
  };
}
