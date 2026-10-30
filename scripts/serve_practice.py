"""Serve the local practice screen over localhost HTTP and phone-friendly HTTPS."""
import argparse
from datetime import datetime,timedelta,timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
import ipaddress
from pathlib import Path
import socket
import ssl
import threading

ROOT=Path(__file__).resolve().parents[1]

def local_addresses():
    ips={'127.0.0.1'}
    for entry in socket.getaddrinfo(socket.gethostname(),None,socket.AF_INET):
        value=entry[4][0]
        if ipaddress.ip_address(value).is_private:ips.add(value)
    return sorted(ips)

def certificate(ips):
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes,serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID
    folder=ROOT/'models/local-practice-tls';folder.mkdir(parents=True,exist_ok=True)
    cert_path,key_path=folder/'certificate.pem',folder/'private-key.pem'
    reuse=False
    if cert_path.exists() and key_path.exists():
        existing=x509.load_pem_x509_certificate(cert_path.read_bytes())
        sans=existing.extensions.get_extension_for_class(x509.SubjectAlternativeName).value.get_values_for_type(x509.IPAddress)
        reuse=all(ipaddress.ip_address(ip) in sans for ip in ips) and existing.not_valid_after_utc>datetime.now(timezone.utc)+timedelta(days=1)
    if not reuse:
        key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
        name=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'Local movement practice')])
        now=datetime.now(timezone.utc)
        cert=(x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key()).serial_number(x509.random_serial_number())
              .not_valid_before(now-timedelta(minutes=5)).not_valid_after(now+timedelta(days=30))
              .add_extension(x509.SubjectAlternativeName([x509.DNSName('localhost')]+[x509.IPAddress(ipaddress.ip_address(ip)) for ip in ips]),critical=False)
              .sign(key,hashes.SHA256()))
        cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
        key_path.write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
    return cert_path,key_path

class Handler(SimpleHTTPRequestHandler):
    extensions_map={**SimpleHTTPRequestHandler.extensions_map,'.mjs':'text/javascript','.js':'text/javascript','.wasm':'application/wasm','.glb':'model/gltf-binary'}
    def end_headers(self):
        self.send_header('Cache-Control','no-cache')
        self.send_header('Permissions-Policy','camera=(self), microphone=(self)')
        super().end_headers()
    def log_message(self,format,*args):
        if len(args)>1 and str(args[1])!='200':super().log_message(format,*args)

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--port',type=int,default=8000);p.add_argument('--https-port',type=int,default=8443);args=p.parse_args()
    handler=partial(Handler,directory=str(ROOT/'web/dist'))
    http=ThreadingHTTPServer(('127.0.0.1',args.port),handler)
    ips=local_addresses();cert,key=certificate(ips)
    https=ThreadingHTTPServer(('0.0.0.0',args.https_port),handler)
    context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);context.load_cert_chain(cert,key);https.socket=context.wrap_socket(https.socket,server_side=True)
    threading.Thread(target=http.serve_forever,daemon=True).start()
    print(f'Desktop: http://localhost:{args.port}',flush=True)
    for ip in ips:
        if ip!='127.0.0.1':print(f'Phone on the same Wi-Fi: https://{ip}:{args.https_port}',flush=True)
    print('Local HTTPS uses a self-signed certificate. Accept its browser notice for this local address, then allow camera access.',flush=True)
    print('This server serves only web/dist. Camera frames stay in the browser.',flush=True)
    try:https.serve_forever()
    except KeyboardInterrupt:pass
    finally:http.shutdown();https.server_close();http.server_close()

if __name__=='__main__':main()
