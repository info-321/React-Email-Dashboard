"""Copy to config.py for a new installation; set secrets in the environment."""
import os

ADMIN_USERNAME = os.environ['ADMIN_USERNAME']
ADMIN_PASSWORD = os.environ['ADMIN_PASSWORD']
SECRET_KEY = os.environ['SECRET_KEY']
NOTION_API_SECRET = os.getenv('NOTION_API_SECRET', '')
NOTION_DATABASE_ID = os.getenv('NOTION_DATABASE_ID', '')
NOTION_API_VERSION = os.getenv('NOTION_API_VERSION', '2022-06-28')
NOTION_ANALYTICS_SCHEMA = {
    'date': os.getenv('NOTION_PROP_DATE', 'Send Date'),
    'campaign': os.getenv('NOTION_PROP_CAMPAIGN', 'Email Subject'),
    'sent': os.getenv('NOTION_PROP_SENT', 'Recipient List'),
    'delivered': os.getenv('NOTION_PROP_DELIVERED', 'Recipient List'),
    'opened': os.getenv('NOTION_PROP_OPENED', 'Open Rate'),
    'clicked': os.getenv('NOTION_PROP_CLICKED', 'Click Rate'),
    'bounced': os.getenv('NOTION_PROP_BOUNCED', 'Bounce Rate'),
    'unsubscribed': os.getenv('NOTION_PROP_UNSUBSCRIBED', 'Unsubscribe Rate'),
    'spam': os.getenv('NOTION_PROP_SPAM', 'Conversion Rate'),
    'device': os.getenv('NOTION_PROP_DEVICE', 'Email Type'),
}
