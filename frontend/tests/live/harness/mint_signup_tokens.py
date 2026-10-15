"""Mint an RSA key, JWKS and session JWTs for the live sign-up test; write the fake Clerk users."""
import json, sys, time, uuid
import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt.algorithms import RSAAlgorithm
out = sys.argv[1]
key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
jwk = json.loads(RSAAlgorithm.to_jwk(key.public_key())); jwk.update(kid="live-kid", use="sig", alg="RS256")
json.dump({"keys": [jwk]}, open(f"{out}/jwks.json", "w"))
run = uuid.uuid4().hex[:6]
users, tokens = {}, {}
now = int(time.time())
for name, verified, legal in [("manual", True, True), ("google", True, True), ("unverified", False, True),
                              ("unregistered", True, True), ("retry", True, True)]:
    sub = f"user_live_{name}_{run}"
    users[sub] = {"id": sub, "primary_email_address_id": "e1", "first_name": "Live", "last_name": name.title(),
                  "email_addresses": [{"id": "e1", "email_address": f"{sub}@example.com",
                                       "verification": {"status": "verified" if verified else "unverified"}}],
                  "legal_accepted_at": now * 1000 if legal else None, "password_enabled": True,
                  "created_at": now * 1000}
    tok = jwt.encode({"sub": sub, "iss": "http://127.0.0.1:8765", "iat": now, "nbf": now, "exp": now + 3600,
                      "azp": "http://localhost:3000", "sid": f"sess_{sub}"}, key, algorithm="RS256",
                     headers={"kid": "live-kid"})
    tokens[name] = {"sub": sub, "token": tok}
json.dump(users, open(f"{out}/clerk_users.json", "w"))
json.dump(tokens, open(f"{out}/tokens.json", "w"))
print("minted", run)
