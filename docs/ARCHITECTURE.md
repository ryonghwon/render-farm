# Architecture

Render Farm is a single-machine desktop application. Electron owns the window, native dialogs, IPC, notifications, and power management. The React interface communicates through a narrow preload API; Node integration is disabled in the renderer.

## Modules

| Module | Responsibility |
| --- | --- |
| `src/main/index.ts` | Application lifecycle, IPC, previews, native integration |
| `src/main/data-directory.ts` | Stable selection of existing queue and settings storage |
| `src/main/engine/engine.ts` | Queue state, scheduling, retries, persistence, completion actions |
| `src/main/engine/preflight.ts` | Scene checks and suggested fixes |
| `src/main/engine/installs.ts` | Installation discovery and version selection |
| `src/main/engine/command.ts` | Renderer commands and Maya MEL / Blender Python boot scripts |
| `src/main/engine/runner.ts` | Child processes, independent output streams, progress parsing, termination |
| `src/main/engine/probe.ts` | Maya ASCII, binary header, and mayapy inspection |
| `src/main/engine/blend.ts` | Blender file parsing and application-assisted inspection |
| `src/main/engine/frames.ts` | Output scanning and image-sequence selection |
| `src/renderer/src/components/Preferences.tsx` | Preferences and PIN dialogs |
| `src/renderer/src/components/Overlays.tsx` | Queue menus, preflight, completion countdown, presets, and notifications |

## Rendering

A job describes a scene and its overrides. Effective settings combine global defaults with those overrides. The scheduler divides eligible frames into tasks, limits concurrent processes, and retries missing ranges when configured.

Each task launches Maya Render or Blender with a generated boot script. Frame markers and output files provide progress evidence. Standard output and standard error use separate decoding buffers so partial lines cannot corrupt each other. Spawn failure produces one terminal event.

Stopping terminates the renderer process tree. Application shutdown waits for active processes to close, then saves queue state. Interrupted jobs retain their completed-frame records and resume in missing-frame mode.

## Persistence

`state.json` stores the queue, settings, and presets using an atomic write. Logs and task scripts live beside it; rendered images are written to the selected output folder. Existing RenderFarm storage and PIN hashes remain compatible with the displayed Render Farm name.

## Platform boundary

Windows uses executable paths and process-tree termination through `taskkill`. macOS resolves application-bundle executables and terminates process groups. Completion actions use the host operating system's normal power interfaces. The render engine has no Electron dependency and accepts an installation-discovery function for isolated tests.
