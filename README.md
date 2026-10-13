# Source Control for Codex

[![Tests](https://github.com/saltnpixels/codex-source-control/actions/workflows/test.yml/badge.svg)](https://github.com/saltnpixels/codex-source-control/actions/workflows/test.yml)
[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

See what changed in your local Git repositories while you work in Codex desktop.

**Public beta · v0.5.0**

Source Control adds a panel with your current branch, changed files, source and diff views, image previews, and per-file staging controls. It reads Codex's saved projects automatically, including projects with multiple repositories.

## Features

- Search projects, repository roots, and current worktree branches.
- See staged, unstaged, untracked, and conflicted files in separate groups.
- Click a file to view its source or unified diff with line numbers.
- Preview images with pixel dimensions and file size; compare before/after snapshots.
- Use **+** to stage a file and **−** to unstage it. Working-copy contents are preserved.
- Switch repositories without asking the agent to run Git commands.

## Install

You need **Codex desktop with local MCP Apps support**, **Git**, and **Node.js 24+** available on PATH. There are no npm dependencies to install.

```sh
codex plugin marketplace add saltnpixels/codex-source-control
codex plugin add source-control-proof@eric-source-control-proof
```

Restart Codex, then open **Source Control** from the panel picker and pin it for easy access. The marketplace is named **Source Control for Codex**. If “Try it now” opens a chat, use the panel picker to open the app.

The `source-control-proof@eric-source-control-proof` identifier is retained from the original proof so existing installs remain compatible.

This repository is a GitHub-backed marketplace. It is not a listing in OpenAI's official public plugin directory.

### Install a pinned version

```sh
codex plugin marketplace add saltnpixels/codex-source-control --ref v0.5.0
codex plugin add source-control-proof@eric-source-control-proof
```

### Update

If you installed from the default branch:

```sh
codex plugin marketplace upgrade eric-source-control-proof
codex plugin add source-control-proof@eric-source-control-proof
```

Restart Codex and reopen the panel to replace the running MCP process. A marketplace pinned to a release tag stays on that release.

### Remove

```sh
codex plugin remove source-control-proof@eric-source-control-proof
codex plugin marketplace remove eric-source-control-proof
```

## Use

The first opening shows a repository picker. Choose a repository, or use **Open another checkout…** for an absolute checkout path. A remembered checkout or an explicit tool argument can also select the repository; the global panel does not automatically follow the active chat's project.

Click a changed file, then choose **Diff** or **Source**. Under Staged Changes, Source shows the index snapshot. Other groups show the working copy. Diff compares HEAD against the index for staged changes, and the index against the working copy for unstaged changes.

**New** means Git has not tracked the file yet. Staging applies to a whole file; individual hunk staging is not included. The panel does not commit, push, switch branches, or discard working files.

The repository picker refreshes on opening, on **Refresh**, and every 30 seconds while visible. Git status refreshes every five seconds while visible. Additional worktrees are collapsed until expanded or matched by search.

## Compatibility

The native proof was verified on macOS. Updated viewer, image, staging, and discovery behavior was tested with the actual backend in a browser harness and isolated Git fixtures. Automated Git fixture tests run on macOS and Linux. Windows and native installation on other machines have not yet been verified.

Project discovery uses a **read-only adapter for Codex's internal local storage**. It derives the data directory from `CODEX_HOME`, or the current user's `.codex` directory. It queries project names and repository roots from the local state database; older installations can use their saved workspace JSON. Codex storage changes may require an adapter update. If discovery is unavailable, the panel explains the failure and lets you enter a checkout path.

The plugin uses a supported Codex compatibility manifest and a local stdio MCP server. Node runs the installed server using plugin-relative paths. There is no copied project list, personal checkout path, or default repository in the package.

## Data and permissions

The plugin reads local project paths, Git status, and selected file contents. It does not implement analytics, upload files, or contact an external service. Preview data stays between the local MCP server and Codex's panel. Status tools can also return branch and changed-file metadata to the agent when invoked. File and staging tools are app-only.

The staging tool writes the selected file's Git index entries. Requests are serialized per checkout and checked against fresh status. Other index entries and working-copy files are preserved. This is a trusted local integration; app-only tool visibility is not an operating-system filesystem sandbox.

Git read commands use `--no-optional-locks`; diffs disable external diff commands and text conversion. Text views are limited to 512 KB and 10,000 displayed lines. Image snapshots are limited to 8 MB. Working-copy image symlinks are not followed. Unsupported binary files, submodules, oversized files, and missing snapshots display messages.

## Development

Clone the repository and run:

```sh
npm test
```

No npm install is needed. Tests create temporary repositories and a temporary Codex catalog. They cover live multi-root discovery, external catalog changes, empty/unavailable catalogs, portable launch from a relocated folder, partial staging, renames, literal paths, detached/unborn HEAD, unrelated index entries, concurrent requests, source/diff separation, image snapshots, size limits, and path validation. They do not stage files in your real repositories.

The implementation lives under `plugins/source-control-proof/`:

- `codex-projects.mjs`: read-only Codex catalog compatibility adapter.
- `projects.mjs`: project roots and live Git worktrees.
- `git-status.mjs`, `git-file.mjs`, `git-images.mjs`, `git-staging.mjs`: Git data and per-file actions.
- `server.mjs`: stdio MCP transport and assembled panel resource.
- `panel.html`, `panel.css`, `panel.js`: responsive panel and MCP Apps bridge.
- `assets/branch.svg`: transparent outline icon.

## Feedback and contributing

[Open an issue](https://github.com/saltnpixels/codex-source-control/issues) with your OS, Codex version, Node version, and what happened. Please remove private repository paths, source contents, and credentials from logs or screenshots. Small fixes and improvements are welcome.

## License

[MIT](LICENSE) · Eric Greenfield
