import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const PI_SKILL_KEY_PREFIX = "plugin/visioncraft3r-ultimate-pi";

export type PiSkillDeclaration = {
  skillKey: string;
  displayName: string;
  slug: string;
  description: string;
  markdown: string;
  directory: string;
};

export type SkillSnapshotEntry = {
  key: string;
  runtimeName: string | null;
  desired: boolean;
  managed: boolean;
  state: "available" | "installed" | "external";
  origin: "company_managed" | "user_installed";
  originLabel: string;
  readOnly: boolean;
  sourcePath: string | null;
  targetPath: string | null;
  detail: string | null;
};

export type SkillSnapshot = {
  adapterType: string;
  supported: true;
  mode: "persistent";
  desiredSkills: string[];
  desiredSkillEntries: Array<{ key: string; versionId: null }>;
  entries: SkillSnapshotEntry[];
  warnings: string[];
};

type RuntimeSkill = { key: string; runtimeName: string; source: string };

export function defaultAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
}

export function skillsHome(agentDir: string): string {
  return join(agentDir, "skills");
}

export function piSkillKey(skillKey: string): string {
  return `${PI_SKILL_KEY_PREFIX}/${skillKey}`;
}

function frontmatterField(markdown: string, key: string): string {
  const match = markdown.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  const value = match?.[1]?.trim() ?? "";
  return value.replace(/^["']|["']$/g, "");
}

function readSkillDir(directory: string, skillKey: string): PiSkillDeclaration | null {
  const file = join(directory, "SKILL.md");
  if (!existsSync(file)) return null;
  const markdown = readFileSync(file, "utf8");
  const name = frontmatterField(markdown, "name") || skillKey;
  const description = frontmatterField(markdown, "description") || name;
  return { skillKey, displayName: name, slug: skillKey, description, markdown, directory };
}

export function piSkillDeclarations(agentDir = defaultAgentDir()): PiSkillDeclaration[] {
  const home = skillsHome(agentDir);
  if (!existsSync(home)) return [];
  const found: PiSkillDeclaration[] = [];
  for (const entry of readdirSync(home, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const skill = readSkillDir(join(home, entry.name), entry.name);
    if (skill) found.push(skill);
  }
  return found.sort((left, right) => left.skillKey.localeCompare(right.skillKey));
}

function packageRoots(agentDir: string): string[] {
  const root = join(agentDir, "npm", "node_modules");
  if (!existsSync(root)) return [];
  const roots: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = join(root, entry.name);
    if (entry.name.startsWith("@")) {
      for (const scoped of readdirSync(full, { withFileTypes: true })) {
        if (scoped.isDirectory()) roots.push(join(full, scoped.name));
      }
      continue;
    }
    roots.push(full);
  }
  return roots;
}

export function packageSkillDeclarations(agentDir = defaultAgentDir()): PiSkillDeclaration[] {
  const found: PiSkillDeclaration[] = [];
  for (const root of packageRoots(agentDir)) {
    const skills = join(root, "skills");
    if (!existsSync(skills)) continue;
    for (const entry of readdirSync(skills, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skill = readSkillDir(join(skills, entry.name), entry.name);
      if (skill) found.push(skill);
    }
  }
  return found.sort((left, right) => left.skillKey.localeCompare(right.skillKey));
}

export function readIgnoredSkills(agentDir: string): Set<string> {
  const ignored = new Set<string>();
  try {
    const text = readFileSync(join(skillsHome(agentDir), ".ignore"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const name = line.trim().replace(/\/$/, "");
      if (!name || name.startsWith("#")) continue;
      ignored.add(name);
    }
  } catch {
    // No ignore file means every skill in the folder is on.
  }
  return ignored;
}

export function writeIgnoredSkills(agentDir: string, names: readonly string[]): void {
  const home = skillsHome(agentDir);
  mkdirSync(home, { recursive: true });
  const body = [...new Set(names)].sort().map((name) => `${name}/`).join("\n");
  writeFileSync(join(home, ".ignore"), body.length > 0 ? `${body}\n` : "");
}

function desiredKeys(config: Record<string, unknown>): string[] {
  const raw = config.paperclipSkillSync;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const list = (raw as { desiredSkills?: unknown }).desiredSkills;
  if (!Array.isArray(list)) return [];
  return list.flatMap((value) => {
    if (typeof value === "string" && value.trim()) return [value.trim()];
    if (value && typeof value === "object" && typeof (value as { key?: unknown }).key === "string") {
      const key = (value as { key: string }).key.trim();
      return key ? [key] : [];
    }
    return [];
  });
}

function runtimeSkills(config: Record<string, unknown>): RuntimeSkill[] {
  const raw = config.paperclipRuntimeSkills;
  if (!Array.isArray(raw)) return [];
  const out: RuntimeSkill[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as { key?: unknown; runtimeName?: unknown; name?: unknown; source?: unknown };
    const key = typeof record.key === "string" ? record.key.trim() : "";
    const runtimeName = typeof record.runtimeName === "string" ? record.runtimeName.trim()
      : typeof record.name === "string" ? record.name.trim() : "";
    const source = typeof record.source === "string" ? record.source.trim() : "";
    if (key && runtimeName && source) out.push({ key, runtimeName, source });
  }
  return out;
}

function matchesPiSkill(key: string, skillKey: string): boolean {
  return key === piSkillKey(skillKey) || key === skillKey || key.endsWith(`/${skillKey}`);
}

function isPiKey(key: string, skills: readonly PiSkillDeclaration[]): boolean {
  return skills.some((skill) => matchesPiSkill(key, skill.skillKey));
}

export function skillSnapshot(agentDir: string, config: Record<string, unknown> = {}): SkillSnapshot {
  const skills = piSkillDeclarations(agentDir);
  const ignored = readIgnoredSkills(agentDir);
  const stored = desiredKeys(config);
  const enabled = skills.filter((skill) => !ignored.has(skill.skillKey)).map((skill) => piSkillKey(skill.skillKey));
  const bundled = stored.filter((key) => !isPiKey(key, skills));
  const desired = [...enabled, ...bundled];
  const entries: SkillSnapshotEntry[] = skills.map((skill) => {
    const on = !ignored.has(skill.skillKey);
    return {
      key: piSkillKey(skill.skillKey),
      runtimeName: skill.skillKey,
      desired: on,
      managed: true,
      state: on ? "installed" : "available",
      origin: "company_managed",
      originLabel: "Ultimate PI",
      readOnly: false,
      sourcePath: skill.directory,
      targetPath: skill.directory,
      detail: on ? "Loaded by every Pi session." : "Ignored. Pi will not load this skill.",
    };
  });
  for (const skill of packageSkillDeclarations(agentDir)) {
    entries.push({
      key: `package/${skill.skillKey}`,
      runtimeName: skill.skillKey,
      desired: true,
      managed: false,
      state: "external",
      origin: "user_installed",
      originLabel: "Pi package",
      readOnly: true,
      sourcePath: skill.directory,
      targetPath: skill.directory,
      detail: "Installed by a Pi package. A skill switch cannot turn this off.",
    });
  }
  entries.sort((left, right) => left.key.localeCompare(right.key));
  return {
    adapterType: "ultimate_pi",
    supported: true,
    mode: "persistent",
    desiredSkills: desired,
    desiredSkillEntries: desired.map((key) => ({ key, versionId: null })),
    entries,
    warnings: [],
  };
}

function linkBundledSkill(source: string, target: string): void {
  const existing = existsSync(target) ? lstatSync(target) : null;
  if (existing && !existing.isSymbolicLink()) return;
  if (existing?.isSymbolicLink()) {
    const linked = resolve(target, "..", readlinkSync(target));
    if (linked === resolve(source)) return;
    unlinkSync(target);
  }
  symlinkSync(source, target);
}

function unlinkBundledSkill(target: string): void {
  let existing;
  try {
    existing = lstatSync(target);
  } catch {
    return;
  }
  if (!existing.isSymbolicLink()) return;
  unlinkSync(target);
}

function skillDisplayName(directory: string): string | null {
  const skill = readSkillDir(directory, "");
  const name = skill?.displayName.trim();
  return name ? name : null;
}

/** Names already provided by real skill directories. Symlinks are not names of their own. */
function installedSkillNames(home: string): Set<string> {
  const names = new Set<string>();
  if (!existsSync(home)) return names;
  for (const entry of readdirSync(home, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.isSymbolicLink() || !entry.isDirectory()) continue;
    const name = skillDisplayName(join(home, entry.name));
    if (name) names.add(name);
  }
  return names;
}

function dropCollidingSkillLinks(home: string, taken: ReadonlySet<string>): void {
  if (!existsSync(home)) return;
  for (const entry of readdirSync(home, { withFileTypes: true })) {
    if (!entry.isSymbolicLink()) continue;
    const target = join(home, entry.name);
    let source = "";
    try {
      source = resolve(target, "..", readlinkSync(target));
    } catch {
      continue;
    }
    const name = skillDisplayName(source);
    if (name && taken.has(name)) unlinkBundledSkill(target);
  }
}

export function syncSkillSelection(agentDir: string, desired: readonly string[], config: Record<string, unknown> = {}): SkillSnapshot {
  const skills = piSkillDeclarations(agentDir);
  const disabled = skills.filter((skill) => !desired.some((key) => matchesPiSkill(key, skill.skillKey))).map((skill) => skill.skillKey);
  writeIgnoredSkills(agentDir, disabled);
  const home = skillsHome(agentDir);
  mkdirSync(home, { recursive: true });
  const taken = installedSkillNames(home);
  dropCollidingSkillLinks(home, taken);
  for (const entry of runtimeSkills(config)) {
    if (skills.some((skill) => skill.skillKey === entry.runtimeName)) continue;
    const target = join(home, entry.runtimeName);
    const sourceName = skillDisplayName(entry.source);
    if (desired.includes(entry.key) && sourceName && taken.has(sourceName)) {
      unlinkBundledSkill(target);
      continue;
    }
    if (desired.includes(entry.key)) linkBundledSkill(entry.source, target);
    else unlinkBundledSkill(target);
  }
  const nextConfig = {
    ...config,
    paperclipSkillSync: { desiredSkills: [...desired] },
  };
  return skillSnapshot(agentDir, nextConfig);
}
