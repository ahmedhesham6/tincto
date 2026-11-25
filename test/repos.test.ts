import { afterAll, beforeEach, expect, test as plainTest } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as Test from "@alchemy.run/test/Bun";
import * as Effect from "effect/Effect";
import { providers } from "../src/Providers.ts";
import { GitHubLogin } from "../src/repos/GitHubLogin.ts";
import { GitRepo } from "../src/repos/GitRepo.ts";
import { repoSource } from "../src/repos/index.ts";
import { fakeMachine } from "../src/testing.ts";

const machine = fakeMachine();
beforeEach(() => {
  machine.reset();
  machine.bin("gh", "exit 1");
});
afterAll(machine.close);

// A real repository on this computer, so the test runs a real `git clone`.
const origin = join(machine.dir, "origin");
mkdirSync(origin);
const git = (...args: string[]) =>
  execFileSync("git", ["-C", origin, "-c", "user.name=t", "-c", "user.email=t@t", ...args]);
git("init", "-q", "-b", "main");
writeFileSync(join(origin, "README.md"), "hello");
git("add", ".");
git("commit", "-q", "-m", "first");

const { test } = Test.make({ providers: providers() });
const news = { sshDest: "box", url: origin, path: "repos/origin" };

test.provider("GitRepo clones the repository, and does not touch a clone that is there", (stack) =>
  Effect.gen(function* () {
    expect(yield* stack.deploy(GitRepo("Repo", news))).toEqual({ path: "repos/origin" });
    expect(machine.read("repos/origin/README.md")).toBe("hello");

    // Work of a person in the clone stays after the next deploy that runs the resource.
    writeFileSync(join(machine.home, "repos/origin/README.md"), "my change");
    yield* stack.deploy(GitRepo("Repo", news), { force: true });
    expect(machine.read("repos/origin/README.md")).toBe("my change");

    // Destroy leaves the clone.
    yield* stack.destroy();
    expect(machine.read("repos/origin/README.md")).toBe("my change");
  }),
);

test.provider("GitRepo gives the GitHub token of this computer to the clone command only", (stack) =>
  Effect.gen(function* () {
    machine.bin("gh", 'echo "token-123"');
    machine.record("git");
    yield* stack.deploy(GitRepo("Repo", { ...news, url: "https://github.com/me/private.git", path: "repos/private" }));
    const header = `Authorization: Basic ${Buffer.from("x-access-token:token-123").toString("base64")}`;
    expect(machine.calls()).toEqual([
      `git -c http.https://github.com/.extraheader=${header} clone https://github.com/me/private.git ${machine.home}/repos/private`,
    ]);
  }),
);

test.provider("GitRepo sends no token to a host that is not GitHub", (stack) =>
  Effect.gen(function* () {
    machine.bin("gh", 'echo "token-123"');
    machine.record("git");
    yield* stack.deploy(GitRepo("Repo", { ...news, url: "https://example.com/me/repo.git", path: "repos/repo" }));
    expect(machine.calls()).toEqual([`git clone https://example.com/me/repo.git ${machine.home}/repos/repo`]);
  }),
);

test.provider("GitRepo refuses a path that is not below the home directory", (stack) =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(stack.deploy(GitRepo("Repo", { ...news, path: "../outside" })));
    expect(String(error)).toContain("not a path below the home directory");
  }),
);

test.provider("GitRepo fails when the clone fails", (stack) =>
  Effect.gen(function* () {
    yield* Effect.flip(stack.deploy(GitRepo("Repo", { ...news, url: join(machine.dir, "missing") })));
  }),
);

plainTest("repoSource reads a GitHub owner/name and a full URL", () => {
  expect(repoSource("example/alpha")).toEqual({
    url: "https://github.com/example/alpha.git",
    name: "alpha",
  });
  expect(repoSource("git@github.com:me/thing.git")).toEqual({ url: "git@github.com:me/thing.git", name: "thing" });
  expect(repoSource("https://gitlab.com/group/sub/repo")).toEqual({
    url: "https://gitlab.com/group/sub/repo",
    name: "repo",
  });
});

test.provider("GitHubLogin gives the token of this computer to gh on the machine through stdin", (stack) =>
  Effect.gen(function* () {
    // One fake stands for gh on this computer (`auth token`) and gh on the machine.
    machine.bin(
      "gh",
      `case "$*" in
  "auth token") echo "token-123" ;;
  "auth login"*) cat > "$HOME/token-on-machine"; echo "gh $*" >> "${machine.dir}/log" ;;
  "auth logout"*) echo "gh $*" >> "${machine.dir}/log" ;;
  "api user"*) echo "octocat" ;;
esac`,
    );
    expect(yield* stack.deploy(GitHubLogin("Login", { sshDest: "box" }))).toEqual({ user: "octocat" });
    expect(machine.read("token-on-machine")).toBe("token-123\n");
    // The token is not an argument of a command.
    expect(machine.calls()).toEqual(["gh auth login --hostname github.com --with-token"]);

    // Destroy logs out on the machine.
    yield* stack.destroy();
    expect(machine.calls().at(-1)).toBe("gh auth logout --hostname github.com");
  }),
);

test.provider("GitHubLogin says what to do when this computer has no GitHub login", (stack) =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(stack.deploy(GitHubLogin("Login", { sshDest: "box" })));
    expect(String(error)).toContain("Run `gh auth login` here first");
  }),
);
