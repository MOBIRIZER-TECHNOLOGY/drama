"""No two routes may claim the same method and path.

FastAPI serves the first route registered for a path and never mentions the others. The OpenAPI document does
the opposite: it is a mapping keyed by path and method, so the *last* registration is the one described. A
duplicate therefore produces a document that promises one response and a server that returns another — and
the TypeScript client is generated from the document, so the client is correctly typed against an endpoint
that never runs.

That happened on `GET /v1/admin/users/{user_id}`. An older handler returning the plain account shadowed a
newer one that also returns VIP state and purchases. The spec, the generated client and the admin console all
agreed the richer shape was there; the server sent the smaller one, and the console crashed reading
`purchases.length` of undefined, so support could not open any account at all.

Nothing else catches this. Tests of the endpoint pass, because they exercise whichever handler is first.
Typechecking passes, because the client matches the document. Only the running server disagrees.
"""

from collections import defaultdict

import pytest
from fastapi.routing import APIRoute

from app.main import create_app


def collect_routes(app) -> list[tuple[str, str, str]]:
    """Every (method, full path, handler name) the app will actually serve.

    Recent FastAPI keeps an included router nested behind a `_IncludedRouter` rather than flattening its
    routes into `app.routes`, so walking the top level alone finds only the handful defined on the app
    itself. Getting this wrong is how a check like this passes while inspecting nothing, which is why
    `test_the_router_walk_finds_the_api` exists below.
    """
    found: list[tuple[str, str, str]] = []

    def walk(routes, prefix: str) -> None:
        for route in routes:
            if isinstance(route, APIRoute):
                for method in route.methods:
                    found.append((method, prefix + route.path, route.endpoint.__name__))
            elif (context := getattr(route, "include_context", None)) is not None:
                walk(context.included_router.routes, prefix + (context.prefix or ""))

    walk(app.routes, "")
    return found


@pytest.fixture(scope="module")
def routes() -> list[tuple[str, str, str]]:
    return collect_routes(create_app())


def test_the_router_walk_finds_the_api(routes):
    """Guards the guard: a walk that returns nothing would make every other test here vacuous."""
    paths = {path for _, path, _ in routes}
    assert len(routes) > 100, f"only found {len(routes)} routes; the walk is not reaching the API"
    assert "/v1/home" in paths
    assert "/v1/admin/users/{user_id}" in paths


def test_no_route_is_registered_twice(routes):
    seen: dict[tuple[str, str], list[str]] = defaultdict(list)
    for method, path, name in routes:
        seen[(method, path)].append(name)

    duplicates = {key: names for key, names in seen.items() if len(names) > 1}
    assert not duplicates, (
        "Two handlers claim the same route. The first registered one serves every request; the last one is "
        "what the OpenAPI document and the generated client describe:\n"
        + "\n".join(f"  {method} {path}: {', '.join(names)}" for (method, path), names in duplicates.items())
    )


def test_the_admin_user_detail_route_is_the_rich_one():
    """The specific regression, pinned by what the console needs rather than by counting routes."""
    app = create_app()

    def find(routes, prefix: str):
        for route in routes:
            if isinstance(route, APIRoute):
                if prefix + route.path == "/v1/admin/users/{user_id}" and "GET" in route.methods:
                    return route
            elif (context := getattr(route, "include_context", None)) is not None:
                hit = find(context.included_router.routes, prefix + (context.prefix or ""))
                if hit is not None:
                    return hit
        return None

    route = find(app.routes, "")
    assert route is not None, "GET /v1/admin/users/{user_id} is not registered"
    fields = route.response_model.model_fields
    for required in ("is_vip", "vip_ends_at", "purchases", "sessions"):
        assert required in fields, f"the admin user detail response lost `{required}`"
