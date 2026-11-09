"""Manual invocation: python tests/browser_smoke.py [http://127.0.0.1:3100]

Uses an existing agent-browser session named parcel-explorer. The session is
isolated from the user's browser. No government websites are crawled by this test.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
BASE=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:3100'
CLI=shutil.which('agent-browser.cmd' if os.name=='nt' else 'agent-browser')
if not CLI:raise SystemExit('Install agent-browser to run the browser smoke test.')
ROOT=Path(__file__).resolve().parents[1]

def run(*args):
    p=subprocess.run([CLI,'--session','parcel-explorer',*args],capture_output=True,text=True,encoding='utf-8',timeout=35)
    if p.returncode:raise AssertionError(p.stdout+p.stderr)
    return p.stdout.strip()

def evaluate(js):
    result=json.loads(run('eval',js) or 'null')
    return result

def wait_for(js,timeout=15):
    start=time.monotonic()
    while time.monotonic()-start<timeout:
        if evaluate(js):return
        time.sleep(.2)
    raise AssertionError('Timed out: '+js)

def click(selector):run('click',selector)

def test():
    run('set','viewport','1440','1000')
    run('open',BASE)
    evaluate('localStorage.removeItem("parcel-explorer:local-research:v1"); true')
    run('reload')
    wait_for('document.querySelectorAll("canvas").length === 1')
    assert evaluate('document.querySelector("canvas").getBoundingClientRect().height')>900
    evaluate('window.__qaCanvas = document.querySelector("canvas"); true')
    # Background network is irrelevant to behavior checks; prevent automated
    # pan/zoom testing from fetching new public basemap tiles.
    run('network','route','https://tile.openstreetmap.org/**','--abort')
    run('fill','input[role="combobox"]','10 Jay Street')
    run('press','Enter')
    wait_for('document.querySelectorAll(".result-row").length === 2')
    click('.result-row:first-child')
    wait_for('document.querySelector(".inspector h1")?.textContent === "10 Jay Street"')
    assert evaluate('document.querySelector(".inspector").getBoundingClientRect().width / innerWidth')<=.30
    assert evaluate('window.__qaCanvas === document.querySelector("canvas")')
    click('[role="tab"]:nth-child(2)')
    assert evaluate('window.__qaCanvas === document.querySelector("canvas")')
    wait_for('!!document.querySelector(".record-card")')
    assert 'Partial import' in evaluate('document.querySelector(".inspector-scroll").innerText')
    click('[aria-label="Bookmark property"]')
    wait_for('!!document.querySelector(".is-saved")')
    click('.notes-toggle')
    run('fill','#research-note','Browser QA fixture note; not real property research.')
    click('.note-editor .primary-button')
    assert evaluate('location.search.includes("QA")') is False
    assert 'Browser QA fixture note' in evaluate('localStorage.getItem("parcel-explorer:local-research:v1")')
    run('reload')
    wait_for('!!document.querySelector(".inspector h1")')
    click('.notes-toggle')
    assert evaluate('document.querySelector("#research-note").value')=='Browser QA fixture note; not real property research.'
    click('[aria-label="Close property inspector"]')
    run('fill','input[role="combobox"]','Jersey City')
    run('press','Enter')
    wait_for('document.querySelector(".results-scroll")?.innerText.includes("That area isn’t imported yet")')
    # A real condo footprint never receives invented individual-unit history.
    run('open',BASE+'/?parcel=3000537501')
    wait_for('document.querySelector(".inspector-scroll")?.innerText.includes("Condominium footprint")')
    assert 'official unit crosswalk is not imported' in evaluate('document.querySelector(".inspector-scroll").innerText')
    run('set','viewport','390','844')
    assert evaluate('document.documentElement.scrollWidth')==390
    before=evaluate('document.querySelector(".inspector").getBoundingClientRect().height')
    click('.sheet-handle')
    assert evaluate('document.querySelector(".inspector").getBoundingClientRect().height')>before
    click('[aria-label="Collapse details to summary"]')
    assert evaluate('document.querySelector(".inspector").classList.contains("compact")')
    assert evaluate('document.querySelector(".inspector h1").textContent')=='100 Jay Street'
    click('.summary-body .primary-button')
    click('[aria-label="Close property inspector"]')
    click('[aria-label="Open property filters"]')
    run('check','.filter-fieldset:first-of-type .check-row:first-of-type input')
    click('.tool-footer .primary-button')
    wait_for('!!document.querySelector(".results-panel")')
    assert evaluate('document.querySelectorAll(".active-search-context button").length')>0
    click('[aria-label="Clear query and filters"]')
    run('set','viewport','1280','900')
    run('open',BASE+'/?parcel=3001480001')
    wait_for('!!document.querySelector(".inspector h1")')
    assert evaluate('document.querySelector(".inspector").getBoundingClientRect().width / innerWidth')<=.30
    click('[role="tab"]:nth-child(2)')
    run('select','[aria-label="Filter record type"]','document')
    wait_for('!!document.querySelector(".record-caution")')
    assert 'no per-property allocation' in evaluate('document.querySelector(".record-caution").innerText')
    # Clean only the fixture created in this isolated session.
    evaluate('localStorage.removeItem("parcel-explorer:local-research:v1"); true')
    run('set','viewport','914','816')
    run('open',BASE+'/?map=-73.994543,40.694386,19.19')
    wait_for('!!document.querySelector(".maplibregl-canvas")')
    for _ in range(20):
        run('mouse','move','366','475')
        run('mouse','move','365','475')
        if evaluate('document.querySelector("canvas")?.style.cursor === "pointer"'):break
        time.sleep(.2)
    run('mouse','down');run('mouse','up')
    wait_for('document.querySelector(".inspector.expanded h1")?.textContent === "93 Remsen Street"')
    assert evaluate('!!document.querySelector(".summary-body")') is False
    run('network','unroute','https://tile.openstreetmap.org/**')
    run('set','viewport','1440','1000')
    run('open',BASE)
    print('Browser smoke: PASS (desktop 1440/1280, mobile 390, search, unsupported coverage, persistent map, notes, condo warning, multi-property amount, sheet states).')

if __name__=='__main__':test()
