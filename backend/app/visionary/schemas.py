"""Request bodies for the Visionaries portal (/api/v1/visionary/...).

Field names match the frontend (src/lib/visionary/storage.ts) so the screens send
their own objects unchanged. Strings are trimmed; limits match the form inputs
(maxLength) and the database CHECK constraints in 012_visionary_portal.sql.
"""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

STAGES = ("Idea Stage", "Design Stage", "Prototype Stage", "Ready for Manufacturing")
TIMELINES = ("immediately", "within_1_month", "1_3_months", "3_6_months")
DURATIONS = ("1_week", "2_weeks", "1_month", "2_months", "3_months", "6_months")
MAX_QUANTITY = 1_000_000_000          # fits INTEGER
MAX_BUDGET = 1_000_000_000_000        # fits NUMERIC(14,2)

# Same list as MACHINE_CATALOG in src/lib/visionary/storage.ts: offered when the selected
# manufacturer has not published any machines yet.
MACHINE_CATALOG = (
    "Injection Moulding", "CNC Machining", "CNC Milling", "CNC Turning / Lathe", "3D Printing (FDM)",
    "3D Printing (SLA / Resin)", "Laser Cutting", "Laser Engraving", "Sheet Metal Bending",
    "Sheet Metal Punching", "Die Casting", "Vacuum Casting", "Blow Moulding", "Extrusion",
    "Thermoforming", "Compression Moulding", "Welding", "Powder Coating", "Screen Printing",
    "Sublimation Printing", "Embroidery", "Sewing / Stitching", "Packaging & Labelling", "Assembly Line",
)

Timeline = Literal["immediately", "within_1_month", "1_3_months", "3_6_months", ""]
Duration = Literal["1_week", "2_weeks", "1_month", "2_months", "3_months", "6_months", ""]


class _Model(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)


class Quantity(_Model):
    value: int = Field(default=0, ge=0, le=MAX_QUANTITY)
    unit: Literal["units"] = "units"


class Budget(_Model):
    amount: int = Field(default=0, ge=0, le=MAX_BUDGET)
    currency: Literal["INR"] = "INR"


class ProfileIn(_Model):
    """Step 1 "Let's Start With You" (Continue)."""
    name: str = Field(min_length=1, max_length=120)
    role: str = Field(min_length=1, max_length=120)
    org: str = Field(default="", max_length=160)
    location: str = Field(min_length=1, max_length=120)
    intro: str = Field(default="", max_length=300)


class IdeaIn(_Model):
    """Step 2 "Your idea". complete=true for "Save & Next" (all four required);
    false for "Previous" (whatever was typed is kept)."""
    project: str = Field(default="", max_length=160)
    idea: str = Field(default="", max_length=500)
    product: str = Field(default="", max_length=160)
    industry: str = Field(default="", max_length=120)
    complete: bool = True
    # True when "Add Project" starts a new idea. False keeps updating the current project.
    create_new: bool = False

    @model_validator(mode="after")
    def _required(self):
        if self.complete:
            missing = [k for k in ("project", "idea", "product", "industry") if not getattr(self, k)]
            if missing:
                raise ValueError(f"Required: {', '.join(missing)}")
        return self


class ProjectUpdateIn(_Model):
    """View All Projects "Save": the fields on the project card. Machines are left as stored."""
    project: str = Field(min_length=1, max_length=160)
    idea: str = Field(default="", max_length=500)
    product: str = Field(default="", max_length=160)
    industry: str = Field(default="", max_length=120)
    stage: str = Field(default="", max_length=40)
    manufacturing_location: str = Field(default="", max_length=120)
    quantity: int = Field(default=0, ge=0, le=MAX_QUANTITY)
    budget: int = Field(default=0, ge=0, le=MAX_BUDGET)
    timeline: Timeline = ""
    additional_requirements: str = Field(default="", max_length=500)

    @model_validator(mode="after")
    def _stage(self):
        if self.stage and self.stage not in STAGES:
            raise ValueError("Choose a project stage.")
        return self


class StageIn(_Model):
    """Step 3 "Project stage"."""
    stage: Literal["Idea Stage", "Design Stage", "Prototype Stage", "Ready for Manufacturing"]


class RequirementsIn(_Model):
    """Step 4 "Manufacturing needs". complete=true for "Find a Manufacturer".
    `machines`: the manufacturing capabilities the project needs (optional, any number up to 30)."""
    machines: list[str] = Field(default_factory=list, max_length=30)
    manufacturing_location: str = Field(default="", max_length=120)
    quantity: Quantity = Quantity()
    budget: Budget = Budget()
    timeline: Timeline = ""
    additional_requirements: str = Field(default="", max_length=500)
    complete: bool = True

    @field_validator("machines")
    @classmethod
    def _machines(cls, values: list[str]) -> list[str]:
        """Trimmed, empty entries dropped, duplicates (ignoring case) removed, order kept."""
        seen, clean = set(), []
        for value in values:
            name = " ".join(str(value or "").split())
            if len(name) > 160:
                raise ValueError("Machine names can be at most 160 characters.")
            if name and name.lower() not in seen:
                seen.add(name.lower())
                clean.append(name)
        return clean

    @model_validator(mode="after")
    def _required(self):
        if self.complete:
            missing = []
            if not self.manufacturing_location:
                missing.append("manufacturing_location")
            if self.quantity.value < 1:
                missing.append("quantity")
            if self.budget.amount < 1:
                missing.append("budget")
            if not self.timeline:
                missing.append("timeline")
            if missing:
                raise ValueError(f"Required: {', '.join(missing)}")
        return self


class RequestDraftIn(_Model):
    """Request form "Save" (any subset of the fields)."""
    machine: str = Field(default="", max_length=160)
    quantity: Quantity = Quantity()
    required_duration: Duration = ""
    manufacturing_location: str = Field(default="", max_length=120)
    budget: Budget = Budget()
    timeline: Timeline = ""
    additional_requirements: str = Field(default="", max_length=500)


class RequestIn(_Model):
    """Request form "Send Request to Manufacturer": every field the form requires."""
    manufacturer_id: str = Field(min_length=1, max_length=64)
    machine: str = Field(min_length=1, max_length=160)
    quantity: Quantity
    required_duration: Literal["1_week", "2_weeks", "1_month", "2_months", "3_months", "6_months"]
    manufacturing_location: str = Field(min_length=1, max_length=120)
    budget: Budget
    timeline: Literal["immediately", "within_1_month", "1_3_months", "3_6_months"]
    additional_requirements: str = Field(default="", max_length=500)

    @model_validator(mode="after")
    def _positive(self):
        if self.quantity.value < 1:
            raise ValueError("Enter a quantity greater than 0.")
        if self.budget.amount < 1:
            raise ValueError("Enter a budget greater than 0.")
        return self
