# Rivka_Dikstein_Lab

## Equipment ordering application

Open the [equipment ordering site](https://ehudelfer.github.io/Rivka_Dikstein_Lab/)
or open `equipment_orders/index.html` directly in a modern browser. No server
or installation is required.

With no Firebase configuration, the app uses **Local Mode**: orders stay in
that browser and are not shared. Once configured, **Live Sync Active** means
the app is listening to the shared Firestore database. A connection or
configuration error does not silently switch to local mode; writes are disabled
until the connection is restored. Reload the page after resolving a sync error.

Use **Export CSV** or **Export JSON** to back up orders. Imports add orders
and skip IDs already present (up to 400 orders per import). New exports
contain IDs; older files without IDs are treated as new orders each time.
CSV exports prefix formula-like cells with a tab to reduce spreadsheet formula
injection; use JSON for an exact external backup. An identical pending item
produces a warning but can still be ordered again.

### Enable Firestore live sync

**Public access warning:** The requested no-login setup allows *anyone on the
internet* to read, add, edit and delete these orders and consume your Firebase
quota. The sample rules validate the shape of orders but do not protect access.
Use only non-sensitive data; a private lab database requires authentication
and restrictive Firestore rules. Monitor usage and billing in Firebase.

1. In the [Firebase console](https://console.firebase.google.com/), create a
   project and register a **Web app**. The free Spark plan has usage limits.
2. Create a **Cloud Firestore** database in the Firebase console.
3. In Firestore **Rules**, paste and publish the contents of
   `equipment_orders/firestore.rules`. These rules intentionally allow public
   access to the `lab_orders` collection.
4. In Project settings, copy the web app configuration into `firebaseConfig`
   at the top of `equipment_orders/app.js`. Fill at least `apiKey`, `projectId`,
   and `appId`; include `authDomain` from the configuration too. Firebase web
   configuration is public, not an admin credential. Never paste a
   service-account key into the site.
5. Push the updated files to `main` and wait for GitHub Pages to deploy. Open
   the site on two devices and check for **Live Sync Active**.

Existing local orders are not automatically uploaded. After enabling Firebase,
use **Export local backup** on the original browser, then import that JSON into
the live table once. The original browser data remains untouched. Re-imports
of the same ID-bearing backup are skipped; exports from the older app that have
no IDs do not have this guarantee.

The lab member list is a snapshot of the
[lab group page](https://www.weizmann.ac.il/Biomolecular_Sciences/dikstein/group)
and can be updated in `equipment_orders/app.js`. Choose **Other** for
someone not in the list.

For GitHub Pages, set **Settings > Pages > Build and deployment > Source** to
**GitHub Actions**. The workflow publishes the static ordering page after
changes are pushed to `main`. The old Flask files are retained for reference
but are not used by the static site.
