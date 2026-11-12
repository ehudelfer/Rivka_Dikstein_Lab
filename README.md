# Rivka_Dikstein_Lab

Laboratory equipment ordering application managed by Dr. Anat Bahat.

## Equipment ordering application

GitHub Pages is static and cannot run Flask, sign-in or shared storage. The
[Pages site](https://ehudelfer.github.io/Rivka_Dikstein_Lab/) is therefore a
landing page, not the ordering application. Run the application locally as
follows (Windows PowerShell):

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r equipment_orders\requirements.txt
.\.venv\Scripts\python.exe equipment_orders\app.py
```

Open <http://127.0.0.1:5000/>. New eligible users request approval from Ehud.
Once approved, they request a sign-in link without needing approval again.
Both links require a confirmation click and expire after 24 hours. Without SMTP
configuration, **local development only** prints links to the server console;
no email is sent. Anyone with access to those logs can use the links.

### SMTP and production hosting

Configure `SMTP_HOST`, `SMTP_PORT` (defaults to `587`), `SMTP_USERNAME`,
`SMTP_PASSWORD` and `SMTP_FROM`. SMTP uses STARTTLS. Set these as environment
variables, never in the repository. The administrator receives approval
requests at `ehud.elfer@weizmann.ac.il`.

For a shared deployment, use a Flask-capable host, HTTPS and a persistent,
backed-up private disk. Set `APP_ENV=production`, `SECRET_KEY` to a long
random secret shared across workers, `BASE_URL` to the public HTTPS origin
(for example `https://orders.example.org`), and `DATA_DIR` to the persistent
disk directory. Configure all SMTP settings; production refuses console email.
Serve the application as `equipment_orders.app:app` with a production WSGI
server, not Flask's development server. Keep the database, mail links, logs and
environment variables private. Read access to orders is public by design.
Production hosts should also provide request rate limiting and monitor abuse.

Orders, approved addresses and one-use tokens are stored in SQLite at
`DATA_DIR/equipment_orders.sqlite3`. Lab member names are fetched from the
[lab group page](https://www.weizmann.ac.il/Biomolecular_Sciences/dikstein/group)
and cached at `DATA_DIR/lab_members.json`. An approved user can refresh the
list; if refresh fails, the existing cache is retained. Without a cache and
when the page cannot be reached, the app shows a warning and a minimal fallback.
