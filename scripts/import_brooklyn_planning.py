"""Refresh the Brooklyn planning snapshot from the two official ZAP feeds."""
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen

BASE = "https://data.cityofnewyork.us/resource/"
OUTPUT = Path(__file__).resolve().parents[1] / "apps/web/public/planning/brooklyn.json"


def rows(dataset, query):
    size = 5000
    offset = 0
    while True:
        params = urlencode({"$query": f"{query} limit {size} offset {offset}"})
        with urlopen(f"{BASE}{dataset}.json?{params}", timeout=60) as response:
            page = json.load(response)
        yield from page
        if len(page) < size:
            break
        offset += size


def main():
    projects = {
        row["project_id"]: row for row in rows(
            "hgx4-8ukb",
            "select project_id,project_name,public_status,actions,current_milestone,"
            "current_milestone_date,ulurp_numbers "
            "where borough in ('Brooklyn','Citywide') order by project_id",
        )
    }
    lots = {}
    for row in rows(
        "2iga-a6mk",
        "select distinct project_id,bbl where validated = 'true' "
        "and validated_borough = 'Brooklyn' and bbl is not null order by bbl,project_id",
    ):
        bbl, project = row["bbl"], row["project_id"]
        if re.fullmatch(r"3[0-9]{9}", bbl) and project in projects:
            lots.setdefault(bbl, []).append(project)
    linked = {project for ids in lots.values() for project in ids}
    if not linked:
        raise RuntimeError("ZAP returned no linked Brooklyn projects")
    snapshot = {
        "asOf": datetime.now(timezone.utc).date().isoformat(),
        "lots": lots,
        "projects": {key: value for key, value in projects.items() if key in linked},
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temporary = OUTPUT.with_suffix(".tmp")
    temporary.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    temporary.replace(OUTPUT)
    print(f"{len(linked)} projects linked to {len(lots)} Brooklyn tax lots")


if __name__ == "__main__":
    main()
