# Troubleshooting

## An application is not detected

Open **Preferences > Applications** and add the installed Maya or Blender application. Maya requires its batch renderer, not only a scene-file association. Check that the selected application can start on this computer. On Mac, select the `.app` bundle rather than a Windows executable.

## A scene fails before rendering

Review the preflight error and the scene's log. Verify the scene path, output permissions, camera, required references, plugins, and renderer license. Open the scene in the selected Maya or Blender installation to confirm that the same renderer can load it.

A newer scene may use features unavailable in an older application. Choose a matching or compatible installation in **Scene settings**. Render Farm does not convert scenes between Maya and Blender or install render plugins.

## Arnold is waiting for a license

Render Farm detects license-acquisition failures and waits before retrying. It does not alter licenses or authentication. Check the renderer license service and the number of permitted concurrent render processes. Repeated failures appear in the log with the missing frame range.

## Frames are missing or written to another folder

Inspect the command and renderer output in the full log. Scene-specific output settings, render layers, AOVs, and plugin behavior can change the destination. Check the output example in scene settings and inspect the folder itself. Use an image sequence for reliable missing-frame recovery.

## Previews are unavailable

PNG and JPEG previews use the app's image reader. For EXR and other supported formats, install FFmpeg and select its executable under **Preferences > Advanced**. On Mac, Homebrew locations are also searched. Creating a review movie does not replace the source frames.

## Mac blocks the application

Unsigned packages can trigger Gatekeeper checks. Verify that the download came from this repository's release page. If you trust the package, use the operating system's **Privacy & Security** controls to approve it. Managed computers may require an administrator. Signed distribution builds are configured through the build process.

## A restarted queue contains stopped scenes

Closing the app stops active renders. The queue records and completed-frame information are saved. Start the queue again to continue unfinished frames. If the app was forcibly terminated or the computer lost power, verify the output folder before restarting.
