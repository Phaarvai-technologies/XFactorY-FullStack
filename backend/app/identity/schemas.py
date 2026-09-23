from pydantic import BaseModel, Field


ALLOWED_ROLES = {
    "manufacturer",
    "visionary",
    "vendor",
    "logistics_provider",
    "labour_supplier",
    "legal_writer",
    "investor",
    "market_lead",
}


class RoleUpdate(BaseModel):
    roles: list[str] = Field(min_length=1, max_length=8)

    def normalized(self) -> list[str]:
        values = list(dict.fromkeys(self.roles))
        invalid = set(values) - ALLOWED_ROLES
        if invalid:
            raise ValueError(f"Unsupported roles: {', '.join(sorted(invalid))}")
        return values
