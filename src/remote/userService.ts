import { toolPath } from "./Ssh.ts";

/**
 * Bash for systemd user services on the machine. T3 Code and the bb server
 * are both user services, so the rules are here one time: lingering, the PATH
 * of a unit, and how a service starts and goes away.
 */

const unitDir = `"$HOME/.config/systemd/user"`;

/** The `Environment=PATH=` line of a unit or a drop-in. Use it in a heredoc that expands `$HOME`. */
// The last two directories are where NixOS has its programs. On other systems they are not there.
export const unitPath = `Environment=PATH=${toolPath}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/run/wrappers/bin:/run/current-system/sw/bin`;

/** Writes the unit file of a service that runs one command. */
export const writeUnit = (name: string, description: string, command: string) => `
mkdir -p ${unitDir}
cat > ${unitDir}/${name}.service <<UNIT
# Managed by tincto.
[Unit]
Description=${description}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
${unitPath}
ExecStart=${command}
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
UNIT
`;

/** Starts a service, or starts it again, and makes it start at boot with no person logged in. */
export const start = (name: string) => `
# Root is necessary only when the services of the user do not stay yet.
if [ "$(loginctl show-user "$(id -un)" --property=Linger --value 2>/dev/null)" != yes ]; then
  sudo loginctl enable-linger "$(id -un)"
fi
systemctl --user daemon-reload
systemctl --user enable ${name}
systemctl --user restart ${name}
`;

/** Stops a service and removes its unit file and its drop-ins. */
export const remove = (name: string) => `
systemctl --user disable --now ${name}
rm -rf ${unitDir}/${name}.service ${unitDir}/${name}.service.d
systemctl --user daemon-reload
`;

/** Waits until a local HTTP port answers, and fails with the status of the service when it does not. */
export const waitForPort = (name: string, port: string) => `
for attempt in $(seq 1 60); do
  curl -fsS -o /dev/null "http://127.0.0.1:${port}/" && exit 0
  sleep 2
done
echo "The service ${name} did not answer on port ${port}." >&2
systemctl --user status ${name} --no-pager >&2 || true
exit 1
`;
