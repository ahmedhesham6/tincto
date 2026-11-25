import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import * as Tincto from "tincto";

/** A machine that exists. For an exe.dev VM: `const host = yield* Tincto.ExeHost("Vm", { cpu: 2 })`. */
export const host: Tincto.Host = { sshDest: "box" };

/**
 * An example machine with each component of tincto. The full deploy test runs it
 * against a fake machine. The files that it names are in ../machine/.
 */
export const example = Effect.gen(function* () {
  const tools = yield* Tincto.Toolchain("Tools", {
    host,
    apt: ["curl", "ca-certificates", "git", "unzip"],
    services: ["docker"],
    minimumReleaseAge: "0s",
    tools: {
      node: "24",
      gh: "latest",
      claude: "latest",
      codex: "latest",
      pi: "latest",
      "npm:skills": "latest",
      "npm:t3": "nightly",
      "npm:bb-app": "latest",
    },
  });
  const tailnet = yield* Tincto.Tailnet("Tailscale", { host: tools.base, tags: [], ssh: true });

  yield* Tincto.Agents("Home", {
    tools,
    home: { zshrc: ".zshrc" },
    agents: {
      claude: {
        plugins: [{ name: "tools@example-tools", marketplace: "example/tools" }],
        files: { "CLAUDE.md": ".claude/CLAUDE.md" },
        skillsDir: ".claude/skills",
        skills: ["hello"],
      },
      codex: {
        plugins: [{ name: "tools@example-tools", marketplace: "example/tools" }],
        files: { "AGENTS.md": ".codex/AGENTS.md" },
        skillsDir: ".codex/skills",
        skills: ["hello"],
      },
      pi: {
        plugins: [{ name: "git:github.com/example/pi-tools" }],
        files: {},
        skillsDir: ".pi/agent/skills",
        skills: [],
      },
    },
    skills: { agents: ["claude-code"], sources: { "vercel-labs/skills": ["find-skills"] } },
  });

  const clones = yield* Tincto.Repos("Repos", {
    host: tools.host,
    githubLogin: true,
    dir: "repos",
    sources: ["example/alpha", "example/beta"],
  });
  const t3code = yield* Tincto.T3Code("T3Code", { tools, tailnet, port: 3999, servePort: 9443, projects: clones });
  const bb = yield* Tincto.BbMachine("BbMachine", { tools });
  yield* Tincto.Serve("Serve", { tailnet, rules: [t3code.serve] });

  return {
    ssh: host.sshDest,
    tailnet: tailnet.device.dnsName,
    t3code: t3code.url,
    t3codePair: t3code.pairUrl,
    bbMachine: bb.hostId,
  };
});

export default Alchemy.Stack("example-box", { providers: Tincto.providers(), state: Alchemy.localState() }, example);
