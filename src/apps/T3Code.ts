import { Resource } from "alchemy/Resource";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type { Providers } from "../Providers.ts";
import { provider } from "../remote/provider.ts";
import { cleanUp, runScript } from "../remote/Ssh.ts";
import * as userService from "../remote/userService.ts";

export interface T3CodeProps {
  /** SSH destination of the machine. */
  sshDest: string;
  /** Version of the `t3` tool on the machine. The script does not read it: a new version restarts the service. */
  version: string;
  /** Address that the server listens on. Use the tailnet address to keep it private. */
  host: string;
  port: number;
  /** Address at which the T3 Code app reaches the server, for example the Tailscale Serve URL. */
  publicUrl: string;
  /**
   * `false` stops the product usage events and the relay traces of the server
   * (`T3CODE_TELEMETRY_ENABLED=false`). With no value, T3 Code uses its own default.
   */
  telemetry?: boolean;
}

export interface T3CodeAttributes {
  /** Local address of the server, for a Serve rule. */
  url: string;
  /**
   * A link that pairs a T3 Code app with the server. The token in it is for
   * one use and stops one hour after the deploy that made it.
   */
  pairUrl: string;
}

/**
 * The T3 Code server as a systemd user service on the machine. Each run makes a
 * new pairing link, so a deploy that installs or upgrades T3 Code shows one.
 */
export type T3Code = Resource<"App.T3Code", T3CodeProps, T3CodeAttributes, never, Providers>;
export const T3Code = Resource<T3Code>("App.T3Code");

// `t3 service install` writes its own unit, and writes it again on each upgrade. The drop-in stays.
const install = `
T3CODE_HOME="$HOME/.t3" t3 service install
dropin="$HOME/.config/systemd/user/t3code.service.d"
mkdir -p "$dropin"
cat > "$dropin/override.conf" <<CONF
# Managed by tincto (App.T3Code).
[Service]
Environment=T3CODE_HOST=$T3CODE_HOST
Environment=T3CODE_PORT=$T3CODE_PORT
$T3CODE_TELEMETRY
${userService.unitPath}
CONF
${userService.start("t3code")}`;

// The token is short-lived, so it can be in the state of Alchemy and in the output of the deploy.
// On a new machine, the server makes its database at its first start. Until that is done,
// `t3` refuses each command that reads the database, so the script tries again for one minute.
const pair = `
problem="$(mktemp)"
trap 'rm -f "$problem"' EXIT
for attempt in $(seq 1 30); do
  T3CODE_HOME="$HOME/.t3" t3 auth pairing create --ttl 1h --label tincto --base-url "$PUBLIC_URL" --json 2> "$problem" && exit 0
  grep -q ServerOwnsDatabaseError "$problem" || break
  sleep 2
done
cat "$problem" >&2
exit 1`;

export class T3CodeError extends Data.TaggedError("T3CodeError")<{ message: string }> {}

export const T3CodeProvider = provider(T3Code, {
  reconcile: Effect.fn(function* ({ news }) {
    yield* runScript(news.sshDest, install, {
      T3CODE_HOST: news.host,
      T3CODE_PORT: String(news.port),
      // A line of the drop-in. A comment when the machine file gives no value.
      T3CODE_TELEMETRY:
        news.telemetry === undefined
          ? "# Telemetry: the default of T3 Code."
          : `Environment=T3CODE_TELEMETRY_ENABLED=${news.telemetry}`,
    });
    const paired = yield* runScript(news.sshDest, pair, { PUBLIC_URL: news.publicUrl });
    const pairUrl = yield* Effect.try({
      try: () => (JSON.parse(paired.stdout.slice(paired.stdout.indexOf("{"))) as { pairUrl: string }).pairUrl,
      catch: () => new T3CodeError({ message: `t3 did not print a pairing link: ${paired.stdout.slice(0, 300)}` }),
    });
    return { url: `http://${news.host}:${news.port}`, pairUrl };
  }),
  delete: ({ olds }) => cleanUp(olds.sshDest, userService.remove("t3code")),
});
