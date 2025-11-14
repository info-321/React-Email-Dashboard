import os
from pathlib import Path


def _load_local_env():
    """Load key=value pairs from a .env file without requiring python-dotenv."""
    env_locations = [
        Path(__file__).resolve().parent.parent / ".env",
        Path(__file__).resolve().parent / ".env",
    ]
    for env_file in env_locations:
        if not env_file.exists():
            continue
        with env_file.open("r", encoding="utf-8") as handle:
            for raw_line in handle:
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                os.environ.setdefault(key, value)
        break


_load_local_env()


ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin")
SECRET_KEY = os.getenv("SECRET_KEY", "change-me")

NOTION_API_SECRET = os.getenv("NOTION_API_SECRET", "")
NOTION_DATABASE_ID = os.getenv("NOTION_DATABASE_ID", "")
NOTION_API_VERSION = os.getenv("NOTION_API_VERSION", "2022-06-28")

NOTION_ANALYTICS_SCHEMA = {
    "date": os.getenv("NOTION_PROP_DATE", "Send Date"),
    "campaign": os.getenv("NOTION_PROP_CAMPAIGN", "Email Subject"),
    "sent": os.getenv("NOTION_PROP_SENT", "Recipient List"),
    "delivered": os.getenv("NOTION_PROP_DELIVERED", "Recipient List"),
    "opened": os.getenv("NOTION_PROP_OPENED", "Open Rate"),
    "clicked": os.getenv("NOTION_PROP_CLICKED", "Click Rate"),
    "bounced": os.getenv("NOTION_PROP_BOUNCED", "Bounce Rate"),
    "unsubscribed": os.getenv("NOTION_PROP_UNSUBSCRIBED", "Unsubscribe Rate"),
    "spam": os.getenv("NOTION_PROP_SPAM", "Conversion Rate"),
    "device": os.getenv("NOTION_PROP_DEVICE", "Email Type"),
}
