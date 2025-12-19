let map;
let polyline;
let markers = [];
let lastRests = [];
let infowindow = null;
let isSelectingAutocomplete = false;

// 카드 클릭 확대 1회 제한 + 폴리라인 기준 레벨 저장
let hasFocusedFromCard = false;
let routeBaseLevel = null;

// =========================
// 역지오코딩 (좌표 -> 주소)
// =========================
const geocoder = new kakao.maps.services.Geocoder();
const addressCache = {}; // restId -> address 캐시

// 주소 역변환
function getAddressFromCoords(lat, lng, callback) {
  geocoder.coord2Address(lng, lat, function (result, status) {
    if (status === kakao.maps.services.Status.OK) {
      const roadAddr = result[0].road_address?.address_name;
      const jibunAddr = result[0].address?.address_name;
      callback(roadAddr || jibunAddr || "주소 정보 없음");
    } else {
      callback("주소 정보 없음");
    }
  });
}
// 인포 윈도우 호출 함수
function addListenerOnce(target, type, handler) {
  const onceHandler = function () {
    kakao.maps.event.removeListener(target, type, onceHandler);
    handler();
  };
  kakao.maps.event.addListener(target, type, onceHandler);
}



// 인포윈도우 틀
function createSimpleInfoContent(name, address, restId) {
  return `
    <div style="
      box-sizing:border-box;
      padding:12px 14px;
      width:240px;
      font-size:13px;
      line-height:1.4;
      font-family:'Noto Sans KR', sans-serif;
    ">
      <div style="
        font-weight:800;
        font-size:14px;
        margin-bottom:6px;
        white-space:nowrap;
        overflow:hidden;
        text-overflow:ellipsis;
      ">
        ${name}
      </div>

      <div style="color:#555; margin-bottom:8px;">
        ${address}
      </div>

      <button
        onclick="openRestModalFromId(${restId})"
        style="
          width:100%;
          padding:6px 0;
          font-size:12px;
          font-weight:700;
          background:#2563eb;
          color:#fff;
          border:none;
          border-radius:6px;
          cursor:pointer;
        "
      >
        상세 보기
      </button>
    </div>
  `;
}

// 인포윈도우 열기 (공통), 상세보기 버튼 누르면 카드로 이동
function openSimpleInfo(marker, rest) {
  if (!marker || !rest) return;

  if (window.infowindow) {
    window.infowindow.close();
    window.infowindow = null;
  }

  const restName = formatRestName(rest.name);

  window.infowindow = new kakao.maps.InfoWindow({
    content: createSimpleInfoContent(
      restName,
      "주소 불러오는 중...",
      rest.id
    ),
    removable: true
  });
  window.infowindow.open(map, marker);

  // 주소 캐시 사용
  if (addressCache[rest.id]) {
    window.infowindow.setContent(
      createSimpleInfoContent(
        restName,
        addressCache[rest.id],
        rest.id
      )
    );
    return;
  }

  getAddressFromCoords(rest.lat, rest.lng, function (address) {
    addressCache[rest.id] = address;
    if (!window.infowindow) return;

    window.infowindow.setContent(
      createSimpleInfoContent(
        restName,
        address,
        rest.id
      )
    );
  });
}


// =========================
// 휴게소 이름 포맷
// =========================
function formatRestName(name) {
  return name.endsWith("휴게소") ? name : `${name}휴게소`;
}

// =========================
// 필터 상태
// =========================
const filters = {
  onlyBestFood: false,
  hasEV: false,
  hasGas: false,
};

window.onload = function () {
  const container = document.getElementById("map");
  map = new kakao.maps.Map(container, {
    center: new kakao.maps.LatLng(36.5, 127.8),
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
// =========================
// 자동완성 및 입력 처리 (IME 안정 버전)
// =========================

// 🔥 자동완성 선택 중 여부 (한글 IME 충돌 방지)

function addInputListeners() {
  const startInput = document.getElementById("start");
  const endInput = document.getElementById("end");

  startInput.addEventListener("input", () => autoComplete("start"));
  endInput.addEventListener("input", () => autoComplete("end"));
}

function autoComplete(type) {
  // 🔥 자동완성 항목 클릭 중이면 무시
  if (isSelectingAutocomplete) return;

  const input = document.getElementById(type);
  const keyword = input.value;
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
      item.className =
        "p-3 hover:bg-blue-50 cursor-pointer border-b border-gray-50 last:border-0";

      item.innerHTML = `
        <div class="font-bold text-sm text-gray-800">
          ${place.place_name}
        </div>
        <div class="text-xs text-gray-400 truncate">
          ${place.road_address_name || place.address_name}
        </div>
      `;

      // 🔥 onclick ❌ → mousedown ⭕ (IME 핵심 포인트)
      item.onmousedown = (e) => {
        e.preventDefault(); // 한글 조합 중단 방지
        isSelectingAutocomplete = true;

        input.value = place.place_name;
        box.style.display = "none";

        // 다음 tick에서 조합 종료 확정
        setTimeout(() => {
          isSelectingAutocomplete = false;
          input.blur(); // 조합 완전 종료
        }, 0);
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

      document.getElementById("empty-state").classList.add("hidden");
      document.getElementById("result-area").classList.remove("hidden");

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
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calculateTotalDistance(path) {
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    total += getDistance(
      path[i].getLat(), path[i].getLng(),
      path[i + 1].getLat(), path[i + 1].getLng()
    );
  }
  return total;
}

function estimateTime(totalMeters) {
  const avgSpeedKmh = 90;
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
    strokeColor: "#2563EB",
    strokeOpacity: 0.8,
  });
  polyline.setMap(map);

  const bounds = new kakao.maps.LatLngBounds();
  path.forEach(p => bounds.extend(p));
  map.setBounds(bounds);

  // 폴리라인 기준 레벨 저장 + 카드 확대 상태 초기화
  addListenerOnce(map, "idle", () => {
    routeBaseLevel = map.getLevel();
    hasFocusedFromCard = false;
  });

  const totalMeters = calculateTotalDistance(path);
  document.getElementById("route-meta").classList.remove("hidden");
  document.getElementById("meta-distance").textContent = `${(totalMeters / 1000).toFixed(1)} km`;
  document.getElementById("meta-time").textContent = estimateTime(totalMeters);

  lastRests = data.rests || [];
  drawRestAreas(lastRests);
}

function isRestAreaNearRoute(restLat, restLng, routePoints) {
  const step = 5;
  for (let i = 0; i < routePoints.length - 1; i += step) {
    const p1 = routePoints[i];
    const d = getDistance(restLat, restLng, p1.getLat(), p1.getLng());
    if (d <= 1500) return true;
  }
  return false;
}

function getTravelDirection(path) {
  const start = path[0];
  const end = path[path.length - 1];
  return end.getLat() < start.getLat() ? "하행" : "상행";
}

// =========================
// 휴게소 리스트 + 마커 렌더링
// =========================
function drawRestAreas(rests) {
  const list = document.getElementById("rest-list");
  list.innerHTML = "";

  // 기존 마커 제거 + 인포윈도우 닫기
  markers.forEach(m => m.setMap(null));
  markers = [];
  if (window.infowindow) {
    window.infowindow.close();
    window.infowindow = null;
  }

  if (!polyline) return;
  const path = polyline.getPath();
  const travelDirection = getTravelDirection(path);
  const startPoint = path[0];

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

  filtered.forEach((r, idx) => {
    const loc = new kakao.maps.LatLng(r.lat, r.lng);

    const marker = new kakao.maps.Marker({
      position: loc,
      map: map,
      title: r.name,
      clickable: true
    });
    markers.push(marker);

    // ✅ 마커 클릭 = 인포윈도우만 (확대/이동 없음)
    kakao.maps.event.addListener(marker, "click", function () {
      const moveLatLon = new kakao.maps.LatLng(r.lat, r.lng);

      const baseLevel =
        routeBaseLevel !== null ? routeBaseLevel : map.getLevel();

      const targetLevel = Math.max(baseLevel - 3, 5);

      const needMove =
        map.getLevel() !== targetLevel ||
        !map.getCenter().equals(moveLatLon);

      // 지도 이동/확대
      if (needMove) {
        map.setCenter(moveLatLon);
        map.setLevel(targetLevel, { animate: true });

        // 이동이 실제로 발생한 경우만 idle 대기
        addListenerOnce(map, "idle", () => {
          openSimpleInfo(marker, r);
        });
      } else {
        // 🔥 이미 같은 위치/레벨이면 즉시 인포윈도우
        openSimpleInfo(marker, r);
      }
    });

    const item = document.createElement("div");
    item.className = "timeline-item animate-fade-in-up";
    item.style.animationDelay = `${idx * 0.1}s`;

    const nodeColor = r.has_ev ? "bg-green-500" : "bg-blue-500";
    const foodBadge = r.food
      ? `<span class="px-2 py-0.5 bg-orange-100 text-orange-700 text-[10px] font-bold rounded">BEST</span>`
      : "";

    item.innerHTML = `
      <div class="timeline-dot w-4 h-4 rounded-full border-2 border-white shadow-md ${nodeColor} z-10"></div>
      <div class="timeline-card-wrapper w-full">
        <div class="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 hover:shadow-md transition cursor-pointer"
             onclick="handleCardClick(${idx}, ${r.id})">
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

    if (!window.restData) window.restData = {};
    window.restData[r.id] = r;

    list.appendChild(item);
  });
}

// =========================
// 카드 클릭: 최초 1회만 확대 + 인포 + 모달
// =========================
window.handleCardClick = function (idx, restId) {
  const r = window.restData?.[restId];
  if (!r) return;

  
  openRestModal(r);
};


// =========================
// 모달 로직
// =========================
window.openRestModalFromId = function (id) {
  const r = window.restData?.[id];
  if (r) openRestModal(r);
};

function openRestModal(rest) {
  const restName = formatRestName(rest.name);

  document.getElementById("modal-name").textContent = restName;

  // 주소
  const addrEl = document.getElementById("modal-address");
  if (addrEl) {
    // 캐시 우선
    if (addressCache[rest.id]) {
      addrEl.textContent = addressCache[rest.id];
    } else {
      addrEl.textContent = "주소 불러오는 중...";
      getAddressFromCoords(rest.lat, rest.lng, function (address) {
        addressCache[rest.id] = address;
        addrEl.textContent = address;
      });
    }
  }

  // 대표 메뉴
  document.getElementById("modal-menu-name").textContent = rest.food || "정보 없음";

  const priceEl = document.getElementById("modal-menu-price");
  if (priceEl) priceEl.textContent = rest.price || "";

  // Gemini 설명
  const descEl = document.getElementById("modal-menu-desc");
  descEl.textContent = "정보를 불러오는 중...";

  fetch("/get_info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: rest.name })
  })
    .then(res => res.json())
    .then(data => {
      if (data.info) descEl.innerHTML = data.info.replace(/\n/g, "<br>");
      else descEl.textContent = "이 휴게소의 인기 메뉴입니다.";
    })
    .catch(() => {
      descEl.textContent = "메뉴 정보를 불러오는 중 오류가 발생했습니다.";
    });

  // 시설물 (너 기존대로 유지: 지금은 전부 true 처리)
  const setFac = (id, has) => {
    const el = document.getElementById(id);
    if (!el) return;

    // TODO: 실제 데이터로 바꾸고 싶으면 아래 줄을 활성화
    // const isActive = (has === true || has === 1 || has === "1" || has === "Y");
    const isActive = true;

    el.className = isActive
      ? "p-2 rounded-lg bg-blue-50 text-blue-600 font-bold"
      : "p-2 rounded-lg bg-gray-50 text-gray-400 opacity-60";
  };

  setFac("fac-gas", rest.has_gas);
  setFac("fac-ev", rest.has_ev);
  setFac("fac-pharmacy", rest.has_pharmacy);
  setFac("fac-baby", rest.has_baby);

  // 카카오맵 버튼
  const kakaoBtn = document.getElementById("modal-kakao");
  if (kakaoBtn) {
    kakaoBtn.onclick = () => {
      const q = encodeURIComponent(`${restName} ${rest.direction || ""}`);
      window.open(`https://map.kakao.com/link/search/${q}`, "_blank");
    };
  }

  if (window.lucide) lucide.createIcons();
  document.getElementById("rest-modal").classList.remove("hidden");
}

window.closeRestModal = function () {
  document.getElementById("rest-modal").classList.add("hidden");
};
