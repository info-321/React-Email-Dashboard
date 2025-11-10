import base64
import io
import json
import os
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders
from flask import Flask, request, jsonify, send_file
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
    'archive': {'query': '-in:trash -in:spam', 'use_profile_total': True},
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
    response = service.users().labels().list(userId=user_email).execute()
    labels = response.get('labels', [])
    label_map = {label['id']: label for label in labels}

    required_ids = {
        label_id
        for cfg in LABEL_CONFIG.values()
        for label_id in cfg.get('label_ids', []) or []
    }
    missing_ids = [
        label_id for label_id in required_ids
        if label_id not in label_map or label_map[label_id].get('messagesTotal') is None
    ]
    for label_id in missing_ids:
        detail = service.users().labels().get(userId=user_email, id=label_id).execute()
        label_map[label_id] = detail

    profile = service.users().getProfile(userId=user_email).execute()
    stats = {}
    for key, cfg in LABEL_CONFIG.items():
        if cfg.get('use_profile_total'):
            stats[key] = profile.get('messagesTotal', 0)
            continue
        count = 0
        for label_id in cfg.get('label_ids', []) or []:
            data = label_map.get(label_id)
            if data and data.get('messagesTotal') is not None:
                count = data.get('messagesTotal', 0)
                break
        stats[key] = count

    return stats, [
        {
            'id': label['id'],
            'name': label.get('name'),
            'type': label.get('type'),
            'messagesTotal': label_map.get(label['id'], {}).get('messagesTotal')
        }
        for label in labels
    ]


def extract_attachments(payload, message_id):
    attachments = []
    stack = [payload] if payload else []
    while stack:
        part = stack.pop()
        filename = part.get('filename')
        body = part.get('body', {})
        if filename and body.get('attachmentId'):
            attachments.append({
                'filename': filename,
                'mimeType': part.get('mimeType'),
                'size': body.get('size'),
                'attachmentId': body.get('attachmentId'),
                'messageId': message_id,
            })
        stack.extend(part.get('parts', []) or [])
    return attachments


def extract_body_content(payload):
    result = {"text": "", "html": ""}

    def _walk(part):
        if not part:
            return
        mime = (part.get("mimeType") or "").lower()
        body = part.get("body", {})
        data = body.get("data")
        decoded = ""
        if data:
            try:
                decoded = base64.urlsafe_b64decode(data.encode("utf-8")).decode(
                    "utf-8", errors="replace"
                )
            except Exception:
                decoded = ""
        if mime == "text/html" and decoded and not result["html"]:
            result["html"] = decoded
        elif mime == "text/plain" and decoded and not result["text"]:
            result["text"] = decoded
        for child in part.get("parts", []) or []:
            _walk(child)

    _walk(payload)
    return result


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
            msg = service.users().messages().get(
                userId=user_email,
                id=ref['id'],
                format='full',
                metadataHeaders=['Subject', 'From', 'To', 'Date', 'Cc']
            ).execute()
            headers = {
                (h.get('name') or '').lower(): h.get('value', '')
                for h in msg.get('payload', {}).get('headers', [])
            }
            payload = msg.get('payload')
            attachments = extract_attachments(payload, msg['id'])
            label_ids = msg.get('labelIds', []) or []
            body_content = extract_body_content(payload)
            messages.append({
                'id': msg['id'],
                'snippet': msg.get('snippet', ''),
                'subject': headers.get('subject') or '(No subject)',
                'from': headers.get('from', ''),
                'to': headers.get('to', ''),
                'cc': headers.get('cc', ''),
                'date': headers.get('date', ''),
                'labelIds': label_ids,
                'attachments': attachments,
                'hasAttachments': bool(attachments),
                'bodyHtml': body_content.get('html', ''),
                'bodyPlain': body_content.get('text', ''),
                'isStarred': 'STARRED' in label_ids,
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


@app.post('/api/mailbox/<path:email>/messages/bulk')
def modify_messages(email):
    payload = request.get_json() or {}
    message_ids = payload.get('messageIds') or []
    action = (payload.get('action') or '').lower()

    if not message_ids:
        return jsonify({'error': 'messageIds are required.'}), 400
    if action not in {'archive', 'delete', 'star', 'unstar'}:
        return jsonify({'error': 'Unsupported action.'}), 400

    try:
        service = build_gmail_service(email)
        modify_body = {'ids': message_ids}
        remove_labels = []
        add_labels = []
        if action == 'archive':
            remove_labels = ['INBOX']
        elif action == 'delete':
            remove_labels = ['INBOX']
            add_labels = ['TRASH']
        elif action == 'star':
            add_labels = ['STARRED']
        elif action == 'unstar':
            remove_labels = ['STARRED']

        if remove_labels:
            modify_body['removeLabelIds'] = remove_labels
        if add_labels:
            modify_body['addLabelIds'] = add_labels

        service.users().messages().batchModify(
            userId=email,
            body=modify_body
        ).execute()
        return jsonify({'updated': len(message_ids)})
    except HttpError as err:
        return jsonify({'error': f'Gmail API error: {err}'}), err.status_code
    except Exception as exc:
        app.logger.exception("Unexpected error while modifying messages for %s", email)
        return jsonify({'error': f'Unexpected error: {exc}'}), 500


def encode_message(to_addr, subject, body, cc=None, bcc=None, attachments=None):
    attachments = attachments or []
    cc = (cc or "").strip()
    bcc = (bcc or "").strip()

    if attachments:
        message = MIMEMultipart()
        message.attach(MIMEText(body, 'plain'))
        for attachment in attachments:
            filename = attachment.get('filename') or 'attachment'
            content_type = attachment.get('contentType') or 'application/octet-stream'
            data = attachment.get('data')
            if not data:
                continue
            try:
                payload = base64.b64decode(data)
            except Exception:
                continue
            maintype, subtype = content_type.split('/', 1) if '/' in content_type else ('application', 'octet-stream')
            part = MIMEBase(maintype, subtype)
            part.set_payload(payload)
            encoders.encode_base64(part)
            part.add_header('Content-Disposition', f'attachment; filename="{filename}"')
            message.attach(part)
    else:
        message = MIMEText(body, 'plain')

    message['to'] = to_addr
    message['subject'] = subject
    if cc:
        message['Cc'] = cc
    if bcc:
        message['Bcc'] = bcc

    raw = base64.urlsafe_b64encode(message.as_bytes()).decode()
    return {'raw': raw}


@app.post('/api/mailbox/<path:email>/send')
def send_message(email):
    payload = request.get_json() or {}
    to_addr = payload.get('to', '').strip()
    cc_addr = payload.get('cc', '').strip()
    bcc_addr = payload.get('bcc', '').strip()
    subject = payload.get('subject', '').strip()
    body = payload.get('body', '').strip()
    attachments = payload.get('attachments') or []

    if not to_addr or not subject or not body:
        return jsonify({'error': 'All fields are required.'}), 400

    try:
        service = build_gmail_service(email)
        message = encode_message(
            to_addr,
            subject,
            body,
            cc=cc_addr,
            bcc=bcc_addr,
            attachments=attachments
        )
        result = service.users().messages().send(userId=email, body=message).execute()
        return jsonify({'messageId': result.get('id')})
    except HttpError as err:
        return jsonify({'error': f'Gmail API error: {err}'}), err.status_code
    except Exception as exc:
        return jsonify({'error': f'Unexpected error: {exc}'}), 500


@app.get('/api/mailbox/<path:email>/attachments/<message_id>/<attachment_id>')
def download_attachment(email, message_id, attachment_id):
    filename = request.args.get('filename', 'attachment')
    mime_type = request.args.get('mimeType', 'application/octet-stream')
    try:
        service = build_gmail_service(email)
        attachment = service.users().messages().attachments().get(
            userId=email, messageId=message_id, id=attachment_id
        ).execute()
        data = attachment.get('data')
        if not data:
            return jsonify({'error': 'Attachment data unavailable.'}), 404

        file_bytes = base64.urlsafe_b64decode(data.encode('utf-8'))
        buffer = io.BytesIO(file_bytes)
        buffer.seek(0)
        return send_file(
            buffer,
            mimetype=mime_type or 'application/octet-stream',
            as_attachment=True,
            download_name=filename or 'attachment'
        )
    except HttpError as err:
        return jsonify({'error': f'Gmail API error: {err}'}), err.status_code
    except Exception as exc:
        app.logger.exception(
            "Unexpected error while downloading attachment %s for %s",
            attachment_id,
            email
        )
        return jsonify({'error': f'Unexpected error: {exc}'}), 500


if __name__ == '__main__':
    if not os.path.exists(EMAIL_STORE):
        persist_emails([])
    app.run(host='0.0.0.0', port=5001, debug=True)
