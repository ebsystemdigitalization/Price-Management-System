// revoke-attachment-tokens.js
//
// One-off remediation for FIND-01. Every attachment uploaded before that fix
// had a `getDownloadURL` token minted on it, and those URLs were persisted on
// order documents and rendered to every reader. A Firebase Storage download
// token bypasses storage.rules entirely, so any link that ever leaked remains
// valid indefinitely — removing the token is the only way to invalidate it.
//
// Firebase stores the token in the object's custom metadata under
// `firebaseStorageDownloadTokens`. Clearing that key invalidates every
// previously-issued download URL for the object. This is the same mechanism
// the Firebase console's per-file token revocation uses.
//
// ⚠ CAVEAT: `firebaseStorageDownloadTokens` is an implementation detail of the
// Firebase Storage layer over GCS rather than a formally documented, stability-
// guaranteed API. It is widely relied upon and is what the console manipulates,
// but verify against a single object before running the bulk pass.
//
// ⚠ ORDERING: run this only AFTER the client that no longer calls
// getDownloadURL has been deployed. Running it earlier breaks every attachment
// link in the running app, and any surviving getDownloadURL call would simply
// mint a fresh token and undo this.
//
// Dry-run by default — pass --apply to write. (Default-safe, per FIND-25.)
//
// Usage:
//   node revoke-attachment-tokens.js            # report only
//   node revoke-attachment-tokens.js --apply    # actually revoke

const admin = require("firebase-admin");
const { getStorage } = require("firebase-admin/storage");

admin.initializeApp();

const PREFIX = "draft-attachments/";
const APPLY = process.argv.includes("--apply");

async function main() {
  const bucket = getStorage().bucket();
  console.log(`${APPLY ? "" : "[dry-run] "}Scanning gs://${bucket.name}/${PREFIX}`);

  const [files] = await bucket.getFiles({ prefix: PREFIX });
  let withToken = 0;
  let revoked = 0;

  for (const file of files) {
    const [meta] = await file.getMetadata();
    if (!meta?.metadata?.firebaseStorageDownloadTokens) continue;
    withToken++;

    if (!APPLY) {
      console.log(`[dry-run] would revoke token on ${file.name}`);
      continue;
    }

    // Setting the key to null removes it, which invalidates every download URL
    // previously issued for this object.
    await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: null } });
    revoked++;
    console.log(`Revoked token on ${file.name}`);
  }

  console.log(
    `${APPLY ? "" : "[dry-run] "}Done. ${files.length} object(s) scanned, ` +
      `${withToken} carried a token, ${APPLY ? `${revoked} revoked` : "0 revoked (dry run)"}.`
  );
  if (!APPLY && withToken > 0) {
    console.log("Re-run with --apply to revoke.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
