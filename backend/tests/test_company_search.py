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


async def test_sql_seeded_search_and_selection(client):
    assert (await client.get('/manufacturer/bootstrap')).status_code == 200
    a=await seed(client,'Alpha Castings')
    b=await seed(client,'AL AKSAA CNC')
    partial=await seed(client,'Precision Alpha Works',profile=False)
    data=(await client.get('/manufacturer/claims/search',params={'q':'A'})).json()
    ids=[x['id'] for x in data['results']]
    assert a in ids and b in ids and partial in ids
    assert ids.index(partial)>ids.index(a) and ids.index(partial)>ids.index(b)
    for q in (' alpha CASTINGS ','Alpha Castings','castings'):
        results=(await client.get('/manufacturer/claims/search',params={'q':q})).json()['results']
        assert any(x['id']==a for x in results)
    detail=await client.get('/manufacturer/claims/companies/'+b)
    assert detail.status_code==200,detail.text
    assert detail.json()['id']==b and detail.json()['capacity']=='500 parts/month'
    before=(await client.sql('SELECT count(*) FROM memberships'))[0][0]
    await client.get('/manufacturer/claims/companies/'+a)
    assert (await client.sql('SELECT count(*) FROM memberships'))[0][0]==before
    late=await seed(client,'Alpha Newly Seeded')
    assert late in [x['id'] for x in (await client.get('/manufacturer/claims/search',params={'q':'A'})).json()['results']]
    assert (await client.get('/manufacturer/claims/search',params={'q':'no-match-xyz'})).json()['results']==[]
    assert (await client.get('/manufacturer/claims/search',params={'q':' '})).json()['results']==[]
    limited=(await client.get('/manufacturer/claims/search',params={'q':'A','limit':1})).json()
    assert len(limited['results'])==1 and limited['hasMore']
    assert (await client.get('/manufacturer/claims/search',params={'q':'A'},headers={'Authorization':''})).status_code==401


async def test_same_names_owned_records_literal_wildcards(client):
    await client.get('/manufacturer/bootstrap')
    first=await seed(client,'Twin Precision','Chennai')
    second=await seed(client,'Twin Precision','Erode')
    rows=(await client.get('/manufacturer/claims/search',params={'q':'Twin Precision'})).json()['results']
    assert {r['id'] for r in rows}>={first,second}
    assert (await client.get('/manufacturer/claims/companies/'+second)).json()['city']=='Erode'
    await client.sql("""INSERT INTO memberships(user_id,organization_id,membership_role)
      SELECT id,CAST(:id AS uuid),'owner' FROM users WHERE clerk_user_id=:sub""",id=first,sub=client.user)
    rows=(await client.get('/manufacturer/claims/search',params={'q':'Twin Precision'})).json()['results']
    assert first not in [r['id'] for r in rows]
    assert (await client.get('/manufacturer/claims/companies/'+first)).status_code==404
    wildcard=await seed(client,'A_100% Works')
    rows=(await client.get('/manufacturer/claims/search',params={'q':'A_100%'})).json()['results']
    assert [r['id'] for r in rows]==[wildcard]


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
        results=(await client.get('/manufacturer/claims/search',params={'q':'A','limit':50})).json()['results']
        assert org in [r['id'] for r in results]
        full=(await client.get('/manufacturer/claims/search',params={'q':sample['company_name'].swapcase()})).json()['results']
        assert any(r['id']==org for r in full)
        detail=(await client.get('/manufacturer/claims/companies/'+org)).json()
        assert (detail['id'],detail['name'],detail['city'])==(org,sample['company_name'],sample['city'])
