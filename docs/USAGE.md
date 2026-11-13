# User guide

## Add and arrange scenes

Choose **Add scenes > Add files…** or **Add folder…**, or drag files into the queue. Render Farm inspects scene metadata when files are added. Maya ASCII and supported Blender files are read directly; deeper inspection uses the installed application when needed.

Drag rows to change queue order. A row's checkbox includes or excludes that scene. Right-click a row for queue actions, duplication, output-folder access, and rerender options. Removing a row only removes its queue record; render files remain in the output folder.

## Set the output

Choose an output folder and file format in the **Output** panel. The default layout is:

```text
<output folder>/<scene>/<scene>.<frame>.<extension>
```

Open **Scene settings** to override output settings for an individual scene. Formats and renderers depend on the installed application and its plugins. **Use scene setting** retains the scene's renderer or output format. Image sequences support frame-level recovery; a movie output may need to restart as a whole after interruption.

## Review scene checks

Before starting, resolve blocking errors such as a missing scene, missing render application, empty output folder, or overlapping output paths. Warnings identify settings that merit review, including version differences, unavailable references, textures, or cameras.

Use the action beside a check to apply a supported correction or open the scene settings. Changes affect Render Farm's render settings; the source scene is not saved over.

## Control rendering

| Control | Behavior |
| --- | --- |
| Start render | Starts eligible queue entries after preflight |
| Pause | Stops scheduling new work while active work finishes |
| Resume | Continues scheduling the paused queue |
| Stop | Terminates active render processes and keeps completed-frame records |
| Render missing frames | Renders gaps from an interrupted or incomplete job |
| Render again | Schedules the full frame range |

The progress panel combines renderer messages and files found in the output folder. Time estimates use measured scene-loading and frame-render times. They become more useful after frames have completed.

If a renderer crashes or omits frames, Render Farm retries the missing ranges up to the configured retry limit. Arnold license failures use a separate waiting period. A completion status is based on available output evidence; check the log if the renderer reports success but writes outside the configured folder.

## Logs and previews

The summary log shows queue and render events. Switch to the full renderer log for application output, plugin errors, and license messages. Logs are saved in the application data directory and can be opened from the log panel.

PNG and JPEG frames can be previewed directly. FFmpeg enables additional image previews and optional review movies. The original render outputs remain in the selected output folder.

## Keyboard shortcuts

| Action | Windows | macOS |
| --- | --- | --- |
| Select all scenes | Ctrl+A | Command+A |
| Duplicate selected scenes | Ctrl+D | Command+D |
| Open scene settings | Enter | Return |
| Include or exclude selected scenes | Space | Space |
| Remove selected inactive scenes | Delete or Backspace | Delete |
| Move selection | Arrow keys | Arrow keys |
| Clear selection | Escape | Escape |

Shortcuts are inactive while typing or while a dialog is open.
