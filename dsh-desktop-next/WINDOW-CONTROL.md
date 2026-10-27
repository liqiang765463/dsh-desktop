# Codex task-bound native windows

For portable Mac packaging, installation, rollback and interrupted transactions, see [PORTABLE-UPGRADE.md](PORTABLE-UPGRADE.md). The installed tools resolve the current user's paths and do not depend on the original developer checkout.

`dsh-window bind` reads `CODEX_THREAD_ID` from the Codex execution environment and claims a persistent UUID. Every later tool call from that task goes directly to that window. The label, task suffix and UUID prefix appear in its native title. Closing/reopening or restarting DSH retains that identity and Chromium partition. Another task receives another unclaimed window or a new one; no focus-dependent fallback is allowed.

The supported operator is a local CLI, not an app-wide Computer Use/MCP session:

```sh
dsh-window bind
dsh-window snapshot
dsh-window click NODE --snapshot OBSERVATION
dsh-window fill NODE --snapshot OBSERVATION <<'TEXT'
replacement text
TEXT
dsh-window select NODE OBSERVED_OPTION_VALUE --snapshot OBSERVATION
dsh-window scroll NODE 600 --snapshot OBSERVATION
dsh-window capture
```

Read `snapshot` after each mutation. Node numbers and observation IDs only apply to that exact window/document. Actions consume the observation before dispatch, so an uncertain action cannot be replayed with the same observation. A provided `--window` must equal the owning task's durable UUID. Missing identity, a different window, another caller's observation, a changed/disconnected node, unsupported surface or closed/unavailable environment causes an error. Input never uses the OS cursor, keyboard, pasteboard or foreground-window selection. Snapshots redact password values; the tool does not expose password entry, arbitrary JavaScript, shell commands, global quit/restart or external documents. A capture contains only the owning BrowserWindow.

Identity is a trusted launcher convention, not an OS sandbox. The CLI accepts no owner argument; do not override `CODEX_THREAD_ID`. The local socket is in a private directory and the binding registry is a mode-0600 local file. Processes with the same full macOS account privileges could deliberately forge environment variables or use another control program. This feature prevents cross-window actions through this tool; it cannot revoke the existing general Computer Use tool's desktop authority. All Codex DSH UI work must use this CLI. Native dialogs and unsupported frames must stop with a clear gap, never fall back to a global click.

Plugin configuration, accounts, Profile, the same workflow and business records remain shared. Independent drafts/pages are not private copies of shared workflows. Existing business authorization/version checks remain in effect.

## Preserving the feature during upgrades

The feature source is on `feat/independent-desktop-windows`, based on official v2.0.19-next (`6a63b973`). `dsh-next-upgrade` runs `preserve-window-upgrade.mjs prepare latest`:

Official stable release → export the exact committed feature diff + SHA manifest → isolated source checkout → three-way apply → dependency compatibility check → focused tests/build → candidate ready for native acceptance and controlled packaging/install.

No installed app, user Profile or binding registry is replaced by this command. Conflicts, dependency drift or a failed check leave a concrete checkout/log and stop before installation. A direct official-package download/install through this custom app shows a feature-preservation notice instead of dropping the patch. The patch remains a local fork, not an official vendor build; a future upstream release with equivalent capabilities can replace it after verification.

After an AI reviews and resolves a reported source conflict in that isolated checkout, run `dsh-next-upgrade verify OUT`. It refuses unresolved Git stages, rechecks the original patch SHA, tests/builds the merged result, and updates `window-feature-base.json` to the new upstream revision. Future patch exports are then relative to that updated base rather than accidentally including an entire upstream release. This does not mean every future upstream version will merge automatically.

`preserve-window-upgrade.mjs export OUT` produces a portable patch bundle. Keep source, base revision, patch SHA, checks, the exact original app and the current `desktop-windows.json` schema reference together. Do not apply a binary archive built for v2.0.19 to a different vendor version. Packaging retains the current official app assets/dependencies and original hardened-runtime entitlements; signed vendor identity is not claimed for a locally ad-hoc signed build.
