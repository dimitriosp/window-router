# Changelog

All notable Window Router changes are recorded here. Versions follow semantic
versioning: patch releases fix behavior, minor releases add backward-compatible
features, and major releases may change existing workflows.

## 1.4.1 — 2026-08-30

### Fixed

- Prevented multiple website groups from sharing one destination window.
- Made the organizer repair duplicate window bindings created during restart
  recovery.
- Prevented auto-merge and startup recovery from claiming a window that already
  belongs to another website group.

### Changed

- Added this changelog and made version and changelog updates mandatory for
  every release.
- Added repository instructions that require future coding agents to keep the
  manifest version, README, and changelog aligned.

## 1.4.0 — 2026-08-28

### Added

- Added an optional auto-merge threshold of one to four matching tabs.
- Added the reusable Codex and Claude build prompt.

### Fixed

- Restricted auto-merge destination selection to normal Chrome windows.

## 1.3.0 — 2026-08-28

### Added

- Added the optional **Always create a dedicated window** setting.

### Fixed

- Limited automatic destination recovery to browser startup.

## 1.2.0 — 2026-08-28

### Added

- Added **Add this site to Window Router** to the tab context menu.
- Added GitHub installation and update instructions.

### Fixed

- Serialized routing operations to prevent competing destination windows.

## 1.1.0 — 2026-08-28

### Added

- Added the one-click organizer that creates one window per website group.

### Fixed

- Preserved unrelated tabs while organizing large sets of open tabs.

## 1.0.0 — 2026-08-28

### Added

- Added configurable website groups and automatic future-tab routing.
- Added persistent routing intent and browser-restart recovery.
