import base64
import json
import os
from email.mime.text import MIMEText
from flask import Flask, request, jsonify
from flask_cors import CORS
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from config import ADMIN_USERNAME, ADMIN_PASSWORD, SECRET_KEY

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
EMAIL_STORE = os.path.join(BASE_DIR, 'emails.json')
SERVICE_ACCOUNT_FILE = os.path.join(BASE_DIR, 'workspace_service_account.json')
SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.send'
]
LABEL_CONFIG = {
    'inbox': {'label_ids': ['INBOX']},
    'sent': {'label_ids': ['SENT']},
    'drafts': {'label_ids': ['DRAFT']},
    'starred': {'label_ids': ['STARRED']},
    'spam': {'label_ids': ['SPAM']},
    'deleted': {'label_ids': ['TRASH']},
    'archive': {'label_ids': ['ALL'], 'query': '-in:trash -in:spam'},
}

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


def build_gmail_service(user_email: str):
    if not os.path.exists(SERVICE_ACCOUNT_FILE):
        raise FileNotFoundError("workspace_service_account.json is missing.")

    creds = service_account.Credentials.from_service_account_file(
        SERVICE_ACCOUNT_FILE, scopes=SCOPES
    )
    delegated = creds.with_subject(user_email)
    return build('gmail', 'v1', credentials=delegated, cache_discovery=False)


def fetch_label_counts(service, user_email: str):
    stats = {}
    response = service.users().labels().list(userId=user_email).execute()
    labels = response.get('labels', [])
    totals = {label['id'].lower(): label.get('messagesTotal') for label in labels}
    for key, cfg in LABEL_CONFIG.items():
        label_ids = cfg.get('label_ids', [])
        stats[key] = 0
        for label_id in label_ids:
            count = totals.get(label_id.lower())
            if count is not None:
                stats[key] = count
                break
    return stats, [
        {'id': label['id'], 'name': label['name'], 'type': label.get('type')}
        for label in labels
    ]


def fetch_messages(service, user_email: str, label_ids=None, query=None, max_results=25, page_token=None):
    try:
        list_args = {
            'userId': user_email,
            'maxResults': max_results,
        }
        if label_ids:
            list_args['labelIds'] = label_ids
        if query:
            list_args['q'] = query
        if page_token:
            list_args['pageToken'] = page_token

        response = service.users().messages().list(**list_args).execute()
        message_refs = response.get('messages', [])
        messages = []
        for ref in message_refs:
            msg = service.users().messages().get(userId=user_email, id=ref['id'], format='metadata', metadataHeaders=['Subject', 'From', 'To', 'Date']).execute()
            headers = {h['name']: h['value'] for h in msg.get('payload', {}).get('headers', [])}
            messages.append({
                'id': msg['id'],
                'snippet': msg.get('snippet', ''),
                'subject': headers.get('Subject', '(No subject)'),
                'from': headers.get('From', ''),
                'to': headers.get('To', ''),
                'date': headers.get('Date', ''),
                'labelIds': msg.get('labelIds', []),
            })
        return messages, response.get('nextPageToken'), response.get('resultSizeEstimate')
    except HttpError as err:
        raise err
    except Exception as exc:
        raise exc


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


@app.get('/api/mailbox/<path:email>/overview')
def mailbox_overview(email):
    try:
        service = build_gmail_service(email)
        counts, labels = fetch_label_counts(service, email)
        return jsonify({'labels': labels, 'counts': counts})
    except FileNotFoundError as missing:
        return jsonify({'error': str(missing)}), 500
    except HttpError as err:
        return jsonify({'error': f'Gmail API error: {err}' }), err.status_code
    except Exception as exc:
        app.logger.exception("Unexpected error while loading mailbox overview for %s", email)
        return jsonify({'error': f'Unexpected error: {exc}'}), 500


@app.get('/api/mailbox/<path:email>/messages')
def mailbox_messages(email):
    folder = request.args.get('folder', 'inbox').lower()
    max_results = min(int(request.args.get('maxResults', 25)), 100)
    search_query = (request.args.get('query') or '').strip()
    page_token = request.args.get('pageToken')

    config = LABEL_CONFIG.get(folder)
    if not config:
        return jsonify({'error': 'Unsupported folder'}), 400

    try:
        service = build_gmail_service(email)
        combined_query = config.get('query', '').strip()
        if search_query:
            combined_query = f"{combined_query} {search_query}".strip()
        query_value = combined_query or None

        messages = fetch_messages(
            service,
            email,
            label_ids=config.get('label_ids'),
            query=query_value,
            max_results=max_results,
            page_token=page_token
        )
        message_list, next_token, estimate = messages
        return jsonify({
            'messages': message_list,
            'nextPageToken': next_token,
            'resultSizeEstimate': estimate
        })
    except HttpError as err:
        return jsonify({'error': f'Gmail API error: {err}' }), err.status_code
    except Exception as exc:
        app.logger.exception("Unexpected error while loading messages for %s", email)
        return jsonify({'error': f'Unexpected error: {exc}'}), 500


def encode_message(to_addr, subject, body):
    message = MIMEText(body)
    message['to'] = to_addr
    message['subject'] = subject
    raw = base64.urlsafe_b64encode(message.as_bytes()).decode()
    return {'raw': raw}


@app.post('/api/mailbox/<path:email>/send')
def send_message(email):
    payload = request.get_json() or {}
    to_addr = payload.get('to', '').strip()
    subject = payload.get('subject', '').strip()
    body = payload.get('body', '').strip()

    if not to_addr or not subject or not body:
        return jsonify({'error': 'All fields are required.'}), 400

    try:
        service = build_gmail_service(email)
        message = encode_message(to_addr, subject, body)
        result = service.users().messages().send(userId=email, body=message).execute()
        return jsonify({'messageId': result.get('id')})
    except HttpError as err:
        return jsonify({'error': f'Gmail API error: {err}'}), err.status_code
    except Exception as exc:
        return jsonify({'error': f'Unexpected error: {exc}'}), 500


if __name__ == '__main__':
    if not os.path.exists(EMAIL_STORE):
        persist_emails([])
    app.run(host='0.0.0.0', port=5001, debug=True)
