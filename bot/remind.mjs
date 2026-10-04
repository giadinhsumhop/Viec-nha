// Bot nhắc việc: đọc Supabase, gửi cảnh báo vào nhóm Zalo + nhắn riêng từng người. Chạy bằng GitHub Actions (Node 20).
const E = process.env, MODE = E.MODE || (E.SCHEDULE === "0 13 * * *" ? "summary" : "alerts");
const need = ["SUPABASE_URL", "SUPABASE_KEY", "BOT_SECRET", "ZALO_TOKEN", ...(["getid", "link"].includes(MODE) ? [] : ["ZALO_CHAT_ID"])];
const miss = need.filter(k => !E[k]);
if (miss.length) { console.error("Thiếu secret:", miss.join(", ")); process.exit(1); }

const API = `https://bot-api.zaloplatforms.com/bot${E.ZALO_TOKEN}`;
const hm = x => (x || "").slice(0, 5);
const dm = d => d.split("-").reverse().slice(0, 2).join("/");
const pick = a => a[Math.floor(Math.random() * a.length)];
const vnHour = +new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
const norm = s => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

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
  if (!r.ok || j.ok === false) { const e = new Error(`Zalo ${method}: ${JSON.stringify(j).slice(0, 200)}`); e.code = j.error_code; throw e; }
  return j;
}
async function sendTo(chat, text) {
  const parts = []; let cur = "";
  for (const line of text.split("\n")) { if ((cur + line).length > 1800) { parts.push(cur); cur = ""; } cur += line + "\n"; }
  if (cur.trim()) parts.push(cur);
  for (const p of parts) await zalo("sendMessage", { chat_id: chat, text: p.trim() });
}
const send = text => sendTo(E.ZALO_CHAT_ID, text);
// Nhắn riêng: lỗi (chưa liên kết, bị chặn...) chỉ ghi log, không làm hỏng cả lượt chạy.
async function dmTo(chat, who, text) {
  if (!chat) return false;
  try { await sendTo(chat, text); return true; }
  catch (e) { console.log(`Không nhắn riêng được cho ${who}: ${e.message.slice(0, 80)}`); return false; }
}

const line = t => `👉 @${t.who}: ${t.title}` +
  (t.start_time ? ` (${hm(t.start_time)}${t.end_time ? "–" + hm(t.end_time) : ""})` : "") +
  (t.by_name && t.by_name !== t.who ? ` — giao bởi ${t.by_name}` : "");
const myLine = t => `• ${t.title}` + (t.start_time ? ` (${hm(t.start_time)}${t.end_time ? "–" + hm(t.end_time) : ""})` : "") +
  (t.by_name && t.by_name !== t.who ? ` — giao bởi ${t.by_name}` : "");

async function alerts() {
  if (!E.FORCE && (vnHour >= 22 || vnHour < 6)) return console.log("Ngoài giờ nhắc (22h–6h), bỏ qua.");
  const rows = await rpc("bot_pending", { p_secret: E.BOT_SECRET });
  if (!rows.length) return console.log("Không có gì cần nhắc.");
  const soon = rows.filter(r => r.kind === "soon"), late = rows.filter(r => r.kind === "late");
  let msg = "";
  if (soon.length) msg += pick(["⏰ Ting ting! Sắp đến giờ rồi nè:", "🔔 Chuẩn bị nào cả nhà, sắp tới giờ:", "⏳ Chưa đầy 30 phút nữa là tới giờ:"]) + "\n" + soon.map(line).join("\n") + "\n\n";
  if (late.length) msg += pick(["🔴 Ơ ơ, mấy việc này chưa thấy xong nè:", "😅 Ai đó quên rồi phải không? Quá hạn nè:", "🚨 Quá hạn rồi nha, mau xử lý thôi:"]) + "\n" + late.map(t => line(t) + ` [hạn ${dm(t.due)}]`).join("\n") + "\n\n";
  await send(msg.trim() + "\n\n" + pick(["Xong việc nhớ vào web tích ✅ và gửi ảnh nhé! 💪", "Làm xong tích ✅ cho bố mẹ vui nha 😄", "Cố lên cả nhà ơi! 🌟", "Nhanh tay là có điểm cộng đó nha 😉"]));
  if (soon.length) await rpc("bot_mark", { p_secret: E.BOT_SECRET, p_ids: soon.map(r => r.task_id), p_kind: "soon" });
  if (late.length) await rpc("bot_mark", { p_secret: E.BOT_SECRET, p_ids: late.map(r => r.task_id), p_kind: "late" });
  let n = 0;
  for (const who of [...new Set(rows.map(r => r.who))]) {
    const mine = rows.filter(r => r.who === who), chat = mine[0].chat_id;
    const s = mine.filter(r => r.kind === "soon"), l = mine.filter(r => r.kind === "late");
    let t = `${pick(["Ơi", "Này", "Hey"])} ${who} ơi 👋\n`;
    if (s.length) t += "\n⏰ Sắp đến giờ:\n" + s.map(myLine).join("\n") + "\n";
    if (l.length) t += "\n🔴 Quá hạn, chưa xong:\n" + l.map(r => myLine(r) + ` [hạn ${dm(r.due)}]`).join("\n") + "\n";
    t += "\n" + pick(["Xong nhớ vào web tích ✅ và gửi ảnh nha! 💪", "Cố lên nào, mình tin bạn làm được! 🌟", "Làm xong là nhẹ người liền 😄"]);
    if (await dmTo(chat, who, t)) n++;
  }
  console.log(`Đã nhắc nhóm: ${soon.length} sắp tới, ${late.length} quá hạn. Nhắn riêng: ${n} người.`);
}
async function summary() {
  const rows = (await rpc("bot_stats", { p_secret: E.BOT_SECRET })).filter(r => r.total);
  if (!rows.length) return console.log("Hôm nay không có việc, bỏ qua tổng kết.");
  const sum = k => rows.reduce((a, r) => a + r[k], 0), D = sum("done"), T = sum("total"), L = sum("late");
  const star = rows.filter(r => r.done === r.total).sort((a, b) => b.total - a.total);
  let msg = "📊 TỔNG KẾT HÔM NAY\n" + rows.map(r =>
    `${r.done === r.total ? "🌟" : r.late ? "😬" : "🙂"} ${r.who}: xong ${r.done}/${r.total}` + (r.late ? ` · quá hạn ${r.late}` : "")).join("\n") +
    `\n\nCả nhà: xong ${D}/${T} việc` + (L ? `, quá hạn ${L}.` : ".");
  if (D === T) msg += "\n\n🎉🎉 CẢ NHÀ HOÀN THÀNH 100%! Tự hào quá đi! Cả nhà vỗ tay nào 👏";
  else {
    if (star.length) msg += `\n\n🏆 Ngôi sao hôm nay: ${star.map(r => r.who).join(", ")}. Giỏi lắm!`;
    msg += "\n" + pick(["Việc nào chưa xong thì mai mình cố hơn nhé 💪", "Còn dang dở thì tranh thủ làm nốt nha, chưa muộn đâu 😄", "Mai cả nhà cùng bứt phá nào! 🚀"]);
  }
  await send(msg);
  let n = 0;
  for (const r of rows) {
    const t = r.done === r.total
      ? `🌟 ${r.who} ơi, hôm nay bạn xong ${r.done}/${r.total} việc. Tuyệt vời, nghỉ ngơi thôi nào! 🎉`
      : `📊 ${r.who} ơi, hôm nay bạn xong ${r.done}/${r.total} việc` + (r.late ? `, quá hạn ${r.late}` : "") + ". " + pick(["Còn dang dở thì vào web xem lại nhé 💪", "Mai mình cố thêm chút nữa nha 😊", "Chưa muộn đâu, làm nốt nếu còn sức nhé! 🚀"]);
    if (await dmTo(r.chat_id, r.who, t)) n++;
  }
  console.log(`Đã tổng kết nhóm. Nhắn riêng: ${n} người.`);
}
const collect = (j, out, seen) => (function walk(o) {
  if (!o || typeof o !== "object") return;
  if (o.chat && o.chat.id && typeof o.text === "string") {
    const k = o.message_id || o.id;
    if (!k || !seen.has(k)) { if (k) seen.add(k); out.push(o); }
  }
  Object.values(o).forEach(walk);
})(j);
async function getid() {
  const found = new Map(), end = Date.now() + 100000;
  const walk = o => { if (o && typeof o === "object") { if (o.chat && o.chat.id) found.set(o.chat.id, o.chat.chat_type || o.chat.type || "?"); Object.values(o).forEach(walk); } };
  console.log("Đang lắng nghe khoảng 100 giây. Hãy gửi tin @tag bot trong nhóm (hoặc nhắn riêng cho bot) NGAY BÂY GIỜ...");
  while (Date.now() < end && !found.size) {
    try { walk(await zalo("getUpdates", { timeout: 25 })); }
    catch (e) { if (e.code !== 408) throw e; console.log("... chưa có tin mới, tiếp tục chờ"); }
  }
  if (!found.size) return console.log("Hết giờ, chưa nhận được tin nào. Kiểm tra bot đã vào nhóm chưa và tin có tag đúng bot không, rồi chạy lại.");
  for (const [id, type] of found) console.log(`chat.id = ${id}  (loại: ${type})`);
}
// Liên kết nhắn riêng: mỗi người nhắn riêng cho bot đúng tên đã đăng ký trên web.
async function link() {
  const members = await rpc("bot_members", { p_secret: E.BOT_SECRET });
  const linked = new Set(), seen = new Set(), end = Date.now() + (+E.LINK_SECONDS || 240) * 1000;
  console.log(`Đang lắng nghe ${Math.round((end - Date.now()) / 1000)} giây. Mỗi người hãy nhắn RIÊNG cho bot đúng tên mình (VD: Bố, Mẹ...). Thành viên: ${members.map(m => m.name).join(", ")}`);
  while (Date.now() < end && linked.size < members.length) {
    let j; try { j = await zalo("getUpdates", { timeout: 25 }); } catch (e) { if (e.code !== 408) throw e; continue; }
    const msgs = []; collect(j, msgs, seen);
    for (const m of msgs) {
      if (m.chat.chat_type === "GROUP" || String(m.chat.id).startsWith("zgr")) continue;
      const t = " " + norm(m.text) + " ";
      const hit = members.find(x => t === " " + norm(x.name) + " ") || members.find(x => t.includes(" " + norm(x.name) + " "));
      if (!hit) { console.log("Có một tin nhắn riêng chưa khớp tên thành viên nào."); await dmTo(String(m.chat.id), "?", "Mình chưa biết bạn là ai 🤔 Hãy nhắn đúng tên bạn đã đăng ký trên web việc nhà nhé (VD: " + members.map(x => x.name).join(", ") + ")."); continue; }
      const ok = await rpc("bot_link", { p_secret: E.BOT_SECRET, p_name: hit.name, p_chat: String(m.chat.id) });
      if (ok) { linked.add(ok); console.log(`✅ Đã liên kết: ${ok}`); await dmTo(String(m.chat.id), ok, `✅ Xong! Mình nhớ bạn là ${ok} rồi. Từ giờ mình sẽ nhắn riêng khi bạn có việc sắp tới giờ, quá hạn và gửi tổng kết cuối ngày nhé 😊`); }
    }
  }
  console.log(`Kết thúc. Đã liên kết trong lượt này: ${[...linked].join(", ") || "(chưa có ai)"}. Chưa liên kết: ${members.filter(m => !linked.has(m.name)).map(m => m.name).join(", ") || "(không còn ai)"}.`);
}
({ alerts, summary, getid, link }[MODE] || (() => { throw new Error("MODE không hợp lệ: " + MODE); }))()
  .catch(e => { console.error("LỖI:", e.message); process.exit(1); });
