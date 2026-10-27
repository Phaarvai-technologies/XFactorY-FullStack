"""Real database/API search tests; uses disposable E2E_DATABASE_URL only."""
import os
from uuid import uuid4

import pytest
from test_e2e_local import client  # noqa: F401

pytestmark = pytest.mark.skipif(not os.environ.get('E2E_DATABASE_URL'), reason='E2E_DATABASE_URL not set')


async def seed(c, name, city='Hosur', profile=True):
    org = str(uuid4())
    await c.sql("""INSERT INTO organizations(id,display_name,organization_type,entry_source,status)
        VALUES(CAST(:id AS uuid),:name,'manufacturer','IMPORTED','claim_pending')""", id=org,name=name)
    if profile:
        await c.sql("""INSERT INTO organization_profiles(organization_id,country_name,company_category,
            production_capacity_label) VALUES(CAST(:id AS uuid),'India','Automotive & Machinery','500 parts/month')""",id=org)
    await c.sql("""INSERT INTO facilities(organization_id,name,is_headquarters,city,state_province,country_name)
        VALUES(CAST(:id AS uuid),'HQ',true,:city,'Tamil Nadu','India')""",id=org,city=city)
    return org


async def search(c, q, **headers):
    r = await c.get('/manufacturer/companies/search', params={'q': q}, **headers)
    assert r.status_code == 200, r.text
    return r.json()['items']


async def test_sql_seeded_search_and_selection(client):
    """The details form's live company search (GET /manufacturer/companies/search, at least two
    letters) and the read-only details of the chosen record."""
    assert (await client.get('/manufacturer/bootstrap')).status_code == 200
    t = uuid4().hex[:5]
    a = await seed(client, f'Alpha{t} Castings')
    b = await seed(client, f'Alpha{t} AKSAA CNC')
    partial = await seed(client, f'Precision Alpha{t} Works', profile=False)
    ids = [x['id'] for x in await search(client, f'alpha{t}')]
    assert a in ids and b in ids and partial in ids
    assert ids.index(partial) > ids.index(a) and ids.index(partial) > ids.index(b)   # starts-with first
    for q in (f' alpha{t} CASTINGS ', f'Alpha{t} Castings', f'{t} castings'):
        assert any(x['id'] == a for x in await search(client, q))
    detail = await client.get('/manufacturer/companies/' + b)
    assert detail.status_code == 200, detail.text
    assert detail.json()['id'] == b and detail.json()['capacity'] == '500 parts/month'
    before = (await client.sql('SELECT count(*) FROM memberships'))[0][0]
    await client.get('/manufacturer/companies/' + a)
    assert (await client.sql('SELECT count(*) FROM memberships'))[0][0] == before   # viewing grants nothing
    late = await seed(client, f'Alpha{t} Newly Seeded')
    assert late in [x['id'] for x in await search(client, f'alpha{t}')]               # live, no cache
    assert await search(client, 'no-match-xyz') == []
    assert await search(client, f'{t[0]} ') == []                                       # under two letters
    one = await client.get('/manufacturer/companies/search', params={'q': 'a'})
    assert one.status_code == 422                                                       # one letter: refused
    unauth = await client.get('/manufacturer/companies/search', params={'q': 'Alpha'},
                              headers={'Authorization': ''})
    assert unauth.status_code == 401


async def test_same_names_owned_records_literal_wildcards(client):
    await client.get('/manufacturer/bootstrap')
    t = uuid4().hex[:5]
    first = await seed(client, f'Twin{t} Precision', 'Chennai')
    second = await seed(client, f'Twin{t} Precision', 'Erode')
    rows = await search(client, f'Twin{t} Precision')
    assert {r['id'] for r in rows} == {first, second}
    assert {r['city'] for r in rows} == {'Chennai', 'Erode'}                 # told apart by location
    assert (await client.get('/manufacturer/companies/' + second)).json()['city'] == 'Erode'
    await client.sql("""INSERT INTO memberships(user_id,organization_id,membership_role)
      SELECT id,CAST(:id AS uuid),'owner' FROM users WHERE clerk_user_id=:sub""", id=first, sub=client.user)
    rows = {r['id']: r for r in await search(client, f'Twin{t} Precision')}
    assert rows[first]['ownedByYou'] and rows[first]['claimed'] and not rows[second]['claimed']
    assert (await client.get('/manufacturer/companies/' + first)).json()['access'] == 'owner'
    wildcard = await seed(client, f'A_100% Works {t}')
    lookalike = await seed(client, f'AB1000 Works {t}')                       # would match if _ / % were wildcards
    found = [r['id'] for r in await search(client, f'A_100% Works {t}')]
    assert found == [wildcard] and lookalike not in found


async def test_selection_cannot_create_duplicate_or_grant_ownership(client):
    await client.get('/manufacturer/bootstrap')
    selected=await seed(client,'Selected Company')
    orgs=(await client.sql('SELECT count(*) FROM organizations'))[0][0]
    body={'firstName':'Jordan','lastName':'Lee','contact':'jordan@example.com','dob':'1992-06-20',
      'companyName':'Selected Company','companyType':'Automotive & Machinery','country':'India',
      'phone':'9876543210','selectedCompanyId':selected}
    r=await client.post('/manufacturer/account',json=body)
    assert r.status_code==409,r.text
    assert (await client.sql('SELECT count(*) FROM organizations'))[0][0]==orgs
    assert (await client.sql('SELECT count(*) FROM memberships WHERE organization_id=CAST(:id AS uuid)',id=selected))[0][0]==0
    # Ordinary account creation remains supported; no selection means the original workflow.
    body.pop('selectedCompanyId');body['companyName']='Jordan New Manufacturing'
    assert (await client.post('/manufacturer/account',json=body)).status_code==201
    assert (await client.get('/manufacturer/bootstrap')).json()['state']['account']['companyName']=='Jordan New Manufacturing'


async def test_attached_import_package_sample(client):
    import json
    from pathlib import Path
    await client.get('/manufacturer/bootstrap')
    samples=json.loads((Path(__file__).parent/'fixtures/company_search_import_sample.json').read_text())
    assert samples
    for sample in samples:
        org=await seed(client,sample['company_name'],sample['city'])
        full=await search(client,sample['company_name'].swapcase())   # any case finds it
        assert any(r['id']==org and r['city']==sample['city'] for r in full)
        detail=(await client.get('/manufacturer/companies/'+org)).json()
        assert (detail['id'],detail['companyName'],detail['city'])==(org,sample['company_name'],sample['city'])
