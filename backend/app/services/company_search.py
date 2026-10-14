"""Read-only company search; independent of optional bulk-import tracking tables."""
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


def escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


class CompanySearchService:
    def __init__(self, session: AsyncSession):
        self.db = session

    async def _query(self) -> str:
        # Optional existing claim rules still apply when the claim feature is installed.
        has_claims = await self.db.scalar(text("SELECT to_regclass('organization_claims') IS NOT NULL"))
        claim_filter = """AND NOT EXISTS (SELECT 1 FROM organization_claims c
            WHERE c.organization_id = o.id AND c.status = 'approved')""" if has_claims else ""
        return f"""
            SELECT o.id, o.display_name AS name, o.website_domain AS website,
                   f.city, f.state_province AS state, f.postal_code AS "postalCode",
                   COALESCE(f.country_name, op.country_name) AS country,
                   op.company_category AS category,
                   COALESCE(NULLIF(op.production_capacity_label, ''),
                            op.stated_production_capacity::text) AS capacity,
                   NULL::text AS sector, NULL::text AS products
            FROM organizations o
            LEFT JOIN organization_profiles op ON op.organization_id = o.id
            LEFT JOIN LATERAL (
                SELECT city, state_province, postal_code, country_name
                FROM facilities WHERE organization_id = o.id AND is_headquarters
                ORDER BY id LIMIT 1
            ) f ON true
            WHERE o.organization_type = 'manufacturer' AND o.entry_source = 'IMPORTED'
              AND o.status = 'claim_pending' AND NOT o.is_archived
              AND NOT EXISTS (SELECT 1 FROM memberships m
                  WHERE m.organization_id = o.id AND m.status = 'active')
              {claim_filter}
        """

    async def search(self, q: str, limit: int = 20) -> dict:
        query = q.strip()
        if not query:
            return {"query": query, "results": [], "hasMore": False}
        value = query.lower()
        params = {"value": value, "prefix": escape_like(value) + "%",
                  "contains": "%" + escape_like(value) + "%", "limit": limit + 1}
        sql = await self._query()
        rows = (await self.db.execute(text(sql + """
            AND lower(btrim(o.display_name)) LIKE :contains ESCAPE '\\'
            ORDER BY CASE
                WHEN lower(btrim(o.display_name)) = :value THEN 0
                WHEN lower(btrim(o.display_name)) LIKE :prefix ESCAPE '\\' THEN 1
                ELSE 2 END, lower(btrim(o.display_name)), o.id
            LIMIT :limit
        """), params)).mappings().all()
        results = []
        for row in rows[:limit]:
            result = dict(row)
            result["id"] = str(result["id"])
            result["exactName"] = result["name"].strip().lower() == value
            results.append(result)
        return {"query": query, "results": results, "hasMore": len(rows) > limit}

    async def company(self, org_id: str) -> dict:
        sql = await self._query()
        row = (await self.db.execute(text(sql + " AND o.id = CAST(:id AS uuid)"),
                                     {"id": org_id})).mappings().first()
        if row is None:
            raise HTTPException(404, "This company is no longer available for selection.")
        result = dict(row)
        result["id"] = str(result["id"])
        return result
