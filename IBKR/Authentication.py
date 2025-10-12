"""
Python script when demonstrates the current OAuth 2.0 Authentication workflow:
   An OAuth 2.0 Access Token is requested via     - POST https://api.ibkr.com/oauth2/api/v1/token (scope = sso-sessions.write)
   An OAuth 2.0 SSO Bearer Token is requested via - POST https://api.ibkr.com/gw/api/v1/sso-sessions  -> A 200 (Ok) response means end user may now access CP API’s non-iserver endpoints

ip address | clientId | clientKeyId | credential | path_to_PrivateKey | scope | should be entered in lines 26-31

Main function begins in line 219 - 
   getAccessToken() & getBearerToken() are used for CP API Authentication
   ssodh_init() validate_sso() & tickle() are used for CP API requests [contigent upon 200 (OK) responses from  POST api/v1/token & POST gw/api/v1/sso-sessions]
"""

import base64
import json
import math
import pprint
import requests
import time
from Crypto.PublicKey import RSA
from Crypto.Signature import PKCS1_v1_5
from Crypto.Hash import SHA256

#====================================================================================================================
#-------------------------------------------INPUTS-------------------------------------------------------------------
#====================================================================================================================
import os

ip = os.getenv('ip', '')
clientId = os.getenv('clientId', '')
clientKeyId = os.getenv('clientKeyId', 'main')
credential = os.getenv('credential', '')
path_to_PrivateKey = os.getenv('path_to_PrivateKey', '')
scope = os.getenv('scope', 'sso-sessions.write')

if not clientId or not clientKeyId or not credential or not path_to_PrivateKey:
    raise RuntimeError(
        "Missing required env. Set: clientId, clientKeyId, credential, path_to_PrivateKey"
    )
 

#====================================================================================================================
#------------------------------------------BASE URLS-----------------------------------------------------------------
#====================================================================================================================
host = 'api.ibkr.com'
oauth2Url = 'https://api.ibkr.com/oauth2'
gatewayUrl = 'https://api.ibkr.com/gw'
clientPortalUrl = 'https://api.ibkr.com'
audience = '/token'

file = open(path_to_PrivateKey, "r")                                           #Read private RSA Key then close it, once done 
clientPrivateKey = file.read()   
jwtPrivateKey = RSA.import_key(clientPrivateKey.encode()) 
file.close()


#====================================================================================================================
#-------------------------------------ADD CLEAN FORMATTING-----------------------------------------------------------
#====================================================================================================================
RESP_HEADERS_TO_PRINT = ["Cookie", "Cache-Control", "Content-Type", "Host"]

def formatted_HTTPrequest(resp: requests.Response) -> str:
    """Print request and response legibly."""
    req = resp.request
    rqh = '\n'.join(f"{k}: {v}" for k, v in req.headers.items())
    rqh = rqh.replace(', ', ',\n    ')
    rqb = req.body if req.body else ""
    
    try:
        rsb = f"\n{pprint.pformat(resp.json())}\n" if resp.text else ""
    except json.JSONDecodeError:
        rsb = resp.text
    rsh = '\n'.join([f"{k}: {v}" for k, v in resp.headers.items() if k in RESP_HEADERS_TO_PRINT])
    
    return_str = '\n'.join([
        '-----------REQUEST-----------',
        f"{req.method} {req.url}",
        "",
        rqh,
        f"{rqb}",
        "",
        '-----------RESPONSE-----------',
        f"{resp.status_code} {resp.reason}",
        rsh,
        f"{rsb}\n",
    ])
    print("")
    return return_str


#====================================================================================================================
#----------------------------------------OAuth 2.0 FUNCTIONS---------------------------------------------------------
#====================================================================================================================
def base64_encode(val):
    return base64.b64encode(val).decode().replace('+', '-').replace('/', '_').rstrip('=')

def make_jws(header, claims):
    json_header = json.dumps(header, separators=(',', ':')).encode()
    encoded_header = base64_encode(json_header)
    json_claims = json.dumps(claims, separators=(',', ':')).encode()
    encoded_claims = base64_encode(json_claims)

    payload = f"{encoded_header}.{encoded_claims}"
    
    md = SHA256.new(payload.encode())
    signer = PKCS1_v1_5.new(jwtPrivateKey)
    signature = signer.sign(md)
    encoded_signature = base64_encode(signature)
    
    return payload + "." + encoded_signature

def compute_client_assertion(url):
    now = math.floor(time.time())
    header = {
        'alg': 'RS256',
        'typ': 'JWT',
        'kid': f'{clientKeyId}'
    }

    if url == f'{oauth2Url}/api/v1/token':
        claims = {
            'iss': f'{clientId}',
            'sub': f'{clientId}',
            'aud': f'{audience}',
            'exp': now + 20,
            'iat': now - 10
        }

    elif url == f'{gatewayUrl}/api/v1/sso-sessions':
        claims = {
            'ip': ip,                    
            #'service': "CP.API",
            'credential': f'{credential}',
            'iss': f'{clientId}',
            'exp': now + 86400,
            'iat': now
        }

    assertion = make_jws(header, claims)
    return assertion


#====================================================================================================================
#---------------------------------1. REQUEST OAuth 2.0 ACCESS TOKEN--------------------------------------------------
#====================================================================================================================
def getAccessToken():
    url=f'{oauth2Url}/api/v1/token'

    headers = {
        "Content-Type": "application/x-www-form-urlencoded"
    }

    form_data = {
            'client_assertion_type': 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
            'client_assertion': compute_client_assertion(url),
            'grant_type': 'client_credentials',
            'scope': scope
    }

    token_request = requests.post(url=url, headers=headers, data=form_data)
    print(formatted_HTTPrequest(token_request))
    
    return token_request.json()["access_token"]


#====================================================================================================================
#--------------------------------2. REQUEST SSO BEARER TOKEN---------------------------------------------------------
#====================================================================================================================
def getBearerToken(access_token: str):
    url=f'{gatewayUrl}/api/v1/sso-sessions'

    headers = {
        "Authorization": "Bearer " + access_token,
        "Content-Type": "application/jwt"
    }

    signed_request = compute_client_assertion(url)
    bearer_request = requests.post(url=url, headers=headers, data=signed_request)
    print(formatted_HTTPrequest(bearer_request))
    
    if bearer_request.status_code == 200:
        return bearer_request.json()["access_token"]
    return


#====================================================================================================================
#------------------------------------3. CP API REQUESTS--------------------------------------------------------------
#====================================================================================================================
def ssodh_init(bearer_token):
    headers = {"Authorization": "Bearer "+bearer_token}
    headers["User-Agent"] = "python/3.11"
    
    url = f'{clientPortalUrl}/v1/api/iserver/auth/ssodh/init'                  #Initialize brokerage sesison (required in order to access the IServer endpoints)
    json_data = {"publish":True, "compete":True}
    init_request = requests.post(url=url, headers=headers, json=json_data)     #Prepare and send request to /ssodh/init endpoint, print request and response.
    print(formatted_HTTPrequest(init_request))

def validate_sso(bearer_token):
    headers = {"Authorization": "Bearer "+bearer_token}
    headers["User-Agent"] = "python/3.11"

    url = f'{clientPortalUrl}/v1/api/sso/validate'                             #Validates the current session for the user
    vsso_request = requests.get(url=url, headers=headers)                      #Prepare and send request to /sso/validate endpoint, print request and response.
    print(formatted_HTTPrequest(vsso_request))

def tickle(bearer_token):
    headers = {"Authorization": "Bearer " + bearer_token}
    headers["User-Agent"] = "python/3.11"
    
    url = f'{clientPortalUrl}/v1/api/tickle'                                   #Tickle endpoint, used to ping the server and/or being the process of opening a websocket connection   
    tickle_request = requests.get(url=url, headers=headers)                    #Prepare and send request to /tickle endpoint, print request and response.
    print(formatted_HTTPrequest(tickle_request))
    return tickle_request.json()['session']

def logoutSession(bearer_token):
    headers = {"Authorization": "Bearer " + bearer_token}
    headers["User-Agent"] = "python/3.11"
    
    url = f'{clientPortalUrl}/v1/api/logout'                                   
    logout_request = requests.post(url=url, headers=headers)                    
    print(formatted_HTTPrequest(logout_request))


#====================================================================================================================
#--------------------------------------MAIN FUNCTION-----------------------------------------------------------------
#====================================================================================================================
if __name__ == "__main__":
    access_token = getAccessToken()            
    bearer_token = getBearerToken(access_token)
    validate_sso(bearer_token)     
    # ssodh_init(bearer_token)
    # session_token = tickle(bearer_token)
    # logoutSession(bearer_token)
