import base64
import io
import json
import os
import time
from datetime import datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders
from email.utils import parsedate_to_datetime

import requests
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from config import (
    ADMIN_PASSWORD,
    ADMIN_USERNAME,
    SECRET_KEY,
    NOTION_API_SECRET,
    NOTION_DATABASE_ID,
    NOTION_API_VERSION,
    NOTION_ANALYTICS_SCHEMA,
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
EMAIL_STORE = os.path.join(BASE_DIR, 'emails.json')
SERVICE_ACCOUNT_FILE = os.path.join(BASE_DIR, 'workspace_service_account.json')
ANALYTICS_SAMPLE_FILE = os.path.join(BASE_DIR, 'analytics_sample.json')
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
ANALYTICS_RANGE_PRESETS = {
    '7d': 7,
    '30d': 30,
    '90d': 90,
    '365d': 365,
}
MAX_ANALYTICS_PAGES = 200
ANALYTICS_CACHE_TTL = int(os.getenv('ANALYTICS_CACHE_TTL', '300'))
analytics_cache = {}

SAMPLE_ANALYTICS_DATA = [
    {
        'date': '2025-11-11',
        'campaign': 'All Featured Press Releases',
        'sent': 5200,
        'delivered': 5085,
        'opened': 3825,
        'clicked': 812,
        'bounced': 25,
        'unsubscribed': 64,
        'spam': 5,
        'device': ['Desktop/Laptop', 'Smartphone'],
    },
    {
        'date': '2025-11-09',
        'campaign': 'TTW Weekly Digest',
        'sent': 4800,
        'delivered': 4711,
        'opened': 3205,
        'clicked': 640,
        'bounced': 40,
        'unsubscribed': 102,
        'spam': 11,
        'device': ['Desktop/Laptop', 'Tablet', 'Smartphone'],
    },
    {
        'date': '2025-11-06',
        'campaign': 'Travel Trade Webinar Invite',
        'sent': 4100,
        'delivered': 4054,
        'opened': 2890,
        'clicked': 512,
        'bounced': 18,
        'unsubscribed': 55,
        'spam': 3,
        'device': ['Desktop/Laptop', 'Smartwatch'],
    },
    {
        'date': '2025-11-02',
        'campaign': 'Airline Partners Spotlight',
        'sent': 3650,
        'delivered': 3602,
        'opened': 2411,
        'clicked': 435,
        'bounced': 33,
        'unsubscribed': 49,
        'spam': 6,
        'device': ['Desktop/Laptop', 'Smartphone', 'Tablet'],
    },
    {
        'date': '2025-10-29',
        'campaign': 'TTW Premium Offers',
        'sent': 5900,
        'delivered': 5751,
        'opened': 4010,
        'clicked': 998,
        'bounced': 41,
        'unsubscribed': 88,
        'spam': 9,
        'device': ['Desktop/Laptop', 'Smartphone'],
    },
]


class NotionConfigError(RuntimeError):
    """Raised when Notion API credentials or schema are missing."""
    pass


def _normalize_date_input(value: str) -> str:
    if not value:
        return None
    try:
        if "T" in value:
            parsed = datetime.fromisoformat(value)
        else:
            parsed = datetime.strptime(value, "%Y-%m-%d")
    except ValueError as exc:
        raise ValueError("Invalid date format. Use YYYY-MM-DD.") from exc
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc)
    return parsed.date().isoformat()


def _determine_range(range_key: str, start_override: str = None, end_override: str = None):
    if start_override:
        start_date = _normalize_date_input(start_override)
        end_date = _normalize_date_input(end_override) if end_override else None
        return 'custom', start_date, end_date
    key, start_date = _resolve_range(range_key)
    return key, start_date, None


def _cache_get(key: str):
    entry = analytics_cache.get(key)
    if not entry:
        return None
    if entry['expires'] < time.time():
        analytics_cache.pop(key, None)
        return None
    return entry['payload']


def _cache_set(key: str, payload):
    if ANALYTICS_CACHE_TTL <= 0:
        return
    analytics_cache[key] = {
        'payload': payload,
        'expires': time.time() + ANALYTICS_CACHE_TTL,
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


def _resolve_range(range_key: str):
    key = (range_key or '30d').strip().lower()
    if key in ANALYTICS_RANGE_PRESETS:
        days = ANALYTICS_RANGE_PRESETS[key]
    elif key.endswith('d'):
        try:
            days = max(1, min(365, int(key[:-1])))
        except ValueError:
            key = '30d'
            days = ANALYTICS_RANGE_PRESETS[key]
    else:
        key = '30d'
        days = ANALYTICS_RANGE_PRESETS[key]
    now_utc = datetime.now(timezone.utc)
    start = (now_utc - timedelta(days=days - 1)).date().isoformat()
    return key, start


def _ensure_notion_config():
    if not NOTION_API_SECRET or not NOTION_DATABASE_ID:
        raise NotionConfigError(
            "Notion API is not configured. Set NOTION_API_SECRET and NOTION_DATABASE_ID."
        )


def _notion_headers():
    return {
        'Authorization': f'Bearer {NOTION_API_SECRET}',
        'Notion-Version': NOTION_API_VERSION or '2022-06-28',
        'Content-Type': 'application/json',
    }


def _query_notion(range_key: str, start_date: str, end_date: str = None):
    _ensure_notion_config()
    payload = {
        'page_size': 100,
        'sorts': [{'property': NOTION_ANALYTICS_SCHEMA['date'], 'direction': 'ascending'}],
    }
    if start_date or end_date:
        date_filter = {}
        if start_date:
            date_filter['on_or_after'] = start_date
        if end_date:
            date_filter['on_or_before'] = end_date
        payload['filter'] = {
            'property': NOTION_ANALYTICS_SCHEMA['date'],
            'date': date_filter
        }

    url = f'https://api.notion.com/v1/databases/{NOTION_DATABASE_ID}/query'
    results = []
    next_cursor = None
    headers = _notion_headers()

    while True:
        body = dict(payload)
        if next_cursor:
            body['start_cursor'] = next_cursor
        response = requests.post(url, headers=headers, json=body, timeout=25)
        response.raise_for_status()
        data = response.json()
        results.extend(data.get('results', []))
        if not data.get('has_more') or len(results) >= MAX_ANALYTICS_PAGES:
            break
        next_cursor = data.get('next_cursor')

    return results


def _coerce_number(value):
    if value is None or value == '':
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value).replace('%', '').strip())
    except (TypeError, ValueError):
        return 0.0


def _extract_number(prop):
    if not prop:
        return 0.0
    prop_type = prop.get('type')
    if prop_type == 'number':
        return _coerce_number(prop.get('number'))
    if prop_type == 'formula':
        formula = prop.get('formula') or {}
        return _extract_number(formula)
    if prop_type == 'rollup':
        rollup = prop.get('rollup') or {}
        rollup_type = rollup.get('type')
        if rollup_type == 'number':
            return _coerce_number(rollup.get('number'))
        if rollup_type == 'array':
            return sum(_extract_number(item) for item in rollup.get('array') or [])
    if prop_type == 'rich_text':
        text = ''.join(part.get('plain_text', '') for part in prop.get('rich_text', []))
        return _coerce_number(text)
    if prop_type == 'title':
        text = ''.join(part.get('plain_text', '') for part in prop.get('title', []))
        return _coerce_number(text)
    if prop_type == 'number':
        return _coerce_number(prop.get('number'))
    if prop_type == 'string':
        return _coerce_number(prop.get('string'))
    value = prop.get(prop_type) if prop_type else None
    return _coerce_number(value)


def _extract_text(prop):
    if not prop:
        return ''
    prop_type = prop.get('type')
    if prop_type in {'rich_text', 'title'}:
        key = 'rich_text' if prop_type == 'rich_text' else 'title'
        return ''.join(part.get('plain_text', '') for part in prop.get(key, []))
    if prop_type == 'select':
        data = prop.get('select')
        return (data or {}).get('name', '')
    if prop_type == 'multi_select':
        return ', '.join(option.get('name', '') for option in prop.get('multi_select', []))
    if prop_type == 'formula':
        formula = prop.get('formula') or {}
        return _extract_text(formula)
    if prop_type == 'rollup':
        rollup = prop.get('rollup') or {}
        if rollup.get('type') == 'array':
            return ', '.join(_extract_text(item) for item in rollup.get('array') or [])
        if rollup.get('type') == 'string':
            return rollup.get('string', '')
    if prop_type == 'people':
        return ', '.join(person.get('name', '') for person in prop.get('people', []))
    value = prop.get(prop_type)
    if isinstance(value, str):
        return value
    return ''


def _extract_date(prop):
    if not prop:
        return ''
    if prop.get('type') == 'date':
        date_payload = prop.get('date') or {}
        return date_payload.get('start') or ''
    if prop.get('type') == 'formula':
        formula = prop.get('formula') or {}
        if formula.get('type') == 'date':
            return (formula.get('date') or {}).get('start', '')
    return ''


def _extract_multi(prop):
    if not prop:
        return []
    prop_type = prop.get('type')
    if prop_type == 'multi_select':
        return [option.get('name', 'Other') or 'Other' for option in prop.get('multi_select', [])]
    if prop_type == 'select':
        return [prop.get('select', {}).get('name', 'Other') or 'Other']
    if prop_type == 'relation':
        return [entry.get('id', 'Related') for entry in prop.get('relation', [])]
    if prop_type == 'formula':
        formula = prop.get('formula') or {}
        if formula.get('type') == 'string':
            return [formula.get('string')]
    return []


def _percent(a, b):
    if not b:
        return 0.0
    return round((a / b) * 100, 2)


def _delta(series):
    values = [value for value in series if value is not None]
    if len(values) < 2:
        return None
    start, end = values[0], values[-1]
    if not start:
        return None
    return round(((end - start) / start) * 100, 2)


def _build_analytics_payload(range_key, start_date, records):
    schema = NOTION_ANALYTICS_SCHEMA
    timeline = []
    devices = {}
    rows = []
    totals = {
        'sent': 0.0,
        'delivered': 0.0,
        'opened': 0.0,
        'clicked': 0.0,
        'unsubscribed': 0.0,
        'spam': 0.0,
        'bounced': 0.0,
    }

    for page in records:
        props = page.get('properties', {})
        sent = _extract_number(props.get(schema['sent']))
        delivered = _extract_number(props.get(schema['delivered'])) or sent
        opened = _extract_number(props.get(schema['opened']))
        clicked = _extract_number(props.get(schema['clicked']))
        unsubscribed = _extract_number(props.get(schema['unsubscribed']))
        spam = _extract_number(props.get(schema['spam']))
        bounced = _extract_number(props.get(schema['bounced']))
        totals['sent'] += sent
        totals['delivered'] += delivered
        totals['opened'] += opened
        totals['clicked'] += clicked
        totals['unsubscribed'] += unsubscribed
        totals['spam'] += spam
        totals['bounced'] += bounced

        date_value = _extract_date(props.get(schema['date']))
        if date_value:
            timeline.append({
                'date': date_value,
                'sent': sent,
                'openRate': _percent(opened, delivered or sent),
                'clickRate': _percent(clicked, delivered or sent),
            })

        for device in _extract_multi(props.get(schema['device'])) or ['Other']:
            bucket = devices.setdefault(device, {'opened': 0.0, 'clicked': 0.0})
            bucket['opened'] += opened
            bucket['clicked'] += clicked

        rows.append({
            'email': _extract_text(props.get(schema['campaign'])) or 'Untitled campaign',
            'publishDate': date_value,
            'sent': int(sent),
            'clickRate': _percent(clicked, sent or 1),
            'deliveredRate': _percent(delivered, sent or 1),
            'unsubscribeRate': _percent(unsubscribed, sent or 1),
            'spamRate': _percent(spam, sent or 1),
        })

    timeline.sort(key=lambda point: point.get('date') or '')

    cards = []
    total_sent = totals['sent'] or 0.0
    total_delivered = totals['delivered'] or total_sent or 1
    open_rate = _percent(totals['opened'], total_delivered)
    click_rate = _percent(totals['clicked'], total_delivered)
    click_through = _percent(totals['clicked'], total_sent or total_delivered)
    cards.append({
        'label': 'Sent',
        'value': int(total_sent),
        'unit': '',
        'delta': _delta([point.get('sent') for point in timeline]),
        'trend': 'up',
        'helper': f"{len(records)} campaigns",
    })
    cards.append({
        'label': 'Open rate',
        'value': open_rate,
        'unit': '%',
        'delta': _delta([point.get('openRate') for point in timeline]),
        'trend': 'up' if open_rate >= 0 else 'down',
        'helper': f"{int(totals['opened'])} opened",
    })
    cards.append({
        'label': 'Click rate',
        'value': click_rate,
        'unit': '%',
        'delta': _delta([point.get('clickRate') for point in timeline]),
        'trend': 'up' if click_rate >= 0 else 'down',
        'helper': f"{int(totals['clicked'])} clicked",
    })
    cards.append({
        'label': 'Click through',
        'value': click_through,
        'unit': '%',
        'delta': None,
        'trend': 'flat',
        'helper': 'Unique click share',
    })

    delivery = [
        {
            'label': 'Delivered rate',
            'value': _percent(totals['delivered'], total_sent or 1),
            'helper': f"{int(totals['delivered'])} delivered",
        },
        {
            'label': 'Hard bounce rate',
            'value': _percent(totals['bounced'], total_sent or 1),
            'helper': f"{int(totals['bounced'])} bounced",
        },
        {
            'label': 'Unsubscribed rate',
            'value': _percent(totals['unsubscribed'], total_sent or 1),
            'helper': f"{int(totals['unsubscribed'])} unsubscribed",
        },
        {
            'label': 'Spam report rate',
            'value': _percent(totals['spam'], total_sent or 1),
            'helper': f"{int(totals['spam'])} spam reports",
        },
    ]

    line_series = [
        {
            'label': 'Open rate',
            'color': '#7a5af8',
            'points': [{'date': point['date'], 'value': point['openRate']} for point in timeline],
        },
        {
            'label': 'Click rate',
            'color': '#4cc38a',
            'points': [{'date': point['date'], 'value': point['clickRate']} for point in timeline],
        },
    ]

    device_list = [
        {
            'device': name,
            'opened': round(bucket['opened'], 2),
            'clicked': round(bucket['clicked'], 2),
        }
        for name, bucket in devices.items()
    ]
    device_list.sort(key=lambda item: item['opened'], reverse=True)

    rows.sort(key=lambda row: row['publishDate'] or '', reverse=True)

    undelivered = max(0.0, total_sent - totals['delivered'])
    metrics = {
        'sentCount': int(total_sent),
        'openCount': int(totals['opened']),
        'openRate': min(100.0, open_rate),
        'deliveredCount': int(totals['delivered']),
        'deliveredRate': min(100.0, _percent(totals['delivered'], total_sent or 1)),
        'bounceRate': min(100.0, _percent(undelivered, total_sent or 1)),
        'undeliveredCount': int(undelivered),
        'spamRate': min(100.0, _percent(totals['spam'], total_sent or 1)),
    }

    return {
        'range': range_key,
        'startDate': start_date,
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'cards': cards,
        'delivery': delivery,
        'lineSeries': line_series,
        'devices': device_list,
        'table': rows,
        'metrics': metrics,
    }


def _load_sample_entries():
    try:
        with open(ANALYTICS_SAMPLE_FILE, 'r', encoding='utf-8') as handle:
            data = json.load(handle)
            if isinstance(data, list):
                return data
    except FileNotFoundError:
        pass
    except json.JSONDecodeError:
        pass
    return SAMPLE_ANALYTICS_DATA


def _sample_entry_to_page(entry):
    schema = NOTION_ANALYTICS_SCHEMA

    def number_prop(value):
        return {'type': 'number', 'number': float(value or 0)}

    def title_prop(value):
        return {
            'type': 'title',
            'title': [{'plain_text': str(value or ''), 'type': 'text'}]
        }

    def date_prop(value):
        return {'type': 'date', 'date': {'start': value, 'end': None}}

    def multi_prop(values):
        payload = [{'name': item} for item in (values or [])]
        return {'type': 'multi_select', 'multi_select': payload}

    properties = {
        schema['campaign']: title_prop(entry.get('campaign')),
        schema['date']: date_prop(entry.get('date')),
        schema['sent']: number_prop(entry.get('sent')),
        schema['delivered']: number_prop(entry.get('delivered')),
        schema['opened']: number_prop(entry.get('opened')),
        schema['clicked']: number_prop(entry.get('clicked')),
        schema['bounced']: number_prop(entry.get('bounced')),
        schema['unsubscribed']: number_prop(entry.get('unsubscribed')),
        schema['spam']: number_prop(entry.get('spam')),
        schema['device']: multi_prop(entry.get('device')),
    }
    return {'properties': properties}


def _load_sample_analytics(range_key, start_date, end_date):
    entries = _load_sample_entries()
    filtered = []
    for entry in entries:
        entry_date = entry.get('date')
        if start_date and entry_date and entry_date < start_date:
            continue
        if end_date and entry_date and entry_date > end_date:
            continue
        filtered.append(entry)
    if not filtered:
        filtered = entries
    pages = [_sample_entry_to_page(entry) for entry in filtered]
    return pages


def _build_notion_payload(range_key, start_date, end_date):
    try:
        records = _query_notion(range_key, start_date, end_date)
        source = 'notion'
    except NotionConfigError:
        records = _load_sample_analytics(range_key, start_date, end_date)
        source = 'sample'
    payload = _build_analytics_payload(range_key, start_date, records)
    payload['source'] = source
    return payload


def _timestamp_from_iso(date_str: str) -> int:
    if not date_str:
        return 0
    try:
        if "T" in date_str:
            dt = datetime.fromisoformat(date_str)
        else:
            dt = datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        dt = datetime.strptime(date_str, "%Y-%m-%d")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return int(dt.timestamp())


def _gather_gmail_messages(service, mailbox, label_ids, start_ts, end_ts=None, max_results=100):
    query_parts = []
    if start_ts:
        query_parts.append(f"after:{start_ts}")
    if end_ts:
        query_parts.append(f"before:{end_ts}")
    query = " ".join(query_parts).strip()
    messages, _, _ = fetch_messages(
        service,
        mailbox,
        label_ids=label_ids,
        query=query,
        max_results=max_results
    )
    return messages


def _message_iso_date(value: str) -> str:
    if not value:
        return ''
    try:
        parsed = parsedate_to_datetime(value)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.isoformat()
    except Exception:
        return value


def _category_label(label_id: str) -> str:
    mapping = {
        'CATEGORY_PERSONAL': 'Personal',
        'CATEGORY_SOCIAL': 'Social',
        'CATEGORY_PROMOTIONS': 'Promotions',
        'CATEGORY_UPDATES': 'Updates',
        'CATEGORY_FORUMS': 'Forums',
    }
    return mapping.get(label_id, 'General')


def _build_mailbox_analytics(mailbox: str, range_key: str, start_date: str, end_date: str = None):
    start_ts = _timestamp_from_iso(start_date)
    end_ts = _timestamp_from_iso(end_date) + 86400 if end_date else None
    service = build_gmail_service(mailbox)
    inbox_messages = _gather_gmail_messages(service, mailbox, ['INBOX'], start_ts, end_ts)
    sent_messages = _gather_gmail_messages(service, mailbox, ['SENT'], start_ts, end_ts)
    trash_messages = _gather_gmail_messages(service, mailbox, ['TRASH'], start_ts, end_ts)
    spam_messages = _gather_gmail_messages(service, mailbox, ['SPAM'], start_ts, end_ts)

    timeline_map = {}
    for msg in inbox_messages:
        date_iso = _message_iso_date(msg.get('date'))
        day = (date_iso or '')[:10]
        entry = timeline_map.setdefault(day, {'date': day, 'sent': 0, 'openRate': 0, 'clickRate': 0})
        entry['openRate'] += 1
    for msg in sent_messages:
        date_iso = _message_iso_date(msg.get('date'))
        day = (date_iso or '')[:10]
        entry = timeline_map.setdefault(day, {'date': day, 'sent': 0, 'openRate': 0, 'clickRate': 0})
        entry['clickRate'] += 1
        entry['sent'] += 1
    timeline = sorted(timeline_map.values(), key=lambda item: item['date'])

    line_series = [
        {
            'label': 'Inbox volume',
            'color': '#7a5af8',
            'points': [{'date': row['date'], 'value': row['openRate']} for row in timeline],
        },
        {
            'label': 'Sent volume',
            'color': '#4cc38a',
            'points': [{'date': row['date'], 'value': row['clickRate']} for row in timeline],
        },
    ]

    sent_count = len(sent_messages)
    delivered_count = len(inbox_messages)
    open_count = delivered_count
    spam_count = len(spam_messages)
    bounce_count = len(trash_messages)
    total_sent = sent_count
    total_inbox = delivered_count
    total_spam = spam_count
    total_deleted = bounce_count

    cards = [
        {
            'label': 'Sent',
            'value': total_sent,
            'unit': '',
            'delta': None,
            'trend': 'flat',
            'helper': f"{len(sent_messages)} messages in range",
        },
        {
            'label': 'Open rate',
            'value': _percent(total_inbox, total_sent or total_inbox or 1),
            'unit': '%',
            'delta': None,
            'trend': 'flat',
            'helper': f"{total_inbox} inbox threads",
        },
        {
            'label': 'Click rate',
            'value': _percent(len(sent_messages), total_sent or 1),
            'unit': '%',
            'delta': None,
            'trend': 'flat',
            'helper': "Based on sent items in range",
        },
        {
            'label': 'Click through',
            'value': _percent(len(sent_messages), total_inbox or 1),
            'unit': '%',
            'delta': None,
            'trend': 'flat',
            'helper': "Relative to inbox volume",
        },
    ]

    delivery = [
        {
            'label': 'Delivered rate',
            'value': _percent(total_inbox, total_sent or total_inbox or 1),
            'helper': f"{total_inbox} delivered",
        },
        {
            'label': 'Hard bounce rate',
            'value': _percent(total_deleted, total_sent or 1),
            'helper': f"{total_deleted} removed",
        },
        {
            'label': 'Unsubscribed rate',
            'value': 0.0,
            'helper': 'Gmail does not provide unsubscribe counts',
        },
        {
            'label': 'Spam report rate',
            'value': _percent(total_spam, total_sent or 1),
            'helper': f"{total_spam} spam reports",
        },
    ]

    device_totals = {}
    for msg in inbox_messages:
        categories = [label for label in msg.get('labelIds', []) if label.startswith('CATEGORY_')]
        key = _category_label(categories[0]) if categories else 'Inbox'
        bucket = device_totals.setdefault(key, {'opened': 0, 'clicked': 0})
        bucket['opened'] += 1
    for msg in sent_messages:
        categories = [label for label in msg.get('labelIds', []) if label.startswith('CATEGORY_')]
        key = _category_label(categories[0]) if categories else 'Sent'
        bucket = device_totals.setdefault(key, {'opened': 0, 'clicked': 0})
        bucket['clicked'] += 1
    devices = [
        {'device': name, 'opened': values['opened'], 'clicked': values['clicked']}
        for name, values in device_totals.items()
    ]

    table_rows = []
    for msg in inbox_messages[:25]:
        table_rows.append({
            'email': msg.get('subject') or '(No subject)',
            'publishDate': _message_iso_date(msg.get('date')),
            'sent': 1,
            'clickRate': 0.0,
            'deliveredRate': 100.0,
            'unsubscribeRate': 0.0,
            'spamRate': 0.0,
        })

    undelivered = max(0, total_sent - total_inbox)
    metrics = {
        'sentCount': int(total_sent),
        'openCount': int(total_inbox),
        'openRate': min(100.0, _percent(total_inbox, total_sent or total_inbox or 1)),
        'deliveredCount': int(total_inbox),
        'deliveredRate': min(100.0, _percent(total_inbox, total_sent or total_inbox or 1)),
        'bounceRate': min(100.0, _percent(undelivered, total_sent or 1)),
        'undeliveredCount': int(undelivered),
        'spamRate': min(100.0, _percent(total_spam, total_sent or 1)),
    }

    return {
        'range': range_key,
        'startDate': start_date,
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'cards': cards,
        'delivery': delivery,
        'lineSeries': line_series,
        'devices': devices,
        'table': table_rows,
        'source': 'gmail',
        'metrics': {
            'sentCount': sent_count,
            'openCount': open_count,
            'openRate': min(100.0, _percent(open_count, delivered_count or 1)),
            'deliveredCount': delivered_count,
            'deliveredRate': min(100.0, _percent(delivered_count, sent_count or delivered_count or 1)),
            'bounceRate': min(100.0, _percent(undelivered, sent_count or 1)),
            'undeliveredCount': undelivered,
            'spamRate': min(100.0, _percent(spam_count, sent_count or 1)),
        },
    }


@app.get('/api/analytics/notion')
def analytics_overview():
    selected_range = request.args.get('range', '30d')
    mailbox = (request.args.get('mailbox') or '').strip()
    start_override = request.args.get('startDate')
    end_override = request.args.get('endDate')
    try:
        range_key, start_date, end_date = _determine_range(selected_range, start_override, end_override)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    cache_key = json.dumps(
        {
            'range': range_key,
            'mailbox': mailbox or None,
            'start': start_date,
            'end': end_date,
            'source': 'gmail' if mailbox else 'notion',
        },
        sort_keys=True,
    )
    cached = _cache_get(cache_key)
    if cached:
        return jsonify(cached)
    try:
        if mailbox:
            payload = _build_mailbox_analytics(mailbox, range_key, start_date, end_date)
        else:
            payload = _build_notion_payload(range_key, start_date, end_date)
    except requests.HTTPError as err:
        detail = err.response.text if err.response is not None else str(err)
        return jsonify({'error': 'Failed to query Notion API.', 'details': detail}), err.response.status_code if err.response else 502
    except Exception as exc:
        app.logger.exception("Unexpected error while building analytics dashboard")
        return jsonify({'error': f'Unable to build analytics dashboard: {exc}'}), 500
    _cache_set(cache_key, payload)
    return jsonify(payload)


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
