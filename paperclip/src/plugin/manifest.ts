import { piSkillDeclarations } from "../pi-skills.ts";

const manifest = {
  id: "visioncraft3r.ultimate-pi",
  apiVersion: 1,
  version: "1.5.0",
  displayName: "Ultimate PI",
  description: "Scoped models, personas, and tmux-backed Ultimate PI hires.",
  author: "VisionCraft3r",
  categories: ["automation"],
  capabilities: [
    "events.subscribe",
    "agents.managed",
    "agents.read",
    "issues.read",
    "issue.comments.read",
    "approvals.read",
    "instance.settings.register",
    "ui.sidebar.register",
    "ui.dashboardWidget.register",
    "skills.managed",
    "companies.read",
    "plugin.state.read",
    "plugin.state.write",
  ],
  entrypoints: {
    worker: "./dist/plugin/worker.js",
    ui: "./dist/ui",
  },
  agents: [
    ["orchestrator", "Ultimate PI", "ceo", "Board tasks land here. jev_triage decides the tier, then this agent delegates with subagent. Paperclip mirrors each pane as a sub-task."],
    ["scout", "Scout", "general", "Tier 2 reconnaissance. Ultimate PI assigns file and line maps here before a worker edits."],
    ["worker", "Worker", "engineer", "Tier 1 edits, tier 2 after Scout, and tier 3 after the Planner spec is approved."],
    ["planner", "Planner", "pm", "Tier 3 specs. Ultimate PI assigns the breakdown here. The spec goes back to Ultimate PI, then to Worker."],
    ["researcher", "Researcher", "researcher", "External docs. Ultimate PI assigns research here when the work needs sources outside the repo."],
    ["qa_tester", "QA Tester", "qa", "Tier 4 live UI checks. Ultimate PI assigns browser QA here."],
    ["reviewer", "Reviewer", "reviewer", "Read-only review after a worker wave, and tier 5 code or project audits."],
  ].map(([agentKey, displayName, role, capabilities]) => ({
    agentKey,
    displayName,
    role,
    title: displayName,
    capabilities,
    adapterType: "ultimate_pi",
    adapterConfig: { persona: agentKey },
    instructions: { content: `${displayName} runs as Ultimate PI persona ${agentKey}.` },
  })),
  ui: {
    slots: [
      {
        type: "companySettingsPage",
        id: "ultimate-pi-setup",
        displayName: "Ultimate PI",
        exportName: "UltimatePiSetup",
        routePath: "ultimate-pi",
      },
      {
        type: "sidebar",
        id: "ultimate-pi-questions",
        displayName: "Questions",
        exportName: "QuestionSidebar",
      },
      {
        type: "dashboardWidget",
        id: "ultimate-pi-question-card",
        displayName: "Ultimate PI questions",
        exportName: "QuestionDashboard",
      },
      {
        type: "dashboardWidget",
        id: "ultimate-pi-running",
        displayName: "Running agents",
        exportName: "RunningDashboard",
      },
    ],
  },
  skills: piSkillDeclarations().map((skill) => ({
    skillKey: skill.skillKey,
    displayName: skill.displayName,
    slug: skill.slug,
    description: skill.description,
    markdown: skill.markdown,
  })),
};

export default manifest;
