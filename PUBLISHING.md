# Publishing

The plugin is published to the EmDash plugin registry as `@qqq.ee/ai-visibility`. Publishing needs an Atmosphere (Bluesky) account whose handle is `qqq.ee`; only its owner can log in, so steps 1–3 are done by hand.

1. **Account.** Create a Bluesky account (any provider) and change its handle to `qqq.ee`: Settings → Account → Handle → "I have my own domain" → DNS. Bluesky shows a TXT record `_atproto.qqq.ee` with the value `did=did:plc:…`; add it in Cloudflare DNS for qqq.ee and verify. Keep the record: if the handle stops resolving, the listing shows "INVALID HANDLE" and new installs are blocked.
2. **Publisher.** Replace the placeholder `did:plc:qqqeeplaceholderxxxxxxxx` in `emdash-plugin.jsonc` with that DID and commit.
3. **Login.** `pnpm run login -- qqq.ee` opens the provider's sign-in page in the browser; EmDash never sees the password.
4. **Check and publish.**

   ```sh
   pnpm install
   pnpm run validate && pnpm run typecheck && pnpm run test
   pnpm run publish
   ```

   `publish` builds the bundle, uploads it and the icon to the account's PDS and writes the release record. It prints an `emdash-plugin info … --watch` command; the listing appears on plugins.emdashcms.com only after the registry's moderation labeler approves it.
5. **Check the listing.** On the plugin page, the author link (`https://qqq.ee/en/`) and the links in the overview (this README) should have no `rel="nofollow"`.

## New versions

Releases are immutable. Bump `version` in `package.json` (patch for fixes, minor for new routes or hooks, major when the trust contract widens), add a line to `CHANGELOG.md`, and publish again. Any change to `capabilities`, `allowedHosts` or `storage` needs a version bump, and installed sites must approve it.

## Server side

The plugin calls `https://qqq.ee/mcp`. Calls from Cloudflare Workers are counted per calling zone (`CF-Worker` header), not per IP, so each site has its own daily limit of five technical checks; see `docs/ai-visibility/DECISIONS.md` (01.11.2026) in the qqq.ee site repository.
