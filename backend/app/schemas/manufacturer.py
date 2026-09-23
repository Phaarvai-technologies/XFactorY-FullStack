"""Request bodies — field names are exactly the frontend's (src/lib/manufacturer/types.ts,
ProfileWizardData, MachineryDraft, AccountSubmission)."""
from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class _Model(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)


# ---------------------------------------------------------------- account
class AccountPayload(_Model):
    """AccountScreen `AccountSubmission`."""
    firstName: str = Field(min_length=1, max_length=100)
    lastName: str = Field(min_length=1, max_length=100)
    contact: str = Field(min_length=3, max_length=320)
    dob: date
    companyName: str = Field(min_length=1, max_length=200)
    companyType: str = Field(min_length=1, max_length=150)
    country: str = Field(min_length=1, max_length=100)
    phone: str = Field(default="", max_length=30)
    capacity: str = Field(default="", max_length=100)

    @field_validator("dob")
    @classmethod
    def dob_not_in_future(cls, value: date) -> date:
        if value > date.today():
            raise ValueError("Date of birth cannot be in the future")
        return value


# ---------------------------------------------------------------- profile wizard
class CompanyData(_Model):
    name: str = ""
    logo: str | None = None
    cover: str | None = None
    about: str = ""
    vision: str = ""
    estYear: str = ""
    employees: str = ""
    businessType: str = ""
    orgSize: str = ""


class LocationData(_Model):
    address: str = ""
    city: str = ""
    state: str = ""
    country: str = ""
    zip: str = ""
    pin: str | None = None
    sez: str = "Not in SEZ"
    serviceableAreas: list[str] = []


class CertificationData(_Model):
    name: str
    body: str = ""
    fileName: str = ""
    status: Literal["Pending", "Verified", "Rejected"] = "Pending"


class InfraData(_Model):
    electricity: str = ""
    water: str = ""
    storage: str = ""
    packaging: str = ""
    waste: str = ""
    qa: str = ""


class FaqData(_Model):
    q: str
    a: str = ""


class ProfilePayload(_Model):
    """ProfileWizard `ProfileWizardData`."""
    company: CompanyData
    location: LocationData
    certifications: list[CertificationData] = []
    infra: InfraData = InfraData()
    faqs: list[FaqData] = []


# ---------------------------------------------------------------- machinery
class MachineryImage(_Model):
    src: str
    primary: bool = False


class Pricing(_Model):
    hour: str = ""
    day: str = ""
    month: str = ""
    unit: str = ""
    batch: str = ""


class MachineryPayload(_Model):
    """MachineryWizard `MachineryDraft` + the status chosen on publish."""
    industry: str = ""
    subcategory: str = ""
    type: str = Field(min_length=1, max_length=200)
    capacity: str = ""
    age: str = ""
    condition: str = ""
    technical: str = ""
    images: list[MachineryImage] = Field(default=[], max_length=12)
    rawMatStatus: str = ""
    materialDetails: str = ""
    laborType: str = ""
    workerCount: str = ""
    workerRoles: str = ""
    logistics: list[str] = []
    logisticsPartner: str = ""
    pricing: Pricing = Pricing()
    insurance: str = ""
    status: Literal["Draft", "Published"] = "Draft"


class MachineryStatusPayload(_Model):
    status: Literal["Draft", "Published", "Unpublished", "Archived"]


# ---------------------------------------------------------------- availability
class RecurringData(_Model):
    days: list[str] = []
    start: str = ""
    end: str = ""


class CapacityData(_Model):
    machine: str = ""
    count: str = ""
    start: str = ""
    end: str = ""


class AvailabilityPayload(_Model):
    calendar: dict[str, Literal["available", "blocked"]] = {}
    recurring: RecurringData | None = None
    capacity: CapacityData | None = None


# ---------------------------------------------------------------- bookings
class BookingStatusPayload(_Model):
    status: Literal["accepted", "declined"]
