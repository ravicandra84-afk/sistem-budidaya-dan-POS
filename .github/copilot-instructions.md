# PFI — GitHub Copilot Repository Instructions

This file is the repository-wide entry point for GitHub Copilot Chat and Copilot Agent in VS Code.

## Canonical Instructions

Before planning, editing code, or running commands, read and follow the complete project rules in **`AGENTS.md`** at the repository root, together with the four core project documents:

1. `master_blueprint_api_contract_pfi_main.md` — Single Source of Truth (SSOT) for the locked V4.5 Receiving/Batch/VOID module and POS business decisions.
2. `prd.md` — Product requirements, user roles, pages (`PG-01`–`PG-11`), user flows, validation rules, and acceptance criteria.
3. `architecture.md` — System architecture, PostgreSQL schema, concurrency/security rules, printing strategy, and owner-approved decisions (`APPROVED — OWNER`).
4. `implementation_plan.md` — Phased execution roadmap, task IDs, dependencies, gates (`Gate V4.5`, `Gate POS`), and Definition of Ready/Done.

## Critical Guardrails

- **One Task ID per session:** Work strictly within the single assigned Task ID from `implementation_plan.md`. Inspect the repository first (`P0-01`) and never skip `Gate V4.5` or `Gate POS`.
- **Respect status labels:** Never alter `LOCKED — V4.5`, `LOCKED — BUSINESS`, or `APPROVED — OWNER` rules. Keep `TBD-03` printer compatibility, `TBD-04` POS API contract details, and `TBD-06` POS DDL/privileges behind their gates. `TBD-08` is partially resolved only for local initial Owner CLI provisioning; account lifecycle remains open. `TBD-09` base pagination/filter defaults are approved by ADR 0001; do not invent search or extra sort behavior. Never implement `OUT OF SCOPE` features.
- **Database & transaction invariants:** PostgreSQL 13+, `Asia/Jakarta` (UTC+7) business timezone, verified JWT actor extraction, backend RBAC enforcement, UUIDv4 `Idempotency-Key` on mutating endpoints, `SELECT ... FOR UPDATE` batch locking, computed stock (never manually editable), and append-only historical tables.
- **Communication:** Provide explanations and completion reports in **Indonesian** unless requested otherwise, and report only verified command/test outcomes.
