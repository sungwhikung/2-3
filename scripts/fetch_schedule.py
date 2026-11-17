"""나이스 학사일정에서 우리 학년 일정만 뽑아 data/schedule.json 으로 저장한다."""
import json
import os
from datetime import date, datetime
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

API_URL = "https://open.neis.go.kr/hub/SchoolSchedule"
SCHOOL_NAME = "논산대건고등학교"
OFFICE_CODE = "N10"
SCHOOL_CODE = "8140085"
GRADE = 2
OUTPUT = Path("data/schedule.json")

GRADE_FIELD = {1: "ONE_GRADE_EVENT_YN", 2: "TW_GRADE_EVENT_YN", 3: "THREE_GRADE_EVENT_YN"}[GRADE]
SKIP_TITLES = {"토요휴업일"}  # 매주 반복되어 달력만 어지럽힌다
HOLIDAY_KINDS = {"휴업일", "공휴일"}


def slim(rows):
    """나이스 원본 → 우리 학년 일정만, 화면에서 쓰는 가벼운 형태"""
    schedules = []
    for row in rows:
        title = row.get("EVENT_NM", "").strip()
        day = row.get("AA_YMD", "")
        if not title or len(day) != 8 or title in SKIP_TITLES or row.get(GRADE_FIELD) != "Y":
            continue
        schedules.append({
            "date": f"{day[:4]}-{day[4:6]}-{day[6:8]}",
            "title": title,
            "holiday": row.get("SBTR_DD_SC_NM", "") in HOLIDAY_KINDS,  # 수업이 없는 날
        })
    return sorted(schedules, key=lambda item: (item["date"], item["title"]))


def fetch_rows(api_key, start_date, end_date):
    params = {
        "KEY": api_key,
        "Type": "json",
        "ATPT_OFCDC_SC_CODE": OFFICE_CODE,
        "SD_SCHUL_CODE": SCHOOL_CODE,
        "AA_FROM_YMD": start_date.strftime("%Y%m%d"),
        "AA_TO_YMD": end_date.strftime("%Y%m%d"),
        "pIndex": "1",
        "pSize": "1000",
    }
    request = Request(API_URL + "?" + urlencode(params), headers={"User-Agent": "Class23Site/1.0"})
    with urlopen(request, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))

    if "RESULT" in payload:
        code = payload["RESULT"].get("CODE", "")
        if code == "INFO-200":
            return []
        raise RuntimeError(f"NEIS 학사일정 API 오류: {code} - {payload['RESULT'].get('MESSAGE', '')}")

    sections = payload.get("SchoolSchedule", [])
    return (sections[1].get("row", []) or []) if len(sections) >= 2 else []


def main():
    api_key = os.environ.get("NEIS_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("NEIS_API_KEY가 없습니다. GitHub Actions Secrets를 확인하세요.")

    now = datetime.now(ZoneInfo("Asia/Seoul"))
    start_date = date(now.year, 1, 1)
    end_date = date(now.year + 1, 12, 31)

    schedules = slim(fetch_rows(api_key, start_date, end_date))
    output = {"school": SCHOOL_NAME, "grade": GRADE, "updatedAt": now.isoformat(timespec="seconds"), "schedules": schedules}
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    print(f"조회 기간: {start_date} ~ {end_date}")
    print(f"{GRADE}학년 학사일정 건수: {len(schedules)}")
    print(f"저장 위치: {OUTPUT}")


if __name__ == "__main__":
    main()
