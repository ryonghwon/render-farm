type Pane = 'defaults' | 'run' | 'after' | 'maya' | 'lock' | 'etc'
import type { AppInfo, CompletionAction, RenderSettings, SettingsKey } from '@shared/types'
import { Cpu, Lock, MonitorCog, Plus, Power, RefreshCcw, SlidersHorizontal, Trash2, Wrench, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { APP_LABEL } from '../format'
import { useUi } from '../store'
import { Field, NumberInput, Select, Toggle } from './controls'
import { AdvancedFields } from './SceneDialog'
const MAC = navigator.userAgent.includes('Macintosh')
let relockOnClose = false

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
          <h2 id="pin-title">설정 잠김</h2>
        </div>
        <div className="modal-body">
          <p className="hint" style={{ marginTop: 0 }}>
            환경 설정을 변경하려면 관리자 PIN을 입력하세요.
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
              PIN이 일치하지 않습니다.
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={() => setOpen(false)}>
            취소
          </button>
          <button className="btn primary" disabled={!pin} onClick={submit}>
            잠금 해제
          </button>
        </div>
      </div>
    </div>
  )
}

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
    { id: 'defaults', label: '기본값', icon: <Wrench /> },
    { id: 'run', label: '실행', icon: <Cpu /> },
    { id: 'after', label: '끝난 뒤 작업', icon: <Power /> },
    { id: 'maya', label: '프로그램', icon: <MonitorCog /> },
    { id: 'lock', label: '잠금', icon: <Lock /> },
    { id: 'etc', label: '고급', icon: <SlidersHorizontal /> }
  ]
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal wide" role="dialog" aria-labelledby="st-title">
        <div className="modal-head">
          <h2 id="st-title">환경 설정</h2>
          <button className="btn ghost icon" aria-label="닫기" onClick={close}>
            <X />
          </button>
        </div>
        <div className="settings-layout">
          <nav className="settings-nav" aria-label="설정 항목">
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
                  <h3>프리셋</h3>
                  <Field label="불러오기" hint="저장된 기본값을 일괄 적용합니다.">
                    <div className="field-row">
                      <Select
                        value=""
                        options={[
                          { value: '', label: snap.presets.length ? '프리셋 선택' : '저장된 프리셋 없음' },
                          ...snap.presets.map((p) => ({ value: p.id, label: p.name }))
                        ]}
                        onChange={(v) => {
                          if (!v) return
                          void window.rd.applyPreset(v)
                          toast(`프리셋을 적용했습니다: ${snap.presets.find((p) => p.id === v)?.name}`)
                        }}
                        ariaLabel="프리셋"
                      />
                      <button className="btn" onClick={() => openPreset(true)}>
                        현재 값 저장
                      </button>
                    </div>
                    {snap.presets.length > 0 && (
                      <div className="list" style={{ marginTop: 4 }}>
                        {snap.presets.map((p) => (
                          <div key={p.id} className="list-item">
                            <span className="p">{p.name}</span>
                            <button
                              className="btn small ghost icon"
                              aria-label={`${p.name} 삭제`}
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
                    <h3>고정 저장 설정</h3>
                    <Field label="저장 폴더" hint="잠금 상태에서는 변경할 수 없습니다. 다중 PC 렌더 시 마스터 공유 폴더 경로를 권장합니다.">
                      <div className="field-row">
                        <div
                          className="path-box"
                          onClick={async () => {
                            const p = await window.rd.pickOutputDir(g.outputRoot)
                            if (p) void setG({ outputRoot: p })
                          }}
                        >
                          <span>
                            <bdi>{g.outputRoot || '지정되지 않음'}</bdi>
                          </span>
                        </div>
                      </div>
                    </Field>
                    <Field label="파일 형식">
                      <Select
                        value={g.format}
                        options={[
                          { value: 'exr', label: 'EXR' },
                          { value: 'png', label: 'PNG' },
                          { value: 'jpg', label: 'JPEG' },
                          { value: 'tif', label: 'TIFF' },
                          { value: 'scene', label: '씬 그대로' }
                        ]}
                        onChange={(v) => setG({ format: v as RenderSettings['format'] })}
                      />
                    </Field>
                  </div>
                )}
                <div className="section">
                  <h3>씬 기본값</h3>
                  <p className="hint" style={{ marginTop: -4, marginBottom: 12 }}>
                    따로 설정하지 않은 씬에 적용됩니다. 저장 폴더와 파일 형식은 메인 화면 오른쪽의 저장 패널에서 변경합니다.
                  </p>
                  <Field label="프레임 범위">
                    <Select
                      value={g.frameMode === 'custom' ? 'scene' : g.frameMode}
                      options={[
                        { value: 'scene', label: '렌더 설정 범위' },
                        { value: 'timeline', label: '타임라인 범위' }
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
                <h3>실행</h3>
                <Field label="병렬 렌더" hint="여러 씬을 동시에 렌더합니다. 처리량이 늘어나는 대신 메모리 사용량이 증가합니다.">
                  <Toggle on={app.concurrency > 1} onChange={(v) => up({ concurrency: v ? 2 : 1 })} label="병렬 렌더 사용" />
                  {app.concurrency > 1 && (
                    <div className="field-row">
                      <NumberInput value={app.concurrency} min={2} max={8} onCommit={(v) => up({ concurrency: v })} width={56} />
                      <span className="hint">개 동시 실행</span>
                    </div>
                  )}
                </Field>
                <Field
                  label="프로세스당 스레드"
                  hint={`0은 자동입니다. 순차 렌더 시 전체 코어를, 병렬 렌더 시 논리 코어 ${cores || 'N'}개를 나눠 사용합니다.`}
                >
                  <NumberInput value={app.threadsPerTask} min={0} max={256} onCommit={(v) => up({ threadsPerTask: v })} width={60} />
                </Field>
                <Field label="실패 시 재시도" hint="렌더가 중단되면 빠진 프레임만 지정 횟수까지 다시 렌더합니다.">
                  <div className="field-row">
                    <NumberInput value={app.maxRetries} min={0} max={10} onCommit={(v) => up({ maxRetries: v })} width={56} />
                    <span className="hint">회</span>
                  </div>
                </Field>
                <Field label="Arnold 로그 수준">
                  <Select
                    value={String(app.arnoldVerbosity)}
                    options={[
                      { value: '0', label: '오류' },
                      { value: '1', label: '경고' },
                      { value: '2', label: '정보 (진행률 표시, 권장)' },
                      { value: '3', label: '디버그' }
                    ]}
                    onChange={(v) => up({ arnoldVerbosity: Number(v) })}
                  />
                </Field>
              </div>
            )}
            {pane === 'after' && (
              <div className="section">
                <h3>끝난 뒤 작업</h3>
                <Field label="작업" hint="메인 화면의 '끝나면' 스위치가 켜져 있을 때 실행합니다.">
                  <Select<Exclude<CompletionAction, 'none'>>
                    value={app.completionKind ?? 'shutdown'}
                    options={[
                      { value: 'shutdown', label: 'PC 끄기' },
                      { value: 'sleep', label: '절전 모드' },
                      { value: 'quit', label: 'Render Farm 닫기' }
                    ]}
                    onChange={(v) => up({ completionKind: v, completionAction: armed ? v : 'none' })}
                  />
                </Field>
                <Field label="취소 대기 시간" hint="실행 전 카운트다운을 표시하며 그 사이 취소할 수 있습니다.">
                  <div className="field-row">
                    <NumberInput value={app.countdownSeconds} min={5} max={600} onCommit={(v) => up({ countdownSeconds: v })} width={64} />
                    <span className="hint">초</span>
                  </div>
                </Field>
                <Field label="실패 씬 발생 시">
                  <Toggle
                    on={app.completionOnFailure}
                    onChange={(v) => up({ completionOnFailure: v })}
                    label="작업 실행"
                    hint="해제하면 실패한 씬이 있을 때 실행하지 않습니다."
                  />
                </Field>
                <Field label="절전 방지">
                  <Toggle on={app.keepAwake} onChange={(v) => up({ keepAwake: v })} label="렌더 중 절전 모드 진입 방지" />
                </Field>
                <Field label="알림">
                  <Toggle on={app.notifications} onChange={(v) => up({ notifications: v })} label="씬 완료 및 실패 시 알림 표시" />
                </Field>
              </div>
            )}
            {pane === 'maya' && (
              <div className="section">
                <h3>설치된 프로그램</h3>
                <div className="install-list">
                  {snap.installs.length === 0 && (
                    <div className="install-empty">설치된 Maya와 Blender를 찾지 못했습니다. 아래에서 직접 등록하세요.</div>
                  )}
                  {snap.installs.map((i) => (
                    <div key={i.id} className="install">
                      <span className="ver">
                        {APP_LABEL[i.app]} {i.version === 'unknown' ? '' : i.version}
                      </span>
                      <span className="p" title={i.renderPath}>
                        <bdi>{i.renderPath}</bdi>
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="src">{i.source === 'auto' ? '자동 탐지' : '수동 등록'}</span>
                        {i.source === 'manual' && (
                          <button className="btn small ghost icon" aria-label="등록 해제" onClick={() => window.rd.removeInstall(i.id)}>
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
                    다시 탐지
                  </button>
                  <button className="btn small" onClick={() => window.rd.addInstall('maya')}>
                    <Plus />
                    {MAC ? 'Maya 앱 등록…' : 'Maya Render.exe 등록…'}
                  </button>
                  <button className="btn small" onClick={() => window.rd.addInstall('blender')}>
                    <Plus />
                    {MAC ? 'Blender 앱 등록…' : 'blender.exe 등록…'}
                  </button>
                </div>
                <div style={{ marginTop: 16 }}>
                  <Field label="Maya .mb 파일 분석">
                    <Toggle
                      on={app.deepProbe}
                      onChange={(v) => up({ deepProbe: v })}
                      label="등록 시 Maya로 정밀 분석"
                      hint=".mb 파일의 카메라와 프레임 범위는 Maya로 열어야 확인됩니다. 씬당 수십 초가 소요될 수 있습니다."
                    />
                  </Field>
                </div>
              </div>
            )}
            {pane === 'lock' && (
              <div className="section">
                <h3>설정 잠금</h3>
                <p className="hint" style={{ marginTop: -4, marginBottom: 14 }}>
                  실습실 PC의 저장 폴더, 파일 형식, 고급 설정을 고정합니다. 잠금 상태에서는 씬 추가, 프레임 범위, 카메라, 렌더 시작과 중지,
                  끝나면 PC 끄기만 변경할 수 있습니다.
                </p>
                {snap.lock.enabled ? (
                  <>
                    <Field label="상태">
                      <span style={{ paddingTop: 6 }}>PIN이 설정되어 있습니다. 잠그면 학생용 화면으로 전환됩니다.</span>
                    </Field>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        className="btn primary"
                        onClick={async () => {
                          relockOnClose = false
                          await window.rd.lockNow()
                          setOpen(false)
                          toast('설정을 잠갔습니다.')
                        }}
                      >
                        <Lock />
                        지금 잠금
                      </button>
                      <button
                        className="btn"
                        onClick={async () => {
                          await window.rd.setPin(null)
                          toast('설정 잠금을 해제하고 PIN을 삭제했습니다.')
                        }}
                      >
                        PIN 삭제
                      </button>
                    </div>
                  </>
                ) : (
                  <Field
                    label="PIN 설정"
                    hint="숫자 4자리 이상. 분실 시 앱 데이터 폴더의 state.json에서 lockPinHash 항목을 삭제하면 초기화됩니다."
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
                        aria-label="새 PIN"
                      />
                      <button
                        className="btn"
                        disabled={pin1.length < 4}
                        onClick={async () => {
                          await window.rd.setPin(pin1)
                          setPin1('')
                          toast('PIN을 설정했습니다. 지금 잠금을 누르면 적용됩니다.')
                        }}
                      >
                        PIN 설정
                      </button>
                    </div>
                  </Field>
                )}
              </div>
            )}
            {pane === 'etc' && (
              <div className="section">
                <h3>고급</h3>
                <Field
                  label="ffmpeg"
                  hint="EXR, TIFF 미리보기와 MP4 프리뷰 영상에만 사용하며 렌더에는 필요하지 않습니다. 비워 두면 자동으로 찾습니다."
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
                        <bdi>{app.ffmpegPath || '자동 (PATH)'}</bdi>
                      </span>
                    </div>
                    {app.ffmpegPath && (
                      <button className="btn small ghost" onClick={() => up({ ffmpegPath: '' })}>
                        자동
                      </button>
                    )}
                  </div>
                </Field>
                <Field label="로그 인코딩" hint="Maya 로그의 한글이 깨질 때 변경합니다.">
                  <Select
                    value={app.logEncoding}
                    options={[
                      { value: 'auto', label: '자동' },
                      { value: 'cp949', label: 'CP949 (한국어 Windows)' },
                      { value: 'utf8', label: 'UTF-8' }
                    ]}
                    onChange={(v) => up({ logEncoding: v })}
                  />
                </Field>
                {info && (
                  <div className="hint" style={{ marginTop: 6 }}>
                    Render Farm {info.version}, Electron {info.electron}
                    <br />
                    데이터 폴더 {info.dataDir}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn primary" onClick={close}>
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}
