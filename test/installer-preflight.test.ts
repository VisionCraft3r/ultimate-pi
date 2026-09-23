import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MIN_NODE,
  nodeInstallHint,
  piInstallCommand,
  tmuxInstallCommand,
} from "../installer/preflight.mjs";

test("tmuxInstallCommand matches the user's OS package manager", () => {
  assert.equal(tmuxInstallCommand("darwin"), "brew install tmux");
  assert.equal(tmuxInstallCommand("linux", "ID=ubuntu\n"), "sudo apt-get install tmux");
  assert.equal(tmuxInstallCommand("linux", "ID=debian\n"), "sudo apt-get install tmux");
  assert.equal(
    tmuxInstallCommand("linux", 'ID=ubuntu\nID_LIKE=debian\n'),
    "sudo apt-get install tmux",
  );
  assert.match(tmuxInstallCommand("linux", "ID=fedora\n"), /sudo apt-get install tmux/);
  assert.match(tmuxInstallCommand("win32"), /brew install tmux/);
  assert.match(tmuxInstallCommand("win32"), /sudo apt-get install tmux/);
});

test("nodeInstallHint points at nvm and nodejs.org for the minimum version", () => {
  const hint = nodeInstallHint();
  assert.match(hint, /nvm/);
  assert.match(hint, /nodejs\.org/);
  assert.match(hint, new RegExp(`${MIN_NODE.major}\\.${MIN_NODE.minor}`));
  assert.match(hint, /cannot install Node/i);
});

test("piInstallCommand is the documented global Pi CLI package", () => {
  assert.equal(piInstallCommand(), "npm i -g @earendil-works/pi-coding-agent");
});
