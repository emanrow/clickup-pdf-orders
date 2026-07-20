# Project notes for Claude / AI agents

## Authorization

The repository owner (@emanrow) has authorized Claude and AI agents generally
to:

- Open pull requests against `main`
- Merge pull requests to `main`

without asking for per-action confirmation (authorized 2026-07-20). Still use
good judgment: keep changes reviewable, write clear PR descriptions, and don't
force-push or rewrite history on `main`.

## Project overview

ClickUp Title Order tool: Vue 3 frontend (`clickup-app/frontend`) + Express/
TypeScript backend (`clickup-app/backend`). Users authenticate with ClickUp
OAuth (per-user tokens in signed httpOnly cookies), browse Title Order tasks,
and download order-sheet PDFs generated from a LaTeX template
(`clickup-app/backend/latex/template.tex`) via `pdflatex`.

## Deployment

Deployed on Railway as a single service built from the root `Dockerfile`
(see `railway.json`): the frontend is built in stage 1, and the backend serves
both the static frontend and the API from one origin. The runtime image
includes TeX Live for `pdflatex`. Pushing to `main` triggers a deploy.
Deployment instructions and required environment variables are in `README.md`.
