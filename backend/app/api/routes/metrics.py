from fastapi import APIRouter

router = APIRouter(prefix="/metrics", tags=["Metrics"])


@router.get("/platform")
async def platform_stats():
    """
    Platform statistics.

    Currently returns an empty dataset because the platform
    database does not contain the required dataset yet.

    Database queries can be added here once manufacturer,
    machinery and availability data are available.
    """

    return {
        "manufacturerCount": 0,
        "machineryCount": 0,
        "manufacturerDeltaThisMonth": 0,
        "machineryDeltaThisMonth": 0,
        "availabilityOverTime": [],
    }