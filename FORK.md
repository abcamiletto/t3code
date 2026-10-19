# T3 Paper fork

T3 Paper is T3 Code plus a live LaTeX paper workspace. It installs next to the official app.

## Staying current with upstream

`main` mirrors `upstream/main`; `feat/paper` holds the fork's commits on top.

```sh
git fetch upstream
git checkout main && git merge --ff-only upstream/main && git push origin main
git checkout feat/paper && git rebase main
```

Conflicts land in the small hooks listed below, never in fork-owned code.

## Fork-owned code

- `packages/contracts/src/paper.ts`: wire types for paper state, proposals and SyncTeX lookups.
- `apps/server/src/paper/`: Tectonic builds, file watching, SyncTeX, proposals.
- `apps/server/src/mcp/toolkits/paper/`: the `paper_status` and `paper_propose_edits` agent tools.
- `apps/web/src/paper/` and `packages/client-runtime/src/paper/`: the Paper panel and its chat card.
- `packages/shared/src/forkIdentity.ts`: app name, bundle id, URL scheme, T3 home (`~/.t3-paper`) and
  the auto-update switch. Every collision with the official app is resolved by reading this module.

## Upstream hooks

Each is a few lines that register or call into fork-owned code:

- RPC registration: `contracts/src/rpc.ts`, `clientRpcPermissions.ts`, `server/src/ws.ts`,
  `auth/RpcAuthorization.ts`, `observability/RpcInstrumentation.ts`, `server/src/server.ts`.
- Agent tools: `mcp/McpHttpServer.ts`, `shared/src/t3McpToolPresentation.ts`,
  `shared/src/toolOutput.ts`, `client-runtime/src/t3ToolSummary.ts`, `ClaudeAdapterV2.ts`.
- Panel and chat: `rightPanelStore.ts`, `RightPanelTabs.tsx`, `RightPanelSurfaceContent.tsx`,
  `ChatView.tsx`, `session-logic.ts`, `MessagesTimeline.logic.ts`, `MessagesTimeline.tsx`,
  `closedViewStore.ts`.
- LaTeX project icon: `ProjectFaviconResolver.ts`, `AssetAccess.ts`, `ProjectEnrichmentService.ts`,
  `shared/src/projectFavicon.ts`, `client-runtime/src/projectFaviconCache.ts`, and both
  `ProjectFavicon.tsx` files.
- Identity: desktop app/env/user-data/protocol/update modules, `os-jank.ts`, `httpCors.ts`,
  `cli/browser.ts`, `branding.ts`, `SidebarChrome.tsx`, `promptLinks.ts`, `codexAuthHandoff.ts`,
  `providerAuthReturnUrl.ts`, `scripts/build-desktop-artifact.ts`, `scripts/dev-runner.ts`.

## Building the app

```sh
node scripts/build-desktop-artifact.ts --platform mac --target dmg --arch arm64 --output-dir release
```

The build is ad-hoc signed and has no update feed, so it can never be replaced by an official
release. electron-builder's ad-hoc signature does not survive packaging (`codesign --verify` reports
missing resources), so re-sign the app with `codesign --force --deep --sign -` and repackage it with
`hdiutil create` before publishing the DMG as a GitHub release on the fork.

Upstream desktop tests that assert the official app's scheme, name or profile paths are updated
to T3 Paper's values when they arrive in a rebase. The Linux theme-icon tests assume a
case-sensitive filesystem and fail on macOS regardless of the fork.
