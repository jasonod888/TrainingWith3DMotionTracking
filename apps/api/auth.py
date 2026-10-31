"""Database-backed, revocable cookie sessions and single-use email tokens."""
import hashlib
import hmac
import re
import secrets
import smtplib
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from uuid import uuid4
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .database import Account, AccountToken, AuthThrottle, LoginSession
from .database import AdminControl
from .admin_security import ADMIN_ROLES, account_view, audit, matching_counter, new_mfa_secret, lock_admin_control

COOKIE = 'form_session'


def now():
    return datetime.now(timezone.utc)


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    value = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=131072, r=8, p=1,
                           maxmem=256 * 1024 * 1024, dklen=32)
    return f'scrypt:131072:8:1${salt}${value.hex()}'


def password_matches(password, stored):
    try:
        scheme, salt, _ = stored.split('$')
        return scheme == 'scrypt:131072:8:1' and hmac.compare_digest(password_hash(password, salt), stored)
    except (ValueError, TypeError):
        return False


def csrf_token(raw):
    return hmac.new(raw.encode(), b'form-csrf-v1', hashlib.sha256).hexdigest()


class Credentials(BaseModel):
    email: str = Field(max_length=254, pattern=r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
    password: str = Field(min_length=12, max_length=128)

    @field_validator('email')
    @classmethod
    def normalise(cls, value):
        return value.lower()


class EmailInput(BaseModel):
    email: str = Field(max_length=254, pattern=r'^[^\s@]+@[^\s@]+\.[^\s@]+$')

    @field_validator('email')
    @classmethod
    def normalise(cls, value):
        return value.lower()


class TokenInput(BaseModel):
    token: str = Field(min_length=32, max_length=128)


class ResetInput(TokenInput):
    password: str = Field(min_length=12, max_length=128)


class MfaSetup(BaseModel):
    password: str = Field(min_length=12, max_length=128)


class MfaCode(BaseModel):
    code: str = Field(pattern=r'^[0-9]{6}$', max_length=6)


def send_account_mail(settings, email, purpose, token):
    # Links carry secrets in the fragment, avoiding HTTP logs and Referer headers.
    link = f'{settings.public_url.rstrip("/")}/#{purpose}={token}'
    message = EmailMessage()
    message['From'] = settings.mail_from
    message['To'] = email
    message['Subject'] = {'verify':'Verify your Form account','reset':'Reset your Form password','invite':'A move is waiting for you on Form','group':'You are invited to a group on Form'}[purpose]
    lifetime = '7 days' if purpose in ('invite', 'group') else '30 minutes'
    message.set_content(f'{message["Subject"]}\n\n{link}\n\nThis link expires in {lifetime}. If you did not expect it, ignore this email.')
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
            if settings.smtp_starttls:
                import ssl
                smtp.starttls(context=ssl.create_default_context())
            if settings.smtp_username:
                smtp.login(settings.smtp_username, settings.smtp_password or '')
            smtp.send_message(message)
    except (OSError, smtplib.SMTPException) as exc:
        raise HTTPException(503, 'Email is unavailable. Please try again shortly.') from exc


def install_auth(app, engine, settings):
    router = APIRouter(prefix='/api/auth')
    # A real expensive hash is also checked for unknown accounts.
    dummy_hash = password_hash(secrets.token_urlsafe(32))
    public_origin = settings.public_url.rstrip('/')
    allowed_origins = {public_origin}
    if settings.environment == 'development':
        allowed_origins.update(f'http://{host}:{port}' for host in ('localhost', '127.0.0.1') for port in (5173, 8001, 8010))

    @app.middleware('http')
    async def protect_requests(request, call_next):
        from fastapi.responses import JSONResponse
        worker_route = request.url.path.startswith('/api/worker/')
        binary_upload = request.method == 'PUT' and bool(re.fullmatch(r'/api/conversions/[a-f0-9]{32}/parts/\d+', request.url.path))
        if request.url.path.startswith('/api/') and not worker_route and request.method not in ('GET', 'HEAD', 'OPTIONS'):
            if request.headers.get('origin') not in allowed_origins or request.headers.get('x-form-request') != '1':
                return JSONResponse({'detail': 'Please reload Form and try again.'}, status_code=403)
            if request.headers.get('content-type', '').split(';')[0] != ('application/octet-stream' if binary_upload else 'application/json'):
                return JSONResponse({'detail': 'Expected JSON.'}, status_code=415)
        response = await call_next(request)
        if request.url.path.startswith('/api/'):
            response.headers['Cache-Control'] = 'no-store'
            response.headers['Referrer-Policy'] = 'no-referrer'
            response.headers['X-Content-Type-Options'] = 'nosniff'
        return response

    def db():
        with Session(engine) as session:
            yield session

    def identity(request: Request, session: Session = Depends(db)):
        raw = request.cookies.get(COOKIE, '')
        login = session.get(LoginSession, digest(raw)) if raw else None
        if not login or (login.expires_at if login.expires_at.tzinfo else login.expires_at.replace(tzinfo=timezone.utc)) <= now():
            raise HTTPException(401, 'Sign in to continue.')
        account = session.get(Account, login.account_id)
        if not account or not account.verified or account.status != 'active':
            raise HTTPException(401, 'Sign in to continue.')
        if request.method not in ('GET', 'HEAD') and not hmac.compare_digest(request.headers.get('x-csrf-token', ''), csrf_token(raw)):
            raise HTTPException(403, 'Please reload Form and try again.')
        return account

    def optional_identity(request: Request, session: Session = Depends(db)):
        """Identity for public routes: signed-in readers are recognised, anonymous readers are allowed."""
        raw = request.cookies.get(COOKIE, '')
        login = session.get(LoginSession, digest(raw)) if raw else None
        if not login or (login.expires_at if login.expires_at.tzinfo else login.expires_at.replace(tzinfo=timezone.utc)) <= now():
            return None
        account = session.get(Account, login.account_id)
        return account if account and account.verified and account.status == 'active' else None

    def throttle(request, action, email, limit=10):
        # Shared across processes and restarts; atomic upsert prevents concurrent bypass.
        from sqlalchemy.dialects.postgresql import insert as pg_insert
        from sqlalchemy.dialects.sqlite import insert as sqlite_insert
        stamp = now()
        with engine.begin() as connection:
            connection.execute(delete(AuthThrottle).where(AuthThrottle.expires_at < stamp))
            for scope, value, maximum in [('email', email, limit), ('ip', request.client.host if request.client else 'unknown', 60)]:
                key = digest(f'{action}:{scope}:{value}')
                insert = pg_insert if engine.dialect.name == 'postgresql' else sqlite_insert
                query = insert(AuthThrottle).values(key=key, hits=1, expires_at=stamp + timedelta(minutes=15))
                query = query.on_conflict_do_update(index_elements=['key'], set_={'hits': AuthThrottle.hits + 1}).returning(AuthThrottle.hits)
                hits = connection.execute(query).scalar_one()
                if hits > maximum:
                    # Commit the counter even when rejecting the request.
                    rejected = True
                    break
            else:
                rejected = False
        if rejected:
            raise HTTPException(429, 'Too many attempts. Try again in 15 minutes.', headers={'Retry-After': '900'})

    def issue_token(session, account, purpose):
        raw = secrets.token_urlsafe(32)
        session.execute(update(AccountToken).where(AccountToken.account_id == account.id, AccountToken.purpose == purpose).values(used=True))
        session.add(AccountToken(token_hash=digest(raw), account_id=account.id, purpose=purpose,
                                 expires_at=now()+timedelta(minutes=30), used=False))
        session.commit()
        send_account_mail(settings, account.email, purpose, raw)

    generic = {'message': 'Check your email for the next step.'}

    @router.post('/register', status_code=202)
    def register(body: Credentials, request: Request, session: Session = Depends(db)):
        throttle(request, 'register', body.email, 5)
        control = session.get(AdminControl, 'platform')
        if control and not control.registration_enabled:
            raise HTTPException(403, 'New account registration is temporarily closed.')
        hashed = password_hash(body.password)
        account = session.scalar(select(Account).where(Account.email == body.email))
        if not account:
            account = Account(id=uuid4().hex, email=body.email, password_hash=hashed, verified=False)
            session.add(account)
            try:
                session.commit()
            except IntegrityError:
                session.rollback()
                return generic
        if not account.verified:
            issue_token(session, account, 'verify')
        return generic

    @router.post('/resend', status_code=202)
    def resend(body: EmailInput, request: Request, session: Session = Depends(db)):
        throttle(request, 'resend', body.email, 5)
        account = session.scalar(select(Account).where(Account.email == body.email))
        if account and not account.verified:
            issue_token(session, account, 'verify')
        return generic

    def consume(session, raw, purpose):
        token = session.execute(update(AccountToken).where(AccountToken.token_hash == digest(raw),
            AccountToken.purpose == purpose, AccountToken.used.is_(False), AccountToken.expires_at > now())
            .values(used=True).returning(AccountToken.account_id)).scalar_one_or_none()
        if not token:
            raise HTTPException(400, 'This link has expired or has already been used.')
        return session.get(Account, token)

    @router.post('/verify')
    def verify(body: TokenInput, request: Request, session: Session = Depends(db)):
        throttle(request, 'token', 'verify', 60)
        account = consume(session, body.token, 'verify')
        account.verified = True
        session.commit()
        return {'message': 'Email verified. You can sign in.'}

    @router.post('/login')
    def login(body: Credentials, request: Request, response: Response, session: Session = Depends(db)):
        throttle(request, 'login', body.email)
        account = session.scalar(select(Account).where(Account.email == body.email))
        valid = password_matches(body.password, account.password_hash if account else dummy_hash)
        if not valid or not account or not account.verified or account.status != 'active':
            raise HTTPException(401, 'Check your email and password, and verify your email before signing in.')
        old = request.cookies.get(COOKIE)
        if old:
            session.execute(delete(LoginSession).where(LoginSession.token_hash == digest(old)))
        session.execute(delete(LoginSession).where(LoginSession.expires_at < now()))
        raw = secrets.token_urlsafe(32)
        account.last_login_at = now()
        session.add(LoginSession(token_hash=digest(raw), account_id=account.id, expires_at=now()+timedelta(days=settings.session_days)))
        session.commit()
        response.set_cookie(COOKIE, raw, httponly=True, secure=urlparse(settings.public_url).scheme == 'https' or settings.environment != 'development',
                            samesite='lax', max_age=settings.session_days*86400, path='/')
        return {'account': account_view(account), 'csrf': csrf_token(raw)}

    @router.get('/session')
    def current(request: Request, account=Depends(identity)):
        return {'account': account_view(account), 'csrf': csrf_token(request.cookies[COOKIE])}

    @router.get('/admin-mfa')
    def mfa_status(request: Request, account=Depends(identity), session: Session = Depends(db)):
        if account.platform_role not in ADMIN_ROLES:
            raise HTTPException(403, 'Administrative access required.')
        login = session.get(LoginSession, digest(request.cookies[COOKIE]))
        until = login.admin_verified_until
        return {'enrolled': bool(account.mfa_secret), 'verified': bool(until and
            (until if until.tzinfo else until.replace(tzinfo=timezone.utc)) > now())}

    @router.post('/admin-mfa/setup')
    def mfa_setup(body: MfaSetup, request: Request, account=Depends(identity), session: Session = Depends(db)):
        throttle(request, 'mfa-setup', account.id, 5)
        lock_admin_control(session)
        session.refresh(account)
        if account.platform_role not in ADMIN_ROLES or account.status != 'active':
            raise HTTPException(403, 'Administrative access required.')
        login = session.get(LoginSession, digest(request.cookies[COOKIE]), populate_existing=True)
        if not login:
            raise HTTPException(401, 'Sign in again.')
        if account.mfa_secret:
            raise HTTPException(409, 'An authenticator is already enrolled.')
        if not password_matches(body.password, account.password_hash):
            raise HTTPException(401, 'Check your password.')
        secret = new_mfa_secret()
        login.pending_mfa_secret = secret
        session.commit()
        from urllib.parse import quote
        uri = f'otpauth://totp/{quote("Form:" + account.email, safe="")}?secret={secret}&issuer=Form&algorithm=SHA1&digits=6&period=30'
        return {'secret': secret, 'uri': uri}

    @router.post('/admin-mfa/verify')
    def mfa_verify(body: MfaCode, request: Request, account=Depends(identity), session: Session = Depends(db)):
        throttle(request, 'mfa-verify', account.id, 10)
        lock_admin_control(session)
        session.refresh(account)
        if account.platform_role not in ADMIN_ROLES or account.status != 'active':
            raise HTTPException(403, 'Administrative access required.')
        login = session.get(LoginSession, digest(request.cookies[COOKIE]), populate_existing=True)
        if not login:
            raise HTTPException(401, 'Sign in again.')
        secret = account.mfa_secret or login.pending_mfa_secret
        counter = matching_counter(secret, body.code, account.mfa_counter) if secret else None
        if counter is None:
            raise HTTPException(400, 'Invalid or already used code. Try the next code from your authenticator.')
        enrolling = not account.mfa_secret
        account.mfa_secret = secret
        account.mfa_counter = counter
        login.pending_mfa_secret = None
        login.admin_verified_until = now() + timedelta(minutes=30)
        audit(session, account.id, 'mfa.enroll' if enrolling else 'mfa.verify', account.id,
              'Authenticator verified for administrative access.')
        session.commit()
        return {'verified': True}

    @router.post('/logout')
    def logout(request: Request, response: Response, account=Depends(identity), session: Session = Depends(db)):
        session.execute(delete(LoginSession).where(LoginSession.token_hash == digest(request.cookies[COOKIE])))
        session.commit()
        response.delete_cookie(COOKIE, path='/')
        return {'message': 'Signed out.'}

    @router.post('/forgot', status_code=202)
    def forgot(body: EmailInput, request: Request, session: Session = Depends(db)):
        throttle(request, 'forgot', body.email, 5)
        account = session.scalar(select(Account).where(Account.email == body.email))
        if account and account.verified:
            issue_token(session, account, 'reset')
        return generic

    @router.post('/reset')
    def reset(body: ResetInput, request: Request, session: Session = Depends(db)):
        throttle(request, 'token', 'reset', 60)
        hashed = password_hash(body.password)
        account = consume(session, body.token, 'reset')
        account.password_hash = hashed
        session.execute(delete(LoginSession).where(LoginSession.account_id == account.id))
        session.execute(update(AccountToken).where(AccountToken.account_id == account.id).values(used=True))
        session.commit()
        return {'message': 'Password updated. Sign in again.'}

    app.include_router(router)
    return identity, db, optional_identity
