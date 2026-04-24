import asyncio
import random
from datetime import datetime


async def random_delay(min_sec: float = 5.0, max_sec: float = 20.0) -> None:
    """Delay acak antara min_sec dan max_sec detik."""
    delay = random.uniform(min_sec, max_sec)
    await asyncio.sleep(delay)


async def typing_simulation(client, entity, duration: float = None) -> None:
    """Simulasi mengetik sebelum kirim pesan."""
    try:
        if duration is None:
            duration = random.uniform(1.5, 4.0)
        async with client.action(entity, "typing"):
            await asyncio.sleep(duration)
    except Exception:
        pass


def human_like_interval(base_delay: float, variance: float = 0.3) -> float:
    """Tambahkan variance ±30% pada delay untuk human-like pattern."""
    delta = base_delay * variance
    return random.uniform(base_delay - delta, base_delay + delta)


def should_add_extra_pause(probability: float = 0.15) -> bool:
    """15% kemungkinan jeda lebih panjang (simulasi distraksi)."""
    return random.random() < probability


async def human_delay(min_sec: float = 5.0, max_sec: float = 20.0) -> float:
    """Delay human-like dengan occasional extra pause."""
    base = random.uniform(min_sec, max_sec)
    total = base
    if should_add_extra_pause():
        total += random.uniform(10, 30)
    await asyncio.sleep(total)
    return total


def rotate_accounts(accounts: list, shift: int = None) -> list:
    """Rotasi urutan akun agar tidak selalu mulai dari akun yang sama."""
    if not accounts:
        return accounts
    if shift is None:
        shift = random.randint(0, len(accounts) - 1)
    return accounts[shift:] + accounts[:shift]
