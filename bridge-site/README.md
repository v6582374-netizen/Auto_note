# MuseMark Auth Bridge

Deploy this folder to your HTTPS domain (example: `https://bridge.musemark.app`).

Required routes:
- `/` -> index page
- `/auth/callback` -> `auth-callback.html`
- `/privacy.html`
- `/terms.html`
- `/account-deletion.html`

For static hosts that do not support extension-less paths, configure rewrite:
- `/auth/callback` -> `/auth-callback.html`
