// Bot nhắc việc: đọc Supabase, gửi cảnh báo vào nhóm Zalo. Chạy bằng GitHub Actions (Node 20).
const E = process.env, MODE = E.MODE || "alerts";
const need = ["SUPABASE_URL", "SUPABASE_KEY", "BOT_SECRET", "ZALO_TOKEN", ...(MODE === "getid" ? [] : ["ZALO_CHAT_ID"])];
const miss = need.filter(k => !E[k]);
if (miss.length) { console.error("Thiếu secret:", miss.join(", ")); process.exit(1); }

const API = `https://bot-api.zaloplatforms.com/bot${E.ZALO_TOKEN}`;
const hm = x => (x || "").slice(0, 5);
const dm = d => d.split("-").reverse().slice(0, 2).join("/");
const vnHour = +new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());

async function rpc(fn, args) {
  const r = await fetch(`${E.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST", headers: { apikey: E.SUPABASE_KEY, "Content-Type": "application/json" }, body: JSON.stringify(args) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${fn}: ${(j && j.message) || r.status}`);
  return j;
}
async function zalo(method, body) {
  const r = await fetch(`${API}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(`Zalo ${method}: ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}
async function send(text) {
  const parts = []; let cur = "";
  for (const line of text.split("\n")) { if ((cur + line).length > 1800) { parts.push(cur); cur = ""; } cur += line + "\n"; }
  if (cur.trim()) parts.push(cur);
  for (const p of parts) await zalo("sendMessage", { chat_id: E.ZALO_CHAT_ID, text: p.trim() });
}
const line = t => `• @${t.who}: ${t.title}` +
  (t.start_time ? ` (${hm(t.start_time)}${t.end_time ? "–" + hm(t.end_time) : ""})` : "") +
  (t.by_name && t.by_name !== t.who ? ` — giao bởi ${t.by_name}` : "");

async function alerts() {
  if (!E.FORCE && (vnHour >= 22 || vnHour < 6)) return console.log("Ngoài giờ nhắc (22h–6h), bỏ qua.");
  const rows = await rpc("bot_pending", { p_secret: E.BOT_SECRET });
  if (!rows.length) return console.log("Không có gì cần nhắc.");
  const soon = rows.filter(r => r.kind === "soon"), late = rows.filter(r => r.kind === "late");
  let msg = "";
  if (soon.length) msg += "⏰ SẮP ĐẾN GIỜ (trong 30 phút):\n" + soon.map(line).join("\n") + "\n\n";
  if (late.length) msg += "🔴 QUÁ HẠN, CHƯA XONG:\n" + late.map(t => line(t) + ` [hạn ${dm(t.due)}]`).join("\n") + "\n\n";
  await send(msg.trim() + "\n\nXong việc nhớ vào web tích hoàn thành và gửi ảnh nhé!");
  if (soon.length) await rpc("bot_mark", { p_secret: E.BOT_SECRET, p_ids: soon.map(r => r.task_id), p_kind: "soon" });
  if (late.length) await rpc("bot_mark", { p_secret: E.BOT_SECRET, p_ids: late.map(r => r.task_id), p_kind: "late" });
  console.log(`Đã nhắc: ${soon.length} sắp tới, ${late.length} quá hạn.`);
}
async function summary() {
  const rows = await rpc("bot_stats", { p_secret: E.BOT_SECRET });
  const sum = k => rows.reduce((a, r) => a + r[k], 0);
  if (!sum("total")) return console.log("Hôm nay không có việc, bỏ qua tổng kết.");
  await send("📊 TỔNG KẾT HÔM NAY\n" + rows.filter(r => r.total).map(r =>
    `• ${r.who}: xong ${r.done}/${r.total}` + (r.late ? ` · quá hạn ${r.late}` : "") + (r.done === r.total ? " ✅" : "")).join("\n") +
    `\n\nCả nhà: xong ${sum("done")}/${sum("total")} việc, quá hạn ${sum("late")}.`);
}
async function getid() {
  const j = await zalo("getUpdates", { timeout: 20 });
  const found = new Map();
  (function walk(o) { if (o && typeof o === "object") { if (o.chat && o.chat.id) found.set(o.chat.id, o.chat.chat_type || o.chat.type || "?"); Object.values(o).forEach(walk); } })(j);
  if (!found.size) return console.log("Chưa thấy sự kiện nào. Hãy @tag bot trong nhóm rồi chạy lại ngay.");
  for (const [id, type] of found) console.log(`chat.id = ${id}  (loại: ${type})`);
}
({ alerts, summary, getid }[MODE] || (() => { throw new Error("MODE không hợp lệ: " + MODE); }))()
  .catch(e => { console.error("LỖI:", e.message); process.exit(1); });
