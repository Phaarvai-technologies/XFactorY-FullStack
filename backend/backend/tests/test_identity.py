from datetime import date, timedelta

import pytest
from pydantic import ValidationError

from app.identity.schemas import RoleUpdate
from app.manufacturer.repository import _capacity_number
from app.manufacturer.schemas import ManufacturerAccountCreate


def test_role_update_deduplicates_and_validates():
    payload = RoleUpdate(roles=["manufacturer", "manufacturer", "vendor"])
    assert payload.normalized() == ["manufacturer", "vendor"]


def test_role_update_rejects_unknown_role():
    with pytest.raises(ValueError):
        RoleUpdate(roles=["administrator"]).normalized()


def test_role_update_accepts_frontend_personas():
    payload = RoleUpdate(
        roles=["visionary", "labour_supplier", "legal_writer"]
    )
    assert payload.normalized() == [
        "visionary",
        "labour_supplier",
        "legal_writer",
    ]


def test_capacity_parser_accepts_formatted_values():
    assert _capacity_number("12,500 units/month") == 12500.0
    assert _capacity_number(None) is None


def test_manufacturer_account_rejects_future_birth_date():
    with pytest.raises(ValidationError):
        ManufacturerAccountCreate(
            first_name="A",
            last_name="User",
            contact="a@example.com",
            date_of_birth=date.today() + timedelta(days=1),
            company_name="Factory Ltd",
            company_category="Automotive & Machinery",
            country="India",
        )
