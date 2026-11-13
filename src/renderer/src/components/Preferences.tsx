import type { AppInfo, CompletionAction, RenderSettings, SettingsKey } from '@shared/types'
import { Cpu, Lock, MonitorCog, Plus, Power, RefreshCcw, SlidersHorizontal, Trash2, Wrench, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { APP_LABEL } from '../format'
import { useUi } from '../store'
import { Field, NumberInput, Select, Toggle } from './controls'
import { AdvancedFields } from './SceneDialog'

const MAC = navigator.userAgent.includes('Macintosh')

type Pane = 'defaults' | 'run' | 'after' | 'maya' | 'lock' | 'etc'

let relockOnClose = false

export function SettingsModal({ info }: { info: AppInfo | null }) {
  const open = useUi((s) => s.settingsOpen)
  const setOpen = useUi((s) => s.openSettings)
  const openPreset = useUi((s) => s.openPresetDialog)
  const toast = useUi((s) => s.toast)
  const snap = useUi((s) => s.snap)!
  const [pane, setPane] = useState<Pane>('defaults')
  const [pin1, setPin1] = useState('')
  const close = () => {
    setOpen(false)
    if (relockOnClose) {
      relockOnClose = false
      void window.rd.lockNow()
    }
  }
  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || useUi.getState().presetDialog) return
      setOpen(false)
      if (relockOnClose) {
        relockOnClose = false
        void window.rd.lockNow()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [open, setOpen])
  if (!open) return null
  const app = snap.app
  const g = snap.global
  const up = (patch: Partial<typeof app>) => window.rd.updateApp(patch)
  const setG = (patch: Partial<RenderSettings>) => window.rd.updateGlobal(patch)
  const noOverride = (_k: SettingsKey) => ({ overridden: false, onReset: () => undefined })
  const cores = info?.cores ?? 0
  const armed = app.completionAction !== 'none'
  const nav: { id: Pane; label: string; icon: React.ReactNode }[] = [
    { id: 'defaults', label: 'Defaults', icon: <Wrench /> },
    { id: 'run', label: 'Processing', icon: <Cpu /> },
    { id: 'after', label: 'On completion', icon: <Power /> },
    { id: 'maya', label: 'Applications', icon: <MonitorCog /> },
    { id: 'lock', label: 'Lock', icon: <Lock /> },
    { id: 'etc', label: 'Advanced', icon: <SlidersHorizontal /> }
  ]
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal wide" role="dialog" aria-labelledby="st-title">
        <div className="modal-head">
          <h2 id="st-title">Preferences</h2>
          <button className="btn ghost icon" aria-label="Close" onClick={close}>
            <X />
          </button>
        </div>
        <div className="settings-layout">
          <nav className="settings-nav" aria-label="Preference sections">
            {nav.map((n) => (
              <button key={n.id} className={pane === n.id ? 'on' : ''} onClick={() => setPane(n.id)}>
                {n.icon}
                {n.label}
              </button>
            ))}
          </nav>
          <div className="settings-pane">
            {pane === 'defaults' && (
              <>
                <div className="section">
                  <h3>Presets</h3>
                  <Field label="Load" hint="Apply a saved set of defaults.">
                    <div className="field-row">
                      <Select
                        value=""
                        options={[
                          { value: '', label: snap.presets.length ? 'Choose a preset' : 'No presets saved' },
                          ...snap.presets.map((p) => ({ value: p.id, label: p.name }))
                        ]}
                        onChange={(v) => {
                          if (!v) return
                          void window.rd.applyPreset(v)
                          toast(`Preset applied: ${snap.presets.find((p) => p.id === v)?.name}`)
                        }}
                        ariaLabel="Presets"
                      />
                      <button className="btn" onClick={() => openPreset(true)}>
                        Save current settings
                      </button>
                    </div>
                    {snap.presets.length > 0 && (
                      <div className="list" style={{ marginTop: 4 }}>
                        {snap.presets.map((p) => (
                          <div key={p.id} className="list-item">
                            <span className="p">{p.name}</span>
                            <button
                              className="btn small ghost icon"
                              aria-label={`Delete ${p.name}`}
                              onClick={() => window.rd.deletePreset(p.id)}
                            >
                              <Trash2 />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </Field>
                </div>
                {snap.lock.enabled && (
                  <div className="section">
                    <h3>Locked output settings</h3>
                    <Field
                      label="Output folder"
                      hint="Changes are disabled while settings are locked. Choose a writable local or mounted folder."
                    >
                      <div className="field-row">
                        <div
                          className="path-box"
                          onClick={async () => {
                            const p = await window.rd.pickOutputDir(g.outputRoot)
                            if (p) void setG({ outputRoot: p })
                          }}
                        >
                          <span>
                            <bdi>{g.outputRoot || 'Not set'}</bdi>
                          </span>
                        </div>
                      </div>
                    </Field>
                    <Field label="File format">
                      <Select
                        value={g.format}
                        options={[
                          { value: 'exr', label: 'EXR' },
                          { value: 'png', label: 'PNG' },
                          { value: 'jpg', label: 'JPEG' },
                          { value: 'tif', label: 'TIFF' },
                          { value: 'scene', label: 'Use scene setting' }
                        ]}
                        onChange={(v) => setG({ format: v as RenderSettings['format'] })}
                      />
                    </Field>
                  </div>
                )}
                <div className="section">
                  <h3>Scene defaults</h3>
                  <p className="hint" style={{ marginTop: -4, marginBottom: 12 }}>
                    Applies to scenes without overrides. Change the output folder and file format in the Output panel.
                  </p>
                  <Field label="Frame range">
                    <Select
                      value={g.frameMode === 'custom' ? 'scene' : g.frameMode}
                      options={[
                        { value: 'scene', label: 'Render range' },
                        { value: 'timeline', label: 'Timeline range' }
                      ]}
                      onChange={(v) => setG({ frameMode: v as RenderSettings['frameMode'] })}
                    />
                  </Field>
                  <AdvancedFields snap={snap} first={null} s={g} F={noOverride} set={setG} apps={new Set(['maya', 'blender'])} />
                </div>
              </>
            )}
            {pane === 'run' && (
              <div className="section">
                <h3>Processing</h3>
                <Field label="Parallel rendering" hint="Render multiple scenes at once. Higher concurrency increases memory use.">
                  <Toggle on={app.concurrency > 1} onChange={(v) => up({ concurrency: v ? 2 : 1 })} label="Enable parallel rendering" />
                  {app.concurrency > 1 && (
                    <div className="field-row">
                      <NumberInput value={app.concurrency} min={2} max={8} onCommit={(v) => up({ concurrency: v })} width={56} />
                      <span className="hint">concurrent tasks</span>
                    </div>
                  )}
                </Field>
                <Field
                  label="Threads per task"
                  hint={`0 selects automatically: all cores for a single task, or a share of ${cores || 'N'} logical cores for parallel tasks.`}
                >
                  <NumberInput value={app.threadsPerTask} min={0} max={256} onCommit={(v) => up({ threadsPerTask: v })} width={60} />
                </Field>
                <Field label="Retry failed frames" hint="Retry missing frames up to the specified limit when a render stops.">
                  <div className="field-row">
                    <NumberInput value={app.maxRetries} min={0} max={10} onCommit={(v) => up({ maxRetries: v })} width={56} />
                    <span className="hint">retries</span>
                  </div>
                </Field>
                <Field label="Arnold log level">
                  <Select
                    value={String(app.arnoldVerbosity)}
                    options={[
                      { value: '0', label: 'Errors' },
                      { value: '1', label: 'Warnings' },
                      { value: '2', label: 'Info (shows progress)' },
                      { value: '3', label: 'Debug' }
                    ]}
                    onChange={(v) => up({ arnoldVerbosity: Number(v) })}
                  />
                </Field>
              </div>
            )}
            {pane === 'after' && (
              <div className="section">
                <h3>On completion</h3>
                <Field label="Action" hint="Runs when the completion switch in the main window is enabled.">
                  <Select<Exclude<CompletionAction, 'none'>>
                    value={app.completionKind ?? 'shutdown'}
                    options={[
                      { value: 'shutdown', label: 'Shut down' },
                      { value: 'sleep', label: 'Sleep' },
                      { value: 'quit', label: 'Quit Render Farm' }
                    ]}
                    onChange={(v) => up({ completionKind: v, completionAction: armed ? v : 'none' })}
                  />
                </Field>
                <Field label="Countdown" hint="Shows a countdown before the action. You can cancel during this period.">
                  <div className="field-row">
                    <NumberInput value={app.countdownSeconds} min={5} max={600} onCommit={(v) => up({ countdownSeconds: v })} width={64} />
                    <span className="hint">seconds</span>
                  </div>
                </Field>
                <Field label="If scenes fail">
                  <Toggle
                    on={app.completionOnFailure}
                    onChange={(v) => up({ completionOnFailure: v })}
                    label="Run completion action"
                    hint="Turn off to prevent the completion action when any scene fails."
                  />
                </Field>
                <Field label="Prevent sleep">
                  <Toggle on={app.keepAwake} onChange={(v) => up({ keepAwake: v })} label="Keep the computer awake while rendering" />
                </Field>
                <Field label="Notifications">
                  <Toggle on={app.notifications} onChange={(v) => up({ notifications: v })} label="Notify when scenes complete or fail" />
                </Field>
              </div>
            )}
            {pane === 'maya' && (
              <div className="section">
                <h3>Installed applications</h3>
                <div className="install-list">
                  {snap.installs.length === 0 && <div className="install-empty">No Maya or Blender installation found. Add one below.</div>}
                  {snap.installs.map((i) => (
                    <div key={i.id} className="install">
                      <span className="ver">
                        {APP_LABEL[i.app]} {i.version === 'unknown' ? '' : i.version}
                      </span>
                      <span className="p" title={i.renderPath}>
                        <bdi>{i.renderPath}</bdi>
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="src">{i.source === 'auto' ? 'Detected' : 'Added manually'}</span>
                        {i.source === 'manual' && (
                          <button
                            className="btn small ghost icon"
                            aria-label="Remove installation"
                            onClick={() => window.rd.removeInstall(i.id)}
                          >
                            <Trash2 />
                          </button>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button className="btn small" onClick={() => window.rd.detectApps()}>
                    <RefreshCcw />
                    Scan again
                  </button>
                  <button className="btn small" onClick={() => window.rd.addInstall('maya')}>
                    <Plus />
                    {MAC ? 'Add Maya application…' : 'Add Maya Render.exe…'}
                  </button>
                  <button className="btn small" onClick={() => window.rd.addInstall('blender')}>
                    <Plus />
                    {MAC ? 'Add Blender application…' : 'Add blender.exe…'}
                  </button>
                </div>
                <div style={{ marginTop: 16 }}>
                  <Field label="Maya .mb inspection">
                    <Toggle
                      on={app.deepProbe}
                      onChange={(v) => up({ deepProbe: v })}
                      label="Inspect with Maya when adding scenes"
                      hint="Camera and frame settings in .mb files require Maya to open the scene. This can take several seconds per scene."
                    />
                  </Field>
                </div>
              </div>
            )}
            {pane === 'lock' && (
              <div className="section">
                <h3>Settings locked</h3>
                <p className="hint" style={{ marginTop: -4, marginBottom: 14 }}>
                  Lock output and advanced settings on shared workstations. Users can still add scenes, choose frame ranges and cameras,
                  start or stop rendering, and toggle the completion action.
                </p>
                {snap.lock.enabled ? (
                  <>
                    <Field label="Status">
                      <span style={{ paddingTop: 6 }}>A PIN is configured. Lock settings to restrict changes.</span>
                    </Field>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        className="btn primary"
                        onClick={async () => {
                          relockOnClose = false
                          await window.rd.lockNow()
                          setOpen(false)
                          toast('Settings locked.')
                        }}
                      >
                        <Lock />
                        Lock now
                      </button>
                      <button
                        className="btn"
                        onClick={async () => {
                          await window.rd.setPin(null)
                          toast('Settings unlocked and PIN removed.')
                        }}
                      >
                        Remove PIN
                      </button>
                    </div>
                  </>
                ) : (
                  <Field
                    label="Set PIN"
                    hint="Use at least four digits. To reset a forgotten PIN, close the app and remove lockPinHash from state.json in the data folder."
                  >
                    <div className="field-row">
                      <input
                        className="input"
                        style={{ width: 140 }}
                        type="password"
                        inputMode="numeric"
                        value={pin1}
                        onChange={(e) => setPin1(e.target.value.replace(/\D/g, ''))}
                        placeholder="PIN"
                        aria-label="New PIN"
                      />
                      <button
                        className="btn"
                        disabled={pin1.length < 4}
                        onClick={async () => {
                          await window.rd.setPin(pin1)
                          setPin1('')
                          toast('PIN configured. Select Lock now to apply it.')
                        }}
                      >
                        Set PIN
                      </button>
                    </div>
                  </Field>
                )}
              </div>
            )}
            {pane === 'etc' && (
              <div className="section">
                <h3>Advanced</h3>
                <Field
                  label="ffmpeg"
                  hint="Used for EXR/TIFF thumbnails and MP4 previews, not for rendering. Leave blank to detect automatically."
                >
                  <div className="field-row">
                    <div
                      className="path-box"
                      onClick={async () => {
                        const p = await window.rd.pickFfmpeg()
                        if (p) void up({ ffmpegPath: p })
                      }}
                    >
                      <span>
                        <bdi>{app.ffmpegPath || 'Automatic (PATH)'}</bdi>
                      </span>
                    </div>
                    {app.ffmpegPath && (
                      <button className="btn small ghost" onClick={() => up({ ffmpegPath: '' })}>
                        Automatic
                      </button>
                    )}
                  </div>
                </Field>
                <Field label="Log encoding" hint="Change this if renderer logs contain unreadable characters.">
                  <Select
                    value={app.logEncoding}
                    options={[
                      { value: 'auto', label: 'Automatic' },
                      { value: 'cp949', label: 'CP949 (Korean Windows)' },
                      { value: 'utf8', label: 'UTF-8' }
                    ]}
                    onChange={(v) => up({ logEncoding: v })}
                  />
                </Field>
                {info && (
                  <div className="hint" style={{ marginTop: 6 }}>
                    Render Farm {info.version}, Electron {info.electron}
                    <br />
                    Data folder {info.dataDir}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn primary" onClick={close}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export function PinDialog() {
  const open = useUi((s) => s.pinPrompt)
  const setOpen = useUi((s) => s.openPin)
  const openSettings = useUi((s) => s.openSettings)
  const [pin, setPin] = useState('')
  const [err, setErr] = useState(false)
  useEffect(() => {
    if (!open) return
    setPin('')
    setErr(false)
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [open, setOpen])
  if (!open) return null
  const submit = async () => {
    const ok = await window.rd.unlock(pin)
    if (ok) {
      relockOnClose = true
      setOpen(false)
      openSettings(true)
    } else {
      setErr(true)
      setPin('')
    }
  }
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="modal narrow" role="dialog" aria-labelledby="pin-title">
        <div className="modal-head">
          <h2 id="pin-title">Settings locked</h2>
        </div>
        <div className="modal-body">
          <p className="hint" style={{ marginTop: 0 }}>
            Enter the administrator PIN to change preferences.
          </p>
          <input
            className="input pin-input"
            type="password"
            inputMode="numeric"
            autoFocus
            maxLength={12}
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            aria-label="PIN"
          />
          {err && (
            <div className="hint" style={{ color: 'var(--red)', marginTop: 6 }}>
              Incorrect PIN.
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button className="btn primary" disabled={!pin} onClick={submit}>
            Unlock
          </button>
        </div>
      </div>
    </div>
  )
}
