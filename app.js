import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
         createUserWithEmailAndPassword, sendPasswordResetEmail,
         GoogleAuthProvider, signInWithPopup }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc,
         deleteField, runTransaction, query, where, serverTimestamp }
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
const clinicIdsOf = (u) => u.clinicIds || (u.clinicId ? [u.clinicId] : []);   // old single-clinic accounts still work

const ROLE_LABEL = { admin: "Admin", doctor: "Doctor", assistant: "Assistant", pending: "Pending", rejected: "Rejected" };
const STATUSES = { SCHEDULED: "Scheduled", CHECKED_IN: "Checked in", IN_PROGRESS: "In progress",
                   COMPLETED: "Completed", CANCELLED: "Cancelled", NO_SHOW: "No show" };
const VISIT_TYPES = ["First Visit", "Follow-up", "Emergency"];
const CLIN_FIELDS = [["complaint", "Complaint"], ["diagnosis", "Diagnosis"],
                     ["treatment", "Treatment"], ["plan", "Treatment plan"]];

let me = null, clinicList = [], activeClinicId = null, currentTab = null;
let clinics = [], users = [], patients = [], visits = [], visitDate = today();
let signupName = "";

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
const doctorName = (v) => v.doctorName
  || (v.doctorId === me.uid ? me.name : ((me.doctors || {})[v.doctorId] || {}).name) || "—";
// Doctors the current user can book for in the ACTIVE clinic
const doctorsOfMe = () => {
  if (me.role === "doctor") return [{ id: me.uid, name: me.name }];
  const m = me.doctors || {};
  return (me.doctorIds || [])
    .filter((id) => m[id] && (m[id].clinicIds || []).includes(activeClinicId))
    .map((id) => ({ id, name: m[id].name }));
};

/* ---------- login / registration ---------- */
let mode = "signin";
function setLoginMsg(text, ok = false) {
  const el = $("#loginErr"); el.textContent = text; el.classList.toggle("ok", ok);
}
function authMessage(e) {
  switch (e.code) {
    case "auth/email-already-in-use": return "This email is already registered. Use Sign in.";
    case "auth/weak-password": return "Password must be at least 6 characters.";
    case "auth/invalid-email": return "Invalid email address.";
    case "auth/unauthorized-domain": return "This website domain is not authorized in Firebase (Authentication > Settings > Authorized domains).";
    case "auth/operation-not-allowed": return "This sign-in method is not enabled in Firebase.";
    case "auth/too-many-requests": return "Too many attempts. Try again later.";
    default: return "Invalid email or password.";
  }
}
document.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => {
  mode = b.dataset.mode;
  document.querySelectorAll("[data-mode]").forEach((x) => x.classList.toggle("on", x === b));
  const su = mode === "signup";
  $("#nameRow").hidden = !su; $("#signupHint").hidden = !su; $("#forgotRow").hidden = su;
  $("#nameRow input").required = su;
  $("#loginSubmit").textContent = su ? "Create account" : "Sign in";
  $("#loginForm").elements.password.autocomplete = su ? "new-password" : "current-password";
  setLoginMsg("");
}));
$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  setLoginMsg("");
  try {
    if (mode === "signup") {
      signupName = (fd.name || "").trim();
      if (!signupName) { setLoginMsg("Enter your full name."); return; }
      await createUserWithEmailAndPassword(auth, fd.email.trim(), fd.password);
    } else {
      await signInWithEmailAndPassword(auth, fd.email.trim(), fd.password);
    }
  } catch (err) { signupName = ""; setLoginMsg(authMessage(err)); }
});
$("#googleBtn").addEventListener("click", async () => {
  setLoginMsg("");
  try { await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch (err) {
    if (err.code === "auth/popup-closed-by-user" || err.code === "auth/cancelled-popup-request") return;
    setLoginMsg(authMessage(err));
  }
});
$("#forgotBtn").addEventListener("click", async () => {
  const email = $("#loginForm").elements.email.value.trim();
  if (!email) { setLoginMsg("Enter your email above, then press Forgot password."); return; }
  const sent = "If this email is registered, a password reset link has been sent. Check your inbox and spam folder.";
  try {
    await sendPasswordResetEmail(auth, email);
    setLoginMsg(sent, true);
  } catch (err) {
    // do not reveal whether the email exists
    if (err.code === "auth/user-not-found") setLoginMsg(sent, true);
    else if (err.code === "auth/invalid-email") setLoginMsg("Invalid email address.");
    else if (err.code === "auth/too-many-requests") setLoginMsg("Too many attempts. Try again later.");
    else setLoginMsg("Could not send the reset email. Try again.");
  }
});
$("#logout").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  closeModal();
  if (!user) {
    me = null; clinicList = []; activeClinicId = null; currentTab = null;
    clinics = []; users = []; patients = []; visits = [];
    $("#app").hidden = true; $("#login").hidden = false; view.innerHTML = "";
    try { history.replaceState(null, "", location.pathname + location.search); } catch { /* ignore */ }
    return;
  }
  try {
    const ref = doc(db, "users", user.uid);
    const snap = await getDoc(ref);

    // First time we see this account (email sign-up or Google): create a PENDING profile.
    if (!snap.exists()) {
      await setDoc(ref, {
        name: (signupName || user.displayName || user.email).trim(),
        email: user.email, role: "pending", active: false, clinicIds: [], doctorIds: [],
        provider: (user.providerData[0] && user.providerData[0].providerId) || "password",
        createdAt: serverTimestamp(),
      });
      signupName = "";
      setLoginMsg("Registration received. You can sign in after the administrator approves your account.", true);
      await signOut(auth); return;
    }

    const d = snap.data();
    if (d.role === "pending") {
      setLoginMsg("Your account is waiting for administrator approval.", true);
      await signOut(auth); return;
    }
    if (d.active !== true) {
      setLoginMsg("Your account is disabled. Contact the administrator.");
      await signOut(auth); return;
    }

    me = { uid: user.uid, ...d };
    clinicList = [];
    if (me.role !== "admin") {
      const snaps = await Promise.all(clinicIdsOf(me).map((id) => getDoc(doc(db, "clinics", id))));
      clinicList = snaps.filter((s) => s.exists() && s.data().active !== false).map((s) => ({ id: s.id, ...s.data() }));
      if (!clinicList.length) {
        setLoginMsg("No active clinic is assigned to your account. Contact the administrator.");
        await signOut(auth); return;
      }
      let saved = null;
      try { saved = localStorage.getItem("activeClinic"); } catch { /* storage unavailable */ }
      activeClinicId = clinicList.some((c) => c.id === saved) ? saved : clinicList[0].id;
    }
    setLoginMsg("");
    showApp();
  } catch (e) {
    console.error(e);
    setLoginMsg("Could not load your profile.");
    await signOut(auth);
  }
});

function renderClinicBox() {
  const box = $("#clinicBox");
  if (me.role === "admin") { box.innerHTML = ""; return; }
  box.innerHTML = clinicList.length > 1
    ? `<select id="clinicSel" aria-label="Clinic">${clinicList.map((c) =>
        `<option value="${esc(c.id)}" ${c.id === activeClinicId ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>`
    : `<span>${esc(clinicList[0].name)}</span>`;
}
function showApp() {
  $("#login").hidden = true; $("#app").hidden = false;
  $("#who").textContent = `${me.name} · ${ROLE_LABEL[me.role]}`;
  renderClinicBox();
  const tabs = me.role === "admin"
    ? [["clinics", "Clinics"], ["users", "Users"]]
    : [["visits", "Visits"], ["patients", "Patients"]];
  $("#tabs").innerHTML = tabs.map(([k, l]) => `<button data-act="tab" data-tab="${k}">${l}</button>`).join("");
  // reopen the tab that was open before a refresh (kept in the URL hash, e.g. #patients)
  const wanted = location.hash.slice(1);
  go(tabs.some(([k]) => k === wanted) ? wanted : tabs[0][0]);
  if (me.role === "admin") run(refreshPendingBadge);
}
async function refreshPendingBadge() {
  const s = await getDocs(query(collection(db, "users"), where("role", "==", "pending")));
  const b = document.querySelector('#tabs [data-tab="users"]');
  if (b) b.textContent = "Users" + (s.size ? ` (${s.size} pending)` : "");
}
async function go(tab) {
  currentTab = tab;
  try { history.replaceState(null, "", "#" + tab); } catch { /* ignore */ }
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
const providerLabel = (p) => (p === "google.com" ? "Google" : "Email / password");
const whenOf = (u) => (u.createdAt && u.createdAt.toDate ? u.createdAt.toDate().toLocaleString() : "");

async function renderUsers() {
  const [cs, us] = await Promise.all([getDocs(collection(db, "clinics")), getDocs(collection(db, "users"))]);
  clinics = cs.docs.map((d) => ({ id: d.id, ...d.data() }));
  users = us.docs.map((d) => ({ id: d.id, ...d.data() }));
  const clinicNames = (u) => clinicIdsOf(u).map((id) => (clinics.find((c) => c.id === id) || {}).name || "?").join(", ") || "—";
  const pending = users.filter((u) => u.role === "pending");
  const others = users.filter((u) => u.role !== "pending");
  const badge = document.querySelector('#tabs [data-tab="users"]');
  if (badge) badge.textContent = "Users" + (pending.length ? ` (${pending.length} pending)` : "");

  view.innerHTML = `
    ${pending.length ? `
    <div class="bar"><h2>Pending approvals (${pending.length})</h2></div>
    <table style="margin-bottom:28px"><thead><tr><th>Name</th><th>Email</th><th>Signed up with</th><th>Requested</th><th></th></tr></thead><tbody>
    ${pending.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(providerLabel(u.provider))}</td>
      <td>${esc(whenOf(u))}</td>
      <td class="row"><button class="sm" data-act="approve-user" data-id="${esc(u.id)}">Approve…</button>
      <button class="sm ghost" data-act="reject-user" data-id="${esc(u.id)}">Reject</button></td></tr>`).join("")}
    </tbody></table>` : ""}
    <div class="bar"><h2>Users</h2><button data-act="new-user">+ New User</button></div>
    <table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Clinics</th><th>Status</th><th></th></tr></thead><tbody>
    ${others.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(ROLE_LABEL[u.role] || u.role)}</td>
      <td>${esc(clinicNames(u))}</td><td>${u.active ? "Active" : "Inactive"}</td>
      <td class="row"><button class="sm ghost" data-act="edit-user" data-id="${esc(u.id)}">Edit</button>
      <button class="sm ghost" data-act="reset-pw" data-email="${esc(u.email)}">Reset password</button></td></tr>`).join("")
      || '<tr><td colspan="6" class="muted">No users.</td></tr>'}
    </tbody></table>`;
}
// Doctors that work in at least one of the selected clinics
function doctorBox(clinicIds, selected = []) {
  const docs = users.filter((u) => u.role === "doctor" && u.active !== false
    && clinicIdsOf(u).some((c) => clinicIds.includes(c)));
  if (!clinicIds.length) return '<span class="muted">Select a clinic first.</span>';
  if (!docs.length) return '<span class="muted">No doctors in the selected clinics yet. Approve a doctor first.</span>';
  return docs.map((d) => `<label class="chk"><input type="checkbox" name="doctorIds" value="${esc(d.id)}"
    ${selected.includes(d.id) ? "checked" : ""}> ${esc(d.name)}</label>`).join("");
}
// Shared role / clinics / assigned-doctors fields (new user, approve, edit)
function accessFields(u = {}) {
  const roles = [["doctor", "Doctor"], ["assistant", "Doctor Assistant"], ["admin", "Admin"]];
  const role = roles.some(([k]) => k === u.role) ? u.role : "doctor";
  const sel = clinicIdsOf(u);
  return `
    <label>Role<select name="role">${roles.map(([k, l]) => `<option value="${k}" ${role === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    <div id="clinicWrap" ${role === "admin" ? "hidden" : ""}><label>Clinics (can select more than one)</label>
      <div class="docs">${clinics.filter((c) => c.active !== false || sel.includes(c.id))
        .map((c) => `<label class="chk"><input type="checkbox" name="clinicIds" value="${esc(c.id)}" ${sel.includes(c.id) ? "checked" : ""}> ${esc(c.name)}</label>`).join("")
        || '<span class="muted">No clinics yet. Create a clinic first.</span>'}</div></div>
    <div id="docWrap" ${role === "assistant" ? "" : "hidden"}><label>Assigned doctors</label>
      <div class="docs" id="docBox">${role === "assistant" ? doctorBox(sel, u.doctorIds || []) : ""}</div></div>`;
}
function readAccess(f) {
  const fd = new FormData(f);
  const role = fd.get("role");
  const clinicIds = role === "admin" ? [] : fd.getAll("clinicIds");
  if (role !== "admin" && !clinicIds.length) throw new Error("Select at least one clinic.");
  const doctorIds = role === "assistant" ? fd.getAll("doctorIds") : [];
  // Snapshot of the assigned doctors (name + clinics) stored on the assistant,
  // so assistants never need to read other users' profiles.
  const doctors = {};
  doctorIds.forEach((id) => {
    const d = users.find((u) => u.id === id);
    if (d) doctors[id] = { name: d.name, clinicIds: clinicIdsOf(d) };
  });
  return { role, clinicIds, doctorIds, doctors };
}
// When a doctor's name / clinics change, refresh the copy held by his assistants
async function syncAssistants(doctorId, name, clinicIds) {
  const list = users.filter((u) => u.role === "assistant" && (u.doctorIds || []).includes(doctorId));
  await Promise.all(list.map((a) => updateDoc(doc(db, "users", a.id), { [`doctors.${doctorId}`]: { name, clinicIds } })));
}
function newUserForm() {
  modal(`<h3>New User</h3>
    <form data-form="new-user">
      <label>Full name<input name="name" required></label>
      <label>Email<input type="email" name="email" required></label>
      <label>Initial password (min 6)<input type="text" name="password" minlength="6" required autocomplete="off"></label>
      ${accessFields()}
      <div class="row"><button type="button" class="ghost" data-act="close">Cancel</button><button>Create</button></div>
    </form>`);
}
function approveForm(u) {
  modal(`<h3>Approve registration</h3>
    <p class="muted">${esc(u.email)} · ${esc(providerLabel(u.provider))}</p>
    <form data-form="approve-user" data-id="${esc(u.id)}">
      <label>Full name<input name="name" required value="${esc(u.name)}"></label>
      ${accessFields(u)}
      <div class="row"><button type="button" class="ghost" data-act="close">Cancel</button><button>Approve</button></div>
    </form>`);
}
function editUserForm(u) {
  modal(`<h3>Edit User</h3>
    <form data-form="edit-user" data-id="${esc(u.id)}">
      <p class="muted">${esc(u.email)}</p>
      <label>Full name<input name="name" required value="${esc(u.name)}"></label>
      ${accessFields(u)}
      <label class="chk"><input type="checkbox" name="active" ${u.active ? "checked" : ""}> Active</label>
      <div class="row"><button type="button" class="ghost" data-act="close">Cancel</button><button>Save</button></div>
    </form>`);
}
function getSecondaryAuth() {   // lets the admin create accounts without being signed out
  if (!secondary) secondary = initializeApp(firebaseConfig, "secondary");
  return getAuth(secondary);
}

/* ---------- CLINICAL RECORD (doctor only) ---------- */
// One record per patient per doctor, shown in every visit of that patient.
async function loadClinical(patientId) {
  const s = await getDoc(doc(db, "patientClinical", `${patientId}_${me.uid}`));
  return s.exists() ? s.data() : {};
}
function clinicalFormHtml(patientId, rec = {}, withClose = false, visit = null) {
  return `<form data-form="clinical" data-id="${esc(patientId)}" data-visit="${esc(visit ? visit.id : "")}" class="private">
    <h4>🔒 Clinical record</h4>
    <p class="muted" style="margin:0 0 8px">Visible only to you. Shown in every visit of this patient.</p>
    ${CLIN_FIELDS.map(([k, l]) => `<label>${l}<textarea name="${k}" style="min-height:72px" autocomplete="off">${esc(rec[k])}</textarea></label>`).join("")}
    ${visit ? `<label>Notes (this visit only)<textarea name="note" style="min-height:110px" autocomplete="off">${esc(visit.note)}</textarea></label>` : ""}
    <div class="row">${withClose ? '<button type="button" class="ghost" data-act="close">Close</button>' : ""}<button>Save clinical record</button></div>
  </form>`;
}
async function openClinical(patientId) {
  const p = patients.find((x) => x.id === patientId) || {};
  const rec = await loadClinical(patientId);
  modal(`<h3>${esc(p.fullName)}</h3>` + clinicalFormHtml(patientId, rec, true));
}

/* ---------- PATIENTS (per clinic) ---------- */
async function loadPatients() {
  const snap = await getDocs(query(collection(db, "patients"), where("clinicId", "==", activeClinicId)));
  patients = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.fullName || "").localeCompare(b.fullName || ""));
}
// Takes the next file number of the active clinic (atomic) and lets the caller write it
// in the same transaction: write(tx, fileNo)
async function issueFileNo(write) {
  const cref = doc(db, "counters", activeClinicId);
  let base = 0;
  if (!(await getDoc(cref)).exists()) {
    // first number ever issued in this clinic: continue after the highest numeric file number already used
    await loadPatients();
    base = patients.reduce((m, p) => (/^\d+$/.test(p.fileNo || "") ? Math.max(m, parseInt(p.fileNo, 10)) : m), 0);
  }
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(cref);
    const n = (snap.exists() ? snap.data().patients : base) + 1;
    const no = String(n).padStart(5, "0");
    tx.set(cref, { clinicId: activeClinicId, patients: n });
    write(tx, no);
    return no;
  });
}
async function renderPatients() {
  await loadPatients();
  const missing = patients.filter((p) => !p.fileNo).length;
  view.innerHTML = `
    <div class="bar"><h2>Patients</h2>
      <div class="row"><input id="ptSearch" placeholder="Search name / file no / phone" style="width:260px">
      ${missing ? `<button class="ghost" data-act="assign-all">Assign missing file numbers (${missing})</button>` : ""}
      <button data-act="new-patient">+ New Patient</button></div></div>
    <div id="ptList"></div>`;
  paintPatients("");
}
function paintPatients(q) {
  q = q.trim().toLowerCase();
  const list = patients.filter((p) => !q || [p.fullName, p.fileNo, p.phone].join(" ").toLowerCase().includes(q));
  $("#ptList").innerHTML = `<table><thead><tr><th>File #</th><th>Name</th><th>Phone</th><th>Birth date</th><th>Gender</th><th></th></tr></thead><tbody>
    ${list.map((p) => `<tr><td>${p.fileNo ? esc(p.fileNo) : `<button class="sm ghost" data-act="assign-no" data-id="${esc(p.id)}">Assign #</button>`}</td><td>${esc(p.fullName)}</td><td>${esc(p.phone)}</td>
      <td>${esc(p.birthDate)}</td><td>${esc(p.gender)}</td>
      <td class="row"><button class="sm ghost" data-act="edit-patient" data-id="${esc(p.id)}">Edit</button>
      ${me.role === "doctor" ? `<button class="sm" data-act="clinical" data-id="${esc(p.id)}">Clinical</button>` : ""}</td></tr>`).join("")
      || '<tr><td colspan="6" class="muted">No patients found.</td></tr>'}</tbody></table>`;
}
function patientForm(p = {}) {
  modal(`<h3>${p.id ? "Edit" : "New"} Patient</h3>
    <form data-form="patient" data-id="${esc(p.id || "")}">
      ${p.id
        ? `<label>File number<input value="${esc(p.fileNo)}" readonly disabled></label>`
        : '<p class="muted" style="margin:0 0 10px">The file number is generated automatically when you save.</p>'}
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
  const ids = doctorsOfMe().map((d) => d.id);
  if (!ids.length) { $("#vList").innerHTML = '<p class="muted">No doctors are assigned to your account for this clinic.</p>'; return; }
  // each query is pinned to clinic + one doctor + date, so the security rules can verify it
  const snaps = await Promise.all(ids.map((id) => getDocs(query(collection(db, "visits"),
    where("clinicId", "==", activeClinicId), where("doctorId", "==", id), where("visitDate", "==", visitDate)))));
  visits = snaps.flatMap((s) => s.docs.map((d) => ({ id: d.id, ...d.data() })))
    .sort((a, b) => (a.visitTime || "").localeCompare(b.visitTime || ""));
  $("#vList").innerHTML = `<table><thead><tr><th>Time</th><th>Patient</th><th>Doctor</th><th>Type</th><th>Status</th><th></th></tr></thead><tbody>
    ${visits.map((v) => `<tr><td>${esc(v.visitTime)}</td><td>${esc(v.patientName)}</td><td>${esc(doctorName(v))}</td>
      <td>${esc(v.visitType)}</td><td><span class="badge st-${esc(v.status)}">${esc(STATUSES[v.status] || v.status)}</span></td>
      <td><button class="sm" data-act="open-visit" data-id="${esc(v.id)}">Open</button></td></tr>`).join("")
      || '<tr><td colspan="6" class="muted">No visits on this date.</td></tr>'}</tbody></table>`;
}
async function newVisitForm() {
  if (!patients.length) await loadPatients();
  const docs = doctorsOfMe();
  if (!docs.length) throw new Error("No doctor is assigned to you for this clinic.");
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
  let note = "", rec = {};
  if (me.role === "doctor") {   // only the owning doctor can read these
    const [n, r] = await Promise.all([getDoc(doc(db, "doctorNotes", v.id)), loadClinical(v.patientId)]);
    note = n.exists() ? n.data().text || "" : "";
    rec = r;
  }
  modal(`<h3>${esc(v.patientName)}</h3>
    <p class="muted">Doctor: ${esc(doctorName(v))}</p>
    <form data-form="visit" data-id="${esc(v.id)}">
      <div class="row"><label style="flex:1">Date<input type="date" name="visitDate" value="${esc(v.visitDate)}" required></label>
      <label style="flex:1">Time<input type="time" name="visitTime" value="${esc(v.visitTime)}" required></label></div>
      <label>Visit type<select name="visitType">${VISIT_TYPES.map((t) => `<option ${v.visitType === t ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      <label>Reason for visit<input name="reason" value="${esc(v.reason)}" maxlength="500"></label>
      <label>Status<select name="status">${Object.entries(STATUSES).map(([k, l]) => `<option value="${k}" ${v.status === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <div class="row"><button type="button" class="ghost" data-act="close">Close</button><button>Save visit</button></div>
    </form>
    ${me.role === "doctor" ? clinicalFormHtml(v.patientId, rec, false, { id: v.id, note }) : ""}`);
}

/* ---------- click / change / input delegation ---------- */
const actions = {
  tab: (d) => go(d.tab),
  close: () => closeModal(),
  "new-clinic": () => clinicForm(),
  "edit-clinic": (d) => clinicForm(clinics.find((c) => c.id === d.id)),
  "new-user": () => newUserForm(),
  "edit-user": (d) => editUserForm(users.find((u) => u.id === d.id)),
  "approve-user": (d) => approveForm(users.find((u) => u.id === d.id)),
  "reject-user": async (d) => {
    if (!confirm("Reject this registration?")) return;
    await updateDoc(doc(db, "users", d.id), { role: "rejected", active: false });
    toast("Registration rejected."); await renderUsers();
  },
  "reset-pw": async (d) => { await sendPasswordResetEmail(auth, d.email); toast("Password reset email sent."); },
  "new-patient": () => patientForm(),
  "edit-patient": (d) => patientForm(patients.find((p) => p.id === d.id)),
  clinical: (d) => openClinical(d.id),
  "assign-no": async (d) => {
    const p = patients.find((x) => x.id === d.id);
    if (!p || p.fileNo) return;
    const no = await issueFileNo((tx, n) => tx.update(doc(db, "patients", p.id), { fileNo: n }));
    toast(`File number ${no} assigned.`); await renderPatients();
  },
  "assign-all": async () => {
    // oldest registrations get the lowest numbers
    const todo = patients.filter((p) => !p.fileNo)
      .sort((a, b) => ((a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0)
                     - (b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0)));
    for (const p of todo) await issueFileNo((tx, n) => tx.update(doc(db, "patients", p.id), { fileNo: n }));
    toast(`${todo.length} file number(s) assigned.`); await renderPatients();
  },
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
  if (e.target.id === "clinicSel") {
    activeClinicId = e.target.value;
    try { localStorage.setItem("activeClinic", activeClinicId); } catch { /* storage unavailable */ }
    patients = []; visits = [];
    closeModal(); run(() => go(currentTab));
  }
  // admin user forms: keep clinic / doctor checkboxes in sync with the chosen role
  const f = e.target.closest("form");
  if (f && f.querySelector("#docBox") && (e.target.name === "role" || e.target.name === "clinicIds")) {
    const role = f.elements.role.value;
    const cids = [...f.querySelectorAll('input[name="clinicIds"]:checked')].map((i) => i.value);
    const sel = [...f.querySelectorAll('input[name="doctorIds"]:checked')].map((i) => i.value);
    $("#clinicWrap").hidden = role === "admin";
    $("#docWrap").hidden = role !== "assistant";
    $("#docBox").innerHTML = role === "assistant" ? doctorBox(cids, sel) : "";
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
    const access = readAccess(f);
    const email = fd.get("email").trim();
    const sAuth = getSecondaryAuth();
    const cred = await createUserWithEmailAndPassword(sAuth, email, fd.get("password"));
    await signOut(sAuth);
    await setDoc(doc(db, "users", cred.user.uid), {
      name: fd.get("name").trim(), email, ...access, active: true, provider: "password",
      createdAt: serverTimestamp(), approvedBy: me.uid,
    });
    closeModal(); toast("User created."); await renderUsers();
  },
  async "approve-user"(f, id) {
    const access = readAccess(f);
    const name = new FormData(f).get("name").trim();
    await updateDoc(doc(db, "users", id), {
      name, ...access, clinicId: deleteField(), active: true,
      approvedBy: me.uid, approvedAt: serverTimestamp(),
    });
    closeModal(); toast("User approved."); await renderUsers();
  },
  async "edit-user"(f, id) {
    const fd = new FormData(f);
    const access = readAccess(f);
    const active = fd.get("active") === "on";
    const name = fd.get("name").trim();
    if (id === me.uid && (access.role !== "admin" || !active))
      throw new Error("You cannot remove your own admin access.");
    await updateDoc(doc(db, "users", id), { name, ...access, clinicId: deleteField(), active });
    if (access.role === "doctor") await syncAssistants(id, name, access.clinicIds);
    closeModal(); toast("Saved."); await renderUsers();
  },
  async patient(f, id) {
    const fd = Object.fromEntries(new FormData(f));
    const data = { fullName: fd.fullName.trim(), phone: fd.phone.trim(),
                   birthDate: fd.birthDate, gender: fd.gender };
    if (id) {
      await updateDoc(doc(db, "patients", id), data);   // file number never changes
    } else {
      // Sequential file number per clinic, taken atomically from counters/{clinicId}
      const pref = doc(collection(db, "patients"));
      const fileNo = await issueFileNo((tx, no) =>
        tx.set(pref, { ...data, fileNo: no, clinicId: activeClinicId, createdBy: me.uid, createdAt: serverTimestamp() }));
      toast(`Saved. File number ${fileNo}.`);
      closeModal(); await renderPatients(); return;
    }
    closeModal(); toast("Saved."); await renderPatients();
  },
  async "new-visit"(f) {
    const fd = Object.fromEntries(new FormData(f));
    const p = patients.find((x) => x.id === fd.patientId);
    if (!p) throw new Error("Select a patient.");
    const d = doctorsOfMe().find((x) => x.id === fd.doctorId);
    if (!d) throw new Error("Select a doctor.");
    await addDoc(collection(db, "visits"), {
      clinicId: activeClinicId, patientId: p.id, patientName: p.fullName,
      doctorId: d.id, doctorName: d.name,
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
  async clinical(f, patientId) {
    const fd = Object.fromEntries(new FormData(f));
    const jobs = [setDoc(doc(db, "patientClinical", `${patientId}_${me.uid}`), {
      patientId, doctorId: me.uid, clinicId: activeClinicId,
      complaint: fd.complaint, diagnosis: fd.diagnosis, treatment: fd.treatment, plan: fd.plan,
      updatedAt: serverTimestamp(),
    })];
    // inside a visit, the same Save button also stores that visit's notes
    const visitId = f.dataset.visit;
    if (visitId) jobs.push(setDoc(doc(db, "doctorNotes", visitId), {
      visitId, doctorId: me.uid, clinicId: activeClinicId, text: fd.note || "", updatedAt: serverTimestamp(),
    }));
    await Promise.all(jobs);
    toast("Clinical record saved.");
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

/* ---------- installable app (PWA) ---------- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
