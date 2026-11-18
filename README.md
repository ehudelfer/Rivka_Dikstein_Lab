# Rivka_Dikstein_Lab

## Equipment ordering application

Open the [equipment ordering site](https://ehudelfer.github.io/Rivka_Dikstein_Lab/)
or open `equipment_orders/index.html` directly in a modern browser. No server
or installation is required.

The app is configured for Firebase Realtime Database, with orders stored under
`/orders`. **Live Cloud Sync Active** indicates an established connection and
an initial orders snapshot. Connection or configuration errors do not switch
to local storage; writes are disabled until connected. Reload the page after
resolving a sync error.

Use **Export CSV** or **Export JSON** to back up orders. Imports add orders
and skip IDs already present (up to 400 orders per import). New exports
contain IDs; older files without IDs are treated as new orders each time.
CSV exports prefix formula-like cells with a tab to reduce spreadsheet formula
injection; use JSON for an exact external backup. An identical pending item
produces a warning but can still be ordered again.

Price quotes are optional PDF files up to 4 MiB, stored in the shared database.
JSON backups include the PDF; CSV backups include its filename only, so a CSV
import cannot restore the file. The actual order date is set when an order
changes to Ordered and can be adjusted when editing. Ordered and Delivered
rows provide an order-number field.

For receiving, open the site with `?mode=delivery` or `#delivery`, or choose
**Delivery Receiving Mode** on the dashboard. Select ordered items and confirm
to mark them Delivered with today's local delivery date. The list updates live;
failed updates remain selectable and are reported. The page checks current
status before each update, but another user's concurrent change can still race
with that check.

Run `python equipment_orders/generate_qr.py` with the `qrcode` and Pillow
packages installed to create `lab_orders_qr.png` and
`delivery_receiving_qr.png` in the current directory. Both use the GitHub Pages
root, where the deployment publishes the application.

### Enable Realtime Database live sync

**Public access warning:** If the Realtime Database rules permit this no-login
app to read and write, *anyone on the internet* can read, add, edit and delete
orders and attached PDFs and consume your Firebase quota. Use only non-sensitive data; a private
lab database requires authentication and restrictive rules. Monitor usage and
billing in Firebase.

1. In the [Firebase console](https://console.firebase.google.com/), open
   **Realtime Database**, select the configured database, and review its Rules.
2. The current app does not sign users in. To allow it to work without login,
   the rules must allow unauthenticated reads and writes at `/orders`, including
   writes to that entire path for imports. For example, add the following
   `orders` rule inside the existing top-level `rules` object, preserving any
   other rules:

   ```json
   "orders": { ".read": true, ".write": true }
   ```

   **This example makes all orders publicly readable and writable** and does
   not validate their contents. Publish it only if that exposure is acceptable.
   Never paste a service-account key into the site.
3. Push the updated files to `main` and wait for GitHub Pages to deploy. Open
   the site on two devices and check for **Live Cloud Sync Active**.

Existing local orders are not automatically uploaded. Use **Export local
backup** on the original browser, then import that JSON into the live table
once. This only reads the old browser data; the table uses the database.
Re-imports of the same ID-bearing backup are skipped. Older local orders
without IDs receive new IDs in each export, so separately exported backups
can create duplicates. Orders in the former Firestore collection are not
automatically migrated; export them from the old app and import the backup
into Realtime Database. Edit and delete operations check the latest received
order for conflicts, but simultaneous changes can still overwrite one another
between that check and the write.

The lab member list is a snapshot of the
[lab group page](https://www.weizmann.ac.il/Biomolecular_Sciences/dikstein/group)
and can be updated in `equipment_orders/app.js`. Choose **Other** for
someone not in the list.

For GitHub Pages, set **Settings > Pages > Build and deployment > Source** to
**GitHub Actions**. The workflow publishes the static ordering page after
changes are pushed to `main`. The old Flask files are retained for reference
but are not used by the static site.
