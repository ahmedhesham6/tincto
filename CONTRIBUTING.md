# How to contribute

## Run the checks

```sh
bun install
bun run check    # types, lint, format
bun test         # each resource through the Alchemy engine, and full deploys against a fake machine
```

No test needs a real machine or a Tailscale account.

## Release a version

A push to `main` releases the version in `package.json` when npm does not have it
yet: CI publishes to npm, makes the Git tag and the GitHub release. So to release,
change `"version"` in a pull request and merge it. A maintainer can also run the
`release` workflow by hand with a bump (`patch`, `minor` or `major`): it changes the
version, commits it, and releases.

The publish uses npm trusted publishing. There is no npm token in the repository.

## Add a component to the community list

1. Publish your component to npm, with `tincto` and `alchemy` as peer dependencies.
2. Open a pull request that adds one row to "Community components" in [the README](README.md).

## Add a component to tincto

- A component is in the `index.ts` of its layer in `src/`. It takes an ID and props, declares resources, and has a default for each value that it can.
- A resource is one file with `provider(Resource, handlers)`, and one line in [`Providers.ts`](src/Providers.ts).
- Test a resource with `test.provider` of `@alchemy.run/test`. Each test file in `test/` is an example.
- Use the terms of [CONTEXT.md](CONTEXT.md) in code, comments and documents.

tincto installs only software that each person can get. A component for software with no public install is a community component.
