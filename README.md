# Clinic Visits (Psychiatric Clinic)

Static web app (GitHub Pages) + Firebase Auth + Firestore.
Structure: **Clinic → Doctor → Doctor Assistant**, plus an **Admin** role for setup.

## How accounts work

1. A user opens the site and either **Continue with Google** or **Create account** (name + email + password).
2. The account is created as **Pending** (no access at all). The user sees "waiting for administrator approval".
3. The Admin opens **Users → Pending approvals → Approve…**, picks **Role**, **Clinic** and (for assistants) the **doctors** he works with. The user can sign in immediately after.
4. The Admin can later change role / clinic / doctors, disable a user (Edit → untick Active), or reject a registration.
5. Admin can still create a user directly (**+ New User**) with an initial password.

| Role | Can do |
|---|---|
| Admin | Approve users, manage clinics and users. No access to patients, visits or notes. |
| Doctor | See own visits, patients of the clinic, change visit status, write **private notes** (only he can read them). |
| Assistant | Register patients, book/reschedule visits, check-in, change status — only for the doctors assigned to him. **No access to notes.** |

## Firestore collections

- `clinics/{id}`: name, address, phone, active
- `users/{uid}`: name, email, role (`pending|rejected|admin|doctor|assistant`), clinicId, doctorIds[], active, provider
- `patients/{id}`: clinicId, fileNo, fullName, phone, birthDate, gender
- `visits/{id}`: clinicId, patientId, patientName, doctorId, visitDate, visitTime, visitType, reason, status
- `doctorNotes/{visitId}`: visitId, doctorId, clinicId, text — **separate collection, locked to the owning doctor by rules**

## Setup

1. **Firebase Console** → create a project → add a **Web app** → copy the config into `firebase-config.js`.
2. **Authentication → Sign-in method**:
   - enable **Email/Password**;
   - **Add new provider → Google → Enable** → choose a *Project support email* → Save.
3. **Firestore Database** → create database (production mode) → **Rules** tab → paste `firestore.rules` → Publish.
4. **First admin** (one time). Easiest way:
   - Open the site and sign in with Google (or create an account). You will see "waiting for approval" — this created your `users/{uid}` document.
   - Firestore → `users` → open your document → edit: `role` = `admin`, `active` = `true` → Update.
   - Sign in again.
5. Push these files to a GitHub repo → Settings → Pages → deploy from branch (root).
6. Firebase Console → Authentication → Settings → **Authorized domains** → add `<username>.github.io` (needed for Google sign-in too).
7. Sign in as admin → create a Clinic → approve registrations (approve doctors before assistants, so assistants can be linked to them).

## Security notes (read before using real patient data)

- A self-registered account can only create its own profile as `pending / inactive / no clinic` (enforced by rules). Nobody can grant himself a role.
- Approve only people you know. Email/password sign-ups are not email-verified; Google sign-ups are.
- Private notes are enforced in **Firestore rules**, not just hidden in the UI. Assistants and admins get `permission-denied` even from the browser console.
- The Firebase project owner / anyone with console or Admin SDK access can still read all data. If that is not acceptable, encrypt the note text client-side (e.g. WebCrypto with a doctor-held passphrase) — a lost passphrase means lost notes.
- `firebaseConfig` is public by design; security comes from the rules. Do not loosen them.
- Records are never deleted (rules block delete); use *Cancelled* status and *Inactive* users/clinics.
- Test rules in Firebase Console → Rules Playground (e.g. read `doctorNotes/{id}` as an assistant → must be denied).
- Psychiatric data is highly sensitive: use strong passwords, consider MFA, and check local data-protection law (Egypt PDPL 151/2020) with your legal team.
- If "+ New User" fails midway, an orphan account may exist in Authentication → Users; delete it and retry.
