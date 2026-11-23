/* =====================================================
   Rose noir — script.js (Supabase 데이터베이스 연결판)
   회원 · 상품 · 주문 · 포인트는 Supabase 에 저장하고,
   장바구니만 내 브라우저(localStorage)에 둔다.
   ===================================================== */

// [연결] Supabase 주소와 공개 키 — 공개 저장소에 올려도 되는 두 가지뿐
//        (Secret key · DB 비밀번호는 절대 여기에 넣지 않는다)
const SUPABASE_URL = "https://ocigzmtoiqeoxipnptmn.supabase.co";
const SUPABASE_KEY = "sb_publishable_2l_XPkKEZ8a84EFDVwE6Nw_RpB1hi9C";
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// [표 · 함수 이름] SQL 파일과 한 글자도 다르지 않게
const TABLE = {
  profiles: "shop_profiles",      // 회원
  products: "shop_products",      // 상품
  orders: "shop_orders",          // 주문
  orderItems: "shop_order_items", // 주문 상세
  grades: "shop_grades",          // 회원 등급
  pointLogs: "shop_point_logs"    // 포인트 내역
};
const RPC_PLACE_ORDER = "shop_place_order"; // 주문 함수 (재고 · 포인트 · 등급을 DB 가 한 번에 처리)

// [분류 · 정책] 화면에 미리 보여 주는 계산용 — 실제 금액과 포인트는 DB 함수가 다시 계산한다
const CATEGORIES = ["전체", "아우터", "상의", "하의", "악세서리"];
const SIGNUP_POINT = 3000;        // 가입 축하 포인트 (DB 기본값과 같다)
const SHIPPING_FEE = 3000;        // 배송비
const FREE_SHIPPING_MIN = 50000;  // 무료배송 기준 금액
const POINT_UNIT = 100;           // 포인트 사용 단위

// [DB 에서 읽어 와 채우는 값]
let PRODUCTS = [];  // shop_products → { id, name, category, price, stock, image, sizes, description, createdAt }
let GRADES = [];    // shop_grades   → { name, minSpent, rate }
let session = null; // 로그인 정보 (Supabase Auth)
let profile = null; // 로그인한 회원의 shop_profiles 한 줄

/* ---------- 장바구니만 브라우저에 저장 ---------- */
const store = {
  load(key, empty) {
    try { const v = localStorage.getItem("rosenoir_db_" + key); return v ? JSON.parse(v) : empty; }
    catch (e) { return empty; }
  },
  save(key, value) {
    try { localStorage.setItem("rosenoir_db_" + key, JSON.stringify(value)); } catch (e) { /* 저장 공간 부족 등 */ }
  }
};
let cart = store.load("cart", []); // { productId, size, qty }

/* ---------- 작은 도구 ---------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const won = (n) => Number(n || 0).toLocaleString("ko-KR") + "원";
const pt = (n) => Number(n || 0).toLocaleString("ko-KR") + "P";
const dateText = (iso) => (iso ? new Date(iso).toLocaleDateString("ko-KR") : "");
const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("is-show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("is-show"), 2600);
}

// Supabase 가 돌려주는 영어 오류를 쉬운 한국어로
function koError(error) {
  const m = (error && error.message) || String(error || "");
  if (/Invalid login credentials/i.test(m)) return "이메일 또는 비밀번호가 맞지 않아요.";
  if (/already registered|already exists/i.test(m)) return "이미 가입된 이메일이에요.";
  if (/Email not confirmed/i.test(m)) return "이메일 확인이 켜져 있어요. Supabase 에서 Confirm email 을 꺼 주세요.";
  if (/rate limit/i.test(m)) return "잠시 뒤에 다시 시도해 주세요. (요청이 너무 많아요)";
  if (/Password should be/i.test(m)) return "비밀번호가 너무 짧아요.";
  if (/Failed to fetch|NetworkError/i.test(m)) return "인터넷 연결 또는 Supabase 주소를 확인해 주세요.";
  if (/Invalid API key/i.test(m)) return "Supabase 공개 키가 맞지 않아요.";
  return m;
}

const findProduct = (id) => PRODUCTS.find((p) => p.id === id);
const stockOf = (id) => (findProduct(id) ? findProduct(id).stock : 0);
const gradeOf = (gradeName) => GRADES.find((g) => g.name === gradeName) || GRADES[0] || { name: "BRONZE", minSpent: 0, rate: 0.01 };
const nextGradeOf = (grade) => GRADES.find((g) => g.minSpent > grade.minSpent) || null;
const myGrade = () => (profile ? gradeOf(profile.grade) : null);
const myRate = () => (profile ? myGrade().rate : gradeOf("BRONZE").rate);

/* =====================================================
   DB 에서 읽어 오기
   ===================================================== */
async function loadGrades() {
  const { data, error } = await db.from(TABLE.grades).select("*").order("sort_order");
  if (error) { console.error(error); return; }
  GRADES = data.map((g) => ({ name: g.grade, minSpent: g.min_spent, rate: Number(g.point_rate) }));
}

async function loadProducts() {
  const { data, error } = await db.from(TABLE.products).select("*").order("id");
  if (error) {
    console.error(error);
    $("#productGrid").innerHTML = `<p class="empty">상품을 불러오지 못했어요. (${escapeHtml(koError(error))})</p>`;
    return false;
  }
  PRODUCTS = data.map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    price: r.price,
    stock: r.stock,
    image: r.image_url || "img/favicon.svg",
    sizes: String(r.sizes || "FREE").split(",").map((s) => s.trim()).filter(Boolean),
    description: r.description || "",
    createdAt: r.created_at
  }));
  // 판매가 끝났거나 사이즈가 없어진 상품은 장바구니에서 뺀다
  const before = cart.length;
  cart = cart.filter((c) => findProduct(c.productId) && findProduct(c.productId).sizes.includes(c.size));
  if (cart.length !== before) store.save("cart", cart);
  return true;
}

async function loadProfile() {
  profile = null;
  if (!session) return;
  for (let i = 0; i < 3 && !profile; i++) {
    const { data } = await db.from(TABLE.profiles).select("*").eq("id", session.user.id).maybeSingle();
    profile = data;
    if (!profile) await new Promise((r) => setTimeout(r, 600)); // 가입 직후 회원 표 줄이 생길 때까지 잠깐 기다린다
  }
}

/* =====================================================
   팝업 열기 · 닫기
   ===================================================== */
function openLayer(el) {
  $$(".modal.is-open, .drawer.is-open").forEach((x) => x.classList.remove("is-open"));
  el.classList.add("is-open");
  $("#dim").classList.add("is-open");
  document.body.classList.add("no-scroll");
}
function closeLayer() {
  $$(".modal.is-open, .drawer.is-open").forEach((x) => x.classList.remove("is-open"));
  $("#dim").classList.remove("is-open");
  document.body.classList.remove("no-scroll");
}
$("#dim").addEventListener("click", closeLayer);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeLayer(); });
$$("[data-close]").forEach((btn) => btn.addEventListener("click", closeLayer));

function setBusy(button, busy, text) {
  if (!button) return;
  if (busy) { button.dataset.label = button.textContent; button.textContent = text || "잠시만요…"; button.disabled = true; }
  else { button.textContent = button.dataset.label || button.textContent; button.disabled = false; }
}

/* =====================================================
   메인 슬라이드 (4장, 6초마다 교차)
   ===================================================== */
const slides = $$(".slide");
let slideIndex = 0;
let slideTimer = null;

slides.forEach((_, i) => {
  const dot = document.createElement("button");
  dot.type = "button";
  dot.setAttribute("aria-label", (i + 1) + "번 슬라이드");
  dot.addEventListener("click", () => showSlide(i));
  $("#heroDots").appendChild(dot);
});

function showSlide(i) {
  slideIndex = (i + slides.length) % slides.length;
  slides.forEach((s, n) => s.classList.toggle("is-active", n === slideIndex));
  $$("#heroDots button").forEach((d, n) => d.classList.toggle("is-active", n === slideIndex));
  $("#hero").classList.toggle("light-now", slides[slideIndex].classList.contains("is-light"));
  $("#heroNow").textContent = String(slideIndex + 1).padStart(2, "0");
  clearInterval(slideTimer);
  slideTimer = setInterval(() => showSlide(slideIndex + 1), 6000);
}
$("#heroPrev").addEventListener("click", () => showSlide(slideIndex - 1));
$("#heroNext").addEventListener("click", () => showSlide(slideIndex + 1));
showSlide(0);

/* =====================================================
   상품 목록 · 검색 · 분류 필터 · 정렬
   ===================================================== */
const view = { category: "전체", keyword: "", sort: "new" };

function renderTabs() {
  $("#tabs").innerHTML = CATEGORIES.map((c) =>
    `<button type="button" role="tab" aria-selected="${view.category === c}" class="${view.category === c ? "is-on" : ""}" data-tab="${c}">${c}</button>`
  ).join("");
}

function renderProducts() {
  if (PRODUCTS.length === 0) return; // 아직 못 불러왔으면 안내 문구를 그대로 둔다
  let list = PRODUCTS.filter((p) =>
    (view.category === "전체" || p.category === view.category) &&
    p.name.toLowerCase().includes(view.keyword.toLowerCase())
  );
  if (view.sort === "low") list.sort((a, b) => a.price - b.price);
  else if (view.sort === "high") list.sort((a, b) => b.price - a.price);
  else list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || b.id - a.id);

  $("#resultText").textContent = `${view.category}${view.keyword ? ` · "${view.keyword}" 검색` : ""} · ${list.length}개 상품`;

  if (list.length === 0) {
    $("#productGrid").innerHTML = `<p class="empty">찾는 상품이 없어요. 다른 검색어를 입력해 보세요.</p>`;
    return;
  }
  $("#productGrid").innerHTML = list.map((p) => {
    const badge = p.stock === 0 ? `<span class="badge soldout">품절</span>` : (p.stock <= 5 ? `<span class="badge">${p.stock}개 남음</span>` : "");
    return `
      <article class="card" data-id="${p.id}" tabindex="0">
        <div class="card-img">${badge}<img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}"></div>
        <p class="card-cat">${escapeHtml(p.category)}</p>
        <h3 class="card-name">${escapeHtml(p.name)}</h3>
        <p class="card-price">${won(p.price)}</p>
        <p class="card-point">${pt(Math.floor(p.price * myRate()))} 적립 예정</p>
      </article>`;
  }).join("");
}

function setCategory(category) {
  view.category = category;
  renderTabs();
  renderProducts();
}

$("#tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-tab]");
  if (btn) setCategory(btn.dataset.tab);
});
$$("[data-filter]").forEach((link) => link.addEventListener("click", () => {
  view.keyword = "";
  $("#searchInput").value = "";
  setCategory(link.dataset.filter);
}));
$("#searchInput").addEventListener("input", (e) => { view.keyword = e.target.value.trim(); renderProducts(); });
$("#sortSelect").addEventListener("change", (e) => { view.sort = e.target.value; renderProducts(); });
$("#productGrid").addEventListener("click", (e) => {
  const card = e.target.closest(".card");
  if (card) openDetail(Number(card.dataset.id));
});
$("#productGrid").addEventListener("keydown", (e) => {
  const card = e.target.closest(".card");
  if (card && e.key === "Enter") openDetail(Number(card.dataset.id));
});

/* =====================================================
   상품 상세
   ===================================================== */
function openDetail(id) {
  const p = findProduct(id);
  if (!p) return;
  const left = p.stock;
  const pick = { size: p.sizes.length === 1 ? p.sizes[0] : null, qty: 1 };
  const g = myGrade();

  $("#detailBody").innerHTML = `
    <div class="detail">
      <img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}">
      <div>
        <p class="card-cat">${escapeHtml(p.category)}</p>
        <h3>${escapeHtml(p.name)}</h3>
        <p class="price">${won(p.price)}</p>
        <p class="desc">${escapeHtml(p.description)}</p>
        <p class="stock">재고 ${left === 0 ? "품절" : left + "개"}</p>
        <p class="opt-title">사이즈</p>
        <div class="sizes">${p.sizes.map((s) => `<button type="button" data-size="${escapeHtml(s)}" class="${pick.size === s ? "is-on" : ""}">${escapeHtml(s)}</button>`).join("")}</div>
        <p class="opt-title">수량</p>
        <div class="qty"><button type="button" data-step="-1" aria-label="수량 줄이기">−</button><span id="detailQty">1</span><button type="button" data-step="1" aria-label="수량 늘리기">+</button></div>
        <p class="point-box">${profile
          ? `${escapeHtml(profile.name || "회원")}님은 <b>${g.name}</b> 등급 · 1개당 <b>${pt(Math.floor(p.price * g.rate))}</b> 적립`
          : `로그인하면 결제 금액의 <b>1~7%</b>를 포인트로 적립해 드려요.`}</p>
        <div class="detail-btns">
          <button type="button" class="btn btn-line" id="addCartBtn" ${left === 0 ? "disabled" : ""}>장바구니</button>
          <button type="button" class="btn btn-pink" id="buyNowBtn" ${left === 0 ? "disabled" : ""}>바로 구매</button>
        </div>
      </div>
    </div>`;

  $$("#detailBody [data-size]").forEach((btn) => btn.addEventListener("click", () => {
    pick.size = btn.dataset.size;
    $$("#detailBody [data-size]").forEach((b) => b.classList.toggle("is-on", b === btn));
  }));
  $$("#detailBody [data-step]").forEach((btn) => btn.addEventListener("click", () => {
    pick.qty = Math.min(Math.max(1, pick.qty + Number(btn.dataset.step)), Math.max(1, left));
    $("#detailQty").textContent = pick.qty;
  }));
  const tryAdd = () => {
    if (!pick.size) { toast("사이즈를 선택해 주세요."); return false; }
    return addToCart(id, pick.size, pick.qty);
  };
  $("#addCartBtn").addEventListener("click", () => { if (tryAdd()) { closeLayer(); toast("장바구니에 담았어요."); } });
  $("#buyNowBtn").addEventListener("click", () => { if (tryAdd()) openCheckout(); });

  openLayer($("#detailModal"));
}

/* =====================================================
   장바구니 (수량 바꾸기 · 삭제 · 합계)
   ===================================================== */
const qtyInCart = (productId) => cart.filter((c) => c.productId === productId).reduce((s, c) => s + c.qty, 0);

function addToCart(productId, size, qty) {
  if (qtyInCart(productId) + qty > stockOf(productId)) {
    toast(`재고가 부족해요. (남은 재고 ${stockOf(productId)}개)`);
    return false;
  }
  const same = cart.find((c) => c.productId === productId && c.size === size);
  if (same) same.qty += qty; else cart.push({ productId, size, qty });
  saveCart();
  return true;
}

function changeQty(index, step) {
  const item = cart[index];
  if (!item) return;
  if (step > 0 && qtyInCart(item.productId) + 1 > stockOf(item.productId)) { toast("재고보다 많이 담을 수 없어요."); return; }
  item.qty += step;
  if (item.qty < 1) cart.splice(index, 1);
  saveCart();
}

function removeItem(index) {
  cart.splice(index, 1);
  saveCart();
  toast("상품을 삭제했어요.");
}

function cartTotals() {
  const subtotal = cart.reduce((s, c) => s + (findProduct(c.productId) ? findProduct(c.productId).price * c.qty : 0), 0);
  const shippingFee = subtotal === 0 || subtotal >= FREE_SHIPPING_MIN ? 0 : SHIPPING_FEE;
  return { subtotal, shippingFee, count: cart.reduce((s, c) => s + c.qty, 0) };
}

function saveCart() {
  store.save("cart", cart);
  renderCart();
}

function renderCart() {
  const { subtotal, shippingFee, count } = cartTotals();
  $("#cartCount").textContent = count;
  $("#cartCount").classList.toggle("is-zero", count === 0);

  const rows = cart.map((c, i) => ({ c, i, p: findProduct(c.productId) })).filter((x) => x.p);
  if (rows.length === 0) {
    $("#cartBody").innerHTML = `<p class="empty">장바구니가 비어 있어요.</p>`;
    $("#cartFoot").innerHTML = "";
    return;
  }
  $("#cartBody").innerHTML = rows.map(({ c, i, p }) => `
      <div class="cart-item">
        <img src="${escapeHtml(p.image)}" alt="">
        <div>
          <p class="name">${escapeHtml(p.name)}</p>
          <p class="opt">사이즈 ${escapeHtml(c.size)} · ${won(p.price)}</p>
          <div class="qty"><button type="button" data-minus="${i}" aria-label="수량 줄이기">−</button><span>${c.qty}</span><button type="button" data-plus="${i}" aria-label="수량 늘리기">+</button></div>
        </div>
        <div class="right">
          <button type="button" class="remove" data-remove="${i}">삭제</button>
          <b>${won(p.price * c.qty)}</b>
        </div>
      </div>`).join("");
  $("#cartFoot").innerHTML = `
    <p class="ship-note">${shippingFee === 0 ? "무료배송이 적용됐어요." : `${won(FREE_SHIPPING_MIN - subtotal)} 더 담으면 무료배송`}</p>
    <p class="row"><span>상품 금액</span><span>${won(subtotal)}</span></p>
    <p class="row"><span>배송비</span><span>${shippingFee ? won(shippingFee) : "무료"}</span></p>
    <p class="row total"><span>합계</span><span>${won(subtotal + shippingFee)}</span></p>
    <button type="button" class="btn btn-pink btn-full" id="orderBtn" style="margin-top:14px">주문하기</button>`;
  $("#orderBtn").addEventListener("click", openCheckout);
}

$("#cartBody").addEventListener("click", (e) => {
  const t = e.target;
  if (t.dataset.minus !== undefined) changeQty(Number(t.dataset.minus), -1);
  if (t.dataset.plus !== undefined) changeQty(Number(t.dataset.plus), 1);
  if (t.dataset.remove !== undefined) removeItem(Number(t.dataset.remove));
});
$("#cartBtn").addEventListener("click", () => { renderCart(); openLayer($("#cartDrawer")); });

/* =====================================================
   회원가입 · 로그인 (Supabase Auth)
   ===================================================== */
let afterLogin = null; // 로그인 후 이어서 할 일 (예: 주문하기)

function openAuth(mode) {
  switchAuth(mode || "login");
  $("#loginMsg").textContent = "";
  $("#joinMsg").textContent = "";
  openLayer($("#authModal"));
}
function switchAuth(mode) {
  $$(".auth-tabs button").forEach((b) => b.classList.toggle("is-on", b.dataset.auth === mode));
  $("#loginForm").hidden = mode !== "login";
  $("#joinForm").hidden = mode !== "join";
  $("#authTitle").textContent = mode === "login" ? "로그인" : "회원가입";
}
$$(".auth-tabs button").forEach((b) => b.addEventListener("click", () => switchAuth(b.dataset.auth)));

const emailRule = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const phoneRule = /^01[016789]-?\d{3,4}-?\d{4}$/;
const pwRule = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;

$("#joinForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#joinName").value.trim();
  const email = $("#joinEmail").value.trim().toLowerCase();
  const phone = $("#joinPhone").value.trim();
  const pw = $("#joinPw").value;
  const msg = $("#joinMsg");

  if (name.length < 2) return (msg.textContent = "이름을 2자 이상 입력해 주세요.");
  if (!emailRule.test(email)) return (msg.textContent = "이메일 형식을 확인해 주세요.");
  if (!phoneRule.test(phone)) return (msg.textContent = "휴대폰 번호를 확인해 주세요.");
  if (!pwRule.test(pw)) return (msg.textContent = "비밀번호는 영문과 숫자를 섞어 8자 이상이에요.");
  if (pw !== $("#joinPw2").value) return (msg.textContent = "비밀번호가 서로 달라요.");
  if (!$("#joinAgree").checked) return (msg.textContent = "필수 약관에 동의해 주세요.");

  const button = e.target.querySelector("button[type=submit]");
  setBusy(button, true, "가입하는 중…");
  // 이름 · 연락처는 data 로 함께 보내고, DB 트리거가 shop_profiles 에 옮겨 적는다
  const { data, error } = await db.auth.signUp({ email, password: pw, options: { data: { name, phone } } });
  setBusy(button, false);
  if (error) return (msg.textContent = koError(error));
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    return (msg.textContent = "이미 가입된 이메일이에요.");
  }
  if (!data.session) {
    return (msg.textContent = "가입은 됐지만 이메일 확인이 켜져 있어 로그인되지 않았어요. Supabase 에서 Confirm email 을 꺼 주세요.");
  }
  e.target.reset();
  await afterAuth(data.session, `${name}님, 가입을 환영해요! ${pt(SIGNUP_POINT)}를 드렸어요.`);
});

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#loginEmail").value.trim().toLowerCase();
  const pw = $("#loginPw").value;
  if (!emailRule.test(email) || !pw) return ($("#loginMsg").textContent = "이메일과 비밀번호를 입력해 주세요.");
  const button = e.target.querySelector("button[type=submit]");
  setBusy(button, true, "로그인하는 중…");
  const { data, error } = await db.auth.signInWithPassword({ email, password: pw });
  setBusy(button, false);
  if (error) return ($("#loginMsg").textContent = koError(error));
  e.target.reset();
  await afterAuth(data.session, null);
});

async function afterAuth(newSession, message) {
  session = newSession;
  await loadProfile();
  closeLayer();
  refreshMemberArea();
  toast(message || `${profile && profile.name ? profile.name : "회원"}님, 반가워요.`);
  if (afterLogin) { const next = afterLogin; afterLogin = null; next(); }
}

async function logout() {
  await db.auth.signOut();
  session = null;
  profile = null;
  closeLayer();
  refreshMemberArea();
  toast("로그아웃했어요.");
}

function refreshMemberArea() {
  $("#userLabel").textContent = profile ? `${profile.name || "회원"} · ${pt(profile.points)}` : "로그인";
  $("#userBtn").setAttribute("aria-label", profile ? "마이페이지" : "로그인");
  renderTiers();
  renderProducts();
}
$("#userBtn").addEventListener("click", () => (profile ? openMyPage() : openAuth("login")));

/* =====================================================
   멤버십 안내 (shop_grades)
   ===================================================== */
function renderTiers() {
  const mine = profile ? profile.grade : null;
  $("#tierList").innerHTML = GRADES.map((g) => `
    <div class="tier ${g.name === mine ? "is-mine" : ""}">
      <h3>${escapeHtml(g.name)}</h3>
      <p class="rate">${Math.round(g.rate * 100)}%</p>
      <p class="cond">${g.minSpent === 0 ? "가입 즉시" : `누적 결제 ${won(g.minSpent)} 이상`}</p>
      ${g.name === mine ? `<span class="mine">내 등급</span>` : ""}
    </div>`).join("");
}

/* =====================================================
   체험 결제 → shop_place_order 함수로 주문 저장
   ===================================================== */
let usePoint = 0;

function openCheckout() {
  if (cart.length === 0) { toast("장바구니가 비어 있어요."); return; }
  if (!profile) {
    afterLogin = openCheckout;
    openAuth("login");
    toast("주문은 로그인 후에 할 수 있어요.");
    return;
  }
  usePoint = 0;
  $("#coPoint").value = 0;
  $("#coName").value = profile.name || "";
  $("#coPhone").value = profile.phone || "";
  $("#coAddr").value = "";
  $("#coMsg").textContent = "";
  renderCheckout();
  openLayer($("#checkoutModal"));
}

function maxPoint() {
  const { subtotal } = cartTotals();
  return Math.floor(Math.min(profile.points, subtotal) / POINT_UNIT) * POINT_UNIT;
}

function renderCheckout() {
  const g = myGrade();
  const { subtotal, shippingFee } = cartTotals();
  const payAmount = subtotal + shippingFee - usePoint;

  $("#coItems").innerHTML = cart.map((c) => {
    const p = findProduct(c.productId);
    return p ? `<li><span>${escapeHtml(p.name)} (${escapeHtml(c.size)}) × ${c.qty}</span><span>${won(p.price * c.qty)}</span></li>` : "";
  }).join("");
  $("#coHave").textContent = pt(profile.points);
  $("#coSub").textContent = won(subtotal);
  $("#coShip").textContent = shippingFee ? won(shippingFee) : "무료";
  $("#coUsed").textContent = "-" + won(usePoint);
  $("#coPay").textContent = won(payAmount);
  $("#coGrade").textContent = `${g.name} ${Math.round(g.rate * 100)}%`;
  $("#coEarn").textContent = pt(Math.floor(payAmount * g.rate));
  $("#coSubmit").textContent = `${won(payAmount)} 체험 결제하기`;
}

$("#coPoint").addEventListener("change", (e) => {
  let value = Math.floor((Number(e.target.value) || 0) / POINT_UNIT) * POINT_UNIT;
  if (value < 0) value = 0;
  if (value > maxPoint()) { value = maxPoint(); toast(`최대 ${pt(value)}까지 쓸 수 있어요.`); }
  usePoint = value;
  e.target.value = value;
  renderCheckout();
});
$("#coPointAll").addEventListener("click", () => {
  usePoint = maxPoint();
  $("#coPoint").value = usePoint;
  renderCheckout();
});

$("#checkoutForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const receiver = $("#coName").value.trim();
  const phone = $("#coPhone").value.trim();
  const address = $("#coAddr").value.trim();
  const msg = $("#coMsg");
  if (receiver.length < 2) return (msg.textContent = "받는 분 이름을 입력해 주세요.");
  if (!phoneRule.test(phone)) return (msg.textContent = "연락처를 확인해 주세요.");
  if (address.length < 5) return (msg.textContent = "주소를 자세히 입력해 주세요.");

  const gradeBefore = profile.grade;
  const button = $("#coSubmit");
  setBusy(button, true, "주문을 저장하는 중…");
  // 가격 · 재고 · 포인트 · 등급 계산은 DB 함수가 한 번에(트랜잭션) 처리한다
  const { data: orderId, error } = await db.rpc(RPC_PLACE_ORDER, {
    p_items: cart.map((c) => ({ product_id: c.productId, size: c.size, qty: c.qty })),
    p_use_points: usePoint,
    p_receiver: receiver,
    p_phone: phone,
    p_address: address,
    p_pay_method: $("#payList input:checked").value
  });
  if (error) {
    setBusy(button, false);
    msg.textContent = koError(error);
    await loadProducts(); // 재고가 바뀌었을 수 있으니 다시 읽는다
    renderProducts();
    return;
  }

  const { data: order } = await db.from(TABLE.orders).select("*").eq("id", orderId).single();
  await Promise.all([loadProfile(), loadProducts()]);
  setBusy(button, false);
  cart = [];
  saveCart();
  refreshMemberArea();

  const o = order || { id: orderId, subtotal: 0, shipping_fee: 0, used_points: usePoint, total: 0, earned_points: 0 };
  const newGrade = profile ? profile.grade : gradeBefore;
  $("#doneBody").innerHTML = `
    <h3>주문이 완료됐어요</h3>
    <p class="hint" style="margin-bottom:14px">체험 결제라 실제로 돈이 빠져나가지 않았어요. 주문은 데이터베이스에 저장됐어요.</p>
    <p class="row"><span>주문번호</span><span>${o.id}</span></p>
    <p class="row"><span>상품 금액</span><span>${won(o.subtotal)}</span></p>
    <p class="row"><span>배송비</span><span>${o.shipping_fee ? won(o.shipping_fee) : "무료"}</span></p>
    <p class="row"><span>포인트 사용</span><span>-${won(o.used_points)}</span></p>
    <p class="row total"><span>결제 금액</span><span>${won(o.total)}</span></p>
    <p class="row"><span>적립 포인트</span><span class="plus">+${pt(o.earned_points)}</span></p>
    <p class="row"><span>남은 포인트</span><span>${pt(profile ? profile.points : 0)}</span></p>
    ${newGrade !== gradeBefore ? `<p class="notice" style="margin-top:12px">축하해요! <b>${escapeHtml(newGrade)}</b> 등급이 되어 다음 주문부터 <b>${Math.round(gradeOf(newGrade).rate * 100)}%</b> 적립돼요.</p>` : ""}
    <div class="detail-btns" style="margin-top:16px">
      <button type="button" class="btn btn-line" id="goMyPage">주문 내역 보기</button>
      <button type="button" class="btn btn-pink" id="keepShopping">쇼핑 계속하기</button>
    </div>`;
  $("#goMyPage").addEventListener("click", openMyPage);
  $("#keepShopping").addEventListener("click", closeLayer);
  openLayer($("#doneModal"));
});

/* =====================================================
   마이페이지 (shop_profiles · shop_orders · shop_point_logs)
   ===================================================== */
async function openMyPage() {
  if (!profile) { openAuth("login"); return; }
  $("#myBody").innerHTML = `<p class="hint">불러오는 중이에요…</p>`;
  openLayer($("#myModal"));
  await loadProfile();
  if (!profile) { closeLayer(); openAuth("login"); return; }

  const uid = session.user.id;
  const [ordersRes, logsRes] = await Promise.all([
    db.from(TABLE.orders)
      .select(`id, total, used_points, earned_points, status, pay_method, created_at, ${TABLE.orderItems}(qty, size, unit_price, ${TABLE.products}(name))`)
      .eq("user_id", uid)
      .order("id", { ascending: false }),
    db.from(TABLE.pointLogs).select("amount, reason, created_at").eq("user_id", uid).order("id", { ascending: false })
  ]);
  const myOrders = ordersRes.data || [];
  const myLogs = logsRes.data || [];

  const g = myGrade();
  const next = nextGradeOf(g);
  const progress = next ? Math.min(100, ((profile.total_spent - g.minSpent) / (next.minSpent - g.minSpent)) * 100) : 100;

  $("#myBody").innerHTML = `
    <div class="my-top">
      <h3>${escapeHtml(profile.name || "회원")}님 <span class="grade">${escapeHtml(g.name)}</span></h3>
      <p class="hint" style="color:#C9C9D0">${escapeHtml(profile.email)} · 가입일 ${dateText(profile.created_at)}</p>
      <div class="my-stats">
        <p>보유 포인트<b>${pt(profile.points)}</b></p>
        <p>적립률<b>${Math.round(g.rate * 100)}%</b></p>
        <p>누적 결제<b>${won(profile.total_spent)}</b></p>
      </div>
      <p class="next">${next ? `${next.name}까지 ${won(next.minSpent - profile.total_spent)} 남았어요` : "최고 등급 VIP예요"}</p>
      <div class="bar"><span style="width:${progress}%"></span></div>
    </div>

    <h4>주문 내역</h4>
    ${ordersRes.error ? `<p class="form-msg">${escapeHtml(koError(ordersRes.error))}</p>` : ""}
    ${myOrders.length ? myOrders.map((o) => `
      <div class="order">
        <p><span>주문 ${o.id}</span><span>${won(o.total)}</span></p>
        <p>${(o[TABLE.orderItems] || []).map((i) => `${escapeHtml(i[TABLE.products] ? i[TABLE.products].name : "판매 종료 상품")}(${escapeHtml(i.size)}) × ${i.qty}`).join(", ")}</p>
        <p class="meta">${dateText(o.created_at)} · ${escapeHtml(o.pay_method || "")} · ${escapeHtml(o.status)} · 적립 ${pt(o.earned_points)}${o.used_points ? ` · 사용 ${pt(o.used_points)}` : ""}</p>
      </div>`).join("") : `<p class="hint">아직 주문 내역이 없어요.</p>`}

    <h4>포인트 내역</h4>
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>날짜</th><th>내용</th><th>포인트</th></tr></thead>
        <tbody>${myLogs.map((l) => `<tr><td>${dateText(l.created_at)}</td><td>${escapeHtml(l.reason)}</td><td class="${l.amount >= 0 ? "plus" : "minus"}">${l.amount >= 0 ? "+" : ""}${pt(l.amount)}</td></tr>`).join("")}</tbody>
      </table>
    </div>

    ${profile.role === "admin" ? `<a href="admin.html" class="btn btn-black btn-full" style="margin-top:20px">회원 관리 페이지</a>` : ""}
    <button type="button" class="btn btn-line btn-full" id="logoutBtn" style="margin-top:10px">로그아웃</button>`;
  $("#logoutBtn").addEventListener("click", logout);
}

/* =====================================================
   처음 화면 그리기
   ===================================================== */
async function init() {
  renderTabs();
  renderCart();
  const { data } = await db.auth.getSession();
  session = data.session;
  await Promise.all([loadGrades(), loadProducts()]);
  if (session) await loadProfile();
  refreshMemberArea();
  renderCart();

  // 다른 탭에서 로그아웃하거나 로그인이 만료되면 화면을 맞춘다
  db.auth.onAuthStateChange((event, s) => {
    session = s;
    if (event === "SIGNED_OUT") {
      profile = null;
      setTimeout(refreshMemberArea, 0);
    }
  });
}
init();
