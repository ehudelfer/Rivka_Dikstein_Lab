import re
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import urlsplit

import requests

from equipment_orders import app as application


class ApplicationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        application.app.config.update(TESTING=True, DATA_DIR=self.directory.name, SECRET_KEY="test-secret")
        self.client = application.app.test_client()
        self.client.get("/")
        with self.client.session_transaction() as session:
            self.csrf = session["csrf"]
        self.headers = {"X-CSRF-Token": self.csrf}
        self.order = {
            "insertDate": "2026-11-12", "memberName": "Researcher", "orderedItem": "Tips",
            "productName": "", "serialNumber": "", "sortingGroup": "Weizmann Warehouse",
            "deliveryDate": "2026-11-20", "status": "Pending",
        }

    def tearDown(self):
        self.directory.cleanup()

    def request_link(self, email):
        with patch.object(application, "deliver_email", return_value="email") as mail:
            response = self.client.post("/api/access", json={"email": email}, headers=self.headers)
        self.assertEqual(response.status_code, 200)
        body = mail.call_args.args[2]
        return urlsplit(re.search(r"http://\S+", body).group()).path

    def confirm_link(self, path):
        response = self.client.get(path)
        self.assertEqual(response.status_code, 200)
        with self.client.session_transaction() as session:
            csrf = session["csrf"]
        return self.client.post(path, data={"csrf": csrf})

    def sign_in(self, email="researcher@weizmann.ac.il"):
        approval = self.request_link(email)
        self.assertEqual(self.confirm_link(approval).status_code, 200)
        self.assertEqual(self.client.get(approval).status_code, 400)
        signin = self.request_link(email)
        self.assertEqual(self.confirm_link(signin).status_code, 302)
        self.client.get("/")
        with self.client.session_transaction() as session:
            self.headers = {"X-CSRF-Token": session["csrf"]}

    def test_approval_signin_and_persistent_order_crud(self):
        self.assertEqual(self.client.post("/api/orders", json=self.order, headers=self.headers).status_code, 403)
        self.assertEqual(self.client.post("/api/access", json={"email": "a@example.com"}, headers=self.headers).status_code, 400)
        self.assertEqual(self.client.post("/api/access", json={"email": "a@weizmann.ac.il.evil.test"}, headers=self.headers).status_code, 400)
        self.sign_in()
        created = self.client.post("/api/orders", json=self.order, headers=self.headers)
        self.assertEqual(created.status_code, 201)
        order_id = created.json["order"]["id"]
        other_client = application.app.test_client()
        self.assertEqual(other_client.get("/api/orders").json["orders"][0]["id"], order_id)
        changed = dict(self.order, status="Delivered", productName="Model")
        self.assertEqual(self.client.put(f"/api/orders/{order_id}", json=changed, headers=self.headers).json["order"]["status"], "Delivered")
        self.assertEqual(self.client.put(f"/api/orders/{order_id}", json=dict(changed, status="Invalid"), headers=self.headers).status_code, 400)
        self.assertEqual(self.client.delete(f"/api/orders/{order_id}").status_code, 403)
        self.assertEqual(self.client.delete(f"/api/orders/{order_id}", headers=self.headers).status_code, 200)
        self.assertEqual(other_client.get("/api/orders").json["orders"], [])

    def test_email_failure_and_token_replay(self):
        with patch.object(application, "deliver_email", side_effect=OSError("offline")):
            response = self.client.post("/api/access", json={"email": "person@weizzman.ac.il"}, headers=self.headers)
        self.assertEqual(response.status_code, 503)
        with application.database() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM tokens").fetchone()[0], 0)
        self.sign_in("person@weizzman.ac.il")
        self.assertEqual(self.client.post("/api/signout", headers=self.headers).status_code, 200)
        self.assertEqual(self.client.post("/api/orders", json=self.order, headers=self.headers).status_code, 403)

    def test_member_refresh_cache_and_fallback(self):
        html = """
            <div class="pi-item"><h2 class="pi-title">Prof. Rivka Dikstein</h2></div>
            <ul class="current-group">
              <li class="current-team-item"><h2 class="team-title">Dr.
                         A Researcher</h2></li>
              <li class="current-team-item"><h2 class="team-title">Student B</h2></li>
            </ul>
            <ul class="alumni"><li class="team-title">Past Member</li></ul>
        """
        response = unittest.mock.Mock(text=html)
        with patch.object(application.requests, "get", return_value=response):
            names = application.get_lab_members(refresh=True)
        self.assertEqual(names, ["Prof. Rivka Dikstein", "Dr. A Researcher", "Student B", "Other"])
        with patch.object(application.requests, "get", side_effect=requests.ConnectionError("offline")):
            self.assertEqual(application.get_lab_members(), names)
            self.sign_in()
            failed = self.client.post("/api/refresh-members", headers=self.headers)
            self.assertEqual(failed.status_code, 502)
            self.assertEqual(self.client.get("/api/members").json["members"], names)
        with patch.object(application.requests, "get", return_value=unittest.mock.Mock(text="<h1>Changed page</h1>")):
            with self.assertRaises(ValueError):
                application.get_lab_members(refresh=True)
        self.assertEqual(application.get_lab_members(), names)


if __name__ == "__main__":
    unittest.main()
