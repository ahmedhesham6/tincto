import { Resource } from "alchemy/Resource";
import * as Config from "effect/Config";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import type { Providers } from "../Providers.ts";
import { provider, replaceOn } from "../remote/provider.ts";
import { runOk } from "../remote/Shell.ts";
import { runScript } from "../remote/Ssh.ts";

export interface TailscaleDeviceProps {
  /** SSH destination of the machine. A new destination replaces the device. */
  sshDest: string;
  /** Host name in the tailnet. */
  hostname: string;
  /** Tags for the device, for example `tag:dev`. An OAuth client needs a minimum of one tag. */
  tags: string[];
  /** Let Tailscale SSH accept connections. */
  ssh: boolean;
}

export interface TailscaleDeviceAttributes {
  /** Stable node ID. The Tailscale API accepts it as the device ID. */
  nodeId: string;
  /** MagicDNS name, for example `box.tail1234.ts.net`. */
  dnsName: string;
  ipv4: string;
}

/**
 * The machine as a device in your tailnet. To join, the provider makes an
 * auth key with the Tailscale API (`TAILSCALE_API_KEY`). The key is for one
 * use and stops after ten minutes, and it is not kept in state. Destroy
 * removes the device from the tailnet.
 */
export type TailscaleDevice = Resource<
  "Tailscale.Device",
  TailscaleDeviceProps,
  TailscaleDeviceAttributes,
  never,
  Providers
>;
export const TailscaleDevice = Resource<TailscaleDevice>("Tailscale.Device");

export class TailscaleError extends Data.TaggedError("TailscaleError")<{ message: string }> {}

/**
 * Calls the Tailscale API with curl. The request goes to curl through stdin, so
 * the API key is not in a process argument. Returns the HTTP status and the body.
 */
const api = (method: string, path: string, body?: unknown) =>
  Effect.gen(function* () {
    // The key is a secret, so it is not a prop: Alchemy keeps props in its state.
    // effect/Config reads it from the environment, where the Alchemy CLI puts the values of .env.
    const key = yield* Config.Redacted("TAILSCALE_API_KEY").pipe(
      Effect.mapError(() => new TailscaleError({ message: "Set TAILSCALE_API_KEY, for example in .env." })),
    );
    const config = [
      `url = "https://api.tailscale.com/api/v2${path}"`,
      `request = "${method}"`,
      `header = ${JSON.stringify(`Authorization: Bearer ${Redacted.value(key)}`)}`,
      ...(body ? [`header = "Content-Type: application/json"`, `data = ${JSON.stringify(JSON.stringify(body))}`] : []),
      `write-out = "\\n%{http_code}"`,
    ].join("\n");
    const result = yield* runOk("curl", ["--silent", "--show-error", "--max-time", "30", "--config", "-"], {
      stdin: config,
    });
    const split = result.stdout.lastIndexOf("\n");
    return { status: Number(result.stdout.slice(split + 1)), body: result.stdout.slice(0, split) };
  });

// The exeuntu image has Tailscale with the service off. Other images get the install script.
const status = `
if ! command -v tailscale >/dev/null 2>&1; then
  curl -fsSL https://tailscale.com/install.sh | sh >&2
fi
sudo systemctl enable --now tailscaled >&2
tailscale status --json 2>/dev/null || echo '{"BackendState":"NoState"}'
`;

const up = `
key_file="$(mktemp)"
trap 'rm -f "$key_file"' EXIT
printf '%s' "$AUTH_KEY" > "$key_file"
sudo tailscale up --auth-key="file:$key_file" --hostname="$NAME" --ssh="$SSH" --advertise-tags="$TAGS"
`;

const observe = (sshDest: string) =>
  runScript(sshDest, status).pipe(
    Effect.map((result): TailscaleDeviceAttributes | undefined => {
      const json = JSON.parse(result.stdout) as {
        BackendState: string;
        Self?: { ID: string; DNSName: string; TailscaleIPs?: string[] };
      };
      const ipv4 = json.Self?.TailscaleIPs?.find((ip) => ip.includes("."));
      return json.BackendState === "Running" && json.Self && ipv4
        ? { nodeId: json.Self.ID, dnsName: json.Self.DNSName.replace(/\.$/, ""), ipv4 }
        : undefined;
    }),
  );

/**
 * Makes an auth key with the Tailscale API. The key lets one new device join
 * the tailnet, and stops after ten minutes.
 */
export const authKey = (description: string, tags: string[]) =>
  Effect.gen(function* () {
    const created = yield* api("POST", "/tailnet/-/keys", {
      description: description.slice(0, 50),
      expirySeconds: 600,
      capabilities: { devices: { create: { reusable: false, ephemeral: false, preauthorized: true, tags } } },
    });
    if (created.status !== 200) {
      return yield* new TailscaleError({
        message: `Tailscale API did not make an auth key (HTTP ${created.status}): ${created.body.slice(0, 500)}`,
      });
    }
    return (JSON.parse(created.body) as { key: string }).key;
  });

const join = (news: TailscaleDeviceProps) =>
  Effect.gen(function* () {
    yield* runScript(news.sshDest, up, {
      AUTH_KEY: yield* authKey(`tincto ${news.hostname}`, news.tags),
      NAME: news.hostname,
      SSH: String(news.ssh),
      TAGS: news.tags.join(","),
    });
  });

export const TailscaleDeviceProvider = provider(TailscaleDevice, {
  stables: ["nodeId"],
  diff: replaceOn<TailscaleDeviceProps>("sshDest"),
  reconcile: Effect.fn(function* ({ news }) {
    if (yield* observe(news.sshDest)) {
      // Sync the settings that can change on a connected device.
      yield* runScript(news.sshDest, `sudo tailscale set --hostname="$NAME" --ssh="$SSH"`, {
        NAME: news.hostname,
        SSH: String(news.ssh),
      });
    } else {
      yield* join(news);
    }
    const device = yield* observe(news.sshDest);
    if (!device) return yield* new TailscaleError({ message: `${news.hostname} did not connect to the tailnet` });
    return device;
  }),
  delete: Effect.fn(function* ({ output }) {
    const removed = yield* api("DELETE", `/device/${output.nodeId}`);
    if (removed.status !== 200 && removed.status !== 404) {
      return yield* new TailscaleError({
        message: `Tailscale API did not remove the device (HTTP ${removed.status}): ${removed.body.slice(0, 500)}`,
      });
    }
  }),
});
