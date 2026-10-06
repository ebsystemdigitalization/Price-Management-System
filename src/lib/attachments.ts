import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";

/**
 * Which attachment to resolve, and on what basis the server should authorize it.
 *
 * "order" — an attachment on a persisted order. The server applies the same
 *   scope predicate as getOrder (canAccessOrder), minus viewers.
 * "draft" — an attachment the caller uploaded that is not yet on any order.
 *   The server authorizes on path ownership alone.
 */
export type AttachmentRef =
  | { mode: "order"; orderId: string; attachmentId: string }
  | { mode: "draft"; path: string };

/**
 * Resolve a short-lived signed URL through the authorizing callable and open it.
 *
 * Replaces reading a persisted getDownloadURL token off the order document
 * (FIND-01). Nothing in the client calls getDownloadURL any more — doing so
 * would mint a fresh permanent token on the object and silently undo the
 * token revocation this change depends on.
 */
export async function openAttachment(ref: AttachmentRef): Promise<void> {
  // The tab has to be opened synchronously inside the click handler. Browsers
  // suppress window.open once an await has yielded, so resolving the URL first
  // and opening afterwards would be blocked as an unsolicited popup.
  const win = window.open("", "_blank");
  if (win) win.opener = null;
  try {
    const getAttachmentUrlFn = httpsCallable(functions, "getAttachmentUrl");
    const result = await getAttachmentUrlFn(ref);
    const { url } = result.data as { url: string; expiresInMs: number };
    if (!win) {
      throw new Error("Allow pop-ups for this site to open attachments.");
    }
    win.location.replace(url);
  } catch (err) {
    win?.close();
    throw err;
  }
}
