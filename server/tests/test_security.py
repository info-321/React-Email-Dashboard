"""Exercise API protection without real credentials or Google requests."""
import base64
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import types
import unittest
from unittest.mock import MagicMock, patch


class SecurityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        config = types.ModuleType('config')
        config.ADMIN_USERNAME = 'test-admin'
        config.ADMIN_PASSWORD = 'test-password-with-spaces '
        config.SECRET_KEY = 'test-only-signing-key-never-use-in-production'
        config.NOTION_API_SECRET = ''
        config.NOTION_DATABASE_ID = ''
        config.NOTION_API_VERSION = '2022-06-28'
        config.NOTION_ANALYTICS_SCHEMA = {}
        app_path = Path(__file__).resolve().parents[1] / 'app.py'
        env = {
            'ADMIN_USERNAME': config.ADMIN_USERNAME,
            'ADMIN_PASSWORD': config.ADMIN_PASSWORD,
            'SECRET_KEY': config.SECRET_KEY,
            'SESSION_COOKIE_SECURE': 'true',
            'CORS_ORIGINS': '',
        }
        with patch.dict(sys.modules, {'config': config}), patch.dict(os.environ, env):
            spec = importlib.util.spec_from_file_location('emailhub_under_test', app_path)
            cls.module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(cls.module)
        cls.app = cls.module.app
        cls.app.config['TESTING'] = True

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.email_store = Path(self.temp.name) / 'emails.json'
        self.email_store.write_text('[]', encoding='utf-8')
        self.store_patch = patch.object(self.module, 'EMAIL_STORE', str(self.email_store))
        self.store_patch.start()
        self.addCleanup(self.store_patch.stop)
        self.client = self.app.test_client()

    def request(self, path, method='GET', **kwargs):
        return self.client.open(path, method=method, base_url='https://localhost', **kwargs)

    def token(self):
        return self.request('/api/session').get_json()['csrfToken']

    def login(self):
        response = self.request('/api/login', method='POST',
            headers={'X-CSRF-Token': self.token()},
            json={'username': 'test-admin', 'password': 'test-password-with-spaces '})
        self.assertEqual(response.status_code, 200)
        return response.get_json()['csrfToken']

    def test_every_private_endpoint_requires_login(self):
        public = {'login', 'session_status', 'health', 'serve_frontend'}
        values = {'email': 'mailbox@example.com', 'message_id': 'message', 'attachment_id': 'attachment'}
        for rule in self.app.url_map.iter_rules():
            if rule.endpoint in public:
                continue
            path = rule.rule
            for name, value in values.items():
                path = path.replace(f'<path:{name}>', value).replace(f'<{name}>', value)
            for method in rule.methods - {'HEAD', 'OPTIONS'}:
                with self.subTest(path=path, method=method):
                    self.assertEqual(self.request(path, method=method, json={}).status_code, 401)

    def test_login_requires_csrf_token(self):
        response = self.request('/api/login', method='POST',
            json={'username': 'test-admin', 'password': 'test-password-with-spaces '})
        self.assertEqual(response.status_code, 403)

    def test_bad_credentials_do_not_authenticate(self):
        response = self.request('/api/login', method='POST',
            headers={'X-CSRF-Token': self.token()},
            json={'username': 'test-admin', 'password': 'wrong'})
        self.assertEqual(response.status_code, 401)
        self.assertFalse(self.request('/api/session').get_json()['authenticated'])

    def test_malformed_login_returns_bad_request(self):
        for payload in ([1], {'username': None}, {'username': 'test-admin', 'password': 123}):
            with self.subTest(payload=payload):
                response = self.request('/api/login', method='POST',
                    headers={'X-CSRF-Token': self.token()}, json=payload)
                self.assertEqual(response.status_code, 400)

    def test_session_restoration_and_cookie_security(self):
        token = self.login()
        response = self.request('/api/session')
        self.assertTrue(response.get_json()['authenticated'])
        self.assertEqual(response.get_json()['csrfToken'], token)
        cookie = self.client.get_cookie('emailhub_session')
        self.assertTrue(cookie.secure)
        self.assertTrue(cookie.http_only)
        self.assertEqual(cookie.same_site, 'Lax')

    def test_csrf_rotates_on_login_and_protects_saved_addresses(self):
        old_token = self.token()
        token = self.login()
        self.assertNotEqual(old_token, token)
        for rejected in (None, 'wrong', old_token, 'invalid-\u00e9'):
            headers = {'X-CSRF-Token': rejected} if rejected else {}
            with self.subTest(token=rejected):
                response = self.request('/api/emails', method='POST', headers=headers,
                    json={'email': 'mailbox@example.com'})
                self.assertEqual(response.status_code, 403)
        self.assertEqual(json.loads(self.email_store.read_text()), [])
        added = self.request('/api/emails', method='POST', headers={'X-CSRF-Token': token},
            json={'email': 'mailbox@example.com'})
        self.assertEqual(added.status_code, 200)
        self.assertEqual(self.request('/api/emails').get_json()['emails'], ['mailbox@example.com'])
        deleted = self.request('/api/emails', method='DELETE', headers={'X-CSRF-Token': token},
            json={'email': 'mailbox@example.com'})
        self.assertEqual(deleted.get_json()['emails'], [])

    def test_logout_clears_session(self):
        token = self.login()
        self.assertEqual(self.request('/api/logout', method='POST',
            headers={'X-CSRF-Token': token}).status_code, 200)
        self.assertFalse(self.request('/api/session').get_json()['authenticated'])
        self.assertEqual(self.request('/api/emails').status_code, 401)

    def test_expired_session_cannot_access_mailboxes(self):
        nine_hours_ago = time.time() - 9 * 60 * 60
        with patch('itsdangerous.timed.time.time', return_value=nine_hours_ago):
            self.login()
        self.assertEqual(self.request('/api/emails').status_code, 401)
        self.assertFalse(self.request('/api/session').get_json()['authenticated'])

    def test_attachment_download_uses_session_cookie(self):
        self.login()
        service = MagicMock()
        service.users.return_value.messages.return_value.attachments.return_value.get.return_value.execute.return_value = {
            'data': base64.urlsafe_b64encode(b'test attachment').decode(),
        }
        with patch.object(self.module, 'build_gmail_service', return_value=service):
            response = self.request('/api/mailbox/mailbox@example.com/attachments/message/attachment')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, b'test attachment')
        self.assertIn('attachment', response.headers['Content-Disposition'])

    def test_health_is_public_and_api_responses_are_not_cached(self):
        response = self.request('/api/health')
        self.assertEqual(response.get_json(), {'status': 'ok'})
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertEqual(response.headers['X-Content-Type-Options'], 'nosniff')
        self.assertNotIn('Access-Control-Allow-Origin', response.headers)

    def test_flask_serves_react_static_assets_and_rejects_unknown_api_paths(self):
        build = Path(self.temp.name) / 'build'
        (build / 'static' / 'js').mkdir(parents=True)
        (build / 'index.html').write_text('<html>React app</html>', encoding='utf-8')
        (build / 'static' / 'js' / 'main.js').write_text('/* bundled app */', encoding='utf-8')
        with patch.object(self.module, 'STATIC_DIR', str(build)):
            with self.request('/') as response:
                self.assertEqual(response.status_code, 200)
                self.assertIn(b'React app', response.data)
            with self.request('/static/js/main.js') as response:
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.data, b'/* bundled app */')
        self.login()
        response = self.request('/api/does-not-exist')
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.get_json()['error'], 'API endpoint not found.')


if __name__ == '__main__':
    unittest.main()
