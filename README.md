# 렌더팜

Maya와 Blender 씬 파일 여러 개를 한 렌더 목록에 올려 순차 또는 병렬로 무인 렌더하는 데스크톱 앱. 현재 버전은 1차(PC 한 대) 범위이며 2차 다중 PC 분배(마스터와 렌더 노드)는 같은 작업 구조를 이어서 확장할 예정.

## 실행

- `RenderFarm-Portable-0.2.0.exe` 실행, 설치 과정 없음
- 서명되지 않은 앱이므로 첫 실행 시 Windows "PC 보호" 경고 표시. **추가 정보** 클릭 후 **실행**
- Maya는 `C:\Program Files\Autodesk\Maya20xx\bin\Render.exe`, Blender는 `C:\Program Files\Blender Foundation\Blender x.x\blender.exe`와 Steam 설치 경로에서 자동 탐지. 다른 위치에 설치한 경우 **환경 설정 > 프로그램**에서 등록
- 이전 이름(RenderDock)으로 사용하던 설정은 첫 실행 시 자동으로 가져옴

## Mac에서 실행

- Apple Silicon Mac은 `RenderFarm-0.2.1-mac-arm64.zip`, Intel Mac은 `RenderFarm-0.2.1-mac-x64.zip` 사용
- 압축을 풀고 `RenderFarm.app`을 응용 프로그램 폴더로 이동
- Apple 개발자 서명이 없어 첫 실행이 차단됨. 실행 시도 후 **시스템 설정 > 개인정보 보호 및 보안**에서 **그래도 열기** 클릭
- Maya는 `/Applications/Autodesk/maya20xx/Maya.app`, Blender는 응용 프로그램 폴더의 `Blender.app`에서 자동 탐지
- **끝나면 PC 끄기**를 처음 사용할 때 System Events 제어 허용 창이 표시됨. 허용해야 자동 종료 동작
- 설정과 로그는 `~/Library/Application Support/RenderFarm`에 저장

## 학생 사용 순서

1. 씬 파일(.ma, .mb, .blend)이나 폴더를 창에 끌어 놓기. Maya와 Blender 씬을 한 목록에 함께 등록 가능
2. 오른쪽 **저장** 패널에서 저장 폴더와 파일 형식 확인
3. **렌더 시작**. 확인 사항이 있으면 렌더 전 점검 창에서 바로 수정하거나 그대로 시작
4. 자리를 비울 때는 **끝나면 PC 끄기** 스위치 사용. 모든 씬이 끝나면 카운트다운(기본 60초) 후 실행되며 카운트다운 중 취소 가능

씬별로 프레임 범위, 카메라, 파일 형식을 다르게 지정하려면 해당 씬의 **씬 설정**에서 변경. 변경한 씬에는 "따로 설정" 표시. 렌더 로그는 렌더 목록 오른쪽 위 **로그** 버튼으로 확인. 기본 보기는 요약이며 Maya 원본 출력은 보기 선택에서 표시.

## 관리 기능

- **설정 잠금**: 환경 설정 > 잠금에서 PIN 설정 후 잠금. 잠금 상태에서는 씬 추가, 프레임 범위, 카메라, 렌더 시작과 중지, 끝나면 PC 끄기만 변경 가능
- **실행**: 병렬 렌더(동시 실행 수), 프로세스당 스레드, 실패 시 재시도 횟수, Arnold 로그 수준
- **기본값**: 렌더러, Maya 버전, 파일 이름, 하위 폴더, 프레임 자릿수, 기존 프레임 건너뛰기, 청크 크기, 프리뷰 영상, 추가 인수
- **프리셋**: 기본값 묶음 저장과 불러오기

## Blender 씬

- .blend 파일을 Blender 없이 직접 읽어 프레임 범위, 해상도, 카메라, 뷰 레이어, 링크된 파일, 없는 텍스처 확인. 읽지 못하는 파일은 설치된 Blender로 분석
- 렌더는 `blender -b 씬 --python 설정 스크립트 -s 시작 -e 끝 -j 간격 -a`로 실행. 저장 경로, 파일 형식, 카메라, 해상도, 뷰 레이어, 렌더 장치는 설정 스크립트에서 적용
- 렌더 장치 기본값은 자동(GPU 우선). Cycles에서 OptiX, CUDA, HIP, oneAPI, Metal 순으로 GPU를 찾고 없으면 CPU 사용
- EXR은 멀티레이어 EXR로 저장. 패스가 한 파일에 레이어로 들어감
- 씬 버전과 같은 Blender를 우선 사용하고, 없으면 더 높은 버전 사용. 낮은 버전으로 렌더하면 경고

## 렌더 처리 방식

| 항목 | 처리 |
| --- | --- |
| 실행 | 작업마다 Maya `Render.exe` 또는 `blender.exe`를 하위 프로세스로 실행 |
| 저장 경로 | `{저장 폴더}/{씬 이름}/{씬 이름}.0001.exr` 형식, 하위 폴더와 파일 이름은 고급 설정에서 변경. Arnold AOV가 있으면 AOV별 폴더에 저장 |
| 형식과 파일 이름 | Maya는 렌더 직전 MEL로 `defaultRenderGlobals`, `defaultArnoldDriver`에 적용, Blender는 설정 스크립트로 적용 |
| 프로젝트 | 씬 상위 폴더에서 `workspace.mel`을 찾아 `-proj`로 지정, 텍스처 상대 경로 유지 |
| 진행률 | 프레임 완료 신호(MEL), Arnold 진행률 로그, 저장 폴더 파일 감시 병행 |
| 검증 | 렌더 완료 후 프레임 파일 존재 여부 확인, AOV가 있으면 beauty 기준. 빠진 프레임만 자동 재렌더 |
| 라이선스 | Arnold 라이선스 실패 감지 시 다음 렌더 시작 전 반환 대기(60초부터), 실패 프레임은 대기 후 최대 3회 다시 렌더 |
| 예상 시간 | 씬 여는 시간과 프레임당 시간을 나눠 기록, 이전 렌더 기록으로 시작 전 예상 시간 표시. 기록 없는 씬은 다른 씬 기준 추정 |
| 재개 | 중지하거나 앱을 다시 실행해도 남은 프레임부터 렌더 |
| 무인 운영 | 렌더 중 절전 방지, 완료 알림, 작업 표시줄 진행률, 완료 후 시스템 종료 |

렌더 로그는 `%APPDATA%\RenderFarm\logs\{작업}`에 프로세스별로 저장.

## 개발

```
npm install
npm run dev        개발 실행
npm test           렌더 엔진 테스트 (모의 Maya, 모의 Blender 사용, 32개)
npm run dist:win   Windows 설치 파일과 포터블 실행 파일 생성
npm run dist:mac   Mac 앱 zip 생성 (Apple Silicon, Intel)
```

```
src/main/engine   렌더 엔진 (Electron 비의존)
  engine.ts       렌더 목록, 스케줄러, 재시도, 이어서 렌더, 잠금, 끝난 뒤 작업
  probe.ts        .ma 직접 판독, .mb 헤더 판독, mayapy 정밀 분석
  blend.ts        .blend 직접 판독(압축 포함, Blender 4.5와 5.2 파일로 확인), 실패 시 Blender로 분석
  installs.ts     Maya, Blender 설치 탐지와 버전 선택
  command.ts      Maya Render 명령과 MEL, Blender 명령과 설정 스크립트 구성
  runner.ts       프로세스 실행, 로그 해석, 프로세스 트리 종료
  frames.ts       렌더 프레임 탐지와 시퀀스 판별
src/main/index.ts Electron 창, IPC, 알림, 절전 방지
src/renderer      화면 (React)
test              엔진 테스트, 모의 Render, 화면 캡처 스크립트
```

## 실기 확인 필요 항목

- Arnold 라이선스 반환 대기 시간. 실습실 라이선스 방식에 따라 60초 간격의 적정성 확인
- 교육용 라이선스 환경의 Arnold 배치 렌더 워터마크 여부
- 한글 경로 씬의 실제 렌더 가능 여부 (현재 경고만 표시)
- Redshift, V-Ray는 파일 형식 지정 미지원, 씬에 설정된 형식 사용
- Mac 실행 전반(설치 탐지, 렌더, 자동 종료). 코드는 공통이며 Mac 실기 확인 전
- Blender 실제 렌더 동작(Windows, GPU). 설정 스크립트는 Blender 4.5와 5.2 Python 모듈로 확인, 명령줄 실행은 실습실 PC에서 확인 필요
