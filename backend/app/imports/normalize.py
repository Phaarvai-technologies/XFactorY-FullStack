"""Normalization helpers used by company search and claim verification.

The provider list is not exhaustive; domain claims need production review.
"""
import re
import unicodedata

FREE_MAIL_DOMAINS = frozenset({
    "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "yahoo.co.uk",
    "ymail.com", "rocketmail.com", "outlook.com", "outlook.in", "hotmail.com",
    "hotmail.co.uk", "live.com", "live.in", "msn.com", "aol.com", "icloud.com",
    "me.com", "mac.com", "proton.me", "protonmail.com", "pm.me", "tutanota.com",
    "tuta.com", "tutamail.com", "fastmail.com", "mail.com", "email.com",
    "gmx.com", "gmx.net", "rediffmail.com", "rediff.com", "zoho.com",
    "zohomail.com", "yandex.com", "yandex.ru", "qq.com", "163.com", "126.com",
    "sify.com", "in.com", "indiatimes.com", "vsnl.com", "vsnl.net",
    "bsnl.in", "airtelmail.in", "comcast.net", "att.net", "sbcglobal.net",
    "verizon.net", "btinternet.com", "ntlworld.com", "talktalk.net", "orange.fr",
})


def email_domain(value: str | None) -> str | None:
    """Return a normalized domain for a single plain email, or None."""
    if not isinstance(value, str):
        return None
    value = value.strip().lower()
    if value.count("@") != 1 or re.search(r"[\s<>;,]", value):
        return None
    local, domain = value.split("@")
    if not local or not domain or "." not in domain:
        return None
    try:
        domain = domain.encode("idna").decode("ascii")
    except UnicodeError:
        return None
    if len(domain) > 253:
        return None
    if any(not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", part)
           for part in domain.split(".")):
        return None
    return domain


def normalize_company_name(value: str | None) -> str:
    """Normalize casing, punctuation and whitespace for search."""
    value = unicodedata.normalize("NFKC", value or "").casefold().strip()
    value = value.replace("&", " and ")
    value = "".join(char if char.isalnum() else " " for char in value)
    return " ".join(value.split())
