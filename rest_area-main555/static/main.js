let map;
let polyline;
let markers = [];
let lastRests = [];
let focusedmarker = null;
let originalLevel = null;

// 휴게소 이름 포맷
function formatRestName(name) {
  return name.endsWith("휴게소") ? name : `${name}휴게소`;
}

// 필터 상태
const filters = {
  onlyBestFood: false,
  hasEV: false,
  hasGas: false,
};

window.onload = function () {
  // 지도가 로드될 컨테이너 확인
  const container = document.getElementById("map");
  map = new kakao.maps.Map(container, {
    center: new kakao.maps.LatLng(36.5, 127.8), // 한국 중심
    level: 13,
  });

  addInputListeners();
  wireFilterButtons();
};

// =========================
// 필터 버튼 로직
// =========================
function wireFilterButtons() {
  const bestBtn = document.getElementById("filter-best");
  const evBtn = document.getElementById("filter-ev");
  const gasBtn = document.getElementById("filter-gas");

  bestBtn.onclick = () => {
    filters.onlyBestFood = !filters.onlyBestFood;
    bestBtn.classList.toggle("active-best", filters.onlyBestFood);
    if (polyline) drawRestAreas(lastRests);
  };

  evBtn.onclick = () => {
    filters.hasEV = !filters.hasEV;
    evBtn.classList.toggle("active-ev", filters.hasEV);
    if (polyline) drawRestAreas(lastRests);
  };

  gasBtn.onclick = () => {
    filters.hasGas = !filters.hasGas;
    gasBtn.classList.toggle("active-gas", filters.hasGas);
    if (polyline) drawRestAreas(lastRests);
  };
}

// =========================
// 자동완성 및 입력 처리
// =========================
function addInputListeners() {
  document.getElementById("start").addEventListener("input", () => autoComplete("start"));
  document.getElementById("end").addEventListener("input", () => autoComplete("end"));
}

function autoComplete(type) {
  const keyword = document.getElementById(type).value;
  const box = document.getElementById("autocomplete");

  if (!keyword) {
    box.style.display = "none";
    return;
  }

  const ps = new kakao.maps.services.Places();
  ps.keywordSearch(keyword, (data, status) => {
    if (status !== kakao.maps.services.Status.OK) {
        box.style.display = "none";
        return;
    }

    box.innerHTML = "";
    box.classList.remove("hidden");
    box.style.display = "block";

    data.forEach(place => {
      const item = document.createElement("div");
      item.className = "p-3 hover:bg-blue-50 cursor-pointer border-b border-gray-50 last:border-0";
      item.innerHTML = `
        <div class="font-bold text-sm text-gray-800">${place.place_name}</div>
        <div class="text-xs text-gray-400 truncate">${place.road_address_name || place.address_name}</div>
      `;

      item.onclick = () => {
        document.getElementById(type).value = place.place_name; // 장소명만 입력
        box.style.display = "none";
      };

      box.appendChild(item);
    });
  });
}

// =========================
// API 요청 및 거리 계산
// =========================
function requestRoute() {
  const start = document.getElementById("start").value.trim();
  const end = document.getElementById("end").value.trim();

  if (!start || !end) {
    alert("출발지와 목적지를 모두 입력해주세요.");
    return;
  }

  // 로딩 표시 대신 버튼 텍스트 변경 (간단 구현)
  const btn = document.querySelector("button[onclick='requestRoute()']");
  const originalText = btn.innerText;
  btn.innerText = "🚗 경로 탐색 중...";
  btn.disabled = true;

  fetch("/route", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ start, end }),
  })
    .then(res => res.json())
    .then(data => {
      btn.innerText = originalText;
      btn.disabled = false;
      if (data.error) throw new Error(data.error);
      
      // UI 전환
      document.getElementById("empty-state").classList.add("hidden");
      document.getElementById("result-area").classList.remove("hidden");
      
      // 지도 리사이즈 (hidden 상태에서 풀리면 레이아웃이 깨질 수 있음)
      map.relayout();
      
      drawRoute(data);
    })
    .catch(err => {
        btn.innerText = originalText;
        btn.disabled = false;
        alert("오류: " + err.message);
    });
}

// Haversine 거리 계산
function getDistance(lat1, lng1, lat2, lng2) {
  function toRad(v) { return v * Math.PI / 180; }
  const R = 6371000; 
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calculateTotalDistance(path) {
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    total += getDistance(path[i].getLat(), path[i].getLng(), path[i+1].getLat(), path[i+1].getLng());
  }
  return total;
}

function estimateTime(totalMeters) {
  const avgSpeedKmh = 90; // 고속도로 기준 약간 상향
  const totalMinutes = Math.round((totalMeters / 1000) / avgSpeedKmh * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h === 0 ? `${m}분` : `${h}시간 ${m}분`;
}

// =========================
// 지도 및 결과 그리기
// =========================
function drawRoute(data) {
  const path = data.route.map(p => new kakao.maps.LatLng(p[1], p[0]));

  if (polyline) polyline.setMap(null);

  polyline = new kakao.maps.Polyline({
    path,
    strokeWeight: 6,
    strokeColor: "#2563EB", // Tailwind Blue-600
    strokeOpacity: 0.8,
  });
  polyline.setMap(map);

  const bounds = new kakao.maps.LatLngBounds();
  path.forEach(p => bounds.extend(p));
  map.setBounds(bounds);

  // 메타 정보 표시
  const totalMeters = calculateTotalDistance(path);
  document.getElementById("route-meta").classList.remove("hidden");
  document.getElementById("meta-distance").textContent = `${(totalMeters / 1000).toFixed(1)} km`;
  document.getElementById("meta-time").textContent = estimateTime(totalMeters);

  lastRests = data.rests || [];
  drawRestAreas(lastRests);
}

function isRestAreaNearRoute(restLat, restLng, routePoints) {
  // 샘플링하여 성능 최적화 (모든 포인트 검사하지 않고 10개 단위로)
  // 정밀도가 중요하다면 step을 1로 하세요.
  const step = 5; 
  for (let i = 0; i < routePoints.length - 1; i += step) {
    const p1 = routePoints[i];
    const d = getDistance(restLat, restLng, p1.getLat(), p1.getLng());
    if (d <= 1500) return true; // 1.5km 이내
  }
  return false;
}

function getTravelDirection(path) {
  const start = path[0];
  const end = path[path.length - 1];
  return end.getLat() < start.getLat() ? "하행" : "상행";
}

// ★ 리뉴얼된 타임라인 렌더링 함수
function drawRestAreas(rests) {
  const list = document.getElementById("rest-list");
  list.innerHTML = "";
  
  // 기존 마커 제거
  markers.forEach(m => m.setMap(null));
  markers = [];

  if (!polyline) return;
  const path = polyline.getPath();
  const travelDirection = getTravelDirection(path);
  const startPoint = path[0];

  // 필터링 및 정렬
  let filtered = rests.filter(r => {
      // 1. 경로 근처
      if (!isRestAreaNearRoute(r.lat, r.lng, path)) return false;
      // 2. 방향 체크
      if (r.direction !== travelDirection) return false;
      // 3. UI 필터
      if (filters.onlyBestFood && (!r.food || r.food === "")) return false;
      if (filters.hasEV && !r.has_ev) return false;
      if (filters.hasGas && !r.has_gas) return false;
      
      return true;
  });

  filtered.sort((a, b) => {
    const da = getDistance(startPoint.getLat(), startPoint.getLng(), a.lat, a.lng);
    const db = getDistance(startPoint.getLat(), startPoint.getLng(), b.lat, b.lng);
    return da - db;
  });

  // 타임라인 생성
  filtered.forEach((r, idx) => {
    const loc = new kakao.maps.LatLng(r.lat, r.lng);
    
    // 마커 생성
    const marker = new kakao.maps.Marker({ position: loc, map: map });
    markers.push(marker);
    
    // 타임라인 아이템 (React 디자인 복제)
    const item = document.createElement("div");
    item.className = "timeline-item animate-fade-in-up";
    item.style.animationDelay = `${idx * 0.1}s`; // 순차적 등장

    // 중앙 노드 색상 (충전소 여부 등에 따라)
    const nodeColor = r.has_ev ? "bg-green-500" : "bg-blue-500";
    const foodBadge = r.food ? `<span class="px-2 py-0.5 bg-orange-100 text-orange-700 text-[10px] font-bold rounded">BEST</span>` : "";

    item.innerHTML = `
      <div class="timeline-dot w-4 h-4 rounded-full border-2 border-white shadow-md ${nodeColor} z-10"></div>
      
      <div class="timeline-card-wrapper w-full">
        <div class="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 hover:shadow-md transition cursor-pointer" onclick="openRestModalFromId(${r.id})">
            <div class="flex justify-between items-start mb-2">
                <span class="text-[10px] font-bold text-gray-400 bg-gray-50 px-2 py-1 rounded-full">${r.route_no}</span>
                <button class="text-gray-300 hover:text-blue-500">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7l5 5m0 0l-5 5m5-5H6"></path></svg>
                </button>
            </div>
            
            <h3 class="font-black text-lg text-gray-800 mb-1">${formatRestName(r.name)}</h3>
            <div class="flex items-center gap-2 mb-3">
                <span class="text-yellow-400 text-sm">★ ${r.rating || "4.5"}</span>
                <span class="text-gray-300 text-xs">|</span>
                <span class="text-xs text-gray-500 truncate">${r.food || "간식 맛집"}</span>
            </div>

            <div class="flex gap-2 items-center">
                ${foodBadge}
                ${r.food ? `<span class="text-xs font-bold text-gray-700 truncate flex-1">${r.food}</span>` : ""}
            </div>
        </div>
      </div>
    `;

    // 글로벌 스코프에 임시 저장 (모달 호출용)
    if(!window.restData) window.restData = {};
    window.restData[r.id] = r;

    list.appendChild(item);
  });
}

// 모달 로직
window.openRestModalFromId = function(id) {
    const r = window.restData[id];
    openRestModal(r);
}

function openRestModal(rest) {
  const restName = formatRestName(rest.name);

  document.getElementById("modal-highway").textContent = rest.route_no;
  document.getElementById("modal-name").textContent = restName;
  document.getElementById("modal-rating").textContent = rest.rating || "4.5";

  document.getElementById("modal-menu-name").textContent = rest.food || "정보 없음";
  document.getElementById("modal-menu-price").textContent = rest.price || "가격정보 없음";
  document.getElementById("modal-menu-desc").textContent = rest.desc || "대표 메뉴입니다.";

  // 시설물 아이콘 활성화/비활성화 처리
  const setFac = (id, has) => {
      const el = document.getElementById(id);
      if(has) {
          el.classList.add("facility-active", "bg-blue-50", "text-blue-600");
          el.classList.remove("bg-gray-50", "text-gray-400");
      } else {
          el.classList.remove("facility-active", "bg-blue-50", "text-blue-600");
          el.classList.add("bg-gray-50", "text-gray-400");
      }
  };

 setFac("fac-gas", rest.has_gas);
 setFac("fac-ev", rest.has_ev);
 setFac("fac-pharmacy", rest.has_pharmacy);
 setFac("fac-baby", rest.has_baby);

  document.getElementById("modal-naver").onclick = () => {
    const q = encodeURIComponent(`${restName} ${rest.direction}`);
    window.open(`https://map.naver.com/p/search/${q}`, "_blank");
  };

  document.getElementById("rest-modal").classList.remove("hidden");
}

window.closeRestModal = function() {
  document.getElementById("rest-modal").classList.add("hidden");
}