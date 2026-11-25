# Clinic Visits (Psychiatric Clinic)

Static web app (GitHub Pages) + Firebase Auth + Firestore, installable on a phone (PWA).
Structure: **Clinic → Doctor → Doctor Assistant**, plus an **Admin** role for setup.

## Accounts

1. A user opens the site and uses **Continue with Google** or **Create account**.
2. The account is created as **Pending** (no access). The Admin opens **Users → Pending approvals → Approve…** and picks the **Role**, the **Clinics** (one or more) and, for an assistant, the **doctors** he works with.
3. The Admin can later change role / clinics / doctors, disable a user, or reject a registration.
4. Users can reset their own password from **Forgot password?** on the login page.

## Roles

| Role | Can do |
|---|---|
| Admin | Approve users, manage clinics and users (a doctor / assistant can belong to several clinics). No access to patients, visits or any clinical data. |
| Doctor | Works in one or more clinics (switch from the clinic selector in the header). Sees own visits and the patients of the selected clinic. Writes the **clinical record** and **private notes** (only he can read them). |
| Assistant | Same clinic selector. Registers patients, books visits, check-in, changes status — only for the assigned doctors. **No access to clinical data or notes.** |

## Clinics and patients

- Every patient belongs to **one clinic**. When a user has several clinics, the clinic selector in the header decides which clinic's patients and visits are shown and where new patients / visits are created.
- A person who attends two clinics is two separate patient records (one per clinic).

## Doctor-only clinical data

- **Clinical record**: Complaint, Diagnosis, Treatment, Treatment plan. One record per patient **per doctor**, shown inside **every visit** of that patient (and from **Patients → Clinical**). Editing it in any visit updates it for all that patient's visits.
- **Notes (this visit only)**: a field inside the same Clinical record box, stored per visit (`doctorNotes`). One Save button saves both.
- Both are enforced by **Firestore rules**: assistants and admins get `permission-denied` even from the browser console. Another doctor treating the same patient has his own separate record and cannot see yours.

## Firestore collections

- `clinics/{id}`: name, address, phone, active
- `users/{uid}`: name, email, role (`pending|rejected|admin|doctor|assistant`), `clinicIds[]`, `doctorIds[]`, `doctors{}` (copy of the assigned doctors' name + clinics, kept by the admin screens), active, provider
- `patients/{id}`: clinicId, fileNo, fullName, phone, birthDate, gender
- `visits/{id}`: clinicId, patientId, patientName, doctorId, doctorName, visitDate, visitTime, visitType, reason, status
- `doctorNotes/{visitId}`: private note of one visit (owning doctor only)
- `patientClinical/{patientId}_{doctorId}`: complaint, diagnosis, treatment, plan (that doctor only)

## Upgrading from the previous version (single clinic per user)

1. Replace `app.js`, `index.html` and publish the new `firestore.rules` **at the same time**.
2. Old accounts still work (their single `clinicId` is read as one clinic). To finish the migration, sign in as admin → **Users** → open every doctor and assistant → **Edit → Save**. Do **doctors first, then assistants**: saving an assistant stores the copy of his doctors' names and clinics that the assistant screens need. Until an assistant is re-saved he will see "No doctors are assigned for this clinic".
3. Old visits without `doctorName` still display correctly.

## Setup (new project)

1. **Firebase Console** → create a project → add a **Web app** → copy the config into `firebase-config.js`.
2. **Authentication → Sign-in method**: enable **Email/Password** and **Google**.
3. **Firestore Database** → create database (production mode) → **Rules** → paste `firestore.rules` → Publish.
4. **First admin**: open the site, sign in with Google (you will see "waiting for approval"; this creates your `users/{uid}` document). In Firestore → `users` → your document → set `role` = `admin`, `active` = `true` → sign in again.
5. Push the files to a GitHub repo (including the `icons/` folder) → Settings → Pages → deploy from branch (root).
6. Firebase → Authentication → Settings → **Authorized domains** → add `<username>.github.io`.
7. As admin: create the clinics → approve doctors → approve assistants.

## Install on a phone

- **Android (Chrome):** ⋮ menu → **Install app**.
- **iPhone (Safari):** Share → **Add to Home Screen**.

## Security notes (read before using real patient data)

- A self-registered account can only create its own profile as `pending / inactive / no clinic`. Nobody can grant himself a role.
- Staff cannot read other users' profiles; doctors' names are copied into visits and into the assistant's own profile.
- Anyone with Firebase console / Admin SDK access (the project owner) can still read all data. If that is not acceptable, encrypt the clinical text client-side (a lost passphrase means lost data).
- `firebaseConfig` is public by design; security comes from the rules. Do not loosen them.
- Records are never deleted (rules block delete); use *Cancelled* status and *Inactive* users / clinics.
- Psychiatric data is highly sensitive: strong passwords, MFA if possible, and check local data-protection law (Egypt PDPL 151/2020) with your legal team.
