from app.repositories.manufacturer import slug
from app.services.manufacturer import _booking_status, _decode_spec, _status


def test_slug_is_stable_for_taxonomy_codes():
    assert slug("5-axis CNC mill") == "5_AXIS_CNC_MILL"


def test_machine_and_booking_status_mapping():
    assert _status({"status": "active", "publication_status": "published"}) == "Published"
    assert _booking_status("new") == "New"
    assert _booking_status("accepted") == "Reserved"
    assert _booking_status("booked") == "Booked"


def test_json_machine_specs_are_restored():
    assert _decode_spec('["Local","National"]') == ["Local", "National"]
    assert _decode_spec("Good") == "Good"
