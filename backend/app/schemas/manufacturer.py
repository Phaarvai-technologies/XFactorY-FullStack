from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, Field


class AccountPayload(BaseModel):
    firstName: str = Field(min_length=1, max_length=100)
    lastName: str = Field(min_length=1, max_length=100)
    contact: str = Field(min_length=3, max_length=320)
    dob: date
    companyName: str = Field(min_length=2, max_length=200)
    companyType: str = Field(min_length=2, max_length=150)
    country: str = Field(min_length=2, max_length=100)
    phone: str = Field(default="", max_length=30)
    capacity: str = Field(default="", max_length=100)


class ProfilePayload(BaseModel):
    company: dict[str, Any]
    location: dict[str, Any]
    certifications: list[dict[str, Any]] = []
    infra: dict[str, Any] = {}
    faqs: list[dict[str, Any]] = []


class MachineryPayload(BaseModel):
    industry: str
    subcategory: str = ""
    type: str = Field(min_length=1, max_length=200)
    capacity: str = ""
    age: str = ""
    condition: str = ""
    technical: str = ""
    images: list[dict[str, Any]] = []
    rawMatStatus: str = ""
    materialDetails: str = ""
    laborType: str = ""
    workerCount: str = ""
    workerRoles: str = ""
    logistics: list[str] = []
    logisticsPartner: str = ""
    pricing: dict[str, str] = {}
    insurance: str = ""
    status: Literal["Draft", "Published"]


class MachineryStatusPayload(BaseModel):
    status: Literal["Draft", "Published", "Unpublished", "Archived"]


class AvailabilityPayload(BaseModel):
    calendar: dict[str, Literal["available", "blocked"]] = {}
    recurring: dict[str, Any] | None = None
    capacity: dict[str, Any] | None = None


class BookingStatusPayload(BaseModel):
    status: Literal["accepted", "declined"]

