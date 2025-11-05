import json
import os
from flask import Flask, request, jsonify
from flask_cors import CORS
from config import ADMIN_USERNAME, ADMIN_PASSWORD, SECRET_KEY

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
EMAIL_STORE = os.path.join(BASE_DIR, 'emails.json')

app = Flask(__name__)
app.config['SECRET_KEY'] = SECRET_KEY
CORS(app, supports_credentials=True)


def load_emails():
    try:
        with open(EMAIL_STORE, 'r', encoding='utf-8') as handle:
            data = json.load(handle)
            if isinstance(data, list):
                return data
    except FileNotFoundError:
        pass
    except json.JSONDecodeError:
        pass
    return []


def persist_emails(emails):
    with open(EMAIL_STORE, 'w', encoding='utf-8') as handle:
        json.dump(sorted(emails), handle, indent=2)


@app.post('/api/login')
def login():
    payload = request.get_json() or {}
    username = payload.get('username', '').strip()
    password = payload.get('password', '').strip()

    if username == ADMIN_USERNAME and password == ADMIN_PASSWORD:
        return jsonify({'success': True}), 200

    return jsonify({'success': False, 'message': 'Invalid username or password'}), 401


@app.get('/api/emails')
def get_emails():
    return jsonify({'emails': load_emails()})


@app.post('/api/emails')
def add_email():
    payload = request.get_json() or {}
    email = payload.get('email', '').strip()

    if not email:
        return jsonify({'error': 'Email is required.'}), 400

    emails = load_emails()
    if email in emails:
        return jsonify({'error': 'Email already exists.', 'emails': emails}), 409

    emails.append(email)
    persist_emails(emails)
    return jsonify({'emails': emails})


@app.delete('/api/emails')
def remove_email():
    payload = request.get_json() or {}
    email = payload.get('email', '').strip()

    if not email:
        return jsonify({'error': 'Email is required.'}), 400

    emails = load_emails()
    if email not in emails:
        return jsonify({'error': 'Email not found.', 'emails': emails}), 404

    emails = [item for item in emails if item != email]
    persist_emails(emails)
    return jsonify({'emails': emails})


if __name__ == '__main__':
    if not os.path.exists(EMAIL_STORE):
        persist_emails([])
    app.run(host='0.0.0.0', port=5001, debug=True)
