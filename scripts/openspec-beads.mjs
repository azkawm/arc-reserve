#!/usr/bin/env node
// Bridge between OpenSpec change proposals and the beads issue tracker.
//
//   node scripts/openspec-beads.mjs import <change> [--parallel-groups] [--include-done] [--dry-run]
//   node scripts/openspec-beads.mjs status <change>
//
// `import` turns openspec/changes/<change>/tasks.md into one epic bead plus one
// task bead per checkbox, chained with blocking dependencies so `bd ready`
// surfaces exactly the tasks whose prerequisites are closed.
//
// `status` reports the checkbox state in tasks.md next to the bead status, and
// exits non-zero when the two disagree. It never rewrites tasks.md: ticking a
// checkbox stays the job of /opsx:apply.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const USAGE = `Usage:
  node scripts/openspec-beads.mjs import <change> [--parallel-groups] [--include-done] [--dry-run]
  node scripts/openspec-beads.mjs status <change>

Options:
  --parallel-groups  Chain tasks only within each "## N." group, leaving the
                     groups independent. Default chains every task in file
                     order, matching OpenSpec's "order tasks by dependency".
  --include-done     Also create beads for tasks already ticked [x]; they are
                     created and then closed. Default skips them.
  --dry-run          Print the graph plan without writing anything.`;

class UserError extends Error {}

function bd(args, { json = false } = {}) {
  const out = execFileSync("bd", args, { encoding: "utf8" });
  return json ? JSON.parse(out) : out;
}

/**
 * Parse an OpenSpec tasks.md.
 *
 * The OpenSpec template is strict: groups are `## N. Name` and every task is
 * `- [ ] N.M Description`. Anything else is not a task, by OpenSpec's own rule
 * that untracked lines are not parsed, so we ignore it rather than guessing.
 */
function parseTasks(markdown) {
  const groups = [];
  let current = null;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();

    const groupMatch = /^##\s+(\d+)\.\s*(.*)$/.exec(line);
    if (groupMatch) {
      current = { number: groupMatch[1], name: groupMatch[2].trim() || `Group ${groupMatch[1]}`, tasks: [] };
      groups.push(current);
      continue;
    }

    const taskMatch = /^-\s+\[([ xX])\]\s+(\d+\.\d+)\s+(.*)$/.exec(line);
    if (!taskMatch) continue;
    if (!current) throw new UserError(`Task "${taskMatch[2]}" appears before any "## N." group heading.`);

    const title = taskMatch[3].trim();
    if (!title) throw new UserError(`Task ${taskMatch[2]} has no description.`);
    current.tasks.push({ number: taskMatch[2], title, done: taskMatch[1].toLowerCase() === "x" });
  }

  return groups;
}

function buildPlan(change, groups, { parallelGroups, includeDone }) {
  const label = `openspec:${change}`;
  const nodes = [
    {
      key: "epic",
      title: `OpenSpec: ${change}`,
      type: "epic",
      priority: 1,
      description: `Implementation of the OpenSpec change "${change}".\n\nProposal: openspec/changes/${change}/proposal.md\nDesign:   openspec/changes/${change}/design.md\nTasks:    openspec/changes/${change}/tasks.md`,
      labels: ["openspec", label],
    },
  ];
  const edges = [];
  const closeAfterCreate = [];

  let previousKey = null;
  for (const group of groups) {
    if (parallelGroups) previousKey = null;

    for (const task of group.tasks) {
      if (task.done && !includeDone) {
        // A ticked task is already implemented; it is not work to schedule.
        // Skipping it also means it cannot block the tasks that follow.
        continue;
      }

      const key = `t${task.number}`;
      nodes.push({
        key,
        title: `${task.number} ${task.title}`,
        type: "task",
        priority: 2,
        parent_key: "epic",
        description: `From openspec/changes/${change}/tasks.md, group "${group.number}. ${group.name}".`,
        labels: ["openspec", label],
      });

      if (task.done) closeAfterCreate.push(key);

      // Edge direction is the one beads footgun here: {from_key, to_key} with
      // type "blocks" records "from depends on to", i.e. from is BLOCKED BY to.
      if (previousKey) edges.push({ from_key: key, to_key: previousKey, type: "blocks" });
      previousKey = key;
    }
  }

  if (nodes.length === 1) {
    throw new UserError(
      `No open tasks found in openspec/changes/${change}/tasks.md.` +
        ` Tasks must match the OpenSpec template: "- [ ] N.M Description" under a "## N. Group" heading.`,
    );
  }

  return { plan: { nodes, edges }, label, closeAfterCreate };
}

function importChange(change, options) {
  const tasksPath = `openspec/changes/${change}/tasks.md`;
  let markdown;
  try {
    markdown = readFileSync(tasksPath, "utf8");
  } catch {
    throw new UserError(`Cannot read ${tasksPath}. Run /opsx:propose first, or check the change name.`);
  }

  const groups = parseTasks(markdown);
  const { plan, label, closeAfterCreate } = buildPlan(change, groups, options);

  if (options.dryRun) {
    console.log(JSON.stringify(plan, null, 2));
    console.log(`\n(dry run) ${plan.nodes.length - 1} task bead(s) + 1 epic, ${plan.edges.length} dependency edge(s).`);
    return;
  }

  const existing = bd(["list", "-l", label, "--status", "open,in_progress,blocked,deferred,closed", "--json"], {
    json: true,
  });
  if (Array.isArray(existing) && existing.length > 0) {
    throw new UserError(
      `${existing.length} bead(s) already carry the label "${label}".` +
        ` Re-importing would duplicate them. Inspect with:\n` +
        `  bd list -l ${label}\n  node scripts/openspec-beads.mjs status ${change}`,
    );
  }

  const planPath = join(mkdtempSync(join(tmpdir(), "openspec-beads-")), "plan.json");
  writeFileSync(planPath, JSON.stringify(plan));
  const output = bd(["create", "--graph", planPath]);
  process.stdout.write(output);

  if (closeAfterCreate.length > 0) {
    const created = bd(["list", "-l", label, "--json"], { json: true });
    const byTitle = new Map(created.map((issue) => [issue.title, issue.id]));
    for (const key of closeAfterCreate) {
      const node = plan.nodes.find((candidate) => candidate.key === key);
      const id = byTitle.get(node.title);
      if (!id) throw new UserError(`Created bead for "${node.title}" could not be found to close it.`);
      bd(["close", id, "--reason", "Already ticked in tasks.md at import time"]);
      console.log(`  closed ${id} (${node.title})`);
    }
  }

  console.log(`\nNext: bd ready    # shows the first unblocked task of "${change}"`);
}

function statusChange(change) {
  const tasksPath = `openspec/changes/${change}/tasks.md`;
  let markdown;
  try {
    markdown = readFileSync(tasksPath, "utf8");
  } catch {
    throw new UserError(`Cannot read ${tasksPath}.`);
  }

  const groups = parseTasks(markdown);
  const label = `openspec:${change}`;
  const beads = bd(["list", "-l", label, "--status", "open,in_progress,blocked,deferred,closed", "--json"], {
    json: true,
  });

  // Match on the "N.M " prefix the import writes into every bead title.
  const byNumber = new Map();
  for (const bead of beads) {
    const match = /^(\d+\.\d+)\s/.exec(bead.title ?? "");
    if (match) byNumber.set(match[1], bead);
  }

  // A ticked task with no bead is expected: `import` skips already-done tasks.
  // Every other disagreement is real and worth a non-zero exit.
  const problems = [];
  console.log(`OpenSpec change "${change}" vs beads label "${label}"\n`);
  for (const group of groups) {
    console.log(`## ${group.number}. ${group.name}`);
    for (const task of group.tasks) {
      const bead = byNumber.get(task.number);
      let note = "";
      if (!bead) {
        if (!task.done) note = "not imported — re-run import, or this task was added after it";
      } else if (bead.status === "closed" && !task.done) {
        note = "bead closed but checkbox unticked — /opsx:apply has not recorded it";
      } else if (bead.status !== "closed" && task.done) {
        note = "checkbox ticked but bead still open — close the bead";
      }
      if (note) problems.push(`${task.number}: ${note}`);

      const flag = note ? "!!" : "  ";
      const box = task.done ? "[x]" : "[ ]";
      const beadCell = bead ? `${bead.id} ${bead.status}` : "- (no bead)";
      console.log(`  ${flag} ${box} ${task.number} ${task.title}  ->  ${beadCell}`);
    }
    console.log("");
  }

  if (problems.length > 0) {
    console.log(`${problems.length} disagreement(s) between tasks.md and beads:`);
    for (const problem of problems) console.log(`  ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log("tasks.md and beads agree.");
}

function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const change = argv[1];
  const flags = new Set(argv.slice(2));

  if (!command || command === "--help" || command === "-h") {
    console.log(USAGE);
    return;
  }
  if (!change || change.startsWith("-")) throw new UserError(`Missing <change> name.\n\n${USAGE}`);

  for (const flag of flags) {
    if (!["--parallel-groups", "--include-done", "--dry-run"].includes(flag)) {
      throw new UserError(`Unknown option "${flag}".\n\n${USAGE}`);
    }
  }

  if (command === "import") {
    importChange(change, {
      parallelGroups: flags.has("--parallel-groups"),
      includeDone: flags.has("--include-done"),
      dryRun: flags.has("--dry-run"),
    });
  } else if (command === "status") {
    statusChange(change);
  } else {
    throw new UserError(`Unknown command "${command}".\n\n${USAGE}`);
  }
}

try {
  main();
} catch (error) {
  if (error instanceof UserError) {
    console.error(`error: ${error.message}`);
    process.exit(1);
  }
  throw error;
}
