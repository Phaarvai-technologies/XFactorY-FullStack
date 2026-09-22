from app.main import app


def test_mvp_paths_are_published_in_openapi():
    paths = app.openapi()["paths"]
    assert "/api/v1/identity/me" in paths
    assert "/api/v1/identity/me/roles" in paths
    assert "/api/v1/manufacturer/account" in paths
    assert "get" in paths["/api/v1/manufacturer/account"]
    assert "post" in paths["/api/v1/manufacturer/account"]
    assert "/api/v1/webhooks/clerk" in paths
    assert "/health/live" in paths
