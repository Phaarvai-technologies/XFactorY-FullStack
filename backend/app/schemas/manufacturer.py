"""Request bodies — field names are exactly the frontend's (src/lib/manufacturer/types.ts,
ProfileWizardData, MachineryDraft, AccountSubmission)."""
import re
from datetime import date
from uuid import UUID
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.onboarding_source import reject_client_source


class _Model(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)


EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")


def normalize_indian_phone(value: str) -> str:
    """An Indian phone number as +91 followed by the 10-digit national number. Accepts +91 / 91 / 0
    prefixes, spaces, dashes and brackets; raises ValueError otherwise."""
    raw = (value or "").strip()
    if not raw:
        raise ValueError("Company phone number is required")
    if not re.fullmatch(r"\+?[0-9\s\-().]{7,20}", raw):
        raise ValueError("Enter a valid Indian company phone number")
    digits = re.sub(r"\D", "", raw)
    if raw.startswith("+"):
        if not digits.startswith("91"):
            raise ValueError("Enter an Indian company phone number (+91)")
        digits = digits[2:]
    elif len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    elif len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    if len(digits) != 10 or digits[0] == "0" or len(set(digits)) == 1:
        raise ValueError("Enter a valid Indian company phone number")
    return "+91" + digits


# ---------------------------------------------------------------- account
class AccountPayload(_Model):
    """AccountScreen `AccountSubmission`.

    Personal information (the registering user's own record): firstName, lastName, email (their
    PERSONAL email, required), dob (optional). Company information: companyName, companyType, country,
    phone (the COMPANY's phone, required, Indian, stored as +91XXXXXXXXXX), capacity."""
    # Prefilled from the saved user record; saved only if the user changed them.
    firstName: str = Field(min_length=1, max_length=100)
    lastName: str = Field(min_length=1, max_length=100)
    # The registering user's personal email (never the company's contact email).
    email: str = Field(default="", max_length=320)
    # Older clients sent the email as `contact`.
    contact: str | None = Field(default=None, max_length=320)
    # Optional (may be left empty on the form).
    dob: date | None = None
    companyName: str = Field(min_length=1, max_length=200)
    companyType: str = Field(min_length=1, max_length=150)
    country: str = Field(min_length=1, max_length=100)
    # The company's phone number (required).
    phone: str = Field(default="", max_length=30)
    capacity: str = Field(default="", max_length=100)
    # Database id of the company picked from the search list (None = a new company). The
    # backend checks the record and the user's ownership before writing anything.
    companyId: UUID | None = None

    # The onboarding / submission source is assigned by the backend (web_dashboard for this
    # endpoint); a body that tries to set it is rejected rather than silently ignored.
    @model_validator(mode="before")
    @classmethod
    def no_client_source(cls, data):
        return reject_client_source(data)

    @field_validator("dob")
    @classmethod
    def dob_not_in_future(cls, value: date | None) -> date | None:
        if value is not None and value > date.today():
            raise ValueError("Date of birth cannot be in the future")
        return value

    @model_validator(mode="after")
    def personal_email_and_company_phone(self):
        email = (self.email or "").strip()
        if not email and self.contact and "@" in self.contact:
            email = self.contact.strip()
        if not email:
            raise ValueError("Personal email address is required")
        if not EMAIL_RE.match(email):
            raise ValueError("Enter a valid personal email address")
        self.email = email
        if self.companyId is None:
            # New company: the phone is required. An existing company's saved phone is used as
            # saved (checked against the record in the repository).
            self.phone = normalize_indian_phone(self.phone)
        return self


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


# ---------------------------------------------------------------- profile PATCH
# Partial update: a key that is ABSENT is left unchanged in the database.
# A key that is present with "" or null means the user cleared that field.
# Invalid values are rejected (422) - they never silently become NULL.

def _year(value):
    if value in (None, ""):
        return ""
    text = str(value).strip()
    if not text.isdigit() or not 1700 <= int(text) <= date.today().year:
        raise ValueError(f"Year of establishment must be between 1700 and {date.today().year}")
    return text


def _count(value):
    if value in (None, ""):
        return ""
    text = str(value).strip()
    if not text.isdigit() or int(text) > 10_000_000:
        raise ValueError("Number of employees must be a whole number")
    return text


def _pin(value):
    if value in (None, ""):
        return None
    parts = [p.strip() for p in str(value).split(",")]
    try:
        lat, lng = float(parts[0]), float(parts[1])
        if len(parts) != 2 or not (-90 <= lat <= 90 and -180 <= lng <= 180):
            raise ValueError
    except (ValueError, IndexError) as exc:
        raise ValueError("Map pin must be 'latitude, longitude'") from exc
    return str(value).strip()


class CompanyPatch(_Model):
    name: str | None = Field(default=None, max_length=200)
    logo: str | None = None
    cover: str | None = None
    about: str | None = Field(default=None, max_length=5000)
    vision: str | None = Field(default=None, max_length=5000)
    estYear: str | None = None
    employees: str | None = None
    businessType: str | None = Field(default=None, max_length=150)
    orgSize: str | None = Field(default=None, max_length=150)

    _v_year = field_validator("estYear", mode="before")(classmethod(lambda cls, v: _year(v)))
    _v_count = field_validator("employees", mode="before")(classmethod(lambda cls, v: _count(v)))


class LocationPatch(_Model):
    address: str | None = Field(default=None, max_length=500)
    city: str | None = Field(default=None, max_length=150)
    state: str | None = Field(default=None, max_length=150)
    country: str | None = Field(default=None, max_length=100)
    zip: str | None = Field(default=None, max_length=20)
    pin: str | None = None
    sez: str | None = Field(default=None, max_length=100)
    serviceableAreas: list[str] | None = Field(default=None, max_length=200)

    _v_pin = field_validator("pin", mode="before")(classmethod(lambda cls, v: _pin(v)))


class InfraPatch(_Model):
    electricity: str | None = Field(default=None, max_length=2000)
    water: str | None = Field(default=None, max_length=2000)
    storage: str | None = Field(default=None, max_length=2000)
    packaging: str | None = Field(default=None, max_length=2000)
    waste: str | None = Field(default=None, max_length=2000)
    qa: str | None = Field(default=None, max_length=2000)


class StepProgress(_Model):
    """Which wizard step this save belongs to.

    completed=True  -> "Next" / "Save & Next": the step is validated and marked done.
    completed=False -> "Skip", "Previous" or closing the wizard: position saved only."""
    step: int = Field(ge=1, le=20)
    completed: bool = False
    nextStep: int | None = Field(default=None, ge=1, le=20)   # where the user goes now


class ProfilePatchPayload(_Model):
    """PATCH /manufacturer/profile - only the fields the user changed.

    Lists (certifications, faqs, serviceableAreas) are sent whole when changed,
    because the wizard edits them as a list (add / remove)."""
    company: CompanyPatch | None = None
    location: LocationPatch | None = None
    certifications: list[CertificationData] | None = Field(default=None, max_length=100)
    infra: InfraPatch | None = None
    faqs: list[FaqData] | None = Field(default=None, max_length=100)
    progress: StepProgress | None = None

    def changes(self) -> dict:
        """Only the data keys the client actually sent (absent = unchanged)."""
        return self.model_dump(mode="json", exclude_unset=True, exclude={"progress"})


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


# ---------------------------------------------------------------- machinery steps
class MachineryPatch(_Model):
    """Any subset of MachineryDraft. Absent = unchanged; "" = cleared."""
    industry: str | None = Field(default=None, max_length=150)
    subcategory: str | None = Field(default=None, max_length=150)
    type: str | None = Field(default=None, max_length=200)
    capacity: str | None = Field(default=None, max_length=200)
    age: str | None = Field(default=None, max_length=50)
    condition: str | None = Field(default=None, max_length=50)
    technical: str | None = Field(default=None, max_length=5000)
    images: list[MachineryImage] | None = Field(default=None, max_length=12)
    rawMatStatus: str | None = Field(default=None, max_length=100)
    materialDetails: str | None = Field(default=None, max_length=2000)
    laborType: str | None = Field(default=None, max_length=100)
    workerCount: str | None = Field(default=None, max_length=20)
    workerRoles: str | None = Field(default=None, max_length=1000)
    logistics: list[str] | None = Field(default=None, max_length=20)
    logisticsPartner: str | None = Field(default=None, max_length=300)
    pricing: Pricing | None = None
    insurance: str | None = Field(default=None, max_length=300)
    progress: StepProgress | None = None
    finish: Literal["Draft", "Published"] | None = None

    def changes(self) -> dict:
        return self.model_dump(mode="json", exclude_unset=True, exclude={"progress", "finish"})


class MachineryDraftCreate(MachineryPatch):
    """First "Save & Next" of the machinery wizard: creates the draft record.

    clientKey is generated once per wizard session; repeating the request
    (double click, retry after a timeout) returns the same draft."""
    clientKey: UUID

    def changes(self) -> dict:
        return self.model_dump(mode="json", exclude_unset=True, exclude={"progress", "finish", "clientKey"})


# ---------------------------------------------------------------- availability PATCH
class AvailabilityPatchPayload(_Model):
    """Only the parts that changed: calendar, recurring and/or capacity."""
    calendar: dict[str, Literal["available", "blocked"]] | None = None
    recurring: RecurringData | None = None
    capacity: CapacityData | None = None

    def changes(self) -> dict:
        return self.model_dump(mode="json", exclude_unset=True)


class NotificationsReadPayload(_Model):
    """ids: the notifications opened; omit (or null) to mark all as read."""
    ids: list[UUID] | None = Field(default=None, max_length=200)
