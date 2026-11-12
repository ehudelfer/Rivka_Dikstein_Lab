# Rivka_Dikstein_Lab

## Equipment ordering application

Open the [equipment ordering site](https://ehudelfer.github.io/Rivka_Dikstein_Lab/)
or open `equipment_orders/index.html` directly in a modern browser. No server
or installation is required.

Orders are stored in the browser's local storage. They are **not shared or
synced** between users, browsers, or devices and may be lost if browser data
is cleared. Use **Export CSV** or **Export JSON** to back up or share orders;
**Import CSV / JSON** adds the file's orders to the existing table. Importing
the same file twice adds duplicates. Keep backups private if they contain
sensitive information. CSV exports prefix formula-like cells with a tab to
reduce spreadsheet formula injection; use JSON for an exact external backup.

The lab member list is a snapshot of the
[lab group page](https://www.weizmann.ac.il/Biomolecular_Sciences/dikstein/group)
and can be updated in `equipment_orders/index.html`. Choose **Other** for
someone not in the list.

For GitHub Pages, set **Settings > Pages > Build and deployment > Source** to
**GitHub Actions**. The workflow publishes the static ordering page after
changes are pushed to `main`. The old Flask files are retained for reference
but are not used by the static site.
