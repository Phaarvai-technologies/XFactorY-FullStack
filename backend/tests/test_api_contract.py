from app.main import app


def test_frontend_paths_are_published_in_openapi():
    paths = app.openapi()["paths"]
    expected = {
        "/api/v1/manufacturer/bootstrap": "get",
        "/api/v1/manufacturer/account": "post",
        "/api/v1/manufacturer/profile": "put",
        "/api/v1/manufacturer/machinery": "post",
        "/api/v1/manufacturer/machinery/{machine_id}/status": "patch",
        "/api/v1/manufacturer/availability": "put",
        "/api/v1/manufacturer/booking-requests/{booking_id}": "patch",
        "/api/v1/identity/me": "get",
        "/api/v1/identity/me/roles": "put",
        "/api/v1/webhooks/clerk": "post",
        "/health/live": "get",
    }
    for path, method in expected.items():
        assert method in paths[path], path
