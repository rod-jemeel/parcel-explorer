from services.api.brooklyn import sale_distance


def test_sale_distance_miles():
    assert sale_distance((-74, 40), (-74, 40)) == 0
    assert 0.68 < sale_distance((-74, 40), (-74, 40.01)) < 0.70


def test_comparables_keep_one_positive_whole_lot_sale_per_matching_building():
    import json
    import sqlite3
    from contextlib import closing

    from services.api.brooklyn import comparable_sales
    from services.ingestion.brooklyn_release import init, insert_event

    release = 'bk-123456789abc'
    subject, match, other = ('3000010001', '3000010002', '3000010003')
    with closing(sqlite3.connect(':memory:')) as db:
        init(db)
        for bbl, building_class in [(subject, 'A1'), (match, 'A1'), (other, 'M1')]:
            profile = dict(bbl=bbl, address=bbl, buildings=1, entity_kind='parcel',
                           building_area=2000, building_class=building_class, center=[-74, 40.6])
            db.execute('INSERT INTO parcel VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                       (bbl, bbl, '1', 2000, 1940, 12000, -74, 40.6, -73.999, 40.601, json.dumps(profile)))
        cases = [(match, '2025-01-01', '100000', ''), (match, '2025-02-01', '120000', ''),
                 (match, '2025-03-01', '150000', '3A'), (match, '2025-04-01', '0', ''),
                 (other, '2025-03-01', '140000', '')]
        for i, (bbl, date, amount, apartment) in enumerate(cases):
            record = dict(id=f'dof:{i}', type='transfer', source='dof_sales', date=date,
                          amount=amount, apartment=apartment, property_bbls=[bbl])
            insert_event(db, record, {subject, match, other}, release)
        db.execute("""CREATE TABLE stats AS SELECT bbl, count(*) AS total, 0 AS document,
            count(*) AS transfer, 0 AS permit, max(event_date) AS latest_transfer FROM link GROUP BY bbl""")
        result = comparable_sales(db, subject)
        assert [(row['bbl'], row['sale']['amount']) for row in result['sales']] == [(match, '120000')]
