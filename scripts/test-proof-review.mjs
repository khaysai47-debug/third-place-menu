// Staff payment-proof REVIEW UI check (no framework — run with
// `npm run test:proof-review`). The repo has no DOM test runner, so this splits
// the job the way the codebase already does elsewhere:
//
//   1. COMPILE + EXERCISE the real decision logic (src/components/staff/
//      proofReview.ts) — which reason string reaches the API, when Confirm may
//      be pressed, history order, which controls a proof state may show.
//   2. ASSERT THE WIRING in OrderDetailDrawer.tsx source — that the resolved
//      reason (never the raw input) is what is handed to onReviewProof, that
//      review buttons are gated behind the pending state, that the waiting
//      message exists, and that no storage path or permanent URL is rendered.
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const outDir = "node_modules/.cache/proof-review-test";
execSync(
  `npx tsc src/components/staff/proofReview.ts src/components/staff/slipPreview.ts --outDir ${outDir}` +
    " --module nodenext --moduleResolution nodenext --target es2022" +
    " --lib es2022,dom --skipLibCheck",
  { stdio: "inherit" },
);
writeFileSync(path.join(outDir, "package.json"), '{"type":"module"}\n');

const {
  PROOF_REJECT_REASONS,
  OTHER_REASON,
  resolveRejectionReason,
  canSubmitRejection,
  needsCustomReason,
  newestProofsFirst,
  proofReviewControls,
} = await import(pathToFileURL(path.resolve(outDir, "proofReview.js")).href);

const {
  openPreview,
  markPreviewLoaded,
  markPreviewFailed,
  retryPreview,
  isDismissKey,
  drawerHandlesDismiss,
  previewHandlesDismiss,
} = await import(pathToFileURL(path.resolve(outDir, "slipPreview.js")).href);

/* ── A. The preset vocabulary is exactly what the API stores ─────────────── */

assert.deepEqual(
  PROOF_REJECT_REASONS.map((r) => r.reason),
  [
    "Wrong amount",
    "Unclear image",
    "Wrong slip",
    "Duplicate slip",
    "Payment not received",
    "Other",
  ],
  "preset rejection reasons (stored English values)",
);
assert.deepEqual(
  PROOF_REJECT_REASONS.map((r) => r.zh),
  ["金額錯誤", "圖片不清", "收據錯誤", "重複收據", "未收到付款", "其他"],
  "preset rejection reasons (Chinese labels)",
);
assert.equal(OTHER_REASON, "Other", "the free-text preset is 'Other'");
assert.equal(PROOF_REJECT_REASONS.at(-1).reason, OTHER_REASON, "'Other' is last");

/* ── B. Selecting a preset sends that preset verbatim ────────────────────── */

for (const { reason } of PROOF_REJECT_REASONS) {
  if (reason === OTHER_REASON) continue;
  assert.equal(resolveRejectionReason(reason, ""), reason, `${reason} sent verbatim`);
  assert.equal(canSubmitRejection(reason, ""), true, `${reason} is submittable with no text`);
  assert.equal(needsCustomReason(reason), false, `${reason} shows no free-text field`);
  // Stray text typed before switching presets must not ride along.
  assert.equal(
    resolveRejectionReason(reason, "leftover typing"),
    reason,
    `${reason} ignores custom text`,
  );
}

/* ── C. Nothing selected → nothing submittable ───────────────────────────── */

assert.equal(resolveRejectionReason("", ""), null, "no preset → no reason");
assert.equal(canSubmitRejection("", ""), false, "Confirm disabled with no selection");
assert.equal(canSubmitRejection("", "typed text"), false, "text alone is not a selection");

/* ── D. "Other" REQUIRES custom text ─────────────────────────────────────── */

assert.equal(needsCustomReason(OTHER_REASON), true, "'Other' reveals the free-text field");
assert.equal(resolveRejectionReason(OTHER_REASON, ""), null, "'Other' with no text → null");
assert.equal(canSubmitRejection(OTHER_REASON, ""), false, "Confirm disabled: 'Other', empty");
assert.equal(canSubmitRejection(OTHER_REASON, "   "), false, "Confirm disabled: whitespace only");
assert.equal(
  resolveRejectionReason(OTHER_REASON, "  Slip is from another shop  "),
  "Slip is from another shop",
  "'Other' sends the TRIMMED custom text",
);
assert.equal(canSubmitRejection(OTHER_REASON, "x"), true, "Confirm enabled once text exists");
// The literal word "Other" is never what gets stored.
assert.notEqual(
  resolveRejectionReason(OTHER_REASON, "amount is 50 short"),
  OTHER_REASON,
  "'Other' itself is never stored as the reason",
);

/* ── E. Which controls each proof state may show ─────────────────────────── */

const PENDING = {
  hasPaymentProof: true,
  paymentProofId: "cccccccc-dddd-eeee-ffff-000000000000",
  paymentProofStatus: "pending",
  paymentStatus: "unpaid",
};

let controls = proofReviewControls(PENDING);
assert.equal(controls.canReview, true, "pending proof: Approve/Reject shown");
assert.equal(controls.awaitingNewSlip, false, "pending proof: no waiting message");

controls = proofReviewControls({ ...PENDING, paymentProofStatus: "rejected" });
assert.equal(controls.canReview, false, "REJECTED proof: no review buttons");
assert.equal(controls.awaitingNewSlip, true, "rejected + unpaid: waiting message shown");

controls = proofReviewControls({
  ...PENDING,
  paymentProofStatus: "approved",
  paymentStatus: "paid",
});
assert.equal(controls.canReview, false, "approved proof: no review buttons");
assert.equal(controls.awaitingNewSlip, false, "approved proof: no waiting message");

// Rejected but the order got paid another way (Cash at the counter): nothing
// is pending on the customer any more.
controls = proofReviewControls({
  ...PENDING,
  paymentProofStatus: "rejected",
  paymentStatus: "paid",
});
assert.equal(controls.awaitingNewSlip, false, "rejected + already paid: no waiting message");

// No proof at all, and a pending proof whose id never arrived.
assert.equal(proofReviewControls({}).canReview, false, "no proof: no review buttons");
assert.equal(proofReviewControls({}).awaitingNewSlip, false, "no proof: no waiting message");
assert.equal(
  proofReviewControls({ ...PENDING, paymentProofId: undefined }).canReview,
  false,
  "pending proof without an id cannot be reviewed",
);

/* ── F. History stays newest-first, and keeps every attempt ──────────────── */

// The API returns oldest → newest.
const apiOrder = [
  { id: "p1", status: "rejected" },
  { id: "p2", status: "rejected" },
  { id: "p3", status: "pending" },
];
const shown = newestProofsFirst(apiOrder);
assert.deepEqual(
  shown.map((p) => p.id),
  ["p3", "p2", "p1"],
  "latest attempt first",
);
assert.equal(shown.length, apiOrder.length, "no attempt is dropped");
assert.equal(shown[0].status, "pending", "the newest pending proof leads");
assert.ok(
  shown.slice(1).every((p) => p.status === "rejected"),
  "earlier REJECTED attempts stay visible under a new pending one",
);
assert.deepEqual(
  apiOrder.map((p) => p.id),
  ["p1", "p2", "p3"],
  "the source array is not mutated",
);
assert.deepEqual(newestProofsFirst([]), [], "empty history is fine");

/* ── G. Drawer wiring (source-level — no DOM runner in this repo) ─────────── */

const drawer = readFileSync("src/components/staff/OrderDetailDrawer.tsx", "utf8");

// The RESOLVED reason is what reaches the callback — never the raw input box.
assert.ok(
  drawer.includes("resolveRejectionReason(rejectPreset, rejectCustom)"),
  "the reason is resolved through proofReview.ts before submitting",
);
assert.ok(
  drawer.includes('onReviewProof(order.orderId, order.paymentProofId!, "reject", reason)'),
  "the resolved reason string is passed to the existing review callback",
);
assert.ok(
  drawer.includes("disabled={!canSubmitRejection(rejectPreset, rejectCustom) || reviewing}"),
  "Confirm Reject is disabled until the selection is complete (and while reviewing)",
);
assert.ok(
  drawer.includes("{needsCustomReason(rejectPreset) && ("),
  "the free-text input renders only for 'Other'",
);
assert.ok(drawer.includes("PROOF_REJECT_REASONS.map"), "the preset buttons come from the list");
assert.ok(drawer.includes("aria-pressed={active}"), "the selected preset exposes an active state");

// Approve/Reject are gated behind the pending state; the API shape is unchanged.
assert.ok(
  drawer.includes("const { canReview: proofPending, awaitingNewSlip } = proofReviewControls(order)"),
  "the drawer derives its controls from proofReviewControls",
);
assert.ok(
  drawer.includes('onReviewProof(order.orderId, order.paymentProofId!, "approve")'),
  "Approve still calls the existing callback with no reason",
);
assert.ok(
  drawer.includes("{awaitingNewSlip && ("),
  "the waiting-for-customer block is gated on awaitingNewSlip",
);
assert.ok(drawer.includes("等待顧客重新傳送收據"), "Chinese waiting message present");
assert.ok(
  drawer.includes("Waiting for customer to send another slip"),
  "English waiting message present",
);

// Touch targets: presets ≥ 44px, action buttons 48px, View slip 44px.
assert.ok(drawer.includes("min-h-11"), "preset buttons are at least 44px tall");
assert.ok(drawer.includes("inline-flex h-11 shrink-0 items-center"), "View slip is a 44px button");
assert.ok(drawer.includes("h-12 flex-1 rounded-xl"), "review actions are 48px tall");

// The signed preview opens IN-DASHBOARD (see the modal section below) — the
// drawer must not navigate or spawn a tab.
assert.ok(drawer.includes("aria-haspopup=\"dialog\""), "View slip opens a dialog, not a tab");

/* ── H. No storage path or permanent URL can be rendered ─────────────────── */

for (const forbidden of ["proof_file_path", "storage/v1", "PAYMENT_PROOFS_BUCKET", "/object/sign/"]) {
  assert.ok(!drawer.includes(forbidden), `drawer never references ${forbidden}`);
}
// The ONLY url the drawer renders is the per-request signed one from the API.
const urlRefs = drawer.match(/p\.[a-z_]*url/gi) ?? [];
assert.ok(
  urlRefs.every((ref) => ref === "p.proof_url"),
  `only the signed proof_url is rendered (found: ${[...new Set(urlRefs)].join(", ")})`,
);
// Legacy rows (no private object) get an explicit unavailable state instead.
assert.ok(
  drawer.includes("Legacy proof preview unavailable"),
  "legacy proofs show an unavailable state rather than a permanent link",
);

const client = readFileSync("src/lib/data/staffReadClient.ts", "utf8");
assert.ok(!client.includes("proof_file_path"), "the client type carries no storage path");

/* ══════════════════════════════════════════════════════════════════════════
   SLIP PREVIEW MODAL
   ══════════════════════════════════════════════════════════════════════════ */

const SIGNED_URL =
  "https://project.supabase.co/storage/v1/object/sign/payment-proofs/o/x.jpg?token=SIGNED";

/* ── I. Opening: any proof WITH a signed url is previewable ──────────────── */

for (const status of ["pending", "rejected", "approved"]) {
  const state = openPreview({ proof_url: SIGNED_URL, status });
  assert.ok(state, `${status} slip can be previewed`);
  assert.equal(state.url, SIGNED_URL, `${status}: the signed url is the image source`);
  assert.equal(state.status, status, `${status}: status carried into the modal header`);
  assert.equal(state.phase, "loading", `${status}: opens in the loading state`);
  assert.equal(state.attempt, 0, `${status}: first attempt`);
}

// Nothing to open for a legacy proof with no private object.
assert.equal(
  openPreview({ proof_url: null, status: "approved" }),
  null,
  "a proof with no signed url opens no modal",
);

/* ── J. Load / failure / retry cycle ─────────────────────────────────────── */

const opened = openPreview({ proof_url: SIGNED_URL, status: "pending" });
assert.equal(markPreviewLoaded(opened).phase, "ready", "onLoad → ready");
const failed = markPreviewFailed(opened);
assert.equal(failed.phase, "error", "onError → error state");
const retried = retryPreview(failed);
assert.equal(retried.phase, "loading", "retry returns to loading");
assert.equal(retried.attempt, 1, "retry bumps the attempt so the image remounts");
// The signed url must survive a retry byte-for-byte — appending a cache-buster
// would invalidate the signature and turn a retry into a guaranteed 403.
assert.equal(retried.url, SIGNED_URL, "retry never rewrites the signed url");
assert.equal(retryPreview(retried).attempt, 2, "attempts keep incrementing");
assert.equal(opened.phase, "loading", "transitions do not mutate the previous state");

/* ── K. Escape routing between the stacked layers ────────────────────────── */

assert.equal(isDismissKey("Escape"), true, "Escape is the dismiss key");
for (const key of ["Enter", "Esc", "a", " "]) {
  assert.equal(isDismissKey(key), false, `${key} does not dismiss`);
  assert.equal(drawerHandlesDismiss(key, false), false, `${key} never closes the drawer`);
  assert.equal(previewHandlesDismiss(key, true), false, `${key} never closes the preview`);
}
// Preview open → Escape belongs to the preview ONLY; the drawer stays.
assert.equal(previewHandlesDismiss("Escape", true), true, "Escape closes the open preview");
assert.equal(
  drawerHandlesDismiss("Escape", true),
  false,
  "Escape does NOT close the drawer while the preview is open",
);
// Preview closed → Escape closes the drawer, as before.
assert.equal(drawerHandlesDismiss("Escape", false), true, "Escape closes the drawer on its own");
assert.equal(previewHandlesDismiss("Escape", false), false, "no preview, nothing to dismiss");

/* ── L. The trigger opens a modal — no navigation, no new tab ────────────── */

assert.ok(
  drawer.includes("setPreview(openPreview(p))"),
  "View slip opens the in-dashboard preview",
);
assert.ok(
  !drawer.includes('target="_blank"'),
  "the drawer no longer opens the slip in a new tab",
);
assert.ok(!drawer.includes("<a href={p.proof_url}"), "View slip is not a navigation link");
assert.ok(/<button\s+type="button"/.test(drawer), "View slip is a button, not an anchor");
assert.ok(drawer.includes('aria-haspopup="dialog"'), "the trigger announces it opens a dialog");
assert.ok(
  drawer.includes("{preview && (") && drawer.includes("<PaymentSlipPreview"),
  "the drawer renders the preview only when one is open",
);
// The drawer's own Escape handler stands down while the preview is up.
assert.ok(
  drawer.includes("drawerHandlesDismiss(e.key, preview !== null)"),
  "the drawer defers Escape to the preview",
);
// Focus returns to the button that opened it.
assert.ok(
  drawer.includes("previewTriggerRef.current = e.currentTarget"),
  "the originating trigger is remembered",
);
assert.ok(
  drawer.includes("previewTriggerRef.current?.focus()"),
  "focus is restored to the originating View slip button on close",
);
// The preview is rendered INSIDE the drawer tree, so the drawer cannot unmount
// while it is open.
assert.ok(
  drawer.indexOf("<PaymentSlipPreview") > drawer.indexOf("取消訂單 · Cancel Order"),
  "the preview is nested in the drawer (drawer stays mounted underneath)",
);

/* ── M. The modal itself ─────────────────────────────────────────────────── */

const modal = readFileSync("src/components/staff/PaymentSlipPreview.tsx", "utf8");

// Dialog semantics.
assert.ok(modal.includes('role="dialog"'), "role=dialog");
assert.ok(modal.includes('aria-modal="true"'), "aria-modal=true");
assert.ok(modal.includes('aria-labelledby="slip-preview-title"'), "labelled by its title");
assert.ok(modal.includes('id="slip-preview-title"'), "the title carries that id");
assert.ok(modal.includes("Payment slip · 付款收據"), "modal title text");
assert.ok(modal.includes("closeRef.current?.focus()"), "focus moves into the dialog on open");

// Status is shown for every history state.
for (const status of ["pending", "approved", "rejected"]) {
  assert.ok(modal.includes(`${status}:`), `modal labels the ${status} status`);
}

// Three ways out, none of which touch the drawer.
assert.ok(modal.includes('data-testid="slip-preview-backdrop"'), "the backdrop is identifiable");
assert.ok(
  /data-testid="slip-preview-backdrop"\s*\n\s*onClick=\{onClose\}/.test(modal),
  "clicking the backdrop closes the preview",
);
assert.ok(
  modal.includes("previewHandlesDismiss(e.key, true)"),
  "Escape closes the preview via the shared rule",
);
assert.ok(
  modal.includes('aria-label="Close payment slip preview"'),
  "the close button is labelled",
);
assert.ok(modal.includes("h-11 w-11 shrink-0"), "the close button is a 44px touch target");

// Background scrolling is locked, and the PREVIOUS value restored.
assert.ok(
  modal.includes('document.body.style.overflow = "hidden"'),
  "background scrolling is prevented while open",
);
assert.ok(
  modal.includes("document.body.style.overflow = previous"),
  "the previous overflow value is restored on close",
);

// Image display: contained, centred, never cropped, no horizontal overflow.
assert.ok(modal.includes("src={state.url}"), "the modal renders the signed proof_url");
assert.ok(modal.includes("object-contain"), "object-fit: contain (never crops)");
assert.ok(modal.includes("h-auto max-w-full"), "aspect ratio preserved, no horizontal overflow");
assert.ok(modal.includes("mx-auto"), "the image is centred");
assert.ok(
  modal.includes("overflow-x-hidden overflow-y-auto"),
  "the image area scrolls vertically only",
);
assert.ok(modal.includes("key={state.attempt}"), "a retry remounts the image");

// Responsive panel — a panel on tablet, never a full-screen takeover.
assert.ok(modal.includes("w-[90vw]"), "small screens ~90vw");
assert.ok(modal.includes("max-h-[78vh]"), "small screens ~78vh");
assert.ok(modal.includes("sm:w-[min(60vw,520px)]"), "tablet/desktop min(60vw, 520px)");
assert.ok(modal.includes("sm:max-h-[68vh]"), "tablet/desktop max-height 68vh");

// Loading + failure + retry states.
assert.ok(modal.includes('state.phase === "loading"'), "loading state while the image loads");
assert.ok(modal.includes('state.phase === "error"'), "image-load failure state");
assert.ok(modal.includes("onError={() => onChange(markPreviewFailed(state))}"), "failures are caught");
assert.ok(modal.includes("onLoad={() => onChange(markPreviewLoaded(state))}"), "loads are caught");
assert.ok(modal.includes("重試 · Retry"), "a retry action is offered");

// The OPTIONAL full-size escape hatch is the only new-tab affordance, and it is
// rel-protected.
const fullSize = modal.slice(modal.indexOf("原圖 · Open full size") - 600);
assert.ok(fullSize.includes('target="_blank"'), "Open full size may use a new tab");
assert.ok(fullSize.includes('rel="noopener noreferrer"'), "Open full size is rel-protected");
assert.equal(
  (modal.match(/target="_blank"/g) ?? []).length,
  1,
  "exactly ONE new-tab affordance exists (the optional full-size action)",
);

/* ── N. No storage path, bucket name, or permanent URL is constructed ────── */

for (const forbidden of [
  "proof_file_path",
  "PAYMENT_PROOFS_BUCKET",
  "payment-proofs",
  "/storage/v1",
  "/object/sign/",
  "supabase",
]) {
  assert.ok(!modal.includes(forbidden), `the modal never references ${forbidden}`);
}
const preview = readFileSync("src/components/staff/slipPreview.ts", "utf8");
for (const forbidden of ["proof_file_path", "payment-proofs", "/storage/v1", "http"]) {
  assert.ok(!preview.includes(forbidden), `the preview state module never references ${forbidden}`);
}
// The image src is passed through from the API, never assembled.
assert.ok(
  !/src=\{[^}]*\+/.test(modal) && !/src=\{`/.test(modal),
  "the image src is used verbatim — never concatenated or templated",
);

console.log("test-proof-review: all assertions passed");
