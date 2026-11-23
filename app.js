import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
         createUserWithEmailAndPassword, sendPasswordResetEmail }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc,
         query, where, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

/* ---------- helpers ---------- */
const $ = (s) => document.querySelector(s);
const view = $("#view");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => fmtDate(new Date());
const shiftDate = (s, n) => { const d = new Date(s + "T00:00:00"); d.setDate(d.getDate() + n); return fmtDate(d); };

const ROLE_LABEL = { admin: "Admin", doctor: "Doctor", assistant: "Assistant" };
const STATUSES = { SCHEDULED: "Scheduled", CHECKED_IN: "Checked in", IN_PROGRESS: "In progress",
                   COMPLETED: "Completed", CANCELLED: "Cancelled", NO_SHOW: "No show" };
const VISIT_TYPES = ["First Visit", "Follow-up", "Emergency"];

let me = null, clinic = null, staff = [];
let clinics = [], users = [], patients = [], visits = [], visitDate = today();

function toast(msg, bad = false) {
  const t = $("#toast");
  t.textContent = msg; t.className = "show" + (bad ? " bad" : "");
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.className = ""), 3200);
}
async function run(fn) {
  try { await fn(); }
  catch (e) {
    console.error(e);
    toast(e.code === "permission-denied" ? "You are not allowed to do that." : (e.message || "Error"), true);
  }
}
function modal(html) { $("#modalBox").innerHTML = html; $("#modal").hidden = false; }
function closeModal() { $("#modal").hidden = true; $("#modalBox").innerHTML = ""; }
const nameOf = (id) => (staff.find((s) => s.id === id) || {}).name || "—";
const doctorsOfMe = () => me.role === "doctor"
  ? [{ id: me.uid, name: me.name }]
  : staff.filter((s) => s.role === "doctor" && s.active && (me.doctorIds || []).includes(s.id));

/* ---------- auth ---------- */
$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  $("#loginErr").textContent = "";
  try { await signInWithEmailAndPassword(auth, fd.email.trim(), fd.password); }
  catch { $("#loginErr").textContent = "Invalid email or password."; }
});
$("#logout").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  closeModal();
  if (!user) {
    me = clinic = null; staff = []; clinics = users = patients = visits = [];
    $("#app").hidden = true; $("#login").hidden = false; view.innerHTML = "";
    return;
  }
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (!snap.exists() || snap.data().active !== true) {
      $("#loginErr").textContent = "Your account is not active. Contact the administrator.";
      await signOut(auth); return;
    }
    me = { uid: user.uid, ...snap.data() };
    if (me.role !== "admin") {
      const c = await getDoc(doc(db, "clinics", me.clinicId));
      clinic = c.exists() ? { id: c.id, ...c.data() } : null;
      const s = await getDocs(query(collection(db, "users"), where("clinicId", "==", me.clinicId)));
      staff = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    }
    showApp();
  } catch (e) {
    console.error(e);
    $("#loginErr").textContent = "Could not load your profile.";
    await signOut(auth);
  }
});

function showApp() {
  $("#login").hidden = true; $("#app").hidden = false;
  $("#who").textContent = `${me.name} · ${ROLE_LABEL[me.role]}${clinic ? " · " + clinic.name : ""}`;
  const tabs = me.role === "admin"
    ? [["clinics", "Clinics"], ["users", "Users"]]
    : [["visits", "Visits"], ["patients", "Patients"]];
  $("#tabs").innerHTML = tabs.map(([k, l]) => `<button data-act="tab" data-tab="${k}">${l}</button>`).join("");
  go(tabs[0][0]);
}
async function go(tab) {
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  view.innerHTML = '<p class="muted">Loading…</p>';
  const map = { clinics: renderClinics, users: renderUsers, visits: renderVisits, patients: renderPatients };
  await run(() => map[tab]());
}

/* ---------- ADMIN: clinics ---------- */
async function renderClinics() {
  const snap = await getDocs(collection(db, "clinics"));
  clinics = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  view.innerHTML = `
    <div class="bar"><h2>Clinics</h2><button data-act="new-clinic">+ New Clinic</button></div>
    <table><thead><tr><th>Name</th><th>Address</th><th>Phone</th><th>Status</th><th></th></tr></thead><tbody>
    ${clinics.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.address)}</td><td>${esc(c.phone)}</td>
      <td>${c.active !== false ? "Active" : "Inactive"}</td>
      <td><button class="sm ghost" data-act="edit-clinic" data-id="${esc(c.id)}">Edit</button></td></tr>`).join("")
      || '<tr><td colspan="5" class="muted">No clinics yet.</td></tr>'}
    </tbody></table>`;
}
function clinicForm(c = {}) {
  modal(`<h3>${c.id ? "Edit" : "New"} Clinic</h3>
    <form data-form="clinic" data-id="${esc(c.id || "")}">
      <label>Name<input name="name" required value="${esc(c.name)}"></label>
      <label>Address<input name="address" value="${esc(c.address)}"></label>
      <label>Phone<input name="phone" value="${esc(c.phone)}"></label>
      <label class="chk"><input type="checkbox" name="active" ${c.active !== false ? "checked" : ""}> Active</label>
      <div class="row"><button type="button" class="ghost" data-act="close">Cancel</button><button>Save</button></div>
    </form>`);
}

/* ---------- ADMIN: users ---------- */
let secondary = null;
async function renderUsers() {
  const [cs, us] = await Promise.all([getDocs(collection(db, "clinics")), getDocs(collection(db, "users"))]);
  clinics = cs.docs.map((d) => ({ id: d.id, ...d.data() }));
  users = us.docs.map((d) => ({ id: d.id, ...d.data() }));
  const clinicName = (id) => (clinics.find((c) => c.id === id) || {}).name || "—";
  view.innerHTML = `
    <div class="bar"><h2>Users</h2><button data-act="new-user">+ New User</button></div>
    <table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Clinic</th><th>Status</th><th></th></tr></thead><tbody>
    ${users.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${ROLE_LABEL[u.role] || esc(u.role)}</td>
      <td>${esc(clinicName(u.clinicId))}</td><td>${u.active ? "Active" : "Inactive"}</td>
      <td class="row"><button class="sm ghost" data-act="edit-user" data-id="${esc(u.id)}">Edit</button>
      <button class="sm ghost" data-act="reset-pw" data-email="${esc(u.email)}">Reset password</button></td></tr>`).join("")
      || '<tr><td colspan="6" class="muted">No users.</td></tr>'}
    </tbody></table>`;
}
function doctorBox(clinicId, selected = []) {
  const docs = users.filter((u) => u.role === "doctor" && u.clinicId === clinicId);
  if (!docs.length) return '<span class="muted">No doctors in this clinic yet.</span>';
  return docs.map((d) => `<label class="chk"><input type="checkbox" name="doctorIds" value="${esc(d.id)}"
    ${selected.includes(d.id) ? "checked" : ""}> ${esc(d.name)}</label>`).join("");
}
function newUserForm() {
  modal(`<h3>New User</h3>
    <form data-form="new-user">
      <label>Full name<input name="name" required></label>
      <label>Email<input type="email" name="email" required></label>
      <label>Initial password (min 6)<input type="text" name="password" minlength="6" required autocomplete="off"></label>
      <label>Role<select name="role"><option value="doctor">Doctor</option><option value="assistant">Doctor Assistant</option><option value="admin">Admin</option></select></label>
      <label>Clinic<select name="clinicId"><option value="">— select —</option>
        ${clinics.filter((c) => c.active !== false).map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}</select></label>
      <div id="docWrap" hidden><label>Assigned doctors</label><div class="docs" id="docBox"></div></div>
      <div class="row"><button type="button" class="ghost" data-act="close">Cancel</button><button>Create</button></div>
    </form>`);
}
function editUserForm(u) {
  modal(`<h3>Edit User</h3>
    <form data-form="edit-user" data-id="${esc(u.id)}" data-role="${esc(u.role)}" data-clinic="${esc(u.clinicId || "")}">
      <p class="muted">${esc(u.email)} · ${ROLE_LABEL[u.role]}</p>
      <label>Full name<input name="name" required value="${esc(u.name)}"></label>
      <label class="chk"><input type="checkbox" name="active" ${u.active ? "checked" : ""}> Active</label>
      ${u.role === "assistant" ? `<label>Assigned doctors</label><div class="docs">${doctorBox(u.clinicId, u.doctorIds || [])}</div>` : ""}
      <div class="row"><button type="button" class="ghost" data-act="close">Cancel</button><button>Save</button></div>
    </form>`);
}
function getSecondaryAuth() {   // lets the admin create accounts without being signed out
  if (!secondary) secondary = initializeApp(firebaseConfig, "secondary");
  return getAuth(secondary);
}

/* ---------- PATIENTS ---------- */
async function loadPatients() {
  const snap = await getDocs(query(collection(db, "patients"), where("clinicId", "==", me.clinicId)));
  patients = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.fullName || "").localeCompare(b.fullName || ""));
}
async function renderPatients() {
  await loadPatients();
  view.innerHTML = `
    <div class="bar"><h2>Patients</h2>
      <div class="row"><input id="ptSearch" placeholder="Search name / file no / phone" style="width:260px">
      <button data-act="new-patient">+ New Patient</button></div></div>
    <div id="ptList"></div>`;
  paintPatients("");
}
function paintPatients(q) {
  q = q.trim().toLowerCase();
  const list = patients.filter((p) => !q || [p.fullName, p.fileNo, p.phone].join(" ").toLowerCase().includes(q));
  $("#ptList").innerHTML = `<table><thead><tr><th>File #</th><th>Name</th><th>Phone</th><th>Birth date</th><th>Gender</th><th></th></tr></thead><tbody>
    ${list.map((p) => `<tr><td>${esc(p.fileNo)}</td><td>${esc(p.fullName)}</td><td>${esc(p.phone)}</td>
      <td>${esc(p.birthDate)}</td><td>${esc(p.gender)}</td>
      <td><button class="sm ghost" data-act="edit-patient" data-id="${esc(p.id)}">Edit</button></td></tr>`).join("")
      || '<tr><td colspan="6" class="muted">No patients found.</td></tr>'}</tbody></table>`;
}
function patientForm(p = {}) {
  modal(`<h3>${p.id ? "Edit" : "New"} Patient</h3>
    <form data-form="patient" data-id="${esc(p.id || "")}">
      <label>File number<input name="fileNo" value="${esc(p.fileNo)}"></label>
      <label>Full name<input name="fullName" required value="${esc(p.fullName)}"></label>
      <label>Phone<input name="phone" value="${esc(p.phone)}"></label>
      <label>Birth date<input type="date" name="birthDate" value="${esc(p.birthDate)}"></label>
      <label>Gender<select name="gender"><option value="">—</option>
        ${["Male", "Female"].map((g) => `<option ${p.gender === g ? "selected" : ""}>${g}</option>`).join("")}</select></label>
      <div class="row"><button type="button" class="ghost" data-act="close">Cancel</button><button>Save</button></div>
    </form>`);
}

/* ---------- VISITS ---------- */
async function renderVisits() {
  view.innerHTML = `
    <div class="bar"><h2>Visits</h2>
      <div class="row">
        <button class="sm ghost" data-act="day" data-n="-1">◀</button>
        <input type="date" id="vDate" value="${visitDate}" style="width:auto">
        <button class="sm ghost" data-act="day" data-n="1">▶</button>
        <button class="sm ghost" data-act="day" data-n="0">Today</button>
      </div>
      <button data-act="new-visit">+ New Visit</button></div>
    <div id="vList"></div>`;
  await loadVisits();
}
async function loadVisits() {
  const ids = me.role === "doctor" ? [me.uid] : (me.doctorIds || []);
  if (!ids.length) { $("#vList").innerHTML = '<p class="muted">No doctors are assigned to your account.</p>'; return; }
  // each query is pinned to clinic + one doctor + date, so the security rules can verify it
  const snaps = await Promise.all(ids.map((id) => getDocs(query(collection(db, "visits"),
    where("clinicId", "==", me.clinicId), where("doctorId", "==", id), where("visitDate", "==", visitDate)))));
  visits = snaps.flatMap((s) => s.docs.map((d) => ({ id: d.id, ...d.data() })))
    .sort((a, b) => (a.visitTime || "").localeCompare(b.visitTime || ""));
  $("#vList").innerHTML = `<table><thead><tr><th>Time</th><th>Patient</th><th>Doctor</th><th>Type</th><th>Status</th><th></th></tr></thead><tbody>
    ${visits.map((v) => `<tr><td>${esc(v.visitTime)}</td><td>${esc(v.patientName)}</td><td>${esc(nameOf(v.doctorId))}</td>
      <td>${esc(v.visitType)}</td><td><span class="badge st-${esc(v.status)}">${esc(STATUSES[v.status] || v.status)}</span></td>
      <td><button class="sm" data-act="open-visit" data-id="${esc(v.id)}">Open</button></td></tr>`).join("")
      || '<tr><td colspan="6" class="muted">No visits on this date.</td></tr>'}</tbody></table>`;
}
async function newVisitForm() {
  if (!patients.length) await loadPatients();
  const docs = doctorsOfMe();
  modal(`<h3>New Visit</h3>
    <form data-form="new-visit">
      <label>Patient<input id="pSearch" placeholder="Type to search…" autocomplete="off"></label>
      <select name="patientId" id="pSelect" size="5" required style="margin-bottom:10px"></select>
      <label>Doctor<select name="doctorId" required>${docs.map((d) => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join("")}</select></label>
      <div class="row"><label style="flex:1">Date<input type="date" name="visitDate" value="${visitDate}" required></label>
      <label style="flex:1">Time<input type="time" name="visitTime" value="09:00" required></label></div>
      <label>Visit type<select name="visitType">${VISIT_TYPES.map((t) => `<option>${t}</option>`).join("")}</select></label>
      <label>Reason for visit<input name="reason" maxlength="500"></label>
      <div class="row"><button type="button" class="ghost" data-act="close">Cancel</button><button>Create visit</button></div>
    </form>`);
  fillPatientSelect("");
}
function fillPatientSelect(q) {
  q = q.trim().toLowerCase();
  $("#pSelect").innerHTML = patients
    .filter((p) => !q || [p.fullName, p.fileNo, p.phone].join(" ").toLowerCase().includes(q))
    .slice(0, 50)
    .map((p) => `<option value="${esc(p.id)}">${esc(p.fullName)}${p.fileNo ? " (" + esc(p.fileNo) + ")" : ""}</option>`).join("");
}
async function openVisit(id) {
  const v = visits.find((x) => x.id === id); if (!v) return;
  let note = "";
  if (me.role === "doctor") {
    const n = await getDoc(doc(db, "doctorNotes", v.id));   // only the owning doctor can read this
    note = n.exists() ? n.data().text || "" : "";
  }
  modal(`<h3>${esc(v.patientName)}</h3>
    <p class="muted">Doctor: ${esc(nameOf(v.doctorId))}</p>
    <form data-form="visit" data-id="${esc(v.id)}">
      <div class="row"><label style="flex:1">Date<input type="date" name="visitDate" value="${esc(v.visitDate)}" required></label>
      <label style="flex:1">Time<input type="time" name="visitTime" value="${esc(v.visitTime)}" required></label></div>
      <label>Visit type<select name="visitType">${VISIT_TYPES.map((t) => `<option ${v.visitType === t ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      <label>Reason for visit<input name="reason" value="${esc(v.reason)}" maxlength="500"></label>
      <label>Status<select name="status">${Object.entries(STATUSES).map(([k, l]) => `<option value="${k}" ${v.status === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <div class="row"><button type="button" class="ghost" data-act="close">Close</button><button>Save visit</button></div>
    </form>
    ${me.role === "doctor" ? `
    <form data-form="notes" data-id="${esc(v.id)}" class="private">
      <h4>🔒 Private notes</h4>
      <p class="muted" style="margin:0 0 8px">Visible only to you. Not visible to assistants or administrators.</p>
      <textarea name="text" autocomplete="off">${esc(note)}</textarea>
      <div class="row" style="margin-top:8px"><button>Save notes</button></div>
    </form>` : ""}`);
}

/* ---------- click / change / input delegation ---------- */
const actions = {
  tab: (d) => go(d.tab),
  close: () => closeModal(),
  "new-clinic": () => clinicForm(),
  "edit-clinic": (d) => clinicForm(clinics.find((c) => c.id === d.id)),
  "new-user": () => newUserForm(),
  "edit-user": (d) => editUserForm(users.find((u) => u.id === d.id)),
  "reset-pw": async (d) => { await sendPasswordResetEmail(auth, d.email); toast("Password reset email sent."); },
  "new-patient": () => patientForm(),
  "edit-patient": (d) => patientForm(patients.find((p) => p.id === d.id)),
  day: (d) => { visitDate = +d.n === 0 ? today() : shiftDate(visitDate, +d.n); return renderVisits(); },
  "new-visit": () => newVisitForm(),
  "open-visit": (d) => openVisit(d.id),
};
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]");
  if (b && actions[b.dataset.act]) run(() => actions[b.dataset.act](b.dataset));
});
document.addEventListener("change", (e) => {
  if (e.target.id === "vDate" && e.target.value) { visitDate = e.target.value; run(renderVisits); }
  const f = e.target.closest('form[data-form="new-user"]');
  if (f && (e.target.name === "role" || e.target.name === "clinicId")) {
    const role = f.elements.role.value, cid = f.elements.clinicId.value;
    $("#docWrap").hidden = role !== "assistant";
    $("#docBox").innerHTML = role === "assistant" ? (cid ? doctorBox(cid) : '<span class="muted">Select a clinic first.</span>') : "";
  }
});
document.addEventListener("input", (e) => {
  if (e.target.id === "ptSearch") paintPatients(e.target.value);
  if (e.target.id === "pSearch") fillPatientSelect(e.target.value);
});

/* ---------- form submits ---------- */
const forms = {
  async clinic(f, id) {
    const fd = Object.fromEntries(new FormData(f));
    const data = { name: fd.name.trim(), address: fd.address.trim(), phone: fd.phone.trim(), active: fd.active === "on" };
    if (id) await updateDoc(doc(db, "clinics", id), data);
    else await addDoc(collection(db, "clinics"), { ...data, createdAt: serverTimestamp() });
    closeModal(); toast("Saved."); await renderClinics();
  },
  async "new-user"(f) {
    const fd = new FormData(f);
    const role = fd.get("role"), clinicId = fd.get("clinicId") || null;
    if (role !== "admin" && !clinicId) throw new Error("Select a clinic.");
    const email = fd.get("email").trim();
    const sAuth = getSecondaryAuth();
    const cred = await createUserWithEmailAndPassword(sAuth, email, fd.get("password"));
    await signOut(sAuth);
    await setDoc(doc(db, "users", cred.user.uid), {
      name: fd.get("name").trim(), email, role, clinicId: role === "admin" ? null : clinicId,
      doctorIds: role === "assistant" ? fd.getAll("doctorIds") : [], active: true, createdAt: serverTimestamp(),
    });
    closeModal(); toast("User created."); await renderUsers();
  },
  async "edit-user"(f, id) {
    const fd = new FormData(f);
    const data = { name: fd.get("name").trim(), active: fd.get("active") === "on" };
    if (f.dataset.role === "assistant") data.doctorIds = fd.getAll("doctorIds");
    await updateDoc(doc(db, "users", id), data);
    closeModal(); toast("Saved."); await renderUsers();
  },
  async patient(f, id) {
    const fd = Object.fromEntries(new FormData(f));
    const data = { fileNo: fd.fileNo.trim(), fullName: fd.fullName.trim(), phone: fd.phone.trim(),
                   birthDate: fd.birthDate, gender: fd.gender, clinicId: me.clinicId };
    if (id) await updateDoc(doc(db, "patients", id), data);
    else await addDoc(collection(db, "patients"), { ...data, createdBy: me.uid, createdAt: serverTimestamp() });
    closeModal(); toast("Saved."); await renderPatients();
  },
  async "new-visit"(f) {
    const fd = Object.fromEntries(new FormData(f));
    const p = patients.find((x) => x.id === fd.patientId);
    if (!p) throw new Error("Select a patient.");
    await addDoc(collection(db, "visits"), {
      clinicId: me.clinicId, patientId: p.id, patientName: p.fullName, doctorId: fd.doctorId,
      visitDate: fd.visitDate, visitTime: fd.visitTime, visitType: fd.visitType, reason: fd.reason.trim(),
      status: "SCHEDULED", createdBy: me.uid, createdAt: serverTimestamp(),
    });
    visitDate = fd.visitDate;
    closeModal(); toast("Visit created."); await renderVisits();
  },
  async visit(f, id) {
    const fd = Object.fromEntries(new FormData(f));
    await updateDoc(doc(db, "visits", id), {
      visitDate: fd.visitDate, visitTime: fd.visitTime, visitType: fd.visitType,
      reason: fd.reason.trim(), status: fd.status, updatedAt: serverTimestamp(),
    });
    visitDate = fd.visitDate;
    closeModal(); toast("Visit saved."); await renderVisits();
  },
  async notes(f, id) {
    const text = new FormData(f).get("text");
    await setDoc(doc(db, "doctorNotes", id), {
      visitId: id, doctorId: me.uid, clinicId: me.clinicId, text, updatedAt: serverTimestamp(),
    });
    toast("Notes saved.");
  },
};
document.addEventListener("submit", (e) => {
  const f = e.target.closest("form[data-form]");
  if (!f) return;
  e.preventDefault();
  const btn = e.submitter; if (btn) btn.disabled = true;
  run(() => forms[f.dataset.form](f, f.dataset.id)).finally(() => { if (btn) btn.disabled = false; });
});
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });
