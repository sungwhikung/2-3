# 2–3

논산대건고등학교 2학년 3반 친구들을 위한 사이트입니다. (meal-dg의 후속)

- **홈** — 다음 급식, 오늘(또는 다음 수업일) 내 시간표, 할 일, D-day(시험·외박·방학 자동), 방학까지 학교 가는 날, 다가오는 일정, 공지
- **급식** — 날짜별·주간 식단, 열량/탄단지, 내 알레르기 표시, 메뉴 찾기와 기다리는 메뉴(★) 알림, 공유
- **시간표** — 번호만 넣으면 내 선택 과목이 채워지는 2-3 시간표
- **일정** — 나이스 학사일정 + 학교 캘린더, 자습 감독, 날짜별 내 메모와 할 일
- **공지** — 관리자가 올리는 반 공지 (Firebase), 새 글이 있으면 탭에 빨간 점
- **도구** — 번호 뽑기, 순서 섞기, 조 나누기, 자리 바꾸기(교실 모양·짝·고정 자리·앞줄·떨어져 앉기·지난 자리/짝 피하기·한 자리씩 공개)

빌드 과정 없는 정적 사이트입니다. `index.html`, `css/`, `js/`, `data/`만 있으면 동작합니다.

## 처음 한 번 설정하기

1. **GitHub Pages 켜기** — Settings → Pages → Source: `Deploy from a branch`, Branch: `main` / `/(root)`
2. **자동 갱신용 키 넣기** — Settings → Secrets and variables → Actions 에 meal-dg와 같은 값을 추가
   - `NEIS_API_KEY` : 나이스 교육정보 개방 포털 인증키 (급식, 학사일정)
   - `SCHEDULE_API_KEY` : 구글 캘린더 API 키 (자습 감독, 학교 행사)
3. Actions 탭에서 **Update school data** 를 한 번 수동 실행해 확인

이후에는 매일 새벽 5시(한국 시간)에 `data/` 가 자동으로 갱신됩니다.

## 구조

| 경로 | 내용 |
| --- | --- |
| `js/app.js` | 홈·급식·시간표·일정·공지 로직 |
| `js/tools.js` | 도구 탭 (뽑기·조 나누기) |
| `js/seats.js` | 도구 탭의 자리 바꾸기 |
| `js/util.js` | 공통 함수 (저장, 안내 메시지 등) |
| `css/style.css` | 디자인 (맨 위 변수로 색 변경, 다크 모드 포함) |
| `data/*.json` | 급식·학사일정·학교 캘린더·자습 감독·시간표 |
| `scripts/` | `data/` 를 만드는 스크립트 (GitHub Actions가 실행) |
| `firestore.rules` | 공지용 Firestore 보안 규칙 |

- 시간표가 바뀌면 `node scripts/extract_timetable.js <timetable.js 경로>` 로 `data/timetable.json` 을 다시 만듭니다.
- 공지는 meal-dg와 같은 Firebase 프로젝트를 쓰므로 기존 공지와 관리자 계정이 그대로 이어집니다.
- 선택 과목·메모·할 일·D-day·알레르기·기다리는 메뉴·도구 탭의 이름 목록은 각자 기기에만 저장됩니다.

로컬에서 보기:

```bash
python3 -m http.server 8000
```

학교 공식 서비스가 아닌 개인 프로젝트입니다.
