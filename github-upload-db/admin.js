/* =====================================================
   Rose noir — admin.js (회원 관리 페이지)
   관리자(shop_profiles.role = 'admin')만 들어올 수 있다.
   실제로 막는 일은 DB 의 보안 규칙(RLS)이 하고, 이 화면은 돌려보내기만 한다.
   ===================================================== */

// [연결] 쇼핑몰(script.js)과 같은 주소 · 공개 키
const SUPABASE_URL = "https://ocigzmtoiqeoxipnptmn.supabase.co";
const SUPABASE_KEY = "sb_publishable_2l_XPkKEZ8a84EFDVwE6Nw_RpB1hi9C";
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// [표 · 함수 이름] SQL 파일과 똑같이
const TABLE = { profiles: "shop_profiles", products: "shop_products", orders: "shop_orders", orderItems: "shop_order_items", grades: "shop_grades" };
const RPC_UPDATE_MEMBER = "shop_admin_update_member";
const ORDER_STATUSES = ["결제완료", "배송중", "배송완료", "취소"];
const ROLES = ["member", "admin"];

let me = null;        // 로그인한 관리자
let members = [];     // shop_profiles 전체
let orders = [];      // shop_orders 전체
let grades = [];      // shop_grades

const $ = (sel) => document.querySelector(sel);
const won = (n) => Number(n || 0).toLocaleString("ko-KR") + "원";
const num = (n) => Number(n || 0).toLocaleString("ko-KR");
const dateText = (iso) => (iso ? new Date(iso).toLocaleDateString("ko-KR") : "");
const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("is-show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("is-show"), 2600);
}

function goShop(reason) {
  $("#checking").textContent = reason + " 쇼핑몰로 돌아갑니다…";
  setTimeout(() => location.replace("index.html"), 1500);
}

/* ---------- 1. 관리자인지 확인 ---------- */
async function checkAdmin() {
  const { data } = await db.auth.getSession();
  if (!data.session) { goShop("로그인이 필요해요. 쇼핑몰에서 관리자 계정으로 로그인해 주세요."); return false; }
  const { data: p } = await db.from(TABLE.profiles).select("*").eq("id", data.session.user.id).maybeSingle();
  if (!p || p.role !== "admin") { goShop("관리자만 들어올 수 있어요."); return false; }
  me = p;
  $("#adminWho").textContent = `${p.name || p.email} (관리자)`;
  document.body.classList.remove("is-checking");
  $("#checking").remove();
  return true;
}

/* ---------- 2. 읽어 오기 ---------- */
async function loadAll() {
  const [g, m, o] = await Promise.all([
    db.from(TABLE.grades).select("*").order("sort_order"),
    db.from(TABLE.profiles).select("*").order("created_at", { ascending: false }),
    db.from(TABLE.orders)
      .select(`id, user_id, total, status, pay_method, created_at, ${TABLE.orderItems}(qty, size, ${TABLE.products}(name))`)
      .order("id", { ascending: false })
  ]);
  for (const r of [g, m, o]) if (r.error) toast("불러오기 실패: " + r.error.message);
  grades = (g.data || []).map((x) => x.grade);
  members = m.data || [];
  orders = o.data || [];

  const filter = $("#gradeFilter");
  if (filter.options.length === 1) {
    filter.insertAdjacentHTML("beforeend", grades.map((x) => `<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join(""));
  }
  renderSummary();
  renderMembers();
  renderOrders();
}

/* ---------- 3. 요약 숫자 (COUNT · SUM · GROUP BY 와 같은 계산) ---------- */
function renderSummary() {
  const byGrade = grades.map((gr) => `${gr} ${members.filter((x) => x.grade === gr).length}명`).join(" · ");
  const paid = orders.filter((x) => x.status !== "취소");
  const sum = paid.reduce((s, x) => s + x.total, 0);
  $("#summaryCards").innerHTML = `
    <div class="admin-card"><p>전체 회원</p><b>${num(members.length)}명</b><span>${escapeHtml(byGrade)}</span></div>
    <div class="admin-card"><p>주문 건수</p><b>${num(paid.length)}건</b><span>취소 ${num(orders.length - paid.length)}건 제외</span></div>
    <div class="admin-card"><p>주문 합계</p><b>${won(sum)}</b><span>취소 제외 결제 금액</span></div>
    <div class="admin-card"><p>회원 포인트 합계</p><b>${num(members.reduce((s, x) => s + x.points, 0))}P</b><span>아직 쓰지 않은 포인트</span></div>`;
}

/* ---------- 4. 회원 목록 · 이름 검색 · 등급 필터 ---------- */
function renderMembers() {
  const keyword = $("#memberSearch").value.trim().toLowerCase();
  const grade = $("#gradeFilter").value;
  const list = members.filter((x) =>
    (!keyword || String(x.name || "").toLowerCase().includes(keyword)) &&
    (!grade || x.grade === grade)
  );
  $("#memberCount").textContent = `${list.length}명`;
  if (list.length === 0) {
    $("#memberRows").innerHTML = `<tr><td colspan="9" class="empty-cell">조건에 맞는 회원이 없어요.</td></tr>`;
    return;
  }
  $("#memberRows").innerHTML = list.map((x) => {
    const isMe = x.id === me.id;
    return `
      <tr data-id="${x.id}">
        <td><b>${escapeHtml(x.name || "-")}</b></td>
        <td>${escapeHtml(x.email || "")}</td>
        <td>${escapeHtml(x.phone || "")}</td>
        <td><select class="mini-input" data-field="grade" aria-label="등급">${grades.map((gr) => `<option ${gr === x.grade ? "selected" : ""}>${escapeHtml(gr)}</option>`).join("")}</select></td>
        <td><input class="mini-input" data-field="points" type="number" min="0" step="100" value="${x.points}" aria-label="포인트"></td>
        <td><select class="mini-input" data-field="role" aria-label="역할" ${isMe ? "disabled title=\"내 관리자 권한은 여기서 바꿀 수 없어요\"" : ""}>${ROLES.map((r) => `<option ${r === x.role ? "selected" : ""}>${r}</option>`).join("")}</select></td>
        <td>${won(x.total_spent)}</td>
        <td>${dateText(x.created_at)}</td>
        <td><button type="button" class="btn btn-pink mini-btn" data-save="${x.id}">저장</button></td>
      </tr>`;
  }).join("");
}
$("#memberSearch").addEventListener("input", renderMembers);
$("#gradeFilter").addEventListener("change", renderMembers);

/* ---------- 5. 등급 · 포인트 · 역할 저장 (shop_admin_update_member) ---------- */
$("#memberRows").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-save]");
  if (!btn) return;
  const row = btn.closest("tr");
  const target = members.find((x) => x.id === btn.dataset.save);
  const points = Number(row.querySelector('[data-field="points"]').value);
  if (!Number.isInteger(points) || points < 0) { toast("포인트는 0 이상의 정수로 입력해 주세요."); return; }

  btn.disabled = true;
  const { error } = await db.rpc(RPC_UPDATE_MEMBER, {
    p_user_id: target.id,
    p_grade: row.querySelector('[data-field="grade"]').value,
    p_points: points,
    p_role: target.id === me.id ? "admin" : row.querySelector('[data-field="role"]').value
  });
  btn.disabled = false;
  if (error) { toast("저장 실패: " + error.message); return; }
  toast(`${target.name || target.email} 회원 정보를 저장했어요.`);
  await loadAll();
});

/* ---------- 6. 주문 목록 · 상태 바꾸기 ---------- */
function renderOrders() {
  if (orders.length === 0) {
    $("#orderRows").innerHTML = `<tr><td colspan="7" class="empty-cell">아직 주문이 없어요.</td></tr>`;
    return;
  }
  const nameOf = (uid) => { const m = members.find((x) => x.id === uid); return m ? (m.name || m.email) : "탈퇴 회원"; };
  $("#orderRows").innerHTML = orders.map((o) => `
    <tr data-id="${o.id}">
      <td>${o.id}</td>
      <td>${dateText(o.created_at)}</td>
      <td>${escapeHtml(nameOf(o.user_id))}</td>
      <td class="wrap-cell">${(o[TABLE.orderItems] || []).map((i) => `${escapeHtml(i[TABLE.products] ? i[TABLE.products].name : "상품")}(${escapeHtml(i.size)}) × ${i.qty}`).join(", ")}</td>
      <td>${won(o.total)}</td>
      <td><select class="mini-input" data-status aria-label="주문 상태">${ORDER_STATUSES.map((s) => `<option ${s === o.status ? "selected" : ""}>${s}</option>`).join("")}</select></td>
      <td><button type="button" class="btn btn-black mini-btn" data-order="${o.id}">변경</button></td>
    </tr>`).join("");
}

$("#orderRows").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-order]");
  if (!btn) return;
  const status = btn.closest("tr").querySelector("[data-status]").value;
  btn.disabled = true;
  const { error } = await db.from(TABLE.orders).update({ status }).eq("id", Number(btn.dataset.order));
  btn.disabled = false;
  if (error) { toast("변경 실패: " + error.message); return; }
  toast(`주문 ${btn.dataset.order} 상태를 「${status}」(으)로 바꿨어요.`);
  await loadAll();
});

/* ---------- 7. 로그아웃 ---------- */
$("#adminLogout").addEventListener("click", async () => {
  await db.auth.signOut();
  location.replace("index.html");
});

(async () => {
  if (await checkAdmin()) await loadAll();
})();
