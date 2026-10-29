# Contributing

## Layout and checks

Bubble remains the primary plugin store. Keep `actions/`, `elements/`, `api/`,
`html_headers.html`, `meta_data.json` and `shared_tech_params.json` in their export layout;
never rename existing opaque IDs. New element `AAu` coexists with legacy `AAp`.

Edit TypeScript in `src/`, then run `corepack yarn build` and commit the generated callbacks and
header. The header loads the pinned official Uppy 6.0.5 ESM/CSS CDN bundle, whose core 6.3.0,
Dashboard 6.0.2 and Transloadit 6.0.1 match the typed npm dependencies. Upgrade these together;
Dependabot cannot choose the corresponding CDN release for you. Only our glue is minified into
the header; no vendored Uppy bundle needs reviewing. Apps must allow `releases.transloadit.com`
and Transloadit's API/upload/result hosts through their CSP/network policy.

`corepack yarn check` runs Biome, TypeScript, Vitest with enforced coverage, and deterministic
build verification. `corepack yarn fix` formats source. `corepack yarn test:browser` exercises the
actual generated header and callbacks in Chromium, through Bubble-shaped canvas/state/event APIs.
Install Chromium once with `corepack yarn playwright install chromium`. Unit tests cover lifecycle,
signature byte preservation, progress/results, failures, reset, multiple updates and legacy uploads.

## Real API tests

Use the opentest key from node-sdk as process environment only, without editing or copying `.env`:

```sh
corepack yarn build
BUBBLE_REAL_API=1 node --env-file="$HOME/code/node-sdk/.env" node_modules/@playwright/test/cli.js test
```

This mounts the built element, selects a generated non-customer PNG, performs a signed tus upload,
waits for a real `/image/resize` result, and downloads it. It creates a billable test Assembly but
no persistent Template. The local signer keeps the Auth Secret in Node; only signed params reach
the browser. Traces and request payload recording are disabled to keep credentials out of artifacts.

CI requires `BUBBLE_E2E_TRANSLOADIT_KEY` and `BUBBLE_E2E_TRANSLOADIT_SECRET` as Actions secrets
(and Dependabot secrets for dependency PRs). The test receives them as `TRANSLOADIT_KEY` and
`TRANSLOADIT_SECRET`. Internal PRs fail clearly when missing; fork PRs run unit/browser checks only.

## Versioning and release candidates

Add a user-facing Changeset with `corepack yarn changeset`. On main, Changesets opens a version PR
that updates `package.json` and `CHANGELOG.md`. Merge the version PR, then download that commit's
`bubble-candidate-<sha>` artifact from **Release candidate** Actions. The archive and SHA-256 file
contain only Bubble's export. Locally, `corepack yarn release:prepare` produces the same handoff.
Candidates are built on main only when no Changesets remain pending; use the version PR's commit for publication.
Changesets versions are repository candidates; record Bubble's separately assigned published
version in the release notes. There is deliberately no automatic Bubble deploy or user migration.

## Bubble handoff (Kevin)

1. In a clean checkout of the reviewed/merged commit, run `corepack yarn install --immutable`,
   `corepack yarn check`, then `corepack yarn release:prepare`. Verify the archive SHA-256 before
   handing it off. Keep the prior published version available for rollback.
2. Log in to [the existing plugin editor](https://bubble.io/plugin_editor?id=1550344595465x140038650298630140).
   Under **Version → GitHub**, synchronize the existing repository after the PR is merged. Bubble
   pulls the export; resolve any editor/GitHub conflicts before continuing. Do not create a new plugin.
   If synchronization is unavailable, the archive maps directly to tabs: Shared HTML header and
   shared keys, General metadata, Elements (`AAp` and `AAu`) and Actions (`AAF`). Paste complete
   function expressions from the matching generated `.js` files; declare fields/states/events
   exactly as in their `params.json`. Do not replace the old element or action IDs.
3. Check **Shared → HTML header** uses the current `html_headers.html`, and confirm the new
   **Transloadit Uploader** fields/states/events appear. Keep jQuery disabled; the uploader supports
   both DOM and Bubble's jQuery-style canvas wrapper without depending on jQuery.
4. In the plugin editor's test-app setting, choose a disposable Bubble app, then **Go to test app**
   to install/refresh this development plugin. Add the new element and an authenticated backend
   signer; bind its returned params/signature strings. Never expose the Auth Secret to the page.
5. In editor and run mode, test Template ID and Instructions; inline Dashboard and button; valid
   upload to completed result URLs; expired signature; type/size restriction; cancel/reset; a second
   upload; two instances; and page navigation away during upload. Verify existing VideoWrapper and
   open-action workflows. Repeat at desktop and 390px; check browser errors/network and CORS on any
   legacy notification URL. Confirm both result URLs and Bubble workflow events, not screenshots alone.
6. Only after that pass, deploy from **Version**, selecting the appropriate change type and copying
   the Changeset release notes. Verify the marketplace listing opens while signed out, install the
   published version in the test app, and repeat an upload. Update README with its verified URL and
   record the published Bubble version, repository commit and test evidence on #1. Then close #1.
   If anything fails, keep the current published version and fix the candidate; if already deployed,
   restore its saved export and publish a corrective version from the editor.

[Bubble's GitHub integration](https://manual.bubble.io/account-and-marketplace/building-plugins/github-integration)
explains synchronization; [publishing](https://manual.bubble.io/account-and-marketplace/building-plugins/publishing-and-versioning)
is a separate editor action. These login-dependent steps remain unexecuted by CI.

## Maintenance decisions

Tooling follows transloadit/zapier's commits from 2026-10-14 through 2026-10-21: Yarn 4, Biome,
TypeScript, Vitest, tests of the actual built artifact, Changesets, PR CI and weekly grouped updates.
We preserve legacy IDs like Zapier preserves saved Zap contracts. Bubble has no Zapier-style CLI
upload/promote/migrate, so releases produce an export and explicit human handoff. The official CDN
keeps the export small; a future custom bundle can reduce unused Uppy plugins if download size matters.
