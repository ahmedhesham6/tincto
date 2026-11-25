import { afterAll, beforeEach, expect, test as plainTest } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readlinkSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as Test from "@alchemy.run/test/Bun";
import * as Effect from "effect/Effect";
import { Home } from "../src/agents/Home.ts";
import { Plugins } from "../src/agents/Plugins.ts";
import { Skills } from "../src/agents/Skills.ts";
import { stageAgents } from "../src/agents/stage.ts";
import { providers } from "../src/Providers.ts";
import { fakeMachine } from "../src/testing.ts";

const machine = fakeMachine(["skills", "claude", "codex", "pi"]);
beforeEach(machine.reset);
afterAll(machine.close);

// A small source tree, with the layout of machine/: two custom skills, one agent file, one home file.
const root = join(machine.dir, "source");
for (const name of ["alpha", "beta"]) {
  mkdirSync(join(root, "skills", name, "scripts"), { recursive: true });
  writeFileSync(join(root, "skills", name, "SKILL.md"), `# ${name}`);
  writeFileSync(join(root, "skills", name, "scripts/run.sh"), "#!/bin/sh\n", { mode: 0o755 });
}
mkdirSync(join(root, "agents/claude"), { recursive: true });
writeFileSync(join(root, "agents/claude/CLAUDE.md"), "rules");
mkdirSync(join(root, "home"));
writeFileSync(join(root, "home/zshrc"), "alias ll=ls");

const stage = (skills: string[]) =>
  stageAgents(
    {
      agents: { claude: { files: { "CLAUDE.md": ".claude/CLAUDE.md" }, skillsDir: ".claude/skills", skills } },
      home: { zshrc: ".zshrc" },
    },
    root,
    join(machine.dir, "staging"),
  );
const { test } = Test.make({ providers: providers() });

plainTest(
  "stage puts each custom skill once in the skill store, with a relative link for the agent that lists it",
  () => {
    const staged = stage(["alpha"]);
    expect(staged.entries).toEqual([".agents/skills/alpha", ".claude/CLAUDE.md", ".claude/skills/alpha", ".zshrc"]);
    expect(readlinkSync(join(staged.dir, ".claude/skills/alpha"))).toBe("../../.agents/skills/alpha");
    expect(existsSync(join(staged.dir, ".claude/skills/beta"))).toBe(false);
  },
);

plainTest(
  "stage gives a different hash when the content of a skill changes, and the same hash when nothing changes",
  () => {
    const before = stage(["beta"]).hash;
    expect(stage(["beta"]).hash).toBe(before);
    writeFileSync(join(root, "skills/beta/SKILL.md"), "# beta, changed");
    expect(stage(["beta"]).hash).not.toBe(before);
    writeFileSync(join(root, "skills/beta/SKILL.md"), "# beta");
  },
);

plainTest("stage names the skill that the config lists but machine/skills/ does not have", () => {
  expect(() => stage(["missing"])).toThrow('names the skill "missing"');
});

test.provider("Home copies the files, removes a skill that left the config, and keeps the mode of the home", (stack) =>
  Effect.gen(function* () {
    chmodSync(machine.home, 0o700);
    writeFileSync(join(machine.home, "mine.txt"), "not managed");
    const first = stage(["alpha", "beta"]);
    yield* stack.deploy(Home("Home", { sshDest: "box", ...first }));
    expect(machine.read(".claude/skills/beta/SKILL.md")).toBe("# beta");
    expect(statSync(join(machine.home, ".agents/skills/alpha/scripts/run.sh")).mode & 0o111).not.toBe(0);
    expect(statSync(machine.home).mode & 0o777).toBe(0o700);

    // A file that a person added to a managed skill goes away on the next deploy.
    writeFileSync(join(machine.home, ".agents/skills/alpha/stale.md"), "stale");
    const second = stage(["alpha"]);
    expect(yield* stack.deploy(Home("Home", { sshDest: "box", ...second }))).toEqual({ entries: second.entries });
    expect(machine.has(".agents/skills/beta")).toBe(false);
    expect(machine.has(".claude/skills/beta")).toBe(false);
    expect(machine.has(".agents/skills/alpha/stale.md")).toBe(false);
    expect(machine.read(".claude/CLAUDE.md")).toBe("rules");
    expect(machine.read("mine.txt")).toBe("not managed");

    // Destroy removes only the paths that Home owns.
    yield* stack.destroy();
    expect(machine.has(".agents/skills/alpha")).toBe(false);
    expect(machine.has(".zshrc")).toBe(false);
    expect(machine.read("mine.txt")).toBe("not managed");
  }),
);

test.provider("Home refuses a path that is not below the home directory", (stack) =>
  Effect.gen(function* () {
    const bad = { sshDest: "box", ...stage(["alpha"]), entries: ["../outside"] };
    const error = yield* Effect.flip(stack.deploy(Home("Home", bad)));
    expect(String(error)).toContain("not a path below the home directory");
  }),
);

test.provider(
  "Skills removes the skills that left the config, then adds each skill source in sequence and updates",
  (stack) =>
    Effect.gen(function* () {
      const olds = { sshDest: "box", sources: { "mattpocock/skills": ["tdd", "old"] }, agents: ["claude-code"] };
      yield* stack.deploy(Skills("Skills", olds));
      const before = machine.calls().length;

      const news = {
        sshDest: "box",
        sources: { "mattpocock/skills": ["grilling", "tdd"], "shadcn/improve": ["improve"] },
        agents: ["claude-code"],
      };
      expect(yield* stack.deploy(Skills("Skills", news))).toEqual({ skills: ["grilling", "tdd", "improve"] });
      expect(machine.calls().slice(before)).toEqual([
        "skills remove --global --yes --skill old",
        "skills add mattpocock/skills --global --yes --agent claude-code --skill grilling --skill tdd",
        "skills add shadcn/improve --global --yes --agent claude-code --skill improve",
        "skills update --global --yes",
      ]);
    }),
);

test.provider("Skills refuses a name with shell characters, and runs no command", (stack) =>
  Effect.gen(function* () {
    const news = { sshDest: "box", sources: { "a/b": ["ok", "$(touch /tmp/tincto-bad)"] }, agents: ["claude-code"] };
    const error = yield* Effect.flip(stack.deploy(Skills("Skills", news)));
    expect(String(error)).toContain("not a valid skill");
    expect(machine.calls()).toEqual([]);
  }),
);

test.provider("Skills destroy removes the skills that it installed", (stack) =>
  Effect.gen(function* () {
    yield* stack.deploy(
      Skills("Skills", { sshDest: "box", sources: { "a/b": ["grilling"] }, agents: ["claude-code"] }),
    );
    const before = machine.calls().length;
    yield* stack.destroy();
    expect(machine.calls().slice(before)).toEqual(["skills remove --global --yes --skill grilling"]);
  }),
);

const pstack = { name: "pstack@pstack-claude", marketplace: "michael-denyer/pstack-claude" };

test.provider("Plugins installs and updates a plugin with the commands of the agent", (stack) =>
  Effect.gen(function* () {
    // A deploy removes each resource that is not in it. Thus each agent has its own deploy,
    // and the test reads the calls before the destroy.
    const installs: string[][] = [];
    const deploy = (props: Plugins["Props"]) =>
      Effect.gen(function* () {
        machine.reset();
        const output = yield* stack.deploy(Plugins("Plugins", props));
        installs.push(machine.calls());
        yield* stack.destroy();
        return output;
      });
    expect(yield* deploy({ sshDest: "box", agent: "claude", plugins: [pstack] })).toEqual({
      names: ["pstack@pstack-claude"],
    });
    yield* deploy({ sshDest: "box", agent: "codex", plugins: [pstack] });
    yield* deploy({ sshDest: "box", agent: "pi", plugins: [{ name: "git:github.com/earendil-works/pi-review" }] });
    expect(installs.flat()).toEqual([
      "claude plugin marketplace add michael-denyer/pstack-claude",
      "claude plugin marketplace update pstack-claude",
      "claude plugin install pstack@pstack-claude",
      "claude plugin update pstack@pstack-claude",
      "codex plugin marketplace add michael-denyer/pstack-claude",
      "codex plugin marketplace upgrade",
      "codex plugin add pstack@pstack-claude",
      "pi install git:github.com/earendil-works/pi-review",
      "pi update git:github.com/earendil-works/pi-review",
    ]);
  }),
);

test.provider("Plugins removes a plugin that left the config, and destroy removes the others", (stack) =>
  Effect.gen(function* () {
    const keep = { name: "git:example.com/keep" };
    yield* stack.deploy(
      Plugins("Pi", { sshDest: "box", agent: "pi", plugins: [keep, { name: "git:example.com/old" }] }),
    );
    const before = machine.calls().length;
    yield* stack.deploy(Plugins("Pi", { sshDest: "box", agent: "pi", plugins: [keep] }));
    expect(machine.calls()[before]).toBe("pi remove git:example.com/old");
    const updated = machine.calls().length;
    yield* stack.destroy();
    expect(machine.calls().slice(updated)).toEqual(["pi remove git:example.com/keep"]);
  }),
);

test.provider("Plugins refuses a name with shell characters, and runs no command", (stack) =>
  Effect.gen(function* () {
    const news = { sshDest: "box", agent: "claude" as const, plugins: [{ name: "x; rm -rf ~" }] };
    const error = yield* Effect.flip(stack.deploy(Plugins("Claude", news)));
    expect(String(error)).toContain("not a valid plugin");
    expect(machine.calls()).toEqual([]);
  }),
);
