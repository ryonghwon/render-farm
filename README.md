<p align="center">
  <img src="build/icon.png" width="80" alt="">
</p>

<h1 align="center">렌더팜</h1>

<p align="center">Maya, Blender 배치 렌더 매니저</p>

<p align="center">
  <a href="https://github.com/ryonghwon/renderfarm/releases/latest"><img src="https://img.shields.io/github/v/release/ryonghwon/renderfarm?label=release&color=2383e2" alt="release"></a>
  <img src="https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-37352f" alt="platform">
</p>

![렌더팜](docs/screenshots/overview.png)

## 개요

렌더팜은 여러 Maya, Blender 씬을 하나의 렌더 목록으로 관리하는 Windows 데스크톱 애플리케이션입니다. 씬 등록 시 렌더 설정을 분석해 문제를 사전에 표시하고, 렌더 후 프레임 단위로 결과를 검증합니다. 무인 렌더 환경을 전제로 재시도, 이어서 렌더, 완료 후 시스템 종료를 지원합니다.

## 기능

- Maya(.ma, .mb)와 Blender(.blend) 씬 통합 렌더 목록, 순차 및 병렬 렌더
- 씬 파일 정적 분석: 프레임 범위, 해상도, 카메라, 렌더 레이어, 참조 파일, 누락 텍스처
- 렌더 전 점검과 항목별 즉시 수정
- 프레임 파일 검증, 누락 프레임 자동 재렌더
- 중단 지점부터 이어서 렌더
- 프로세스 비정상 종료 시 지연 재시도, Arnold 라이선스 반환 대기
- 씬 로딩 시간과 프레임 렌더 시간 분리 기록 기반의 남은 시간 계산
- 렌더 중 절전 방지, 완료 알림, 완료 후 시스템 종료
- Blender Cycles GPU 자동 선택(OptiX, CUDA, HIP, oneAPI, Metal)
- PIN 기반 설정 잠금, 기본값 프리셋

## 요구 사항

| 항목 | 지원 범위 |
| --- | --- |
| 운영체제 | Windows 10, 11 (x64) |
| Maya | `Render.exe` 포함 설치본. Arnold 검증 완료, V-Ray와 Redshift는 씬 설정 형식으로 출력 |
| Blender | 4.5 이상. 4.5, 5.2 검증 완료 |

## 설치

[Releases](https://github.com/ryonghwon/renderfarm/releases/latest)에서 용도에 맞는 파일을 받습니다.

| 파일 | 설명 |
| --- | --- |
| `RenderFarm-Setup-<version>.exe` | 설치형. 시작 메뉴와 바탕 화면 바로 가기 생성 |
| `RenderFarm-Portable-<version>.exe` | 단일 실행 파일. 실습실 공용 PC 권장 |

코드 서명이 적용되지 않은 빌드이므로 첫 실행 시 Microsoft Defender SmartScreen 경고가 표시됩니다. **추가 정보 > 실행**으로 진행합니다.

Maya와 Blender는 아래 경로에서 자동 탐지합니다. 그 외 경로는 **환경 설정 > 프로그램**에서 등록합니다.

| 프로그램 | 탐지 경로 |
| --- | --- |
| Maya | `C:\Program Files\Autodesk\Maya<버전>\bin\Render.exe` |
| Blender | `C:\Program Files\Blender Foundation\Blender <버전>\blender.exe`, Steam 설치 경로 |

## 사용 방법

![빈 렌더 목록](docs/screenshots/empty.png)

1. 씬 파일 또는 폴더를 창에 끌어 놓아 렌더 목록에 추가합니다.
2. 오른쪽 **저장** 패널에서 저장 폴더와 파일 형식을 지정합니다.
3. **렌더 시작**을 실행합니다. 점검 항목이 있으면 렌더 전 점검 창이 열립니다.
4. 무인 렌더 시 **끝나면 PC 끄기**를 켭니다. 종료 전 카운트다운 중 취소가 가능합니다.

씬별 프레임 범위, 카메라, 해상도, 파일 형식은 해당 씬의 **씬 설정**에서 변경합니다. 기본값과 다르게 지정된 씬에는 목록에 **따로 설정** 태그가 표시됩니다.

## 화면

### 렌더 전 점검

카메라 누락, 저장 경로 중복, 프레임 범위 불일치, 참조 파일과 텍스처 누락을 렌더 전에 표시합니다. 자동 수정이 가능한 항목은 점검 창에서 바로 적용합니다.

![렌더 전 점검](docs/screenshots/preflight.png)

### 씬 설정

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/scene-settings.png" alt="Maya 씬 설정"></td>
    <td width="50%"><img src="docs/screenshots/blender-scene.png" alt="Blender 씬 설정"></td>
  </tr>
  <tr>
    <td align="center">Maya</td>
    <td align="center">Blender</td>
  </tr>
</table>

### 로그

기본 보기는 렌더팜 이벤트 요약입니다. Maya, Blender 원본 출력은 보기 옵션에서 표시합니다. 재시도로 복구된 오류는 요약에 포함하지 않습니다.

![로그](docs/screenshots/log.png)

### 완료 후 시스템 종료

모든 씬 완료 시 카운트다운 후 시스템을 종료합니다. 실패한 씬이 있으면 종료를 보류합니다.

![카운트다운](docs/screenshots/countdown.png)

### 관리 기능

설정 잠금 상태에서는 씬 추가, 프레임 범위, 카메라, 렌더 시작과 중지, 완료 후 종료 여부만 변경할 수 있습니다. 저장 폴더와 파일 형식은 관리자 값으로 고정됩니다.

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/locked.png" alt="설정 잠금"></td>
    <td width="50%"><img src="docs/screenshots/settings.png" alt="기본값"></td>
  </tr>
  <tr>
    <td align="center">설정 잠금</td>
    <td align="center">기본값, 프리셋</td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/programs.png" alt="프로그램"></td>
    <td width="50%"></td>
  </tr>
  <tr>
    <td align="center">프로그램 관리</td>
    <td></td>
  </tr>
</table>

## 렌더 처리

| 항목 | 처리 방식 |
| --- | --- |
| 실행 | 작업 단위로 `Render.exe`, `blender.exe`를 백그라운드 프로세스로 실행 |
| 출력 경로 | `<저장 폴더>\<씬 이름>\<씬 이름>.<프레임>.<확장자>`. 하위 폴더와 파일 이름 규칙 변경 가능 |
| 설정 적용 | Maya는 렌더 직전 MEL, Blender는 Python 부트 스크립트로 출력 형식과 경로 적용 |
| Maya 프로젝트 | 씬 상위 폴더의 `workspace.mel` 탐지 후 `-proj` 지정 |
| 진행률 | 프레임 완료 신호, 렌더러 진행률 출력, 저장 폴더 감시 병행 |
| 검증 | 프레임 파일 존재 여부 확인. Arnold AOV 출력 시 beauty 기준 |
| 재시도 | 누락 프레임만 재렌더. 비정상 종료 시 20초 후 재시도 |
| 라이선스 | Arnold 라이선스 실패 감지 시 다음 렌더 전 반환 대기. 60초에서 단계적으로 증가, 최대 3회 |
| Blender EXR | 멀티레이어 EXR 출력 |
| 버전 선택 | 씬 저장 버전과 일치하는 설치본 우선, 없으면 상위 버전 사용 |

## 데이터 위치

| 항목 | 경로 |
| --- | --- |
| 설정, 렌더 목록 | `%APPDATA%\RenderFarm\state.json` |
| 렌더 로그 | `%APPDATA%\RenderFarm\logs\<작업 ID>` |

## 문제 해결

| 증상 | 확인 사항 |
| --- | --- |
| 프로그램을 찾지 못함 | 기본 경로 외 설치본은 **환경 설정 > 프로그램**에서 실행 파일 직접 등록 |
| Arnold 라이선스 오류 | 이전 렌더 종료 직후 라이선스 미반환 상태. 반환 대기 후 자동 재렌더 |
| 경로 경고 | Maya 씬 또는 저장 경로에 영문 외 문자 포함. 영문 경로 사용 권장 |
| 빠진 프레임 표시 | 씬 행의 **빠진 프레임 다시 렌더** 실행. 원인은 로그의 Maya, Blender 원본 출력에서 확인 |

## 개발

```bash
npm install
npm run dev          # 개발 모드 실행
npm test             # 렌더 엔진 테스트
npm run typecheck    # 타입 검사
npm run dist:win     # Windows 설치 파일, 포터블 실행 파일
```

### 릴리스

`package.json`의 버전과 같은 태그(`v<version>`)로 GitHub 릴리스를 발행하면 GitHub Actions가 테스트, Windows 빌드, 파일 첨부를 수행합니다. `docs/releases/<태그>.md`가 있으면 릴리스 설명에 반영됩니다.

### 구조

```
src/main/engine     렌더 엔진 (Electron 비의존)
  engine.ts         렌더 목록, 스케줄러, 재시도, 이어서 렌더, 잠금, 완료 후 작업
  probe.ts          .ma 정적 분석, .mb 헤더 분석, mayapy 분석
  blend.ts          .blend 정적 분석, Blender 분석 대체 경로
  installs.ts       Maya, Blender 설치 탐지와 버전 선택
  command.ts        렌더 명령, MEL, Python 부트 스크립트 생성
  runner.ts         프로세스 실행, 출력 해석, 프로세스 트리 종료
  frames.ts         프레임 파일 탐지, 시퀀스 판별
src/main/index.ts   창, IPC, 알림, 절전 방지
src/renderer        UI (React)
test                엔진 테스트, 모의 렌더 프로그램, 화면 캡처 스크립트
```

Electron, React, TypeScript, electron-vite 기반입니다.
