from app.repositories.manufacturer import profile_flags, slug
from app.services.manufacturer import _booking_status, _decode_spec, _status


def test_slug_is_stable_for_taxonomy_codes():
    assert slug("5-axis CNC mill") == "5_AXIS_CNC_MILL"


def test_machine_and_booking_status_mapping():
    assert _status({"status": "active", "publication_status": "published"}) == "Published"
    assert _status({"status": "archived", "publication_status": "hidden"}) == "Archived"
    assert _booking_status("new") == "New"
    assert _booking_status("accepted") == "Reserved"
    assert _booking_status("confirmed") == "Booked"
    assert _booking_status("declined") == "Cancelled"


def test_machine_specs_keep_frontend_types():
    assert _decode_spec("logistics", '["Local","National"]') == ["Local", "National"]
    assert _decode_spec("capacity", "100") == "100"  # stays a string
    assert _decode_spec("condition", "Good") == "Good"


def test_profile_flags_match_frontend_rules():
    data = {"company": {"name": "X", "about": ""}, "location": {"address": "a", "city": "b", "country": "India"},
            "certifications": [], "infra": {"water": " "}, "faqs": [{"q": "q", "a": "a"}]}
    assert profile_flags(data) == {"company": False, "location": True, "certs": False, "infra": False, "faq": True}
