# Security

## Supported versions

Only the latest tagged release on `main` receives security fixes. Pin a
specific version in `package.json` / `npx notion-exporter@<version>` and
upgrade when a new tag ships.

| Version            | Supported |
|--------------------|-----------|
| Latest `main` tag  | ✅        |
| Older releases     | ❌        |

## Reporting a vulnerability

Report privately through **[GitHub Private Vulnerability Reporting](https://github.com/dmetzner/notion-exporter/security/advisories/new)**.
Please do **not** file public issues for security bugs.

We aim to acknowledge reports within 72 hours and ship a fix or mitigation
within 30 days.

## Threat model

`notion-exporter` is a local CLI that holds a Notion **internal integration
token** in its environment and writes plaintext JSON/Markdown/HTML to disk.
The token grants read access to every page or database shared with the
integration in the workspace.

### What the tool does

- Reads `NOTION_TOKEN` from environment or `.env`.
- Makes HTTPS calls to `api.notion.com` and to the signed `*.amazonaws.com`
  URLs Notion returns for file uploads.
- Writes JSON, Markdown, HTML, and downloaded assets to `OUT_DIR`.

### What the tool does not do

- It never sends data to any third party other than the official Notion API
  endpoints and the signed asset hosts.
- It never writes the token to disk or to log output.
- It does not modify Notion content (no writes — read-only scopes only).

## Operator responsibilities

- Treat `NOTION_TOKEN` like a password. Don't commit it.
- Restrict the integration to the **minimum** set of pages you need archived —
  Notion permissions are inherited from the share root.
- Encrypt the output directory at rest if the workspace contains sensitive data
  (the export is plaintext JSON).
- Rotate the token if a backup is exposed. From Notion: **Settings → Integrations →
  rotate secret**.

## Defense-in-depth notes

A few load-bearing security choices that aren't obvious from the user
docs and that auditors should know about before touching the asset or
renderer layer:

- **SSRF gate per redirect hop.** The asset downloader runs
  `assertPublicHttpUrl` on every URL it touches, including each
  redirect hop. Redirects are handled manually — do **not** switch the
  downloader to `fetch(..., { redirect: "follow" })`, that bypasses the
  gate.
- **DNS-rebinding pin.** After `assertPublicHttpUrl` resolves and
  validates the host's IP, the same IP is pinned through TLS by
  passing a `lookup` override to undici's `Agent.buildConnector`. The
  pre-flight resolution and the TCP connect use the **same** IP,
  closing the TOCTOU window between gate and connect.
- **Redirect-loop guard.** Redirect chains are capped at
  `maxRedirects` and overflow throws a non-retryable
  `RedirectLoopError`.
- **`undici@8.0.2` is a deliberate pin.** It matches the version
  bundled with Node 20 and is the version `@notionhq/client` was
  validated against for response decompression. Bumping it requires
  re-verifying both (a) that `Agent.buildConnector` still exposes the
  `lookup` hook the DNS-rebinding pin relies on, and (b) that the
  Notion client's gzip/brotli decode path still works. Upgrading
  without that verification has broken exports in the past.
- **PDF inline-preview iframe.** PDF blocks backed by a downloaded
  local asset render as `<figure class="pdf-preview"><iframe>…</iframe></figure>`.
  The iframe ships `sandbox="allow-scripts"` **without**
  `allow-same-origin`, and the preview path is gated on a `.pdf`
  extension regex — so a Notion file mis-named `report.html` no longer
  renders as a same-origin iframe.
- **`safeLinkUrl` on every URL-bearing attribute.** Every `<a href>`,
  `<img src>`, `<audio src>`, `<video src>`, and `<iframe src>` emitted
  by the Markdown / HTML renderers flows through `safeLinkUrl`
  (`src/export/markdown.ts`), which rejects `javascript:` / `data:` /
  `file:` / `vbscript:` URIs and returns `#` on rejection. Workspace
  members cannot plant clickable XSS via a Notion `rich_text` `href`
  or a media-block URL.
- **S3 signed-URL log redaction.** Failed-asset warn logs strip
  Notion's `X-Amz-Signature` and related query params so log shipping
  doesn't exfiltrate live download credentials. `manifest.json` is
  similarly scrubbed before write.

## Known limitations

- **No automatic restore.** The Notion public API does not allow recreating a
  workspace from JSON. Exports are an archive, not a snapshot you can press
  "undo" on.
- **Asset URLs expire (~1 h).** The exporter downloads them at export time —
  the JSON in `raw/` retains the original signed URL **plus** a `local_path`
  pointing to the saved file.
- **Operator-tampered raw JSON.** Raw DB JSON now carries two
  operator-controlled fields read back during `rerender` / `repair`:
  the persisted `dataSource` schema (option names / colours from
  `notion.dataSources.retrieve`) and the database `description`
  (which may carry a `%%notion-exporter` JSON config fence).
  The renderer assumes both are workspace-controlled, the same way it
  trusts every other Notion-sourced string. `parseDbConfig` and the
  `dataSource` shape validator (`src/notion/dataSourceSchema.ts`)
  reject malformed inputs structurally, but do **not** sanitize string
  content beyond the renderer's existing `escapeHtmlText` /
  `safeLinkUrl` gates at emission sites. A future refactor that
  introduces a raw-JSON pass-through must keep those emission-site
  gates in place — do not assume the input is pre-sanitised.
- **Rate-limited.** Notion allows ~3 requests/second. Large workspaces (10k+
  blocks) can take several minutes.
