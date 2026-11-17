# Windows interaction and import validation

Ticket #6 patches the upstream baseline `ysyyhhh/dsh-pet@a17346b9c41efb4220f387216008928bba652e0e` in the existing renderer and import modules. Keep these patches when syncing upstream until equivalent fixes are present there:

- Win32 callbacks and drag state belong to their HWND; destroying an instance removes its callback entry.
- Window creation, movement and dragging respect `alwaysOnTop`.
- The renderer forwards `animationSpeed`, and a disabled animation still presents one frame without idle timers.
- Startup and `WM_DISPLAYCHANGE` clamp the window into the nearest monitor's work area and persist the recovered position through the existing position callback.
- ZIP imports reject unsafe paths (including backslashes and Windows special paths), duplicate case-insensitive names, compressed input over 40 MiB and expanded data over 80 MiB before writes. Metadata is checked before decompression; bounded streaming also checks actual expanded bytes.
- Both ZIP and Petdex imports claim their target with an exclusive directory creation. A competing import is rejected; cleanup only removes a target created by that import.
- The lockfile updates Sharp from 0.35.3 to 0.35.5 within the existing dependency range, including its platform image libraries, for GHSA-rgj7-g3m4-5g8c and GHSA-wq5f-xc86-pv6w.

## Automated checks

Run `npm test`, `npm run typecheck`, `npm run typecheck:client`, and `npm run build` on Node 22 or newer. The Win32 backend tests inject the native API boundary and deliver window messages to multiple HWNDs; renderer tests use a deterministic clock. Import tests use actual ZIP files and sprite decoding, temporary directories, and concurrent installation attempts.

## Windows 11 x64 desktop checks

These steps are manual acceptance checks, not claims that a headless test verifies native display behavior.

1. Run `npm run start:host`. Drag the pet, hover it, use its close menu, restart the host, and confirm its position persists. Closing the pet should hide that instance while the host remains running.
2. With two instances available in the host, alternate dragging, hovering and closing the older and newer window. Confirm the other pet does not move, change pose, or close. Recreate one window by changing its size and repeat.
3. Use 100%, 125%, 150% and 200% Windows display scaling. Check the full sprite stays visible, hover and drag hit-testing align with it, and resizing does not change the saved desktop location unexpectedly.
4. Test two monitors with one to the left of the primary display (negative coordinates), then with different scaling values. Move a pet onto each display and restart. Disconnect the display containing the pet while it is running: it must move into the remaining monitor's usable work area. Repeat with a previously saved position on a disconnected display and with a gap between monitor rectangles.
5. Check `alwaysOnTop` both on and off against a normal application window, before and after dragging. Check animation speed 0.25, 1 and 4; disabled animation must retain a visible frame.
6. Import a valid nested Codex/Pocket Pet ZIP, then attempt a duplicate import and two concurrent imports of the same id. Exactly one initial import may succeed; the resulting pet must remain loadable. Unsafe-path and size-limit errors must not expose archive path names or change existing pet settings.

Record Windows build, monitor layout, scaling values, and observed results when doing these checks. Hooks and chat/session binding are outside this ticket.
