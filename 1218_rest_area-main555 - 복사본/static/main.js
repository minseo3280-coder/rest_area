let map;
let polyline;
let markers = [];
let lastRests = [];
let focusedmarker = null;
let originalLevel = null;
let infowindow = null;

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
    total += getDistance(path[i].getLat(), path[i].getLng(), path[i + 1].getLat(), path[i + 1].getLng());
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

  // 1. 기존 마커 및 인포윈도우 제거
  markers.forEach(m => m.setMap(null));
  markers = [];
  if (window.infowindow) {
    window.infowindow.close();
  }

  if (!polyline) return;
  const path = polyline.getPath();
  const travelDirection = getTravelDirection(path);
  const startPoint = path[0];

  // 2. 필터링 및 정렬 (기존 필터 로직 유지)
  let filtered = rests.filter(r => {
    if (!isRestAreaNearRoute(r.lat, r.lng, path)) return false;
    if (r.direction !== travelDirection) return false;
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

  // 3. 마커 및 타임라인 카드 생성
  filtered.forEach((r, idx) => {
    const loc = new kakao.maps.LatLng(r.lat, r.lng);

    // [마커 생성]
    const marker = new kakao.maps.Marker({
      position: loc,
      map: map,
      title: r.name,
      clickable: true
    });
    markers.push(marker);

    // [마커 클릭 이벤트: 인포윈도우 + 확대 + 모달]
    kakao.maps.event.addListener(marker, 'click', function () {
      // 1. 인포윈도우 표시 (기존 유지)
      if (window.infowindow) window.infowindow.close();
      window.infowindow = new kakao.maps.InfoWindow({
        content: `<div style="padding:8px 12px; font-size:12px; font-weight:bold;">${formatRestName(r.name)}</div>`,
        removable: true
      });
      window.infowindow.open(map, marker);

      // 2. 정확한 위치 객체 생성
      const moveLatLon = new kakao.maps.LatLng(r.lat, r.lng);

      // [핵심] 자연스러운 줌 인 효과
      // level: 변경할 눈색 (7), {animate: true}를 주면 부드럽게 확대됩니다.
      map.setLevel(7, {
        anchor: moveLatLon,
        animate: {
          duration: 500 // 0.5초 동안 부드럽게 확대
        }
      });

      // 3. 부드럽게 중심 이동
      // setLevel과 동시에 실행되어 더 자연스럽습니다.
      map.panTo(moveLatLon);

      // 4. 모달 오픈
      openRestModal(r);
    });

    // [타임라인 아이템 생성]
    const item = document.createElement("div");
    item.className = "timeline-item animate-fade-in-up";
    item.style.animationDelay = `${idx * 0.1}s`;

    const nodeColor = r.has_ev ? "bg-green-500" : "bg-blue-500";
    const foodBadge = r.food ? `<span class="px-2 py-0.5 bg-orange-100 text-orange-700 text-[10px] font-bold rounded">BEST</span>` : "";

    item.innerHTML = `
            <div class="timeline-dot w-4 h-4 rounded-full border-2 border-white shadow-md ${nodeColor} z-10"></div>
            <div class="timeline-card-wrapper w-full">
                <div class="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 hover:shadow-md transition cursor-pointer" onclick="handleCardClick(${idx}, ${r.id})">
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
                        <span class="text-xs font-bold text-gray-700 truncate flex-1">${r.food || ""}</span>
                    </div>
                </div>
            </div>
        `;

    // 전역 데이터 저장
    if (!window.restData) window.restData = {};
    window.restData[r.id] = r;

    // 카드 클릭 시 지도를 마커로 이동시키기 위한 마커 참조 저장
    marker.idx = idx;
    list.appendChild(item);
  });
}

// 카드를 클릭했을 때 실행될 함수
window.handleCardClick = function (idx, restId) {
  const r = window.restData[restId];
  const marker = markers.find(m => m.getTitle() === r.name);

  if (marker) {
    // 마커 클릭 이벤트를 강제로 발생시켜 인포윈도우와 모달을 띄움
    kakao.maps.event.trigger(marker, 'click');
  }
};

// 모달 로직
window.openRestModalFromId = function (id) {
  const r = window.restData[id];
  openRestModal(r);
}

function openRestModal(rest) {
  const restName = formatRestName(rest.name);
  console.log("휴게소 데이터 상세:", rest);

  // 1. 이름 및 주소 설정
  document.getElementById("modal-name").textContent = restName;
  const address = rest.address || rest.addr || rest.address_name || "주소 정보 없음";
  const addrEl = document.getElementById("modal-address");
  if (addrEl) addrEl.textContent = address;

  // 2. 대표 메뉴 정보 설정
  document.getElementById("modal-menu-name").textContent = rest.food || "정보 없음";
  // 가격 정보 UI가 있다면 표시 (없다면 이 줄은 무시됩니다)
  const priceEl = document.getElementById("modal-menu-price");
  if (priceEl) priceEl.textContent = rest.price || "";

  // 3. Gemini API 호출 (설명글)
  const descEl = document.getElementById("modal-menu-desc");
  descEl.textContent = "정보를 불러오는 중...";

  fetch('/get_info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: rest.name })
  })
    .then(res => res.json())
    .then(data => {
      if (data.info) {
        descEl.innerHTML = data.info.replace(/\n/g, '<br>');
      } else {
        descEl.textContent = "이 휴게소의 인기 메뉴입니다.";
      }
    })
    .catch(() => {
      descEl.textContent = "메뉴 정보를 불러오는 중 오류가 발생했습니다.";
    });
    

  // 4. 시설물 아이콘 활성화 스타일 함수 (이름을 setFac으로 통일)
  const setFac = (id, has) => {
    const el = document.getElementById(id);
    if (!el) return;

    // 데이터가 true, 1, "1"인 경우 활성화
//    const isActive = (has === true || has === 1 || has === "1" || has === "Y");
      const isActive = (true );
  
    if (isActive) {
      el.className = "p-2 rounded-lg bg-blue-50 text-blue-600 font-bold"; // 활성 스타일
    } else {
      el.className = "p-2 rounded-lg bg-gray-50 text-gray-400 opacity-60"; // 비활성 스타일
    }
  };

  // 위에서 정의한 setFac 함수 호출
  setFac("fac-gas", rest.has_gas);
  setFac("fac-ev", rest.has_ev);
  setFac("fac-pharmacy", rest.has_pharmacy);
  setFac("fac-baby", rest.has_baby);

  // 5. 외부 지도 버튼 설정
  const kakaoBtn = document.getElementById("modal-kakao");
  if (kakaoBtn) {
    kakaoBtn.onclick = () => {
      const q = encodeURIComponent(`${restName} ${rest.direction || ''}`);
      window.open(`https://map.kakao.com/link/search/${q}`, "_blank");
    };
  }

  // Lucide 아이콘 렌더링
  if (window.lucide) lucide.createIcons();
  document.getElementById("rest-modal").classList.remove("hidden");
}

window.closeRestModal = function () {
  document.getElementById("rest-modal").classList.add("hidden");
}
