import os
import sqlite3
import requests
from flask import Flask, render_template, request, jsonify
import json

app = Flask(__name__)
app.config["JSON_AS_ASCII"] = False


# 2313
class UTF8JSONEncoder(json.JSONEncoder):
    def ensure_ascii(self):
        return False


# =========================
# 카카오 REST API 키 (환경변수 추천)
# =========================
REST_API_KEY = os.getenv("KAKAO_REST_API_KEY", "bc5e7a5770893ef473191d9d0e068aea")
# REST_API_KEY = "dbc5e7a5770893ef473191d9d0e068aea"


# =========================
# 주소/장소 → 좌표 변환 (x=lng, y=lat)
# =========================
def geocode(query: str):
    headers = {"Authorization": f"KakaoAK {REST_API_KEY}"}

    # 1) 주소 검색
    url_addr = "https://dapi.kakao.com/v2/local/search/address.json"
    r = requests.get(url_addr, headers=headers, params={"query": query}, timeout=10)
    data = r.json()
    if data.get("documents"):
        doc = data["documents"][0]
        return float(doc["x"]), float(doc["y"])  # (lng, lat)

    # 2) 키워드(장소) 검색
    url_kw = "https://dapi.kakao.com/v2/local/search/keyword.json"
    r = requests.get(url_kw, headers=headers, params={"query": query}, timeout=10)
    data = r.json()
    if data.get("documents"):
        doc = data["documents"][0]
        return float(doc["x"]), float(doc["y"])

    raise ValueError(f"주소/장소 검색 실패: {query}")


# =========================
# 카카오 모빌리티 길찾기 (vertexes 파싱)
# =========================
def get_route(origin, dest):
    # origin/dest: (lng, lat)
    url = "https://apis-navi.kakaomobility.com/v1/directions"
    headers = {"Authorization": f"KakaoAK {REST_API_KEY}"}
    params = {
        "origin": f"{origin[0]},{origin[1]}",
        "destination": f"{dest[0]},{dest[1]}",
        "priority": "RECOMMEND",
    }

    res = requests.get(url, headers=headers, params=params, timeout=15).json()

    # 방어 코드
    routes = res.get("routes", [])
    if not routes:
        raise ValueError("길찾기 결과가 없습니다.")
    sections = routes[0].get("sections", [])
    if not sections:
        raise ValueError("길찾기 sections가 없습니다.")

    roads = sections[0].get("roads", [])
    coords = []

    for road in roads:
        v = road.get("vertexes", [])
        for i in range(0, len(v), 2):
            coords.append((v[i], v[i + 1]))  # (lng, lat)

    return coords


# =========================
# DB에서 전체 휴게소 로드
# =========================
def load_rest_areas():
    # rest_areas.db는 app.py와 같은 폴더에 둔다
    conn = sqlite3.connect("rest_areas.db")
    cur = conn.cursor()
    cur.execute(
        """
        SELECT id, name, route_no, direction, latitude, longitude, signature_food
        FROM rest_areas
    """
    )
    rows = cur.fetchall()
    conn.close()

    rests = []
    for row in rows:
        rests.append(
            {
                "id": row[0],
                "name": row[1],
                "route_no": row[2],
                "direction": row[3],
                "lat": row[4],
                "lng": row[5],
                "food": row[6] or "",
            }
        )
    return rests


# =========================
# 페이지
# =========================
@app.route("/")
def index():
    return render_template("index.html")


# =========================
# 경로 요청 (프론트 → POST /route)
# =========================
@app.route("/route", methods=["POST"])
def route():
    data = request.get_json(force=True)
    start = data.get("start", "")
    end = data.get("end", "")

    try:
        start_xy = geocode(start)
        end_xy = geocode(end)
        route_points = get_route(start_xy, end_xy)
        rests = load_rest_areas()
        return jsonify({"route": route_points, "rests": rests})
    except Exception as e:
        # 🔥 한글 에러 메시지도 안전
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    # 외부 접속 필요하면 host="0.0.0.0"
    app.run(debug=True)
