# Domaeng - Privacy Notice

Domaeng is local-first. In the public source distribution, the bridge runs on your Mac, the web app runs in your browser, and any relay you use is either local or self-hosted by you.

The public source tree does not include a managed production relay, analytics service, App Store subscription service, or private push credentials.

During pairing, the web app and bridge exchange cryptographic identity material through the relay. After the secure session is established, application payloads are encrypted end to end between your browser and bridge. The relay should not need plaintext prompts, responses, or git operation payloads.

Operational data may still exist in places you control, including browser storage, local bridge state, Codex session files, relay logs, shell history, and your git repositories. If you configure third-party services such as OpenAI, GitHub, Cloudflare, APNs, or a hosting provider, their privacy terms apply to data they process.

Historical internal identifiers may remain in file names, storage keys, or protocol fields for compatibility with the upstream project and existing local state. They do not imply use of a managed upstream service in this source distribution.
