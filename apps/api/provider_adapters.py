"""Thin asynchronous transports for custom, contract-compatible GPU pipelines.

These classes never select models, retry submissions, or interpret arbitrary rig formats.
Only an operator-verified full-pipeline deployment may be enabled.
"""
import re
from dataclasses import dataclass
from urllib.parse import urlparse
import httpx


def request_id(value):
    if not isinstance(value,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,200}',value):
        raise ValueError('Invalid provider request identifier.')
    return value


@dataclass
class ProviderResult:
    state: str  # pending, succeeded, failed
    output: dict | None = None


class ReplicateAdapter:
    def __init__(self,token,client=None):
        self.client=client or httpx.Client(timeout=60,trust_env=False,follow_redirects=False)
        self.headers={'Authorization':'Bearer '+token}

    def submit(self,target,payload):
        response=self.client.post(f'https://api.replicate.com/v1/deployments/{target}/predictions',headers=self.headers,json={'input':payload})
        response.raise_for_status()
        return request_id(response.json()['id'])

    def poll(self,target,identity):
        response=self.client.get('https://api.replicate.com/v1/predictions/'+request_id(identity),headers=self.headers)
        response.raise_for_status();body=response.json()
        if body['status']=='succeeded':return ProviderResult('succeeded',body['output'])
        return ProviderResult('failed' if body['status'] in ('failed','canceled') else 'pending')

    def cancel(self,target,identity):
        response=self.client.post('https://api.replicate.com/v1/predictions/'+request_id(identity)+'/cancel',headers=self.headers)
        response.raise_for_status()


class FalAdapter:
    def __init__(self,token,client=None):
        self.client=client or httpx.Client(timeout=60,trust_env=False,follow_redirects=False)
        self.headers={'Authorization':'Key '+token}

    def submit(self,target,payload):
        response=self.client.post('https://queue.fal.run/'+target,headers=self.headers,json=payload)
        response.raise_for_status()
        return request_id(response.json()['request_id'])

    def poll(self,target,identity):
        url=f'https://queue.fal.run/{target}/requests/{request_id(identity)}'
        response=self.client.get(url+'/status',headers=self.headers);response.raise_for_status()
        if response.json()['status']!='COMPLETED':return ProviderResult('pending')
        response=self.client.get(url,headers=self.headers)
        if 400<=response.status_code<500:return ProviderResult('failed')
        response.raise_for_status();return ProviderResult('succeeded',response.json())

    def cancel(self,target,identity):
        response=self.client.put(f'https://queue.fal.run/{target}/requests/{request_id(identity)}/cancel',headers=self.headers)
        response.raise_for_status()


def adapter(provider,token,client=None):
    return {'replicate':ReplicateAdapter,'fal':FalAdapter}[provider](token,client)


def validate_output_url(value,provider):
    # Never follow arbitrary provider output URLs into internal services or send API keys there.
    parsed=urlparse(value)
    domains={'replicate':('replicate.delivery',),'fal':('fal.media',)}[provider]
    if parsed.scheme!='https' or parsed.username or parsed.password or parsed.port not in (None,443) or not parsed.hostname or not any(parsed.hostname==d or parsed.hostname.endswith('.'+d) for d in domains):
        raise ValueError('Output must use the approved provider delivery domain.')
    return value
