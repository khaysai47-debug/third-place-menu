// CUSTOMER + MESSENGER HANDOVER CONTRACT CERTIFICATION (no test framework —
// run with `npm run test:customer-handover`).
//
// Three modules already exist and each has its own suite:
//   - api/_lib/metaMessengerWebhook.server.ts receives and sanitizes events;
//   - api/_lib/orderDetails.server.ts answers the authoritative order;
//   - api/_lib/chatMessaging.server.ts validates and claims one send.
// NOTHING spanned them. This does. It walks the whole customer path with the
// REAL handlers and asserts:
//   - the welcome visibly offers Place an Order, Menu, Location and Opening
//     Time in ONE provider-valid message — quick replies, because a button
//     template caps at three and that limit is NOT raised;
//   - every welcome payload is on the webhook's closed allowlist, so a tap
//     comes back as a routable `action` and the two modules cannot drift;
//   - a submitted order produces a confirmation and the EXACT authoritative
//     total in THB, composed only from /api/automation/order-details — the
//     customer re-enters nothing;
//   - the payment QR follows that total as its own image message, using the
//     configured PAYMENT_QR_URL VERBATIM, and no image is invented when none
//     is configured;
//   - the order and its chat are resolved through the bot-session mapping
//     bound to the authoritative order id — never by recency, and an ambiguous
//     mapping fails closed;
//   - a payment-slip image routes to proof handling and CANNOT reach the
//     welcome branch, because action / attachment / plain text are disjoint;
//   - a retried event sends nothing twice and claims no second row;
//   - the browse-mode menu mounts NO ordering control until the customer taps
//     Order Now, which leaves browse mode in the one shared screen rather than
//     opening a second menu;
//   - Location and Opening Hours are read by EXECUTING the frozen workflow
//     artifact's Code node against real webhook output, then sending what it
//     returns through the real endpoint — the destination, the hours and the
//     provider validity are observed, not restated.
//
// SCOPE — repository handlers plus the immutable n8n proposal contracts. It
// proves the three modules fit each other, and it runs the corrected workflow
// node in-process against stubbed n8n accessors. It does not reach, update or
// publish n8n; external Class B changes still require approval.
//
// THE QR FIXTURE. The user-approved temporary test QR is an EXTERNAL file and
// stays external. Its bytes are read only to calculate the recorded SHA-256;
// it is never decoded, rendered, copied, committed or logged, and nothing here
// transcribes a payment identifier. The verified digest is bound to the
// no-network image URL exercised after the authoritative total. The real
// restaurant-approved QR replacing the fixture remains a handover blocker.
//
// No network, no real secrets, no Supabase, no n8n, no Meta, no customer
// message: every fetch target that is not one of the six stubs throws.
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const outDir = "node_modules/.cache/customer-handover-test";
execSync(
  "npx tsc api/_lib/metaMessengerWebhook.server.ts api/_lib/orderDetails.server.ts" +
    " api/_lib/chatMessaging.server.ts" +
    ` --outDir ${outDir}` +
    " --module nodenext --moduleResolution nodenext --target es2022" +
    " --lib es2022,dom --skipLibCheck",
  { stdio: "inherit" },
);
writeFileSync(path.join(outDir, "package.json"), '{"type":"module"}\n');

const load = (file) => import(pathToFileURL(path.resolve(outDir, file)).href);
const webhook = await load("metaMessengerWebhook.server.js");
const { postOrderDetails } = await load("orderDetails.server.js");
const { handleSendChatMessage, metaProvider, __test: chat } = await load("chatMessaging.server.js");

/* ── Customer UI contracts that do not require creating an order ───────── */

const checkoutSource = readFileSync("src/components/menu/CheckoutSheet.tsx", "utf8");
const menuSource = readFileSync("src/components/menu/MenuScreen.tsx", "utf8");
const menuRouteSource = readFileSync("src/routes/index.tsx", "utf8");

assert.match(
  checkoutSource,
  /if \(result\.success\)[\s\S]*?setIsSubmitting\(false\);/,
  "a successful order releases the submitting guard before confirmation can close",
);
assert.ok(
  checkoutSource.includes("const close = useCallback(() => onOpenChange(false)"),
  "the sheet has one canonical close transition",
);
assert.ok(
  checkoutSource.includes("onClose={close}") && checkoutSource.includes("onClick={onClose}"),
  "the success-screen bottom Close uses the canonical close transition",
);
assert.ok(
  checkoutSource.includes("<Drawer.Close asChild>") &&
    checkoutSource.includes("disabled={submitting}"),
  "the top-right X uses the drawer close transition and only the active request can disable it",
);

/* iPhone Safari keyboard.

   The first attempt watched only `visualViewport.resize` and corrected once,
   on a single animation frame, with `scrollIntoView`. On a real device that
   failed three ways: moving between fields while the keyboard is already open
   fires no resize at all; one frame lands mid-animation; and at the bottom of
   the list there is no room left to scroll into. These are source contracts
   because the behaviour needs a physical iPhone to observe. */
assert.ok(
  checkoutSource.includes('container.addEventListener("focusin", schedule)'),
  "a focus change while the keyboard is already open still re-reveals the field",
);
assert.ok(
  checkoutSource.includes('viewport?.addEventListener("resize", schedule)') &&
    checkoutSource.includes('viewport?.addEventListener("scroll", schedule)'),
  "the keyboard opening, closing or moving the visual viewport also re-reveals",
);
assert.match(
  checkoutSource,
  /\[120, 280, 450\]\.map\(\(delay\) => window\.setTimeout\(reveal, delay\)\)/,
  "the correction is re-run across the iOS keyboard animation, not once on one frame",
);
assert.ok(
  checkoutSource.includes("viewport.height + viewport.offsetTop") &&
    !/\.scrollIntoView\(/.test(checkoutSource),
  "the field is measured against the visual viewport and this container is scrolled, " +
    "rather than asking every ancestor to scroll",
);
assert.ok(
  checkoutSource.includes("window.innerHeight - viewport.height - viewport.offsetTop") &&
    checkoutSource.includes("paddingBottom: keyboardInset + 24"),
  "the keyboard's height becomes real scroll room, so the last field can reach the top",
);
assert.match(
  checkoutSource,
  /if \(!\(field instanceof HTMLElement\) \|\| !container\.contains\(field\)\) return;/,
  "nothing moves unless a field inside this form is focused — desktop and tablet are untouched",
);
assert.match(
  checkoutSource,
  /if \(below > 0\) container\.scrollTop \+= below;\s*else if \(above > 0\) container\.scrollTop -= above;/,
  "an already-visible field is left exactly where it is",
);

assert.ok(
  menuRouteSource.includes('.get("browse") === "1"') &&
    menuRouteSource.includes("browseOnly={browseOnly}"),
  "the exact /?browse=1 URL enables browse-only mode without router coercion",
);

/* Browse mode is the ENTRY state and Order Now is the ONLY way out of it.
   These are source contracts because the assertion is about what the React
   tree does and does not MOUNT: a disabled control would still be a control. */

assert.ok(
  menuSource.includes("const [browsing, setBrowsing] = useState(browseOnly);"),
  "browse-only seeds a state the customer can leave, not a permanent mode",
);
// Ordering lives in the FALSE arm of `browsing ? … : …`, so on first render of
// a browse link there is no add control, no cart bar and no checkout sheet in
// the tree at all — nothing that could "accidentally become active".
const browseTernary = menuSource.slice(menuSource.lastIndexOf("{browsing ? ("));
const [browseArm, orderArm] = browseTernary.split("      ) : (");
assert.ok(orderArm, "the browse bar and the ordering tree are the two arms of one ternary");
for (const mounted of ["<CartTray", "<CheckoutSheet"]) {
  assert.ok(!browseArm.includes(mounted), `browse mode does not mount ${mounted}`);
  assert.ok(orderArm.includes(mounted), `leaving browse mode mounts ${mounted}`);
  assert.equal(
    menuSource.split(mounted).length - 1,
    1,
    `${mounted} is mounted in exactly one place — no parallel ordering path`,
  );
}
assert.ok(
  menuSource.includes("browseOnly={browsing}"),
  "the cards read the live browse state, so add controls appear with the cart",
);
assert.ok(browseArm.includes("Order Now"), "browse mode exposes a customer-facing Order Now");
assert.ok(
  browseArm.includes("onClick={() => setBrowsing(false)}"),
  "Order Now enters the existing ordering path by leaving browse mode in place",
);
// Exactly two mentions: the declaration and that one deliberate call. Nothing
// else in the screen — no effect, no URL, no availability refresh — can drop
// the customer into ordering without the tap.
assert.equal(
  menuSource.split("setBrowsing").length - 1,
  2,
  "only the Order Now tap leaves browse mode",
);

// ONE menu implementation. Both entry points render the same screen, and the
// item data has a single module behind it.
assert.ok(
  menuRouteSource.includes("<MenuScreen browseOnly={browseOnly} />"),
  "/ renders the shared screen",
);
assert.ok(
  readFileSync("src/routes/m.tsx", "utf8").includes("<MenuScreen session={{ token: token! }} />"),
  "/m renders that same shared screen",
);
const menuDataModules = execSync("git ls-files", { encoding: "utf8" })
  .trim()
  .split(/\r?\n/)
  .filter((file) => /\.tsx?$/.test(file) && /export const MENU\b/.test(readFileSync(file, "utf8")));
assert.deepEqual(
  menuDataModules,
  ["src/data/menu.ts"],
  "exactly one menu data module — browse and ordering cannot drift apart",
);

/* ── Production-safe identities. Nothing here names a real person. ───────── */

const CHAT_SECRET = "handover-chat-secret-not-a-real-one";
const N8N_SECRET = "handover-automation-secret-not-a-real-one";
const APP_SECRET = "handover-app-secret-not-a-real-one";
const PAGE_TOKEN = "EAAhandover-page-token-not-a-real-one";
const HOOK = "https://n8n.invalid/webhook/atlas-messenger-events-handover";

const ORDER_NUMBER = "TP-MS-000042";
const ORDER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const CHAT_ID = "24681357911131517";
const PAGE_ID = "987654321098765";

// The exact owner-approved temporary fixture stays outside the repository. The
// test reads its bytes only to calculate SHA-256: it never decodes, renders,
// transcribes, copies or logs the image or any payment identifier it contains.
// Missing or changed bytes are a hard failure, never a skipped assertion.
const APPROVED_QR_FIXTURE =
  process.env.ATLAS_APPROVED_QR_FIXTURE ??
  "C:\\Users\\User\\Downloads\\Codex Image Aug 26, 2026, 11_34_33 AM.png";
const APPROVED_QR_SHA256 = "080B3DAFC1661D04D96922CC4097ADAE487F5AE482FEDF4E314E1403491B0BBF";
assert.ok(existsSync(APPROVED_QR_FIXTURE), "approved temporary QR fixture must be available");
const approvedQrDigest = createHash("sha256")
  .update(readFileSync(APPROVED_QR_FIXTURE))
  .digest("hex")
  .toUpperCase();
assert.equal(approvedQrDigest, APPROVED_QR_SHA256, "approved temporary QR fixture digest");

// No real upload or send occurs. The no-network test URL is deterministically
// bound to the verified digest, so the total -> image sequence below proves it
// is describing this exact fixture rather than an unrelated placeholder.
const TEST_QR_URL = `https://qr.invalid/atlas-temporary-test-qr/${approvedQrDigest}.png`;

/* ── Immutable n8n UUID contract: deterministic IDs must still be UUIDv4 ─ */

const R3_WORKFLOW_ARTIFACT_DIR =
  process.env.ATLAS_R3_WORKFLOW_ARTIFACT_DIR ??
  "D:\\Projects\\third-place-menu-agent-state\\artifacts\\ATLAS-008-R3";
const messengerUuidArtifact = JSON.parse(
  readFileSync(
    path.join(R3_WORKFLOW_ARTIFACT_DIR, "messenger-receiver.uuidv4-fix.update.json"),
    "utf8",
  ),
);
const orderUuidArtifact = JSON.parse(
  readFileSync(
    path.join(R3_WORKFLOW_ARTIFACT_DIR, "order-receiver.uuidv4-fix.update.json"),
    "utf8",
  ),
);
const UUID_V4_CONTRACT = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function workflowUuidHelper(artifact, nodeName) {
  const operation = artifact.operations.find(
    (candidate) => candidate.type === "updateNodeParameters" && candidate.nodeName === nodeName,
  );
  assert.ok(operation, `corrected artifact contains ${nodeName}`);
  const code = operation.parameters?.jsCode;
  assert.equal(typeof code, "string", `${nodeName} carries JavaScript`);
  assert.match(code, /chars\[12\]\s*=\s*['"]4['"]/, `${nodeName} emits UUIDv4`);
  assert.doesNotMatch(code, /chars\[12\]\s*=\s*['"]5['"]/, `${nodeName} emits no UUIDv5 IDs`);
  const helperSource = code.match(/const uuidFrom = \(seed\) => \{[\s\S]*?\n\};/)?.[0];
  assert.ok(helperSource, `${nodeName} keeps the deterministic helper`);
  return new Function("require", `${helperSource}\nreturn uuidFrom;`)((moduleName) => {
    assert.equal(moduleName, "crypto");
    return { createHash };
  });
}

// The PENDING presentation revision for Location and Opening Hours. It is
// derived from the published node code above, so it must satisfy the same UUID
// contract; section B2 then EXECUTES it rather than restating what it says.
const presentationArtifact = JSON.parse(
  readFileSync(
    path.join(R3_WORKFLOW_ARTIFACT_DIR, "messenger-receiver.location-hours.update.json"),
    "utf8",
  ),
);

/* ── The order-mapping node, executed from its artifact ──────────────────────

   A live Messenger order reached order-details (200, items=1 qr=configured) and
   then nothing: no send-chat-message call and no n8n error. "Require
   Authoritative Order Mapping" returns [] on every rejection, so a dropped real
   order and a correctly ignored staff order looked identical — an invisible
   stop. It read `$json.data.order`, which only exists when the HTTP node
   answers as the bare body; with `fullResponse` on, the payload is under
   `.body`, and both shapes are already in use in this same workflow.

   This runs the EXACT jsCode that will be applied, against both shapes. */
const mappingArtifact = JSON.parse(
  readFileSync(
    path.join(R3_WORKFLOW_ARTIFACT_DIR, "order-receiver.order-mapping-shape.update.json"),
    "utf8",
  ),
);

function runMappingNode(response) {
  const operation = mappingArtifact.operations.find(
    (candidate) => candidate.nodeName === "Require Authoritative Order Mapping",
  );
  assert.ok(operation, "the artifact updates the mapping node");
  const logged = [];
  const run = new Function("$input", "console", `${operation.parameters.jsCode}`);
  return {
    items: run({ first: () => ({ json: response }) }, { log: (line) => logged.push(String(line)) }),
    logged,
  };
}

const AUTHORITATIVE_ORDER = {
  ok: true,
  data: {
    paymentQrUrl: "https://store.public.blob.vercel-storage.com/qr-Xk39fQ.jpg",
    order: {
      orderNumber: "TP-MS-20260828-162111",
      channel: "messenger",
      externalChatId: "9876543210",
      total: 185,
    },
  },
};

{
  const expected = {
    channel: "messenger",
    external_chat_id: "9876543210",
    order_number: "TP-MS-20260828-162111",
    total: 185,
    payment_qr_url: AUTHORITATIVE_ORDER.data.paymentQrUrl,
  };

  // The bare-body shape, which is what the node already handled.
  const bare = runMappingNode(AUTHORITATIVE_ORDER);
  assert.deepEqual(bare.items, [{ json: expected }], "a bare JSON body maps to the order");
  assert.deepEqual(bare.logged, [], "a good order logs no rejection");

  // The fullResponse shape, which is what silently stopped the customer flow.
  const wrapped = runMappingNode({
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: AUTHORITATIVE_ORDER,
  });
  assert.deepEqual(
    wrapped.items,
    [{ json: expected }],
    "a fullResponse envelope maps to exactly the same order",
  );

  // Supabase can hand a numeric back as a string; that is still authoritative.
  const asString = structuredClone(AUTHORITATIVE_ORDER);
  asString.data.order.total = "185.00";
  assert.equal(runMappingNode(asString).items[0].json.total, 185, "a numeric string is accepted");

  // Every rejection still drops the event — and now says which one it was.
  const rejections = [
    ["order-details returned no order object", (o) => delete o.data.order],
    ["orderNumber is missing", (o) => (o.data.order.orderNumber = "  ")],
    ["channel is missing", (o) => (o.data.order.channel = "")],
    ["externalChatId is missing", (o) => delete o.data.order.externalChatId],
    ["total is not an authoritative number", (o) => (o.data.order.total = "not-a-number")],
  ];
  for (const [reason, mutate] of rejections) {
    const broken = structuredClone(AUTHORITATIVE_ORDER);
    mutate(broken);
    const result = runMappingNode(broken);
    assert.deepEqual(result.items, [], `${reason} still drops the event`);
    assert.deepEqual(
      result.logged,
      [`ORDER_MAPPING dropped: ${reason}`],
      "a dropped event names its reason instead of vanishing",
    );
  }

  // A negative total is refused rather than messaged to a customer.
  const negative = structuredClone(AUTHORITATIVE_ORDER);
  negative.data.order.total = -1;
  assert.deepEqual(runMappingNode(negative).items, [], "a negative total is never authoritative");

  // The node composes no message and reaches nothing outside itself.
  const code = mappingArtifact.operations[0].parameters.jsCode;
  assert.ok(
    !/send-chat-message|fetch\(|\$http|helpers\.request/i.test(code),
    "the mapping node sends nothing",
  );
  assert.ok(!/order_id|created_at|limit=1|order=/.test(code), "no order is selected by recency");
}

const greetingUuid = workflowUuidHelper(messengerUuidArtifact, "Prepare Greeting Event");
const directUuid = workflowUuidHelper(messengerUuidArtifact, "Prepare Messenger Direct Response");
const presentationUuid = workflowUuidHelper(
  presentationArtifact,
  "Prepare Messenger Direct Response",
);
const orderMessageUuid = workflowUuidHelper(orderUuidArtifact, "Prepare Customer Messages");
const deterministicIdPaths = [
  [greetingUuid, "inbound:bot-session", "bot session"],
  [greetingUuid, "inbound:order-link", "order link"],
  [directUuid, "inbound:welcome", "welcome"],
  [directUuid, "inbound:menu", "menu response"],
  [directUuid, "inbound:location", "location response"],
  [directUuid, "inbound:opening-hours", "opening-time response"],
  [presentationUuid, "inbound:location", "revised location response"],
  [presentationUuid, "inbound:opening-hours", "revised opening-hours response"],
  [orderMessageUuid, "order-event:authoritative-total", "authoritative total"],
  [orderMessageUuid, "order-event:payment-qr", "QR message"],
];
for (const [uuidFrom, seed, label] of deterministicIdPaths) {
  const id = uuidFrom(seed);
  assert.match(id, UUID_V4_CONTRACT, `${label} ID satisfies UUID_V4_PATTERN`);
  assert.equal(uuidFrom(seed), id, `${label} ID remains deterministic`);
}
// Wording changed; the route seeds did not. The same inbound delivery still
// derives the same event ID, so the existing dedupe/retry protection carries
// across the revision instead of being reset by it.
for (const seed of ["inbound:location", "inbound:opening-hours", "inbound:menu"]) {
  assert.equal(
    presentationUuid(seed),
    directUuid(seed),
    `the revision does not move the deterministic ID for ${seed}`,
  );
}

const ORDER_EVENT_ID = "33333333-3333-4333-8333-333333333333";
const WELCOME_EVENT_ID = "11111111-1111-4111-8111-111111111111";
const TOTAL_EVENT_ID = "44444444-4444-4444-8444-444444444444";
const QR_EVENT_ID = "55555555-5555-4555-8555-555555555555";

process.env.CHAT_MESSAGING_SECRET = CHAT_SECRET;
process.env.N8N_AUTOMATION_SECRET = N8N_SECRET;
process.env.META_APP_SECRET = APP_SECRET;
process.env.META_PAGE_ACCESS_TOKEN = PAGE_TOKEN;
process.env.N8N_MESSENGER_EVENTS_WEBHOOK_URL = HOOK;
process.env.VITE_SUPABASE_URL = "https://supabase.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-not-a-real-key";
process.env.PAYMENT_QR_URL = TEST_QR_URL;

/* ── The authoritative rows. The totals below are the ONLY source of the
      figure a customer is ever shown. ─────────────────────────────────────── */

const ORDER_ROW = {
  id: ORDER_ID,
  order_number: ORDER_NUMBER,
  order_type: "pickup",
  status: "new",
  source: "messenger",
  table_number: null,
  customer_name: "Test Persona",
  customer_phone: "0800000000",
  customer_address: null,
  customer_note: null,
  subtotal: "420.00",
  delivery_fee: 0,
  total: 420,
  payment_method: null,
  payment_status: "unpaid",
  created_at: "2026-08-26T04:00:00.000+00:00",
};
const ITEM_ROWS = [
  { item_code: "S01", item_name: "Pork Skewer", quantity: 6, unit_price: 45, line_total: 270 },
  { item_code: "R02", item_name: "Fried Rice", quantity: 2, unit_price: 75, line_total: 150 },
];
const SESSION_ROW = { platform: "messenger", external_chat_id: CHAT_ID };

/* ── The stubbed world ───────────────────────────────────────────────────── */

/** The dispatch store, with the one property that matters: UNIQUE event_id. */
const dispatches = new Map();
/** Every Graph request the REAL Meta adapter made, in order. */
let graphCalls = [];
/** Every sanitized payload forwarded to the n8n hook, in order. */
let forwards = [];
/** Every Supabase URL read during the run. */
const supabaseCalls = [];

let sessionRows = [SESSION_ROW];
let messageIds = 0;

function eventIdFromUrl(url) {
  return decodeURIComponent(url.split("event_id=eq.")[1]?.split("&")[0] ?? "");
}

const conflict = () =>
  Response.json(
    {
      code: "23505",
      message: 'duplicate key value violates unique constraint "chat_message_dispatches_pkey"',
      details: "Key (event_id)=(...) already exists.",
    },
    { status: 409 },
  );

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const method = (init.method ?? "GET").toUpperCase();

  // 1. The REAL Meta adapter. Stubbed, recorded, and never a real socket.
  if (u.startsWith("https://graph.facebook.com/")) {
    graphCalls.push({ url: u, method, headers: init.headers, body: JSON.parse(init.body) });
    messageIds += 1;
    return Response.json({ message_id: `mid.handover${messageIds}` });
  }

  // 2. The dispatch store, with a real unique-key claim.
  if (u.includes("/rest/v1/chat_message_dispatches")) {
    if (method === "POST") {
      const row = JSON.parse(init.body);
      if (dispatches.has(row.event_id)) return conflict();
      dispatches.set(row.event_id, row);
      return new Response(null, { status: 201 });
    }
    if (method === "GET") {
      const row = dispatches.get(eventIdFromUrl(u));
      return Response.json(row ? [row] : []);
    }
    if (method === "PATCH") {
      const id = eventIdFromUrl(u);
      dispatches.set(id, { ...dispatches.get(id), ...JSON.parse(init.body) });
      return new Response(null, { status: 204 });
    }
  }

  // 3. The authoritative reads.
  if (u.includes("/rest/v1/orders?")) {
    supabaseCalls.push(u);
    return Response.json([ORDER_ROW]);
  }
  if (u.includes("/rest/v1/order_items?")) {
    supabaseCalls.push(u);
    return Response.json(ITEM_ROWS);
  }
  if (u.includes("/rest/v1/bot_sessions?")) {
    supabaseCalls.push(u);
    return Response.json(sessionRows);
  }

  // 4. The n8n messenger hook — captured, never really called.
  if (u === HOOK) {
    forwards.push(JSON.parse(init.body));
    return new Response(null, { status: 200 });
  }

  throw new Error(`unexpected fetch target: ${method} ${u}`);
};

/** Runs fn with console captured, so the check's own output stays readable. */
async function capture(fn) {
  const logs = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a) => logs.push(a.join(" "));
  console.error = (...a) => logs.push(a.join(" "));
  try {
    return { value: await fn(), logs };
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
}

const everyLog = [];

/* ── The three real handlers, wrapped ────────────────────────────────────── */

/** One send through the REAL endpoint and the REAL Meta adapter. */
async function send(payload) {
  const request = new Request("https://app.invalid/api/automation/send-chat-message", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-chat-messaging-secret": CHAT_SECRET,
    },
    body: JSON.stringify(payload),
  });
  const { value, logs } = await capture(() => handleSendChatMessage(request, metaProvider));
  everyLog.push(...logs);
  return { status: value.status, json: await value.json().catch(() => null) };
}

const b64u = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");

/** The Phase 3A order.created token, minted exactly as the bridge does. */
function orderEventJwt() {
  const now = Math.floor(Date.now() / 1000);
  const header = b64u({ alg: "HS256", typ: "JWT" });
  const claims = b64u({
    iss: "atlas-order-bridge",
    aud: "n8n-order-automation",
    sub: "order.created",
    jti: ORDER_EVENT_ID,
    iat: now,
    nbf: now - 5,
    exp: now + 120,
    eventId: ORDER_EVENT_ID,
    eventType: "order.created",
    occurredAt: "2026-08-26T04:00:00.000Z",
    orderNumber: ORDER_NUMBER,
    channel: "messenger",
  });
  const signature = createHmac("sha256", N8N_SECRET)
    .update(`${header}.${claims}`)
    .digest("base64url");
  return `${header}.${claims}.${signature}`;
}

/** One authoritative order fetch through the REAL endpoint. */
async function fetchOrderDetails() {
  const request = new Request("https://app.invalid/api/automation/order-details", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${orderEventJwt()}`,
    },
    body: JSON.stringify({ eventId: ORDER_EVENT_ID, orderNumber: ORDER_NUMBER }),
  });
  const { value, logs } = await capture(() => postOrderDetails(request));
  everyLog.push(...logs);
  return { status: value.status, json: await value.json().catch(() => null) };
}

const sign = (raw) =>
  `sha256=${createHmac("sha256", APP_SECRET).update(Buffer.from(raw, "utf8")).digest("hex")}`;

/** One signed Meta delivery through the REAL webhook; returns what n8n saw. */
async function deliver(...messaging) {
  forwards = [];
  const body = JSON.stringify({
    object: "page",
    entry: [{ id: PAGE_ID, time: 1_756_000_000_000, messaging }],
  });
  const request = new Request("https://app.invalid/api/automation/meta-messenger-webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-hub-signature-256": sign(body) },
    body,
  });
  const { value, logs } = await capture(async () => {
    const response = await webhook.postMetaMessengerWebhook(request);
    // waitUntil no-ops off Vercel — let the detached forward settle.
    await new Promise((r) => setTimeout(r, 40));
    return response;
  });
  everyLog.push(...logs);
  assert.equal(value.status, 200, "Meta always gets its 200");
  assert.equal(forwards.length, 1, "exactly one forward per accepted delivery");
  return forwards[0];
}

const envelope = (extra) => ({
  sender: { id: CHAT_ID },
  recipient: { id: PAGE_ID },
  timestamp: 1_756_000_000_001,
  ...extra,
});

/** A tap on one welcome option, exactly as Meta delivers a quick reply. */
const tapEvent = (option) =>
  envelope({
    message: { mid: "m_tap", text: option.title, quick_reply: { payload: option.payload } },
  });

/* ══════════════════════════════════════════════════════════════════════════
   THE TRANSFORMATIONS UNDER CERTIFICATION

   These are what the forwarder (n8n today) must do. They are the point of the
   file: every identifier is carried VERBATIM from an authoritative answer, and
   only wording is composed.
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The welcome. FOUR options in ONE message. A Messenger button template
 * permits three buttons and that limit is not raised anywhere in this change;
 * quick replies are the provider's own control for more, capped at 13.
 */
const WELCOME_TEXT = "Welcome to The Third Place. What can we do for you?";
const WELCOME_OPTIONS = [
  { title: "Place an Order", payload: "ORDER_START" },
  { title: "Menu", payload: "SHOW_MENU" },
  { title: "Location", payload: "SHOW_LOCATION" },
  { title: "Opening Time", payload: "SHOW_OPENING_HOURS" },
];

const welcomeMessage = () => ({
  type: "quick_replies",
  text: WELCOME_TEXT,
  quickReplies: WELCOME_OPTIONS,
});

/** Baht, formatted once, so the figure can never be reformatted per message. */
const formatThb = (amount) => `THB ${amount.toLocaleString("en-US")}`;

/**
 * The confirmation, built ONLY from the authoritative order-details response.
 * Nothing here reads anything the customer typed into the chat — that is what
 * "without re-entry" means, and it is why this takes `details` and not a
 * message.
 */
const confirmationMessage = (details) => ({
  type: "text",
  text:
    `Order ${details.order.orderNumber} received. ` +
    `Total ${formatThb(details.order.total)}. ` +
    "Please transfer and send your payment slip in this chat.",
});

/**
 * The QR that follows the total. It is the CONFIGURED URL or nothing at all —
 * a missing QR is a blocker to surface, never a gap to fill with a guess.
 */
const qrMessage = (details) =>
  details.paymentQrUrl === null ? null : { type: "image", url: details.paymentQrUrl };

/**
 * What a receiver must do with ONE sanitized event. Three disjoint inputs, one
 * branch each — which is the whole reason `action` is forwarded. The design
 * this replaces evaluated the welcome branch IN PARALLEL with the image
 * branch, so a slip could replay the greeting.
 */
function route(event) {
  if (event.attachment !== null) return "payment_proof";
  if (event.action !== null) return `action:${event.action}`;
  return "welcome";
}

/* ══════════════════════════════════════════════════════════════════════════
   A. The welcome offers all four options, provider-valid
   ══════════════════════════════════════════════════════════════════════════ */

graphCalls = [];
let out = await send({
  eventId: WELCOME_EVENT_ID,
  orderNumber: ORDER_NUMBER,
  channel: "messenger",
  externalChatId: CHAT_ID,
  message: welcomeMessage(),
});

assert.equal(out.status, 200, "1. the four-option welcome is accepted");
assert.equal(out.json.status, "sent", "1. and it dispatches");
assert.equal(graphCalls.length, 1, "1. as exactly ONE provider message");
assert.deepEqual(
  graphCalls[0].body,
  {
    recipient: { id: CHAT_ID },
    messaging_type: "RESPONSE",
    message: {
      text: WELCOME_TEXT,
      quick_replies: [
        { content_type: "text", title: "Place an Order", payload: "ORDER_START" },
        { content_type: "text", title: "Menu", payload: "SHOW_MENU" },
        { content_type: "text", title: "Location", payload: "SHOW_LOCATION" },
        { content_type: "text", title: "Opening Time", payload: "SHOW_OPENING_HOURS" },
      ],
    },
  },
  "1. the welcome is Meta's exact quick-reply shape, options in caller order",
);

// All four are VISIBLE — the titles are what the customer reads.
for (const title of ["Place an Order", "Menu", "Location", "Opening Time"]) {
  assert.ok(
    graphCalls[0].body.message.quick_replies.some((q) => q.title === title),
    `2. the welcome visibly offers "${title}"`,
  );
  assert.ok(title.length <= chat.MAX_BUTTON_TITLE_CHARS, `2. "${title}" fits Meta's title cap`);
}

// The provider limits are RESPECTED, not raised: four options fit the
// quick-reply cap, and the same four as buttons are refused at the boundary.
assert.equal(chat.MAX_BUTTONS, 3, "3. the button-template cap is still Meta's 3");
assert.equal(chat.MAX_QUICK_REPLIES, 13, "3. the quick-reply cap is still Meta's 13");
assert.ok(WELCOME_OPTIONS.length > chat.MAX_BUTTONS, "3. four options exceed a button template");
assert.ok(WELCOME_OPTIONS.length <= chat.MAX_QUICK_REPLIES, "3. and fit a quick-reply message");

graphCalls = [];
out = await send({
  eventId: "66666666-6666-4666-8666-666666666666",
  orderNumber: ORDER_NUMBER,
  channel: "messenger",
  externalChatId: CHAT_ID,
  message: {
    type: "buttons",
    text: WELCOME_TEXT,
    buttons: WELCOME_OPTIONS.map((o) => ({ type: "postback", ...o })),
  },
});
assert.equal(out.status, 400, "3. the SAME four options as buttons are refused");
assert.equal(graphCalls.length, 0, "3. a four-button template never reaches Meta");
assert.ok(!dispatches.has("66666666-6666-4666-8666-666666666666"), "3. and burns no eventId");

/* ══════════════════════════════════════════════════════════════════════════
   B. Every welcome payload is routable — the two modules agree
   ══════════════════════════════════════════════════════════════════════════ */

for (const option of WELCOME_OPTIONS) {
  assert.ok(
    webhook.__test.MESSENGER_ACTIONS.includes(option.payload),
    `4. "${option.title}" sends a payload the webhook allowlists: ${option.payload}`,
  );
  assert.match(option.payload, chat.POSTBACK_PAYLOAD_PATTERN, "4. and the sender's charset");
}
assert.equal(
  new Set(WELCOME_OPTIONS.map((o) => o.payload)).size,
  WELCOME_OPTIONS.length,
  "4. no two options share a payload, so no tap is ambiguous",
);

// The tap comes back. Each option routes to its OWN branch — Location and
// Opening Time reach the existing location / opening-hours behaviour rather
// than being folded into one another or into the welcome.
for (const option of WELCOME_OPTIONS) {
  const forwarded = await deliver(tapEvent(option));
  assert.equal(forwarded.events.length, 1, `5. one event for the "${option.title}" tap`);
  assert.equal(forwarded.events[0].action, option.payload, `5. "${option.title}" arrives routable`);
  assert.equal(
    route(forwarded.events[0]),
    `action:${option.payload}`,
    `5. and routes to its own branch, never the welcome`,
  );
  assert.ok(
    !JSON.stringify(forwarded).includes(option.title),
    `5. the echoed title is still stripped for "${option.title}"`,
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   B2. Location and Opening Hours, EXECUTED from the frozen workflow artifact

   Not a restatement of what the artifact file says. The real webhook output is
   fed to the artifact's real Code node, and the message it returns is then put
   through the real send endpoint — so the wording, the destination and the
   provider validity are all observed rather than asserted about a string.
   ══════════════════════════════════════════════════════════════════════════ */

/** The approved destination. One constant; nothing composes or shortens it. */
const APPROVED_MAPS_URL = "https://maps.app.goo.gl/SaDkrUaBhUXxAHEj8";

/**
 * The artifact's node, run the way n8n runs it: `$` reaches the webhook item
 * and `require` reaches node crypto. Nothing else is in scope, which is itself
 * part of the contract — the node cannot read an order, a clock or a network.
 */
function runDirectResponse(forwardedBody) {
  const operation = presentationArtifact.operations.find(
    (candidate) => candidate.nodeName === "Prepare Messenger Direct Response",
  );
  assert.ok(operation, "5b. the revision carries the direct-response node");
  const accessor = (node) => {
    assert.equal(node, "Messenger Events POST", "5b. the node reads only the webhook item");
    return { first: () => ({ json: { body: forwardedBody } }) };
  };
  return new Function("require", "$", operation.parameters.jsCode)((moduleName) => {
    assert.equal(moduleName, "crypto");
    return { createHash };
  }, accessor);
}

const answered = {};
for (const option of WELCOME_OPTIONS) {
  answered[option.payload] = runDirectResponse(await deliver(tapEvent(option)));
}

// CHANGE 2 — Location. A native button template, and the approved destination
// carried verbatim rather than printed at the customer as a raw link.
assert.equal(answered.SHOW_LOCATION.length, 1, "6b. Location answers with exactly one message");
const locationMessage = answered.SHOW_LOCATION[0].json.message;
assert.equal(locationMessage.type, "buttons", "6b. Location uses a Messenger button template");
assert.equal(locationMessage.text, "📍 The Third Place", "6b. and the approved heading");
assert.deepEqual(
  locationMessage.buttons,
  [{ type: "web_url", title: "Open in Google Maps", url: APPROVED_MAPS_URL }],
  "6b. one action button, on the EXACT approved Google Maps destination",
);
assert.ok(!locationMessage.text.includes("http"), "6b. no raw URL is left in the wording");
assert.ok(
  locationMessage.buttons[0].title.length <= chat.MAX_BUTTON_TITLE_CHARS,
  "6b. the button title fits Meta's cap",
);

// CHANGE 3 — Opening hours. Wording only; the hours are the same figures.
assert.equal(answered.SHOW_OPENING_HOURS.length, 1, "6b. Opening Hours answers once");
assert.deepEqual(
  answered.SHOW_OPENING_HOURS[0].json.message,
  { type: "text", text: "🕐 Opening Hours\nDaily · 11:00–23:00" },
  "6b. the approved opening-hours presentation",
);
assert.ok(
  answered.SHOW_OPENING_HOURS[0].json.message.text.includes("11:00–23:00"),
  "6b. the business hours are unchanged",
);

// Everything else this node answers is untouched by the revision.
assert.deepEqual(
  answered.SHOW_MENU[0].json.message,
  {
    type: "buttons",
    text: "Browse our current menu.",
    buttons: [
      {
        type: "web_url",
        title: "Open Menu",
        url: "https://third-place-menu.vercel.app/?browse=1",
      },
    ],
  },
  "6b. the Menu option still opens the shared browse-mode menu",
);
assert.deepEqual(
  answered.ORDER_START,
  [],
  "6b. ORDER_START still belongs to the bot-session branch alone",
);

// The four welcome payloads, read off the executable artifact rather than a
// local constant — this is the same list the webhook allowlists in section B.
const executedWelcome = runDirectResponse(
  await deliver(envelope({ message: { mid: "m_hi", text: "Hi" } })),
);
assert.equal(executedWelcome.length, 1, "6b. a plain message still answers with the welcome");
assert.deepEqual(
  executedWelcome[0].json.message.quickReplies,
  WELCOME_OPTIONS,
  "6b. the four welcome options and payloads are unchanged",
);

// A payment slip still reaches NO response branch — the revision does not
// reopen the replay the `action` field was introduced to close.
const slipBody = await deliver(
  envelope({
    message: {
      mid: "m_slip_artifact",
      attachments: [
        { type: "image", payload: { url: "https://cdn.invalid/slip-artifact-check.jpg" } },
      ],
    },
  }),
);
assert.deepEqual(
  runDirectResponse(slipBody),
  [],
  "6b. an image event cannot reach the welcome or any other reply",
);

// Provider validity, proved by sending both through the REAL endpoint and the
// REAL Meta adapter — not by reasoning about what Messenger accepts.
for (const [label, message, expected] of [
  [
    "location",
    locationMessage,
    {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: "📍 The Third Place",
          buttons: [{ type: "web_url", title: "Open in Google Maps", url: APPROVED_MAPS_URL }],
        },
      },
    },
  ],
  [
    "opening-hours",
    answered.SHOW_OPENING_HOURS[0].json.message,
    { text: "🕐 Opening Hours\nDaily · 11:00–23:00" },
  ],
]) {
  graphCalls = [];
  out = await send({
    eventId: presentationUuid(`handover-verify:${label}`),
    orderNumber: "TP-MS-GREETING",
    channel: "messenger",
    externalChatId: CHAT_ID,
    message,
  });
  assert.equal(out.status, 200, `6b. the ${label} message is accepted`);
  assert.equal(out.json.status, "sent", `6b. and dispatches`);
  assert.equal(graphCalls.length, 1, `6b. as exactly ONE provider message`);
  assert.deepEqual(
    graphCalls[0].body,
    { recipient: { id: CHAT_ID }, messaging_type: "RESPONSE", message: expected },
    `6b. the ${label} reply is Meta's exact shape`,
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   C. The authoritative total, with no customer re-entry
   ══════════════════════════════════════════════════════════════════════════ */

const details = await fetchOrderDetails();
assert.equal(details.status, 200, "6. the authoritative order resolves");
assert.equal(details.json.data.order.orderNumber, ORDER_NUMBER, "6. it is THIS order");
assert.equal(details.json.data.order.channel, "messenger", "6. from the messenger source");
assert.equal(details.json.data.order.externalChatId, CHAT_ID, "6. bound to the mapped chat");
assert.equal(details.json.data.order.subtotal, 420, "6. exact subtotal");
assert.equal(details.json.data.order.deliveryFee, 0, "6. exact delivery fee");
assert.equal(details.json.data.order.total, 420, "6. exact total");
assert.equal(details.json.data.paymentQrUrl, TEST_QR_URL, "6. and the configured QR");

const data = details.json.data;
const confirmation = confirmationMessage(data);
assert.ok(confirmation.text.includes(ORDER_NUMBER), "7. the confirmation names the order");
assert.ok(confirmation.text.includes("THB 420"), "7. and carries the EXACT total in THB");
assert.equal(
  confirmation.text,
  confirmationMessage({ ...data, order: { ...data.order, total: 420 } }).text,
  "7. the total is the only figure it depends on",
);
// Changing the authoritative total changes the message, and nothing else can.
assert.ok(
  confirmationMessage({ ...data, order: { ...data.order, total: 999 } }).text.includes("THB 999"),
  "7. the figure comes from the authoritative response, never from the chat",
);
assert.ok(!confirmation.text.includes(CHAT_ID), "7. no chat identifier reaches the wording");
assert.ok(!confirmation.text.includes("?"), "7. the customer is not asked to re-enter anything");

/* ══════════════════════════════════════════════════════════════════════════
   D. The QR image FOLLOWS the total, as its own message
   ══════════════════════════════════════════════════════════════════════════ */

graphCalls = [];
const chatBase = {
  orderNumber: ORDER_NUMBER,
  channel: "messenger",
  externalChatId: data.order.externalChatId,
};

out = await send({ ...chatBase, eventId: TOTAL_EVENT_ID, message: confirmation });
assert.equal(out.json.status, "sent", "8. the confirmation with the total is sent first");

const qr = qrMessage(data);
assert.notEqual(qr, null, "8. a configured QR produces an image message");
out = await send({ ...chatBase, eventId: QR_EVENT_ID, message: qr });
assert.equal(out.json.status, "sent", "8. the QR image is sent second");

assert.equal(graphCalls.length, 2, "8. exactly two messages, in order");
assert.deepEqual(
  graphCalls[0].body.message,
  { text: confirmation.text },
  "8. FIRST the authoritative total, as plain text",
);
assert.deepEqual(
  graphCalls[1].body.message,
  { attachment: { type: "image", payload: { url: TEST_QR_URL, is_reusable: false } } },
  "8. THEN the image, carrying the configured URL verbatim",
);
assert.equal(
  graphCalls[1].body.message.attachment.payload.url,
  data.paymentQrUrl,
  "8. the image URL is the authoritative one, never a literal in the code",
);
assert.notEqual(TOTAL_EVENT_ID, QR_EVENT_ID, "8. two messages, two eventIds, two claim rows");
assert.ok(dispatches.has(TOTAL_EVENT_ID) && dispatches.has(QR_EVENT_ID), "8. both rows exist");

// NOTHING is invented. With no approved QR configured the sequence is the
// total alone — which is the handover blocker staying visible, not a silent
// fallback to some other image.
delete process.env.PAYMENT_QR_URL;
const withoutQr = await fetchOrderDetails();
assert.equal(withoutQr.json.data.paymentQrUrl, null, "9. an unset QR answers null");
assert.equal(qrMessage(withoutQr.json.data), null, "9. and no image message is composed");
process.env.PAYMENT_QR_URL = TEST_QR_URL;

// No module hard-codes a QR: the value can only come from configuration.
for (const file of [
  "api/_lib/orderDetails.server.ts",
  "api/_lib/chatMessaging.server.ts",
  "api/_lib/metaMessengerWebhook.server.ts",
]) {
  const source = readFileSync(file, "utf8");
  assert.ok(!/promptpay/i.test(source), `9. ${file} contains no payment-account reference`);
  assert.ok(!source.includes(TEST_QR_URL), `9. ${file} contains no QR URL literal`);
}

/* ══════════════════════════════════════════════════════════════════════════
   E. Identity comes from the mapping, never from recency
   ══════════════════════════════════════════════════════════════════════════ */

const supabaseUrl = (fragment) => {
  const call = supabaseCalls.find((u) => u.includes(fragment));
  assert.ok(call, `expected a Supabase read of ${fragment}`);
  return call;
};

const ordersUrl = supabaseUrl("/rest/v1/orders?");
const sessionsUrl = supabaseUrl("/rest/v1/bot_sessions?");

assert.ok(ordersUrl.includes(`order_number=eq.${ORDER_NUMBER}`), "10. the order is named");
assert.ok(sessionsUrl.includes(`order_id=eq.${ORDER_ID}`), "10. the session is bound to it");
assert.ok(sessionsUrl.includes("status=eq.completed"), "10. completed sessions only");
assert.ok(sessionsUrl.includes("limit=2"), "10. two rows are read so ambiguity is DETECTED");
assert.ok(!sessionsUrl.includes("order="), "10. the mapping carries no ordering clause at all");
// order_items DOES sort — but ascending, to print the lines in the order they
// were added. Nothing anywhere selects a row by being the newest.
for (const url of supabaseCalls) {
  assert.ok(!url.includes("created_at.desc"), `10. nothing is selected newest-first: ${url}`);
}

// An AMBIGUOUS mapping fails closed rather than picking one.
sessionRows = [SESSION_ROW, { platform: "messenger", external_chat_id: "19999999999999999" }];
const ambiguous = await fetchOrderDetails();
assert.equal(ambiguous.status, 502, "11. two mapped sessions is a refusal, not a choice");
assert.ok(!JSON.stringify(ambiguous.json).includes(CHAT_ID), "11. and no chat id is answered");
sessionRows = [SESSION_ROW];

// The chat id can only come from the SERVER row. A caller cannot supply one.
const smuggled = new Request("https://app.invalid/api/automation/order-details", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${orderEventJwt()}` },
  body: JSON.stringify({
    eventId: ORDER_EVENT_ID,
    orderNumber: ORDER_NUMBER,
    externalChatId: "19999999999999999",
  }),
});
const refused = await capture(() => postOrderDetails(smuggled));
everyLog.push(...refused.logs);
assert.equal(refused.value.status, 400, "11. a caller-supplied chat id is refused outright");

/* ══════════════════════════════════════════════════════════════════════════
   F. A payment slip reaches proof handling and NEVER replays the welcome
   ══════════════════════════════════════════════════════════════════════════ */

const SLIP_URL = "https://cdn.invalid/slip-for-tp-ms-000042.jpg";
const slipEvent = envelope({
  message: {
    mid: "m_slip",
    text: "here is my slip",
    attachments: [{ type: "image", payload: { url: SLIP_URL } }],
  },
});

let forwarded = await deliver(slipEvent);
const slip = forwarded.events[0];
assert.equal(slip.attachment.url, SLIP_URL, "12. the slip image reaches the receiver");
assert.equal(slip.action, null, "12. a slip carries no action");
assert.equal(route(slip), "payment_proof", "12. so it routes to proof handling");
assert.notEqual(route(slip), "welcome", "12. and CANNOT replay the welcome");
assert.equal(slip.externalChatId, CHAT_ID, "12. under the mapped chat identity");

// A slip, a tap and plain text in one batch stay three separate decisions.
forwarded = await deliver(
  slipEvent,
  envelope({ message: { mid: "m_tap", quick_reply: { payload: "ORDER_START" } } }),
  envelope({ message: { mid: "m_text", text: "hello" } }),
);
assert.deepEqual(
  forwarded.events.map(route),
  ["payment_proof", "action:ORDER_START", "welcome"],
  "13. one event, one branch — the welcome is reachable only for plain text",
);

/* ══════════════════════════════════════════════════════════════════════════
   G. Retries change nothing
   ══════════════════════════════════════════════════════════════════════════ */

// Meta retries the IDENTICAL body, so the webhook's dedup key is identical.
const first = await deliver(slipEvent);
const again = await deliver(slipEvent);
assert.equal(first.eventId, again.eventId, "14. a retried delivery keeps its eventId");
assert.deepEqual(first.events, again.events, "14. and sanitizes to the identical event");

// A replayed SEND claims nothing new and reaches Meta not at all.
const rowsBefore = dispatches.size;
graphCalls = [];
out = await send({ ...chatBase, eventId: TOTAL_EVENT_ID, message: confirmation });
assert.equal(out.json.status, "duplicate", "15. a replayed confirmation is a duplicate");
assert.equal(out.json.ok, true, "15. answered as a success, not an error");
assert.equal(graphCalls.length, 0, "15. and the customer is NOT messaged again");
assert.equal(dispatches.size, rowsBefore, "15. no second row is created");

out = await send({ ...chatBase, eventId: QR_EVENT_ID, message: qr });
assert.equal(out.json.status, "duplicate", "15. a replayed QR image is a duplicate too");
assert.equal(graphCalls.length, 0, "15. still nothing sent");
assert.equal(dispatches.size, rowsBefore, "15. still no second row");

// Nothing on any of these paths marked anything paid: the only writes this
// file can make are the dispatch rows above, and every Supabase read is a GET.
for (const row of dispatches.values()) {
  assert.ok(!("payment_status" in row), "16. a dispatch row carries no payment state");
  assert.ok(!("payment_method" in row), "16. and no payment method");
}
assert.ok(supabaseCalls.length > 0, "16. authoritative reads happened");

/* ══════════════════════════════════════════════════════════════════════════
   H. Nothing here could have reached a real customer
   ══════════════════════════════════════════════════════════════════════════ */

for (const line of everyLog) {
  assert.ok(!line.includes(CHAT_SECRET), "17. no log carries the messaging secret");
  assert.ok(!line.includes(N8N_SECRET), "17. no log carries the automation secret");
  assert.ok(!line.includes(APP_SECRET), "17. no log carries the app secret");
  assert.ok(!line.includes(PAGE_TOKEN), "17. no log carries the Page token");
  assert.ok(!line.includes(CHAT_ID), "17. no log carries the raw chat id");
  assert.ok(!line.includes(SLIP_URL), "17. no log carries a payment-slip URL");
  assert.ok(!line.includes(TEST_QR_URL), "17. no log carries the QR URL");
  assert.ok(!line.includes(WELCOME_TEXT), "17. no log carries customer-facing wording");
}

// Every identity used above is a test persona on an .invalid host, and the
// fetch stub throws on any target that is not one of the six above — so no
// socket was opened and no real customer could have been messaged.
for (const target of ["https://graph.facebook.com.evil.invalid/", "https://m.me/thethirdplace"]) {
  await assert.rejects(
    () => globalThis.fetch(target, { method: "POST" }),
    /unexpected fetch target/,
    "18. nothing outside the stubs can reach the network",
  );
}

console.log("test-customer-handover: all assertions passed");
