# PFI AI Agent Instructions — Installation

This package contains project instructions for Gemini Code Assist and GitHub Copilot in VS Code.

## Files

- `GEMINI.md` — root-level context file for Gemini Code Assist Agent Mode in VS Code (also compatible with Gemini CLI context loading).
- `AGENTS.md` — root-level agent instructions for GitHub Copilot Agent and other agents that support the AGENTS.md convention.
- `.github/copilot-instructions.md` — repository-wide entry point for GitHub Copilot Chat/Agent in VS Code; points Copilot to the complete root `AGENTS.md`.

## Install

1. Open the actual PFI repository folder in VS Code (the folder that contains `.git`).
2. Copy `GEMINI.md` and `AGENTS.md` into the repository root.
3. Copy the included `.github/copilot-instructions.md` into the repository's `.github/` folder. Create `.github/` if it does not exist. Preserve any existing content instead of overwriting it blindly.
4. Keep the files under version control so both agents and other contributors use the same rules.
5. Start a new Gemini or Copilot Agent session. For Gemini Code Assist Agent Mode, confirm the context file is loaded. For Copilot, check that repository custom instructions are enabled and that the agent can read the root `AGENTS.md`.

## Project documentation expected beside the instructions

The instructions refer to these project documents:

- `master_blueprint_api_contract_pfi_main.md`
- `prd.md`
- `architecture.md`
- `implementation_plan.md`

If the documents live in `docs/` or another folder, update the references or keep the actual path discoverable. Do not create duplicate documents just to satisfy the file paths.

## Important project note

The actual repository source code has not been audited as part of preparing this instruction package. While the decoupled REST API style and **Node.js + TypeScript** candidate ecosystem (Express.js/NestJS, Next.js/Vue.js, Prisma/TypeORM) are marked `APPROVED — OWNER` in `architecture.md`, the single final framework per layer, styling library, exact folder structure, deployment target, and test tooling are intentionally marked **not yet locked**. The first implementation task must be `P0-01 — Audit repository awal`, followed by locking single-choice decisions in `P0-02`.

## Keeping instructions consistent

`AGENTS.md` is the canonical full rules document in this package. `GEMINI.md` is an identical copy so Gemini Code Assist loads the rules from its native context filename. When editing project rules, update both files in the same commit. Keep `.github/copilot-instructions.md` as the short Copilot entry point and update its critical guardrails if the canonical rules change.
