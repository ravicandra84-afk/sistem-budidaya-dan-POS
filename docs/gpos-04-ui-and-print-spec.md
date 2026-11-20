# GPOS-04 — POS UI and Print Specification

- Status: APPROVED — OWNER
- Scope: UI flow/design handoff and approved browser-print baseline for PG-07 through PG-10.
- Physical printer status: UNVERIFIED — PENDING PHYSICAL DEVICE TEST.
- Normative business/API sources: [ADR 0002](adr/0002-pos-gate-architecture.md), [POS API Contract](pos-api-contract.md), and `prd.md`.

This document closes the GPOS-04 design/integration decision deliverable. It
does not claim that a printer, operating system, or browser combination has
passed a physical compatibility test. Build the print preview and CSS in
Phase 8; record physical results at P8-04 before making any device support
claim.

## 1. Print Integration Decision

The approved baseline is browser printing with `@media print` layouts and the
operating system's print dialog. Do not add a printer bridge, native wrapper,
WebUSB, Web Serial, or direct ESC/POS protocol under this baseline.

Provide a preview mode with a segmented 58 mm / 80 mm paper-width selector.
The selected layout controls the receipt content width; print CSS should use
58 mm and 80 mm page widths (or the closest browser-supported page-size
mechanism) and account for non-printable printer margins. The system dialog
remains authoritative for the actual device, paper, scaling, and margins.
Use the system dialog on Pop!\_OS and Windows desktop and supported mobile
browsers. A successful browser build is not evidence that a physical printer
works on any particular device.

The printed and previewed receipt contains exactly these nine fields:

1. `PT. Pisciculture Farm Indonesia`
2. Transaction date and time in `Asia/Jakarta` / WIB.
3. Fish species.
4. Fish size.
5. Quantity in `ekor`.
6. Price per fish.
7. Total payment.
8. Payment method.
9. Cashier name.

Never render sale number, batch code, weight, customer details, transfer
reference, VOID reason, or a receipt for a VOID sale. Reprint retrieves the
existing receipt and cannot submit a sale.

## 2. UI Design System and Interaction Rules

Apply the project `craft-ui-ux` operating-interface guidance:

- Use a bright neutral canvas, white work surfaces with precise 1 px borders,
  marine-blue structural navigation, sky-blue primary actions, teal secondary
  state, green success/available-stock state, and amber/crimson warning/VOID
  state. Avoid decorative gradients, excessive shadows, or marketing banners.
- Use Plus Jakarta Sans for interface text. Render all Rupiah, quantity,
  stock, and date-time numeric columns with tabular numerals; use a
  monospace face for internal sale IDs and batch codes.
- Give primary actions, payment options, and selectors at least 44 px touch
  height. Use familiar icon buttons with accessible labels/tooltips for
  print, refresh, and close actions.
- Keep POS information dense and operational. The cashier workspace uses an
  approximately 65/35 catalog-to-checkout split on desktop, with checkout
  remaining visible while selecting a batch. Collapse to a single-column
  flow on narrow screens without horizontal page overflow.
- Every page provides loading, empty, error/retry, and populated states.
  Confirm consequential actions and do not show success before the API
  confirms commit.

## 3. Pages and User Flows

### PG-07 — Cashier POS (`/pos`)

Show sellable batches only: active status and computed stock greater than
zero. Each selectable row shows species, size, batch code (internal UI only),
available `ekor`, and current unit price; show a clear missing-price state
without hiding an otherwise sellable batch. Select exactly one batch per
sale. The checkout panel shows quantity, confirmed unit price, calculated
total, and payment controls for cash or transfer.

For cash, accept received amount and show calculated change; block submit
below the total. For transfer, require explicit confirmation that the funds
were received. Refresh stock and price before commit and ask the cashier to
confirm the displayed values. Prevent duplicate submission while the request
is pending.

On `409 PRICE_CHANGED`, preserve batch, quantity, and payment inputs; show the
server's current price, refresh the checkout summary, and require explicit
price confirmation. On `409 INSUFFICIENT_STOCK`, show the server's
`available_quantity`, offer the capped quantity, and require explicit
confirmation before resubmission. Both conflicts roll back the old
idempotency record; after confirmation, submit a fresh UUIDv4 key. If the
request outcome is uncertain due to a network failure, retry with the
original key and never create an automatic second sale.

### PG-08 — Price Management (`/pos/prices`)

Show one current price per species/size combination in a compact table with
species, size, Rupiah price, last-updated time, and updater. Owner and Admin
Operasional can add or edit; no delete action exists. Kasir has no price
management page/action. Validate integer Rupiah from Rp1 through
Rp10,000,000 and show duplicate/range/server errors without discarding form
values unnecessarily.

### PG-09 — Sales History (`/pos/sales`)

Show all sales to POS roles, newest first, with internal sale number, time,
batch identifier, species/size, quantity, unit price, total, payment method,
creator, and derived active/voided status. Use only approved date/status
filters and pagination; do not add free-text search or arbitrary sorting.
Internal sale number and batch code may appear in this screen but never on a
receipt.

### PG-10 — Sale Detail and VOID (`/pos/sales/[id]`)

Show the immutable sale snapshot and any VOID actor/time. All POS roles can
VOID a sale that has not already been VOIDed. Use a confirmation dialog;
there is no required reason field. After confirmation, show the server's
committed state and refreshed batch status/stock. Show reprint only to the
original sale creator while the sale is active. Never show a reprint action
for a VOID sale.

### Receipt Preview and Thermal Print

Keep the preview unframed from the application page but constrain its print
surface to the selected 58 mm or 80 mm width. Use a single-column receipt
hierarchy: company identity, transaction time, fish identity/size, quantity,
price/total, payment method, and cashier. Align numeric values with
`tabular-nums`; use clear separators and high-contrast black-on-white print
styles. Hide navigation, controls, and other page content in print mode.
Provide a print action that opens the system dialog only after a sale commit.
Printing failure is a print-state error and must not relabel or roll back a
committed sale.

## 4. UI Visibility and Action Matrix

| Page / action                       | Owner                | Admin Operasional    | Kasir                    | Kepala Budidaya |
| ----------------------------------- | -------------------- | -------------------- | ------------------------ | --------------- |
| `/pos` — view batches / create sale | Visible / allowed    | Visible / allowed    | Visible / allowed        | Hidden / denied |
| `/pos/prices` — view/manage catalog | Visible / manage     | Visible / manage     | Hidden; no manage action | Hidden / denied |
| `/pos/sales` — view all history     | Visible / allowed    | Visible / allowed    | Visible / allowed        | Hidden / denied |
| `/pos/sales/[id]` — view / VOID     | Visible / allowed    | Visible / allowed    | Visible / allowed        | Hidden / denied |
| Receipt reprint                     | Own active sale only | Own active sale only | Own active sale only     | Denied          |
| 58 mm / 80 mm preview and print     | For own active sale  | For own active sale  | For own active sale      | Denied          |

UI visibility is convenience only; API RBAC remains authoritative. Audit-log
visibility follows its separate role contract and is not expanded by this
POS UI specification.

## 5. Physical Printer Verification — Deferred to P8-04

No device inventory, pairing result, or physical 58 mm / 80 mm print result is
claimed by this document. The approved system-dialog strategy resolves the
integration baseline, while physical compatibility remains unverified.

P8-04 is the end-of-Phase-8 acceptance task for the completed UI, preview,
and `@media print` component. It must test the actual available target
device/browser/printer combinations at both paper widths, record legibility,
clipping, scaling, and the nine-field content, and publish a compatibility
matrix. Do not claim compatibility for an untested combination. If a target
device or printer is unavailable, record it as unverified rather than
passing it by assumption. P9-03 consumes and publishes the P8-04 evidence;
it does not replace the required physical test.

## 6. P8-04 Acceptance Evidence

Record one result per tested combination:

| Field           | Required record                                            |
| --------------- | ---------------------------------------------------------- |
| Device and OS   | Exact model and OS version                                 |
| Browser         | Name and version                                           |
| Printer         | Exact model and connection method                          |
| Paper           | 58 mm or 80 mm                                             |
| Output          | Pass/fail for clipping, legibility, scaling, and margins   |
| Receipt content | Pass/fail for all nine fields and prohibited-field absence |
| Evidence        | Dated photo or captured output and tester                  |

P8-04 passes only when every combination claimed as supported has evidence at
both paper widths and no prohibited receipt fields are printed.

## 7. P8-04 QA and Physical Device Status — 2026-11-20

- UI and role E2E: PASS. The complete web Playwright suite passed 37/37 tests,
  including detail, full-sale VOID, conflict refresh, creator-only reprint,
  responsive 390 px layout, and the nine-field receipt preview.
- Build gates: PASS. `npm run typecheck`, `npm run lint`, and
  `npm run build` completed successfully.
- Print-layout simulation: PASS for browser `print` media at both 58 mm and
  80 mm widths. The automated test confirms the selected page layout, hidden
  controls/application shell, nine approved receipt fields, and no horizontal
  content overflow in the emulated print surface.
- Physical pairing and print output: NOT RUN. No device/OS/browser/printer
  combination was physically paired or printed during this QA session. CSS
  emulation and a successful build do not establish physical compatibility.
- Compatibility claim: none. Every physical device and printer combination
  remains `UNVERIFIED — PENDING PHYSICAL DEVICE TEST` until its actual output
  is recorded below with evidence.

| Device / OS | Browser    | Printer / connection | Paper | Result                                    | Evidence                    |
| ----------- | ---------- | -------------------- | ----- | ----------------------------------------- | --------------------------- |
| Not tested  | Not tested | Not tested           | 58 mm | UNVERIFIED — PENDING PHYSICAL DEVICE TEST | Pending P8-04 physical test |
| Not tested  | Not tested | Not tested           | 80 mm | UNVERIFIED — PENDING PHYSICAL DEVICE TEST | Pending P8-04 physical test |

## 8. Final Receipt Print Compatibility Matrix — 2026-11-20

This matrix separates automated CSS print simulation from actual printer
compatibility. Passing Playwright or browser `print` media checks verifies
only the rendered CSS and receipt DOM; it is not evidence that a physical
printer, connection, OS, or browser combination works.

### Automated CSS Print Simulation

| Engine / test evidence                                                                                                        | Paper                  | Status                                       | Verified scope                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Chromium / Playwright; P8-04 `pos-sale-detail.spec.ts` (37/37 web E2E) and P9-01 `pos-receipt-layout.spec.ts` (38/38 web E2E) | 58 mm                  | VERIFIED — SIMULATED CSS ONLY                | Nine-field receipt content, selected CSS page width, hidden app shell/controls, and no horizontal overflow in emulated `print` media.            |
| Chromium / Playwright; P8-04 `pos-sale-detail.spec.ts` (37/37 web E2E) and P9-01 `pos-receipt-layout.spec.ts` (38/38 web E2E) | 80 mm                  | VERIFIED — SIMULATED CSS ONLY                | Nine-field receipt content, selected CSS page width, hidden app shell/controls, and no horizontal overflow in emulated `print` media.            |
| Chromium / Playwright; P9-02 `pos-print-workflow.spec.ts` (41/41 web E2E)                                                     | 58 mm / 80 mm selector | PASS — WINDOW.PRINT WORKFLOW SIMULATION ONLY | Auto-print invocation after commit, synchronous print failure handling, and local retry without a second sale POST; no physical output verified. |

Evidence files: [P8-04 sale-detail tests](../apps/web/e2e/pos-sale-detail.spec.ts),
[P9-01 receipt-layout test](../apps/web/e2e/pos-receipt-layout.spec.ts), and
[P9-02 print-workflow tests](../apps/web/e2e/pos-print-workflow.spec.ts).

### Physical Device / Printer Compatibility

No device was paired and no receipt was physically printed for this matrix.
Every combination below is `UNVERIFIED — NOT SUPPORTED WITHOUT PHYSICAL TEST`.
The status may change only after the actual model, OS/browser versions,
connection, paper width, output checks, dated evidence, and tester signature
are recorded for that exact combination.

| Device  | OS / browser                         | Connection path to test                                        | Paper | Status                                           | Evidence / tester signature   |
| ------- | ------------------------------------ | -------------------------------------------------------------- | ----- | ------------------------------------------------ | ----------------------------- |
| Desktop | Pop!\_OS; browser/version not tested | USB through CUPS or installed OS printer driver                | 58 mm | UNVERIFIED — NOT SUPPORTED WITHOUT PHYSICAL TEST | Not tested; signature pending |
| Desktop | Pop!\_OS; browser/version not tested | USB through CUPS or installed OS printer driver                | 80 mm | UNVERIFIED — NOT SUPPORTED WITHOUT PHYSICAL TEST | Not tested; signature pending |
| Desktop | Windows; browser/version not tested  | USB through installed OS printer driver                        | 58 mm | UNVERIFIED — NOT SUPPORTED WITHOUT PHYSICAL TEST | Not tested; signature pending |
| Desktop | Windows; browser/version not tested  | USB through installed OS printer driver                        | 80 mm | UNVERIFIED — NOT SUPPORTED WITHOUT PHYSICAL TEST | Not tested; signature pending |
| Mobile  | Android; browser/version not tested  | OS system print dialog; Bluetooth only if exposed by OS/driver | 58 mm | UNVERIFIED — NOT SUPPORTED WITHOUT PHYSICAL TEST | Not tested; signature pending |
| Mobile  | Android; browser/version not tested  | OS system print dialog; Bluetooth only if exposed by OS/driver | 80 mm | UNVERIFIED — NOT SUPPORTED WITHOUT PHYSICAL TEST | Not tested; signature pending |
| Mobile  | iOS; browser/version not tested      | OS system print dialog; Bluetooth only if exposed by OS/driver | 58 mm | UNVERIFIED — NOT SUPPORTED WITHOUT PHYSICAL TEST | Not tested; signature pending |
| Mobile  | iOS; browser/version not tested      | OS system print dialog; Bluetooth only if exposed by OS/driver | 80 mm | UNVERIFIED — NOT SUPPORTED WITHOUT PHYSICAL TEST | Not tested; signature pending |

### Connection and Browser Limits

The supported architectural path is the operating system's system print
dialog, using a USB printer exposed through CUPS or a printer driver already
installed in the OS, for either paper width. The application does not implement
a printer protocol or Bluetooth pairing. Bluetooth printing is not universally
supported and is not claimed for any device.

The browser `window.print()` API returns no reliable physical job result. The
application can detect a missing print function or a synchronous exception,
but cannot detect paper-out, an offline printer, a clipped physical page, or a
cashier cancelling the OS print dialog. Those outcomes remain subject to
physical verification and cashier inspection.

### Cashier Procedure

1. After the system print dialog runs, verify the paper width and inspect the
   physical receipt for all nine fields, legibility, and clipping.
2. If the receipt did not print or is clipped, use **Coba Cetak Ulang** on the
   successful checkout receipt, or **Cetak Ulang Struk** on
   `/pos/sales/[id]` for the original creator of an active sale.
3. Retrying print uses the existing receipt and must not repeat the sale POST.
   A VOID sale cannot be reprinted.
