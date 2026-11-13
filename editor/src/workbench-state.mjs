import { assertDocument } from "../shared/model.mjs";
/** Recovery compares against the draft version that was actually edited, never a newer tab's copy. */
export function restoreLocalRecovery(record, recovery, baseline) {
  if (
    !recovery ||
    JSON.stringify(recovery.document) === JSON.stringify(record.document)
  )
    return null;
  if (!Number.isSafeInteger(recovery.revision) || recovery.revision < 0)
    throw new Error("Invalid recovery revision");
  assertDocument(recovery.document, { baseline });
  assertDocument(recovery.base, { baseline });
  const conflict = record.revision !== recovery.revision ? record : null;
  return {
    document: recovery.document,
    saved: conflict ? recovery.base : record.document,
    conflict,
  };
}
