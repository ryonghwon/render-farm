# Configuration

Open **Preferences** from the toolbar.

## Applications

Render Farm searches standard installation locations and `MAYA_LOCATION`.

| Application | Windows | macOS |
| --- | --- | --- |
| Maya | `Program Files/Autodesk/Maya<year>/bin/Render.exe` | `/Applications/Autodesk/maya<year>/Maya.app/Contents/bin/Render` |
| Blender | `Program Files/Blender Foundation/Blender <version>/blender.exe`, Steam | `/Applications/Blender*.app`, `~/Applications/Blender*.app` |

For other locations, use **Preferences > Applications**. On Windows, select `Render.exe` or `blender.exe`. On Mac, select the Maya or Blender application bundle.

Automatic version selection prefers a match to the scene's saved version. A specific installation can be chosen in scene settings. Render plugins and licenses belong to that installation. CPU and GPU support follows the installed renderer and the computer's hardware.

## Output and presets

The output folder is a normal local or mounted filesystem directory. Rendered images are stored there directly, separate from the application's queue database. Folder and filename patterns accept `{scene}`. Select a writable location with enough free space; keep mounted volumes available throughout rendering.

Presets store output and advanced render defaults. Per-scene overrides take precedence over global defaults. Changing a preset does not rewrite previously rendered files.

## Processing

- **Parallel rendering** controls the number of active render processes.
- **Threads per task** limits CPU threads when supported. Automatic allocation accounts for concurrency.
- **Chunk size** splits a scene into ranges that can occupy separate slots.
- **Retry failed frames** limits automatic retries for missing frames and renderer crashes.
- **Skip existing frames** avoids rendering frames already found in the output sequence.

Concurrent GPU renders share the same GPU memory. Choose concurrency based on scene memory requirements, available licenses, and the render device.

## Completion actions

Choose **Shut down**, **Sleep**, or **Quit Render Farm**, then enable the action in the progress panel for the current session. A countdown allows cancellation. Completion actions are disarmed when the app starts.

**If scenes fail > Run completion action** controls whether failed entries prevent the action. On Mac, automatic shutdown uses System Events and may request Automation permission. Sleep and shutdown follow operating-system permissions and power settings.

## Settings lock

A PIN protects output defaults and processing preferences on shared workstations. Operators can still add scenes, set frame ranges and cameras, and control the queue. Unlock Preferences with the administrator PIN to change protected settings. The lock controls the app interface; filesystem access is governed by the operating system.

## Data and backup

| Data | Location |
| --- | --- |
| Windows settings and queue | `%APPDATA%/RenderFarm/state.json` |
| Mac settings and queue | `~/Library/Application Support/RenderFarm/state.json` |
| Render logs | `logs/<job ID>/` inside the application data directory |
| Render outputs | The output folder selected in the app |

An existing `renderfarm` directory is reused when it contains saved state. The displayed product name does not change these storage locations. `RENDERFARM_DATA_DIR` can select a separate data directory when launching from an administrative script.

To back up a workstation, quit Render Farm and copy the application data directory and render output folders. Include scene files and external assets separately. Restore the same paths or update the queue's scene and output locations before rendering on another machine.
