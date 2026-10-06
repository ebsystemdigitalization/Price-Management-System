// migrate-head-of-commercial.js
const admin = require("firebase-admin");
// Modular import: the namespaced admin.firestore() accepts no database
// argument, so pinning (default) explicitly requires getFirestore().
const { getFirestore } = require("firebase-admin/firestore");

admin.initializeApp();

// Database pinned explicitly rather than relying on the implicit default —
// same reason as functions/src/index.ts and src/firebase.ts. See FIND-17.
// REQUIRES firebase-admin v12+ for the databaseId parameter; verified v13.10.0
// in the build environment. No lockfile enforces this floor — see FIND-11.
const db = getFirestore("(default)");

const OLD_VALUES = ["Head of Enterprise Sales Planning", "Head ES & BP"];
const NEW_VALUE = "Head of Commercial";

async function migrate() {
  const snapshot = await db.collection("orders").get();
  let updatedCount = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    let changed = false;

    // Update authorityLevel on each service in the array
    const services = (data.services || []).map((s) => {
      if (OLD_VALUES.includes(s.authorityLevel)) {
        changed = true;
        return { ...s, authorityLevel: NEW_VALUE };
      }
      return s;
    });

    // Update finalDecisionMaker if it matches
    const updates = { services };
    if (OLD_VALUES.includes(data.finalDecisionMaker)) {
      updates.finalDecisionMaker = NEW_VALUE;
      changed = true;
    }

    if (changed) {
      await doc.ref.update(updates);
      updatedCount++;
      console.log(`Updated order ${doc.id} (${data.orderNumber})`);
    }
  }

  console.log(`Done. Updated ${updatedCount} order(s).`);
}

migrate().catch(console.error);