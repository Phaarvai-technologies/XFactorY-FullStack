from datetime import date, timedelta

import pytest
from pydantic import ValidationError

from app.identity.repository import DB_ROLE_TO_PERSONA, PERSONA_TO_DB_ROLE
from app.identity.schemas import ALLOWED_ROLES, RoleUpdate
from app.repositories.manufacturer import capacity_number, parse_pin
from app.schemas.manufacturer import AccountPayload


def test_role_update_deduplicates_and_validates():
    assert RoleUpdate(roles=["manufacturer", "manufacturer", "vendor"]).normalized() == ["manufacturer", "vendor"]


def test_role_update_rejects_unknown_role():
    with pytest.raises(ValueError):
        RoleUpdate(roles=["administrator"]).normalized()


def test_every_frontend_persona_maps_to_a_database_role():
    db_roles = {"demand_requester", "manufacturer", "vendor", "labor_supplier", "market_lead",
                "logistics_provider", "investor", "legal_compliance"}
    assert set(PERSONA_TO_DB_ROLE) == ALLOWED_ROLES
    assert set(PERSONA_TO_DB_ROLE.values()) <= db_roles
    assert all(DB_ROLE_TO_PERSONA[PERSONA_TO_DB_ROLE[p]] == p for p in ALLOWED_ROLES)


def test_capacity_and_pin_parsers():
    assert capacity_number("12,500 units/month") == 12500.0
    assert capacity_number("") is None
    assert parse_pin("13.0827, 80.2707") == (13.0827, 80.2707)
    assert parse_pin("nonsense") is None


def _account(**overrides):
    data = dict(firstName="A", lastName="User", contact="a@example.com", dob="1990-01-01",
                companyName="Factory Ltd", companyType="Automotive & Machinery", country="India")
    return AccountPayload(**{**data, **overrides})


def test_account_payload_matches_frontend_submission():
    assert _account(phone="", capacity="").dob == date(1990, 1, 1)


def test_account_rejects_future_birth_date():
    with pytest.raises(ValidationError):
        _account(dob=(date.today() + timedelta(days=1)).isoformat())
