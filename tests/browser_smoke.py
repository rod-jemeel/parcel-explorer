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
    wait_for('document.querySelector(".result-row")?.innerText.includes("10 Jay Street")')
    click('.result-row:first-child')
    wait_for('document.querySelector(".inspector h1")?.textContent === "10 Jay Street"')
    assert evaluate('document.querySelector(".inspector").getBoundingClientRect().width / innerWidth')<=.30
    assert evaluate('window.__qaCanvas === document.querySelector("canvas")')
    click('[role="tab"]:nth-child(2)')
    assert evaluate('window.__qaCanvas === document.querySelector("canvas")')
    wait_for('!!document.querySelector(".record-card")')
    click(".history-intro button")
    wait_for('document.querySelector(".source-list")?.innerText.includes("rolling sales")')
    assert evaluate('document.querySelectorAll(".source-list details[open]").length') == 0
    click('.source-list li:first-child summary')
    wait_for('!!document.querySelector(".source-list details[open] a")')
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
    assert evaluate('!!document.querySelector(".search-area-button, .basemap-toggle")') is False
    assert evaluate('document.querySelectorAll(".tool-rail button").length') == 1
    click('button[aria-label="Map layers"]')
    wait_for('!!document.querySelector(".tool-panel [aria-label=Imagery]")')
    click('button[aria-label="Map layers"]')
    click('[aria-label="Open property filters"]')
    run('check','[aria-label="Limit to map view"]')
    run('check','.filter-fieldset:first-of-type .check-row:first-of-type input')
    click('.tool-footer .primary-button')
    wait_for('!!document.querySelector(".results-panel")')
    assert evaluate('!!document.querySelector(".active-search-context .area-chip")')
    click('[aria-label="Clear query and filters"]')
    run('set','viewport','1280','900')
    run('open',BASE+'/?parcel=3001480001')
    wait_for('!!document.querySelector(".inspector h1")')
    assert evaluate('document.querySelector(".inspector").getBoundingClientRect().width / innerWidth')<=.30
    click('[role="tab"]:nth-child(2)')
    wait_for('!!document.querySelector("ol.timeline-events li")')
    assert evaluate('!!document.querySelector(".record-card[open]")') is False
    caution = '.record-card:has(.record-caution)'
    click(caution + ' .record-summary')
    wait_for('!!document.querySelector(".record-card[open] .record-caution")')
    assert 'no per-property allocation' in evaluate('document.querySelector(".record-caution").innerText')
    click('[role="tab"]:nth-child(5)')
    wait_for('!!document.querySelector(".assessment-method")')
    assert evaluate('!!document.querySelector(".assessment-method[open]")') is False
    click('.assessment-method summary')
    assert 'total minus land' in evaluate('document.querySelector(".assessment-method[open]").innerText')
    run('open',BASE+'/?parcel=3002490016')
    wait_for('document.querySelector(".inspector h1")?.textContent === "95 Remsen Street"')
    click('[role="tab"]:nth-child(2)')
    wait_for('document.querySelector(".history-intro h3")?.textContent === "Recorded documents"')
    assert evaluate('!!document.querySelector(".permit-heading")') is False
    click('[role="tab"]:nth-child(4)')
    wait_for('!!document.querySelector(".permit-job-title")')
    assert evaluate('document.querySelector(".permit-job-title").textContent.includes("B08042716-I1")')
    click('[aria-label="Copy job ID B08042716-I1"]')
    wait_for('document.querySelector(".permit-copy-status")?.textContent.includes("Job ID copied")')
    assert evaluate('!!document.querySelector(".permit-toggle[aria-expanded=true]")') is False
    evaluate('document.body.appendChild(Object.assign(document.createElement("input"), {id:"qa-paste"})).focus(); true')
    run('press','Control+v')
    wait_for('document.querySelector("#qa-paste")?.value === "B08042716-I1"')
    evaluate('document.querySelector("#qa-paste").remove(); true')
    toggle = '.timeline-year:first-child .permit-toggle'
    rect = evaluate('document.querySelector(".permit-heading .record-meta").getBoundingClientRect().toJSON()')
    run('mouse','move',str(round(rect['left']+5)),str(round(rect['top']+5)))
    run('mouse','down');run('mouse','up')
    wait_for('document.querySelector(".permit-toggle")?.getAttribute("aria-expanded") === "true"')
    click(toggle)
    wait_for('document.querySelector(".permit-toggle")?.getAttribute("aria-expanded") === "false"')
    click(toggle)
    wait_for('!!document.querySelector(".permit-event .record-card:not([hidden]) .dob-portal-link")')
    assert evaluate('document.querySelector(".dob-portal-link").href') == 'https://a810-dobnow.nyc.gov/publish/Index.html'
    assert evaluate('document.querySelector(".permit-job-link").href.includes("passjobnumber=321994703")')
    assert evaluate('!!document.querySelector(".permit-job-link").closest("summary")') is False
    assert evaluate('!!document.querySelector(".inspector-footer")') is False
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
    print('Browser smoke: PASS (desktop 1440/1280, mobile 390, search, unsupported coverage, persistent map, notes, condo warning, expandable timeline, assessment disclosure, sheet states).')

if __name__=='__main__':test()
