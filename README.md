# Clinic Visits (Psychiatric Clinic)

Static web app (GitHub Pages) + Firebase Auth + Firestore.
Structure: **Clinic → Doctor → Doctor Assistant**, plus an **Admin** role for setup.

## Roles

| Role | Can do |
|---|---|
| Admin | Create clinics and users, assign assistants to doctors. No access to patients, visits or notes. |
| Doctor | See own visits, patients of the clinic, change visit status, write **private notes** (only he can read them). |
| Assistant | Register patients, book/reschedule visits, check-in, change status — only for the doctors assigned to him. **No access to notes.** |

## Firestore collections

- `clinics/{id}`: name, address, phone, active
- `users/{uid}`: name, email, role (`admin|doctor|assistant`), clinicId, doctorIds[] (assistants), active
- `patients/{id}`: clinicId, fileNo, fullName, phone, birthDate, gender
- `visits/{id}`: clinicId, patientId, patientName, doctorId, visitDate, visitTime, visitType, reason, status
- `doctorNotes/{visitId}`: visitId, doctorId, clinicId, text — **separate collection, locked to the owning doctor by rules**

## Setup

1. **Firebase Console** → create a project → add a **Web app** → copy the config into `firebase-config.js`.
2. **Authentication** → Sign-in method → enable **Email/Password**.
3. **Firestore Database** → create database (production mode) → **Rules** tab → paste `firestore.rules` → Publish.
4. **First admin** (one time, done manually because rules block self-registration):
   - Authentication → Users → *Add user* (email + password). Copy the **User UID**.
   - Firestore → start collection `users` → document ID = that UID → fields:
     `name` (string), `email` (string), `role` = `admin` (string), `active` = `true` (boolean), `doctorIds` = empty array, `clinicId` = null.
5. Push these files to a GitHub repo → Settings → Pages → deploy from branch (root).
6. Firebase Console → Authentication → Settings → **Authorized domains** → add `<username>.github.io`.
7. Sign in as admin → create a Clinic → create Users (doctors first, then assistants and assign them to doctors).

## Security notes (read before using real patient data)

- Private notes are enforced in **Firestore rules**, not just hidden in the UI. Assistants and admins get `permission-denied` even from the browser console.
- The Firebase project owner / anyone with console or Admin SDK access can still read all data. If that is not acceptable, encrypt the note text client-side (e.g. WebCrypto with a doctor-held passphrase) — the trade-off is that a lost passphrase means lost notes.
- `firebaseConfig` is public by design; security comes from the rules. Do not loosen them.
- Records are never deleted (rules block delete); use *Cancelled* status and *Inactive* users/clinics.
- Test rules in Firebase Console → Rules Playground (e.g. read `doctorNotes/{id}` as an assistant → must be denied).
- Psychiatric data is highly sensitive: use strong passwords, consider enabling MFA, and check local data-protection law (Egypt PDPL 151/2020) with your legal team.
- Creating a user from the admin page creates the Auth account first, then the `users` profile. If the second step fails (e.g. rules), delete the orphan from Authentication → Users and retry.
