# Changelog

## 0.5.1 beta — 2026-10-13

- Show one clickable repository picker before selection; branch details appear after a repository loads.
- Add a real Codex screenshot to the README.

## 0.5.0 beta — 2026-10-13

Initial public beta for Codex desktop.

- Live discovery of Codex projects, including every root of multi-repository projects.
- Current checkout branch, searchable repositories, and expandable Git worktrees.
- Staged, unstaged, untracked, and conflicted file lists.
- Source and unified diff views, with staged and working snapshots kept distinct.
- Image previews with dimensions, byte size, and before/after snapshots.
- Per-file staging and unstaging that preserves working-copy contents.
- Relative plugin launch paths and temporary Git fixture tests.

Project discovery reads Codex's internal local catalog; future storage changes may require an adapter update. An explicit checkout path remains available.
