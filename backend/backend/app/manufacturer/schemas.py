from datetime import date

from pydantic import BaseModel, Field, field_validator


class ManufacturerAccountCreate(BaseModel):
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    contact: str = Field(min_length=3, max_length=320)
    date_of_birth: date
    company_name: str = Field(min_length=2, max_length=255)
    company_category: str = Field(min_length=2, max_length=100)
    country: str = Field(min_length=2, max_length=100)
    phone: str | None = Field(default=None, max_length=40)
    production_capacity: str | None = Field(default=None, max_length=100)

    @field_validator("date_of_birth")
    @classmethod
    def date_must_be_in_past(cls, value: date) -> date:
        if value >= date.today():
            raise ValueError("Date of birth must be in the past")
        return value

