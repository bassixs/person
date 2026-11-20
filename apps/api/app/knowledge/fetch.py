"""Безопасное получение материалов по ссылке (ТЗ §3: проверка SSRF, запрет внутренних адресов).

Защита:
- только http/https и порты 80/443, без логина в URL;
- адрес проверяется В МОМЕНТ СОЕДИНЕНИЯ (собственный сетевой backend httpcore): имя разрешается,
  и если среди адресов есть непубличный (loopback, частная сеть, link-local, метаданные облака,
  multicast, зарезервированные) — соединение не устанавливается. Это закрывает и DNS rebinding;
- переадресации — вручную, не больше 3, каждая проходит ту же проверку;
- прокси из окружения не используются; ограничены время и размер ответа.
Закрытый доступ, капчи и ограничения платформ не обходятся: ошибка — это ошибка получения.
"""

import ipaddress
import socket
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from urllib.parse import urljoin, urlsplit

import httpcore
import httpx

MAX_REDIRECTS = 3
USER_AGENT = "LichnostiBot/1.0 (internal research; respects robots and access limits)"


class FetchBlocked(Exception):
    """Адрес запрещён правилами безопасности."""


class FetchFailed(Exception):
    """Источник недоступен или ответил ошибкой — не доказательство отсутствия сведений."""


@dataclass
class FetchResult:
    url: str
    final_url: str
    status: int
    content_type: str
    body: bytes
    truncated: bool
    duration_ms: int
    redirects: list[str] = field(default_factory=list)


def _ip_allowed(ip: str) -> bool:
    a = ipaddress.ip_address(ip)
    if isinstance(a, ipaddress.IPv6Address) and a.ipv4_mapped is not None:
        a = a.ipv4_mapped
    return a.is_global and not a.is_multicast


def check_url(url: str) -> tuple[str, int]:
    """Синтаксическая проверка URL. Возвращает (host, port)."""
    try:
        parts = urlsplit(url.strip())
    except ValueError as e:
        raise FetchBlocked("Некорректная ссылка") from e
    if parts.scheme not in ("http", "https"):
        raise FetchBlocked("Разрешены только ссылки http:// и https://")
    if not parts.hostname:
        raise FetchBlocked("В ссылке нет адреса сайта")
    if parts.username or parts.password:
        raise FetchBlocked("Ссылки с логином и паролем не принимаются")
    try:
        port = parts.port or (443 if parts.scheme == "https" else 80)
    except ValueError as e:
        raise FetchBlocked("Некорректный порт") from e
    if port not in (80, 443):
        raise FetchBlocked("Разрешены только стандартные порты 80 и 443")
    host = parts.hostname
    # Литеральный IP проверяем сразу, имя — при соединении.
    try:
        ipaddress.ip_address(host)
        if not _ip_allowed(host):
            raise FetchBlocked("Внутренние и служебные адреса запрещены")
    except ValueError:
        if host == "localhost" or host.endswith((".localhost", ".local", ".internal")):
            raise FetchBlocked("Внутренние и служебные адреса запрещены") from None
    return host, port


def resolve_public(host: str, port: int) -> str:
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror as e:
        raise FetchFailed(f"Не удалось найти адрес сайта: {host}") from e
    ips = sorted({str(i[4][0]) for i in infos})
    if not ips:
        raise FetchFailed(f"Не удалось найти адрес сайта: {host}")
    if any(not _ip_allowed(ip) for ip in ips):
        raise FetchBlocked("Адрес сайта указывает во внутреннюю сеть — запрещено")
    return ips[0]


class _SafeBackend(httpcore.SyncBackend):
    def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):  # type: ignore[no-untyped-def]
        ip = resolve_public(host, port)
        return super().connect_tcp(ip, port, timeout, local_address, socket_options)


def _client(timeout: float) -> httpx.Client:
    transport = httpx.HTTPTransport(trust_env=False)
    transport._pool = (
        httpcore.ConnectionPool(  # подмена сетевого слоя: проверка адреса при соединении
            ssl_context=httpx.create_ssl_context(), network_backend=_SafeBackend()
        )
    )
    return httpx.Client(
        transport=transport,
        timeout=timeout,
        follow_redirects=False,
        trust_env=False,
        headers={"User-Agent": USER_AGENT, "Accept": "*/*"},
    )


_override: Callable[[str, int], FetchResult] | None = None


def set_fetch_override(fn: Callable[[str, int], FetchResult] | None) -> None:
    """Для тестов: подмена сетевого получения (проверка URL выполняется всё равно)."""
    global _override
    _override = fn


def fetch(url: str, max_bytes: int = 10 * 1024 * 1024, timeout: float = 15.0) -> FetchResult:
    check_url(url)
    if _override is not None:
        return _override(url, max_bytes)
    started = time.perf_counter()
    current = url.strip()
    redirects: list[str] = []
    try:
        with _client(timeout) as client:
            for _ in range(MAX_REDIRECTS + 1):
                check_url(current)
                with client.stream("GET", current) as r:
                    if r.is_redirect and "location" in r.headers:
                        current = urljoin(current, r.headers["location"])
                        redirects.append(current)
                        continue
                    if r.status_code >= 400:
                        raise FetchFailed(f"Источник ответил ошибкой {r.status_code}")
                    buf = bytearray()
                    truncated = False
                    for chunk in r.iter_bytes():
                        buf.extend(chunk)
                        if len(buf) > max_bytes:
                            truncated = True
                            del buf[max_bytes:]
                            break
                    return FetchResult(
                        url=url,
                        final_url=current,
                        status=r.status_code,
                        content_type=r.headers.get("content-type", "")
                        .split(";")[0]
                        .strip()
                        .lower(),
                        body=bytes(buf),
                        truncated=truncated,
                        duration_ms=int((time.perf_counter() - started) * 1000),
                        redirects=redirects,
                    )
            raise FetchFailed("Слишком много переадресаций")
    except (FetchBlocked, FetchFailed):
        raise
    except httpx.TimeoutException as e:
        raise FetchFailed("Источник не ответил вовремя") from e
    except httpx.HTTPError as e:
        cause = e.__cause__ or e.__context__
        if isinstance(cause, FetchBlocked):
            raise cause from None
        raise FetchFailed(f"Ошибка соединения: {type(e).__name__}") from e
