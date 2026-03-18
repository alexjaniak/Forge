"""Normalization helpers for staged/applied cron job comparisons."""

OPTIONAL_CRON_FIELD_DEFAULTS = {
    "repo": "",
    "runtime": "claude",
    "model": "",
}


def normalize_optional_cron_field(field, value):
    """Match manage.py apply-state defaults for optional cron fields."""
    if field in OPTIONAL_CRON_FIELD_DEFAULTS and value is None:
        return OPTIONAL_CRON_FIELD_DEFAULTS[field]
    return value
