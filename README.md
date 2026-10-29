# Transloadit for Bubble

Resumable file uploads and media processing using [Uppy](https://uppy.io) and
[Transloadit](https://transloadit.com). Add an inline Dashboard or an upload button,
then connect processed file URLs to Bubble workflows.

## Use in a Bubble app

The modernization is a release candidate: installation in a real Bubble app and marketplace
publication still need the maintainer's Bubble login. See [the handoff](CONTRIBUTING.md#bubble-handoff-kevin).
The existing plugin is `1550344595465x140038650298630140`; its marketplace URL must be
verified after publication before linking builders to it.

1. Add **Transloadit Uploader** to a page (at least 350px high for an inline Dashboard).
2. Have your backend return **params** (a JSON string) and **signature** (SHA-384).
   Bind those strings to **Signed Assembly params** and **Signature**. Refresh them before each
   upload; signatures expire. Keep the exact params string, including spaces and key order.
3. Set **Inline Dashboard** to yes, or no for an upload button. Set allowed types, maximum files,
   and maximum bytes per file. Defaults: one file, 5 MiB. Sources are local files only.
4. On **Encoding completed**, read **Result URLs** (a list of texts), **Results JSON**, or
   **Assembly JSON**. Other states: **Assembly ID**, **Is uploading**, **Upload progress** (0–100,
   transfer progress; processing may continue), and **Error message**. **Upload started** and
   **Upload error** events allow loading and failure workflows. Use Done or Bubble's reset before
   the next batch; one batch owns the result states at a time.

The `params` string supports a Template ID:

```json
{"auth":{"key":"PUBLIC_AUTH_KEY","expires":"2026-10-30T12:00:00Z"},"template_id":"TEMPLATE_ID"}
```

Or replace `template_id` with `steps` containing your Assembly Instructions. Generate it and
its signature on a trusted server, for example with Node:

```js
import { createHmac } from 'node:crypto'
const params = JSON.stringify({
  auth: { key: process.env.TRANSLOADIT_KEY, expires: new Date(Date.now() + 300_000).toISOString() },
  template_id: 'YOUR_TEMPLATE_ID',
})
const signature = `sha384:${createHmac('sha384', process.env.TRANSLOADIT_SECRET).update(params).digest('hex')}`
// Return { params, signature } through your authenticated backend endpoint.
```

Never put an Auth Secret in Bubble client properties, shared client-safe keys, HTML, or browser code.
Your backend must authorize the request and choose its allowed Template/Instructions rather than
sign arbitrary user-submitted params. See [signature authentication](https://transloadit.com/docs/api/signature-authentication/).

## Existing apps

`VideoWrapper` and its `src` field keep their IDs and behavior. The global **open** action now opens
current Uppy; its existing Auth Key, Template ID, maximum file size, allowed types and notification
URL settings still work. Its optional params/signature inputs enable signed uploads. Legacy
unsigned uploads need a key that permits them; migrate to signed uploads. Notifications still POST
an array of completed Assemblies from the browser (the receiver needs CORS); server notifications
can instead use `notify_url` inside signed params. Old remote-source settings are retained but
unused; this version offers local file selection without Companion/OAuth configuration.

## Develop

Use Node 22.23.4+ (CI also tests 26.12.1) and Yarn 4.12 via Corepack:

```sh
corepack yarn install
corepack yarn build
corepack yarn check
corepack yarn test:browser
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) for the source/build layout, real-API tests,
maintenance decisions and release process. Git commits and CI artifacts do not publish to Bubble.
