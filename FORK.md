# T3 Paper fork

T3 Paper adds a LaTeX review workspace to T3 Code and installs alongside the official app.

## Rebasing

Keep fork commits grouped by purpose: app identity, Paper features, and fork maintenance docs.
Keep Paper behavior in the `paper/` directories; upstream files should only register or call it.
Do not edit upstream services' return types to carry Paper metadata.

```sh
git fetch upstream main
git switch main
git branch backup/paper-before-rebase
git rebase upstream/main
# Resolve conflicts and run the focused checks below before pushing.
git push --force-with-lease origin main
```

Use a fresh backup branch name for each rebase. Preserve upstream deletions when resolving test
conflicts; retain Paper coverage in its own test files rather than reviving removed upstream tests.

## Integration boundaries

- `packages/contracts/src/paper.ts`, `apps/server/src/paper/`, and
  `packages/client-runtime/src/paper/` own the contracts, build service, and client state.
- `apps/server/src/mcp/toolkits/paper/` registers the agent tools.
- `apps/web/src/paper/` owns PDF review, proposal rendering, and proposal placement in the timeline.
  Chat, Markdown, and right-panel code call into it.
- `AssetAccess.ts` adds LaTeX metadata to project favicon URLs. The generic favicon resolver and
  project enrichment services stay unchanged.
- `packages/shared/src/forkIdentity.ts` defines the app identity. Desktop startup, protocol,
  authentication, update, and packaging code read it to keep Paper separate from T3 Code.

## Verification

Use the Node and pnpm versions declared in `package.json` and the installed `vp` executable.

```sh
vp test run apps/server/src/paper apps/web/src/paper packages/shared/src/paperProposal.test.ts
vp test run apps/server/src/assets/AssetAccess.test.ts -t 'LaTeX'
env -u ELECTRON_RUN_AS_NODE vp test run scripts/build-desktop-artifact.test.ts
```

Run targeted lint and the typecheck task in each affected app. Identity changes also need the
relevant desktop tests. Keep tests for observable behavior: compile failures retain the good PDF,
source edits stay safe, proposals belong to the correct chat, and PDF comments survive editing.

## Local macOS builds

Keep the public production configuration from `.env.example` in `.env`. Put the existing local
Code Signing certificate name in the gitignored `.env.local`:

```sh
CSC_NAME="T3 Paper Local Development"
```

```sh
node scripts/build-desktop-artifact.ts --platform mac --target dmg --arch arm64 --output-dir release
```

The standard packager loads these settings and signs with the same certificate on every build.
Verify the packaged app with `codesign --verify --deep --strict` before installing. Keep the same
app identity and signing certificate so Keychain can recognize future builds.

Paper uses its own `~/.t3-paper` state and Chromium profile. It does not import the official app's
account, connections, chats, or Keychain entries. Its packaged renderer uses `t3code://app` for
production sign-in compatibility; public links and OS registration use `t3paper://`. Automatic
updates are disabled so an official release cannot replace the fork.
