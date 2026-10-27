# Independent desktop windows

Window → New Independent Window (Cmd/Ctrl+Shift+N) opens another DSH NEXT application window on the same Host and Profile. Each window owns its renderer, selected page, conversation navigation and draft storage. The first window retains the existing Chromium session; additional windows use their own persistent storage partitions. Closing a window while another remains does not stop the Host. Reload, directory dialogs, native IPC and keyboard input stay bound to the requesting window.

Plugin installation, Profile selection, user settings and business records still belong to the shared Host. Changing those resources is a shared action, not a private copy. Existing Host confirmation and business version checks remain in force. A renderer failure is reported for that window without restarting other windows or the Host.

A running Electron main process cannot acquire this new window management code without a normal application restart. Build and validate the candidate separately; never replace the active installation or stop its Host while another task is using it.

Verified on macOS with the installed v2.0.19-next runtime: native menu creates multiple windows; two windows retain different drafts and select different locally created sessions; page navigation, interface reload and closing a secondary window leave the other window's selection and draft intact. No model account or model request is needed for this smoke check. Menu refreshes (including locale and update state changes) must retain the new-window action.

The focused verification suite passes 103 tests, and the Next desktop bundle builds. The window registry's strict TypeScript check passes. The full package typecheck is not an acceptance claim: this local build reuses installed runtime dependencies without their complete development declarations, and that check reports dependency/type-environment errors. Windows and Linux native UI have not been exercised.
