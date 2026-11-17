"""나이스 급식 정보를 받아 data/meals.json 으로 저장한다.

화면에 필요한 값(메뉴, 알레르기 번호, 열량, 탄단지)만 남겨 파일을 가볍게 유지한다.
"""
import calendar
import json
import os
import re
from datetime import datetime
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

API_URL = "https://open.neis.go.kr/hub/mealServiceDietInfo"
SCHOOL_NAME = "논산대건고등학교"
OFFICE_CODE = "N10"
SCHOOL_CODE = "8140085"
OUTPUT = Path("data/meals.json")

BR = re.compile(r"<br\s*/?>", re.I)
ALLERGENS = re.compile(r"\s*\(([\d.\s]+)\)\s*$")
NUTRIENTS = {"탄수화물": "carbs", "단백질": "protein", "지방": "fat"}


def number(text):
    match = re.search(r"\d+(?:\.\d+)?", str(text or ""))
    return float(match.group()) if match else None


def slim(row):
    """나이스 원본 한 줄 → 화면에서 쓰는 가벼운 형태"""
    dishes = []
    for part in BR.split(row.get("DDISH_NM", "")):
        part = part.strip()
        if not part:
            continue
        match = ALLERGENS.search(part)
        codes = [int(code) for code in match.group(1).split(".") if code.strip().isdigit()] if match else []
        dishes.append({"name": ALLERGENS.sub("", part).strip(), "allergens": codes})

    nutrition = {}
    for part in BR.split(row.get("NTR_INFO", "")):
        label, _, value = part.partition(":")
        key = NUTRIENTS.get(label.split("(")[0].strip())
        if key and number(value) is not None:
            nutrition[key] = number(value)

    day = row.get("MLSV_YMD", "")
    return {
        "date": f"{day[:4]}-{day[4:6]}-{day[6:8]}",
        "type": int(row.get("MMEAL_SC_CODE", 0)),  # 1 아침, 2 점심, 3 저녁
        "dishes": dishes,
        "kcal": number(row.get("CAL_INFO")),
        "nutrition": nutrition,
    }


def shift_month(year, month, delta):
    index = year * 12 + (month - 1) + delta
    return index // 12, index % 12 + 1


def fetch_rows(api_key, start_date, end_date):
    params = {
        "KEY": api_key,
        "Type": "json",
        "ATPT_OFCDC_SC_CODE": OFFICE_CODE,
        "SD_SCHUL_CODE": SCHOOL_CODE,
        "MLSV_FROM_YMD": start_date.strftime("%Y%m%d"),
        "MLSV_TO_YMD": end_date.strftime("%Y%m%d"),
        "pIndex": "1",
        "pSize": "1000",
    }
    request = Request(API_URL + "?" + urlencode(params), headers={"User-Agent": "Class23Site/1.0"})
    with urlopen(request, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))

    if "RESULT" in payload:
        code = payload["RESULT"].get("CODE", "")
        if code == "INFO-200":  # 해당 기간에 등록된 급식 없음
            return []
        raise RuntimeError(f"NEIS API 오류: {code} - {payload['RESULT'].get('MESSAGE', '')}")

    sections = payload.get("mealServiceDietInfo", [])
    return (sections[1].get("row", []) or []) if len(sections) >= 2 else []


def main():
    api_key = os.environ.get("NEIS_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("NEIS_API_KEY가 없습니다. GitHub 저장소의 Actions Secrets 설정을 확인하세요.")

    # 실행 환경의 시간대와 관계없이 한국 날짜 기준, 지난달 1일 ~ 다음 달 말일
    now = datetime.now(ZoneInfo("Asia/Seoul"))
    start_year, start_month = shift_month(now.year, now.month, -1)
    end_year, end_month = shift_month(now.year, now.month, 1)
    start_date = datetime(start_year, start_month, 1).date()
    end_date = datetime(end_year, end_month, calendar.monthrange(end_year, end_month)[1]).date()

    meals = sorted((slim(row) for row in fetch_rows(api_key, start_date, end_date)), key=lambda meal: (meal["date"], meal["type"]))
    output = {"school": SCHOOL_NAME, "updatedAt": now.isoformat(timespec="seconds"), "meals": meals}
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    print(f"조회 기간: {start_date} ~ {end_date}")
    print(f"수집한 급식 건수: {len(meals)}")
    print(f"저장 위치: {OUTPUT}")


if __name__ == "__main__":
    main()
